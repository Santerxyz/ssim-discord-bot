// ════════════════════════════════════════════════════════════════════════════
//  licenseApi.ts — client for the ssim-license-server bot API + public /version.
//  Uses the scoped BOT_API_TOKEN bearer (never the admin password). Every call
//  returns a structured result so callers branch on status without try/catch.
// ════════════════════════════════════════════════════════════════════════════
import { config } from './config';
import { logger } from './logger';

export interface License {
  key: string;
  tier: string;
  seats: number;
  usedSeats?: number;
  status: 'active' | 'revoked';
  note?: string;
  expiresAt?: string | null;
  discordId?: string | null;
  discordUsername?: string | null;
}

export interface Whois {
  key: string;
  keyRedacted: string;
  tier: string;
  status: string;
  seats: number;
  usedSeats: number;
  expiresAt?: string | null;
  discordId?: string | null;
  discordUsername?: string | null;
  note?: string;
}

export interface VersionManifest {
  latest: string;
  url?: string;
  sha256?: string;
  kind?: string;
  notes?: string;
  publishedAt?: string;
}

export interface ApiResult<T> { ok: boolean; status: number; data: T | null; error?: string }

async function call<T>(method: string, apiPath: string, body?: unknown, auth = true): Promise<ApiResult<T>> {
  const url = `${config.licenseApiUrl}${apiPath}`;
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (auth) headers['Authorization'] = `Bearer ${config.botApiToken}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  try {
    const res = await fetch(url, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
    let data: unknown = null;
    try { data = await res.json(); } catch { /* empty / non-JSON body */ }
    const err = res.ok ? undefined : ((data as { error?: string })?.error || `HTTP ${res.status}`);
    return { ok: res.ok, status: res.status, data: (data as T | null), error: err };
  } catch (err) {
    logger.error(`license API ${method} ${apiPath} failed`, { err: (err as Error).message });
    return { ok: false, status: 0, data: null, error: (err as Error).message };
  }
}

export const licenseApi = {
  // public
  getVersion: () => call<VersionManifest>('GET', '/version', undefined, false),

  // bot-scoped (Bearer BOT_API_TOKEN)
  byDiscord: (discordId: string) => call<License>('GET', `/admin/api/bot/by-discord/${encodeURIComponent(discordId)}`),
  whois: (discordId: string) => call<Whois>('GET', `/admin/api/bot/whois/${encodeURIComponent(discordId)}`),
  claim: (p: { key: string; discordId: string; discordUsername?: string }) => call<License>('POST', '/admin/api/bot/claim', p),
  selfIssue: (p: { discordId: string; discordUsername?: string }) => call<License>('POST', '/admin/api/bot/self-issue', p),
  assign: (p: { key: string; discordId: string; discordUsername?: string }) => call<License>('POST', '/admin/api/bot/assign', p),
  unassign: (key: string) => call<License>('POST', '/admin/api/bot/unassign', { key }),
};
