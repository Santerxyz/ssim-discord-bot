// ════════════════════════════════════════════════════════════════════════════
//  store.ts: small JSON persistence layer with atomic writes.
//  State lives in memory; every mutation is synchronous then persisted atomically
//  (temp file + rename), so concurrent interactions can't corrupt or race it.
// ════════════════════════════════════════════════════════════════════════════
import fs from 'node:fs';
import path from 'node:path';
import { logger } from './logger';

export interface Ticket {
  channelId: string;
  number: number;
  categoryId: string;   // TicketCategory.id
  openerId: string;
  openerTag: string;
  claimedBy: string | null;
  createdAt: string;
  lastActivityAt: string;
  closed?: boolean;
  warnedAt?: string;   // set when an inactivity warning was posted (auto-close grace window)
}

export interface PostRecord {
  channelId: string;
  messageId: string;
  title: string;
  message: string;
}

interface BotState {
  lastAnnouncedVersion: string;
  ticketCounter: number;
  tickets: Record<string, Ticket>;   // keyed by channelId
  downloadsMessageId: string | null; // the single, edited-in-place "Downloads" message
  posts: Record<string, PostRecord>; // named /post messages (editable later)
}

const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), 'data');
const FILE = path.join(DATA_DIR, 'state.json');

function load(): BotState {
  try {
    if (fs.existsSync(FILE)) {
      const raw = JSON.parse(fs.readFileSync(FILE, 'utf8'));
      return {
        lastAnnouncedVersion: String(raw.lastAnnouncedVersion || '0.0.0'),
        ticketCounter: Number(raw.ticketCounter || 0),
        tickets: raw.tickets && typeof raw.tickets === 'object' ? raw.tickets : {},
        downloadsMessageId: raw.downloadsMessageId || null,
        posts: raw.posts && typeof raw.posts === 'object' ? raw.posts : {},
      };
    }
  } catch (err) {
    // Never crash on a corrupt store. Set it aside and start fresh.
    logger.error('state.json unreadable, starting fresh', { err: (err as Error).message });
    try { fs.copyFileSync(FILE, `${FILE}.corrupt-${Date.now()}`); } catch { /* best effort */ }
  }
  return { lastAnnouncedVersion: '0.0.0', ticketCounter: 0, tickets: {}, downloadsMessageId: null, posts: {} };
}

class Store {
  private state: BotState = load();

  /** Mutate in memory (synchronously) then persist atomically. The synchronous body means no
   *  read-modify-write interleaving between concurrent async interactions. */
  update<T>(fn: (s: BotState) => T): T {
    const out = fn(this.state);
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const tmp = `${FILE}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.state, null, 2));
    fs.renameSync(tmp, FILE); // atomic on same volume
    return out;
  }

  // ── announce idempotency ──
  get lastAnnouncedVersion(): string { return this.state.lastAnnouncedVersion; }
  setLastAnnouncedVersion(v: string): void { this.update((s) => { s.lastAnnouncedVersion = v; }); }

  get downloadsMessageId(): string | null { return this.state.downloadsMessageId; }
  setDownloadsMessageId(id: string): void { this.update((s) => { s.downloadsMessageId = id; }); }

  getPost(name: string): PostRecord | undefined { return this.state.posts[name]; }
  setPost(name: string, rec: PostRecord): void { this.update((s) => { s.posts[name] = rec; }); }

  // ── tickets ──
  nextTicketNumber(): number { return this.update((s) => (s.ticketCounter += 1)); }
  addTicket(t: Ticket): void { this.update((s) => { s.tickets[t.channelId] = t; }); }
  getTicket(channelId: string): Ticket | undefined { return this.state.tickets[channelId]; }
  removeTicket(channelId: string): void { this.update((s) => { delete s.tickets[channelId]; }); }
  updateTicket(channelId: string, patch: Partial<Ticket>): void {
    this.update((s) => { const t = s.tickets[channelId]; if (t) Object.assign(t, patch); });
  }
  listTickets(): Ticket[] { return Object.values(this.state.tickets); }
  /** One open ticket per user per category. */
  openTicketFor(openerId: string, categoryId: string): Ticket | undefined {
    return Object.values(this.state.tickets).find((t) => t.openerId === openerId && t.categoryId === categoryId && !t.closed);
  }
}

export const store = new Store();
