// ════════════════════════════════════════════════════════════════════════════
//  format.ts — the EXACT release-announcement body. Pure (no discord.js) so its
//  pixel-fidelity is unit-tested. The bot only PREPENDS the header, WRAPS the
//  fence, and APPENDS the manual-update line — it never rewrites the notes.
// ════════════════════════════════════════════════════════════════════════════
import { formatReleaseDate, sanitizeNotes } from './util';

export interface ReleasePost {
  version: string;
  notes?: string;
  url?: string;
  publishedAt?: string;
}

/**
 * Owner's style (matches the hand-posted screenshots):
 *
 *   **SSIM • v1.3.1 • Jun 24 2026**
 *   ```diff
 *   + New: …
 *   - Fixed: …
 *   ```
 *   ⬇️ Manual update: https://license.ssim.dev/download/SSIM-1.3.1.exe
 */
export function formatReleasePost(p: ReleasePost): string {
  const date = formatReleaseDate(p.publishedAt);
  const header = `**SSIM • v${p.version}${date ? ` • ${date}` : ''}**`;
  const lines = [header];
  const notes = (p.notes ?? '').trim();
  if (notes) lines.push('```diff\n' + sanitizeNotes(notes) + '\n```');
  if (p.url) lines.push(`⬇️ Manual update: ${p.url}`);
  return lines.join('\n');
}
