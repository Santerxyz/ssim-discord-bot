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

export interface TicketCategory {
  id: string;          // stable key used inside customId. Do not rename after launch.
  label: string;       // shown on the panel button or select-menu option
  description: string; // one line under the label
  intro: string;       // first bot message inside the ticket
  staffPing: boolean;  // ping STAFF_ROLE_ID on open
  style?: 'primary' | 'secondary' | 'success';  // panel button colour
  donationPanel?: boolean;  // also post the donation methods when the ticket opens
  needsDonations?: boolean; // hide from the panel unless donation methods are configured
}

// Add, remove, or rename here (keep `id` stable). No code change needed: one entry
// renders the panel as a single button, two or more render it as a select menu.
// Panels already posted embed the topic id in their custom IDs, which is why an existing
// id must stay stable even if its label changes.
export const TICKET_CATEGORIES: TicketCategory[] = [
  {
    id: 'support', label: 'Support', style: 'primary',
    description: 'Questions, technical issues, or anything not working',
    intro: 'Describe your request in as much detail as you can, and a member of our team will get to you shortly.',
    staffPing: true,
  },
  {
    id: 'donation', label: 'Donate', style: 'success',
    description: 'Contribute to SSIM',
    intro: 'Thank you for considering it. The methods are below. Nobody is notified when you open this, so take your time, and close the ticket whenever you are done.',
    // Nobody needs paging because somebody opened the donation options.
    staffPing: false,
    donationPanel: true,
    needsDonations: true,
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
    // Joins and leaves, with the invite each member arrived on. Empty disables the log.
    memberLog: opt('MEMBER_LOG_CHANNEL_ID'),
  },
  roles: {
    staff: req('STAFF_ROLE_ID'),
    // Granted to every human who joins. Empty disables the grant. The bot's own role
    // must sit ABOVE this one in Server Settings, or Discord refuses the assignment.
    member: opt('MEMBER_ROLE_ID'),
  },
  announceWebhookUrl: opt('ANNOUNCE_WEBHOOK_URL'),
  // Source of truth for release announcements: "owner/repo" on GitHub (see releaseApi.ts).
  githubRepo: opt('GITHUB_REPO', 'Santerxyz/SSIM').replace(/^\/+|\/+$/g, ''),
  announceHmacSecret: opt('ANNOUNCE_HMAC_SECRET'),
  httpPort: Number(opt('HTTP_PORT', '8787')),
  httpHost: opt('HTTP_HOST', '0.0.0.0'),
  pollIntervalMs: Math.max(60_000, Number(opt('POLL_INTERVAL_MS', '600000'))),
  ticketAutocloseHours: Number(opt('TICKET_AUTOCLOSE_HOURS', '0')),
};

export type Config = typeof config;
