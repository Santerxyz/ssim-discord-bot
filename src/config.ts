// ════════════════════════════════════════════════════════════════════════════
//  config.ts — env loading + validation + the ticket-category config.
//
//  Fails FAST (throws) if a required var is missing — no silent half-configured
//  bot. Importing this module has side effects (reads .env), so pure/testable
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

export type TicketKind = 'license' | 'support' | 'bug' | 'billing' | 'other';

export interface TicketCategory {
  id: string;          // stable key used inside customId — DO NOT rename after launch
  label: string;       // select-menu label
  emoji: string;       // select-menu emoji + channel-name prefix
  description: string;  // select-menu description
  intro: string;       // first bot message inside the ticket
  staffPing: boolean;  // ping STAFF_ROLE_ID on open
  kind: TicketKind;
}

// Versatile by design: add / remove / rename here (keep `id` stable) — no code change needed.
export const TICKET_CATEGORIES: TicketCategory[] = [
  {
    id: 'license', label: 'License / Get Access', emoji: '🔑', kind: 'license',
    description: 'Get your license key + unlock the server',
    intro: 'Welcome! Use the buttons below to retrieve your license and unlock access.',
    staffPing: false,
  },
  {
    id: 'support', label: 'Support / Help', emoji: '🛠️', kind: 'support',
    description: 'General questions & help',
    intro: 'How can we help? Describe your issue and a staff member will jump in.',
    staffPing: true,
  },
  {
    id: 'bug', label: 'Bug Report', emoji: '🐛', kind: 'bug',
    description: 'Report something broken',
    intro: 'Thanks for the report — your details are below. Staff will follow up here.',
    staffPing: true,
  },
  {
    id: 'billing', label: 'Purchase / Billing', emoji: '💳', kind: 'billing',
    description: 'Buy a license or billing questions',
    intro: 'Tell us what you need (new license, renewal, invoice…) and staff will assist.',
    staffPing: true,
  },
];

export const config = {
  token: req('DISCORD_TOKEN'),
  clientId: req('DISCORD_CLIENT_ID'),
  guildId: req('GUILD_ID'),
  channels: {
    announce: opt('ANNOUNCE_CHANNEL_ID'),
    onboarding: req('ONBOARDING_CHANNEL_ID'),
    ticketCategory: req('TICKET_CATEGORY_ID'),
    audit: opt('AUDIT_CHANNEL_ID'),
    ticketLog: opt('TICKET_LOG_CHANNEL_ID'),
  },
  roles: {
    staff: req('STAFF_ROLE_ID'),
    betaTester: req('BETA_TESTER_ROLE_ID'),
  },
  announceWebhookUrl: opt('ANNOUNCE_WEBHOOK_URL'),
  licenseApiUrl: req('LICENSE_API_URL').replace(/\/+$/, ''),
  botApiToken: req('BOT_API_TOKEN'),
  announceHmacSecret: opt('ANNOUNCE_HMAC_SECRET'),
  httpPort: Number(opt('HTTP_PORT', '8787')),
  httpHost: opt('HTTP_HOST', '0.0.0.0'),
  pollIntervalMs: Math.max(60_000, Number(opt('POLL_INTERVAL_MS', '600000'))),
  ticketAutocloseHours: Number(opt('TICKET_AUTOCLOSE_HOURS', '0')),
};

export type Config = typeof config;
