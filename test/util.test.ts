import { test } from 'node:test';
import assert from 'node:assert';
import crypto from 'node:crypto';
import { isNewer, redactKey, verifyAnnounceHmac, sanitizeNotes, formatReleaseDate } from '../src/util';

test('isNewer: 3-part numeric semver (matches the client)', () => {
  assert.equal(isNewer('1.3.4', '1.3.3'), true);
  assert.equal(isNewer('1.3.3', '1.3.3'), false);
  assert.equal(isNewer('1.3.3', '1.3.4'), false);
  assert.equal(isNewer('2.0.0', '1.9.9'), true);
  assert.equal(isNewer('1.10.0', '1.9.0'), true); // numeric, not lexical
});

test('redactKey keeps only the last group', () => {
  assert.equal(redactKey('SSIM-2YE7-9EST-V2MT-3N3P'), 'SSIM-••••-••••-••••-3N3P');
  assert.equal(redactKey('garbage'), '••••');
});

test('verifyAnnounceHmac round-trips the publisher signing scheme', () => {
  const secret = 'test-secret';
  const body = Buffer.from(JSON.stringify({ version: '1.3.4', url: 'x', notes: 'n', publishedAt: 'p' }));
  const sig = 'sha256=' + crypto.createHmac('sha256', secret).update(body).digest('hex');
  assert.equal(verifyAnnounceHmac(secret, body, sig), true);
  assert.equal(verifyAnnounceHmac(secret, body, sig.replace(/.$/, sig.endsWith('0') ? '1' : '0')), false); // tampered sig
  assert.equal(verifyAnnounceHmac('wrong-secret', body, sig), false);
  assert.equal(verifyAnnounceHmac(secret, Buffer.from('tampered body'), sig), false);
  assert.equal(verifyAnnounceHmac(secret, body, undefined), false);
  assert.equal(verifyAnnounceHmac('', body, sig), false);
  assert.equal(verifyAnnounceHmac(secret, body, 'not-a-sig'), false);
});

test('sanitizeNotes is a no-op for normal diff lines (pixel-identical)', () => {
  const notes = '+ New: thing\n- Fixed: bug\n- Backend Fixes';
  assert.equal(sanitizeNotes(notes), notes);
});

test('sanitizeNotes neutralises fence-breaks and mass mentions', () => {
  assert.ok(!sanitizeNotes('```evil```').includes('```'));
  assert.ok(!/@everyone/.test(sanitizeNotes('ping @everyone now')));
  assert.ok(!/@here/.test(sanitizeNotes('ping @here now')));
});

test('formatReleaseDate: UTC, deterministic', () => {
  assert.equal(formatReleaseDate('2026-06-24T11:46:53.801Z'), 'Jun 24 2026');
  assert.equal(formatReleaseDate('2026-01-01T00:00:00Z'), 'Jan 1 2026');
  assert.equal(formatReleaseDate('not-a-date'), '');
});
