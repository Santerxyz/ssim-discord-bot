import { test } from 'node:test';
import assert from 'node:assert';
import { formatReleasePost } from '../src/format';

test("formatReleasePost matches the owner's exact hand-posted style", () => {
  const notes = [
    '+ New: SDA Overview, live Steam Guard code with a 30s timer + one-click copy',
    '+ Improved: update security',
    '- Fixed: trade-locked items can no longer be listed for sale',
    '- Backend Fixes',
  ].join('\n');
  const out = formatReleasePost({
    version: '1.3.1',
    notes,
    url: 'https://license.ssim.dev/download/SSIM-1.3.1.exe',
    publishedAt: '2026-06-24T11:46:53.801Z',
  });
  const expected =
    '**SSIM • v1.3.1 • Jun 24 2026**\n' +
    '```diff\n' +
    notes + '\n' +
    '```\n' +
    '⬇️ Manual update: https://license.ssim.dev/download/SSIM-1.3.1.exe';
  assert.equal(out, expected);
});

test('formatReleasePost without notes → header + manual-update line only (no empty fence)', () => {
  const out = formatReleasePost({ version: '1.3.2', url: 'https://x/y.exe', publishedAt: '2026-06-24T00:00:00Z' });
  assert.equal(out, '**SSIM • v1.3.2 • Jun 24 2026**\n⬇️ Manual update: https://x/y.exe');
  assert.ok(!out.includes('```'));
});

test('formatReleasePost preserves +/- lines verbatim inside the diff fence', () => {
  const out = formatReleasePost({ version: '1.0.0', notes: '+ a\n- b', url: 'u' });
  assert.ok(out.includes('```diff\n+ a\n- b\n```'));
});
