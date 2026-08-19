// ════════════════════════════════════════════════════════════════════════════
//  config.ts: env loading, validation, and the ticket topic config.
//
//  Fails fast (throws) if a required var is missing, so there is no silently
//  half-configured bot. Importing this module reads .env, so pure and testable
//  modules (util, format) MUST NOT import it.
// ════════════════════════════════════════════════════════════════════════════
import 'dotenv/config';

function req(name: string): string {
  const v = (process.env[name] || '').trim();
  if (!v) throw new Error(`Missing required env var: ${name} (see .env.example)`);
  return v;
}
function opt(name: string, def = ''): string {
  const v = process.env[name];
  return v === undefined || v === '' ? def : v.trim();
}

export type TicketKind = 'support' | 'bug' | 'billing' | 'other';

export interface TicketCategory {
  id: string;          // stable key used inside customId. Do not rename after launch.
  label: string;       // select-menu label
  description: string;  // select-menu description
  intro: string;       // first bot message inside the ticket
  staffPing: boolean;  // ping STAFF_ROLE_ID on open
  kind: TicketKind;
}

// Add, remove, or rename here (keep `id` stable). No code change needed.
// Panels already posted embed the topic id in their custom IDs, which is why an existing
// id must stay stable even if its label changes.
export const TICKET_CATEGORIES: TicketCategory[] = [
  {
    id: 'support', label: 'Support', kind: 'support',
    description: 'Questions, technical issues, or assistance',
    intro: 'Please describe your request in as much detail as possible, and a member of our team will assist you shortly.',
    staffPing: true,
  },
];

export const config = {
  token: req('DISCORD_TOKEN'),
  clientId: req('DISCORD_CLIENT_ID'),
  guildId: req('GUILD_ID'),
  channels: {
    announce: opt('ANNOUNCE_CHANNEL_ID'),
    downloads: opt('DOWNLOADS_CHANNEL_ID'),
    onboarding: req('ONBOARDING_CHANNEL_ID'),
    ticketCategory: req('TICKET_CATEGORY_ID'),
    audit: opt('AUDIT_CHANNEL_ID'),
    ticketLog: opt('TICKET_LOG_CHANNEL_ID'),
  },
  roles: {
    staff: req('STAFF_ROLE_ID'),
  },
  announceWebhookUrl: opt('ANNOUNCE_WEBHOOK_URL'),
  // Full-install ZIP: one fixed download link shown in the downloads channel. It stays the same
  // across releases, so it is set once in .env and used automatically.
  downloadZipUrl: opt('DOWNLOAD_ZIP_URL'),
  // Source of truth for release announcements: "owner/repo" on GitHub (see releaseApi.ts).
  githubRepo: opt('GITHUB_REPO', 'Santerxyz/SSIM').replace(/^\/+|\/+$/g, ''),
  announceHmacSecret: opt('ANNOUNCE_HMAC_SECRET'),
  httpPort: Number(opt('HTTP_PORT', '8787')),
  httpHost: opt('HTTP_HOST', '0.0.0.0'),
  pollIntervalMs: Math.max(60_000, Number(opt('POLL_INTERVAL_MS', '600000'))),
  ticketAutocloseHours: Number(opt('TICKET_AUTOCLOSE_HOURS', '0')),
};

export type Config = typeof config;
