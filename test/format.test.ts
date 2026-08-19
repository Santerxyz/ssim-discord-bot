import { test } from 'node:test';
import assert from 'node:assert';
import { formatReleasePost } from '../src/format';

test('formatReleasePost: header + diff notes + downloads pointer', () => {
  const notes = [
    '+ New: SDA Overview with a live Steam Guard code',
    '- Fixed: trade-locked items can no longer be listed',
  ].join('\n');
  const out = formatReleasePost({
    version: '1.3.4', notes, publishedAt: '2026-06-24T11:46:53.801Z', downloadsMention: '<#123>',
  });
  const expected =
    '**SSIM • v1.3.4 • Jun 24 2026**\n' +
    '```diff\n' +
    notes + '\n' +
    '```\n' +
    'A manual update may be required for this version. Downloads: <#123>';
  assert.equal(out, expected);
});

test('formatReleasePost without notes → header + notice only (no fence)', () => {
  const out = formatReleasePost({ version: '1.3.5', publishedAt: '2026-06-24T00:00:00Z', downloadsMention: '<#9>' });
  assert.equal(out, '**SSIM • v1.3.5 • Jun 24 2026**\nA manual update may be required for this version. Downloads: <#9>');
  assert.ok(!out.includes('```'));
});

test('formatReleasePost preserves +/- lines verbatim; generic notice without a mention', () => {
  const out = formatReleasePost({ version: '1.0.0', notes: '+ a\n- b' });
  assert.ok(out.includes('```diff\n+ a\n- b\n```'));
  assert.ok(out.includes('A manual update may be required for this version.'));
  assert.ok(!out.includes('Downloads:'));
});

// announce.ts decides whether a posted announcement needs editing by re-rendering the
// release and comparing it to the body it stored. These two properties are what make
// that comparison mean anything.

test('formatReleasePost is stable for identical input, so a poll does not edit forever', () => {
  const p = { version: '1.4.0', notes: '+ New: thing', publishedAt: '2026-08-01T09:00:00Z', downloadsMention: '<#7>' };
  assert.equal(formatReleasePost(p), formatReleasePost({ ...p }));
});

test('formatReleasePost changes when the notes change, so an edit is detected', () => {
  const base = { version: '1.4.0', publishedAt: '2026-08-01T09:00:00Z', downloadsMention: '<#7>' };
  const before = formatReleasePost({ ...base, notes: '+ New: thing' });
  const after = formatReleasePost({ ...base, notes: '+ New: thing\n- Fixed: typo' });
  assert.notEqual(before, after);
  assert.ok(after.includes('- Fixed: typo'));
});
