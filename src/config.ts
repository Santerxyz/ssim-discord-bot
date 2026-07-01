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
  description: string;  // select-menu description
  intro: string;       // first bot message inside the ticket
  staffPing: boolean;  // ping STAFF_ROLE_ID on open
  kind: TicketKind;
}

// Two topics only. Add / remove / rename here (keep `id` stable) — no code change needed.
export const TICKET_CATEGORIES: TicketCategory[] = [
  {
    id: 'license', label: 'License / Get Access', kind: 'license',
    description: 'Retrieve, generate, or activate your license',
    intro: 'Welcome. Use the options below to retrieve or generate your license and unlock access to the server.',
    staffPing: false,
  },
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
