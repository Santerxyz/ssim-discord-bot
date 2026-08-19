// ════════════════════════════════════════════════════════════════════════════
//  util.ts: pure helpers (no discord.js, no config import) so they stay unit-
//  testable in isolation and can be reused anywhere.
// ════════════════════════════════════════════════════════════════════════════
import crypto from 'node:crypto';

/** SSIM brand violet (#7e22ce, the app's brand.dark). Reads cleaner and less pink than the brighter
 *  #9333ea as a Discord embed bar, while staying on-theme. Used on every embed. */
export const BRAND = 0x7e22ce;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "2026-06-24T11:46:53Z" → "Jun 24 2026" (UTC, deterministic). '' for an invalid date. */
export function formatReleaseDate(iso?: string): string {
  const d = iso ? new Date(iso) : new Date();
  if (Number.isNaN(d.getTime())) return '';
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()} ${d.getUTCFullYear()}`;
}

/** 3-part numeric semver compare, identical to the client's Updater.isNewer, so the bot's
 *  "is this release newer?" decision matches what the app itself would do. */
export function isNewer(remote: string, local: string): boolean {
  const r = String(remote).split('.').map((n) => parseInt(n, 10) || 0);
  const l = String(local).split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) {
    const a = r[i] || 0;
    const b = l[i] || 0;
    if (a > b) return true;
    if (a < b) return false;
  }
  return false;
}

/**
 * Verify the push-to-announce HMAC. The publisher signs the exact body bytes:
 *   HMAC-SHA256(secret, rawBody) → hex, header  "X-SSIM-Signature: sha256=<hex>".
 * Constant-time compare. False on any malformed input.
 */
export function verifyAnnounceHmac(secret: string, rawBody: Buffer, header?: string | null): boolean {
  if (!secret || !header) return false;
  const m = /^sha256=([0-9a-f]{64})$/i.exec(String(header).trim());
  if (!m) return false;
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest();
  let got: Buffer;
  try { got = Buffer.from(m[1], 'hex'); } catch { return false; }
  return got.length === expected.length && crypto.timingSafeEqual(got, expected);
}

/**
 * Make release notes safe to drop inside a ```diff fence. The notes are author-written but
 * arrive from outside the bot, so they are treated as untrusted:
 *   - neutralise ``` (fence-break) with a zero-width space,
 *   - defang @everyone and @here (every message is also sent with mentions disabled),
 *   - cap length so one field can't blow past Discord's 4096-char embed limit.
 * Normal +/- lines are preserved verbatim, so the diff renders exactly as written.
 */
export function sanitizeNotes(notes: string, max = 3500): string {
  let s = String(notes ?? '');
  s = s.replace(/```/g, '`​``');               // break fence-escape attempts (zero-width space)
  s = s.replace(/@(everyone|here)/gi, '@​$1'); // defang mass mentions
  if (s.length > max) s = s.slice(0, max - 1) + '…';
  return s;
}
