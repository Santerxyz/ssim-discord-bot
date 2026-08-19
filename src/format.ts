// ════════════════════════════════════════════════════════════════════════════
//  format.ts: the exact release-announcement body. Pure (no discord.js), so its
//  pixel-fidelity is unit-tested. The bot only PREPENDS the header, WRAPS the
//  fence, and appends the manual-update line. It never rewrites the notes.
// ════════════════════════════════════════════════════════════════════════════
import { formatReleaseDate, sanitizeNotes } from './util';

export interface ReleasePost {
  version: string;
  notes?: string;
  publishedAt?: string;
  downloadsMention?: string; // channel mention "<#id>" where the downloads live
}

/**
 * The updates-channel message:
 *
 *   **SSIM • v1.3.4 • Jul 1 2026**
 *   ```diff
 *   + New: …
 *   - Fixed: …
 *   ```
 *   A manual update may be required for this version. Downloads: <#…>
 *
 * The actual download links live in the separate downloads channel (see announce.upsertDownloads).
 */
export function formatReleasePost(p: ReleasePost): string {
  const date = formatReleaseDate(p.publishedAt);
  const header = `**SSIM • v${p.version}${date ? ` • ${date}` : ''}**`;
  const lines = [header];
  const notes = (p.notes ?? '').trim();
  if (notes) lines.push('```diff\n' + sanitizeNotes(notes) + '\n```');
  lines.push(p.downloadsMention
    ? `A manual update may be required for this version. Downloads: ${p.downloadsMention}`
    : 'A manual update may be required for this version.');
  return lines.join('\n');
}
