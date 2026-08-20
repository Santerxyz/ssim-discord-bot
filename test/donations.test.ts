import { test } from 'node:test';
import assert from 'node:assert';
import { sanitizeAnswer, requestView, cryptoModal } from '../src/donations';

// The coin and the network are typed by the donor and end up in a message that
// mentions the staff role. allowedMentions is what stops a ping, but the text still
// has to be unable to break the message it lands in or to look like a mention.

test('a mass mention cannot survive into the staff ping', () => {
  assert.equal(sanitizeAnswer('@everyone'), '');
  assert.equal(sanitizeAnswer('BTC @everyone'), 'BTC');
  assert.equal(sanitizeAnswer('@here now'), 'now');
  assert.equal(sanitizeAnswer('BTC @EveryOne'), 'BTC');
});

test('raw user, role and channel mentions are stripped', () => {
  assert.equal(sanitizeAnswer('<@123456789>'), '');
  assert.equal(sanitizeAnswer('<@!123456789> BTC'), 'BTC');
  assert.equal(sanitizeAnswer('<@&987654321> ETH'), 'ETH');
  assert.equal(sanitizeAnswer('<#555> USDT'), 'USDT');
});

test('markdown that would break the surrounding message is removed', () => {
  // The answer is rendered inside **bold**, so a stray asterisk or backtick would
  // spill formatting into the rest of the line.
  assert.equal(sanitizeAnswer('BTC**'), 'BTC');
  assert.equal(sanitizeAnswer('`BTC`'), 'BTC');
  assert.equal(sanitizeAnswer('B_T_C'), 'BTC');
  assert.equal(sanitizeAnswer('BTC||spoiler||'), 'BTCspoiler');
  assert.equal(sanitizeAnswer('<script>'), 'script');
});

test('whitespace is collapsed and trimmed', () => {
  assert.equal(sanitizeAnswer('  Tron   (TRC20)  '), 'Tron (TRC20)');
  assert.equal(sanitizeAnswer('BTC\n\nBitcoin'), 'BTC Bitcoin');
});

test('length is capped so one answer cannot fill the message', () => {
  assert.equal(sanitizeAnswer('A'.repeat(500), 20).length, 20);
  assert.equal(sanitizeAnswer('A'.repeat(500)).length, 40);
});

test('an answer made only of stripped characters comes back empty', () => {
  // handleDonationModal refuses to page staff on this, rather than posting a
  // request with a blank coin.
  assert.equal(sanitizeAnswer('@everyone'), '');
  assert.equal(sanitizeAnswer('***'), '');
  assert.equal(sanitizeAnswer('   '), '');
});

test('ordinary answers are left exactly as typed', () => {
  for (const s of ['BTC', 'Bitcoin', 'Tron (TRC20)', 'BNB Smart Chain (BEP20)', 'USDT', 'XRP Ledger']) {
    assert.equal(sanitizeAnswer(s), s);
  }
});

test('the closing message repeats the answers and warns about addresses elsewhere', () => {
  const body = requestView('USDT', 'Tron (TRC20)').embeds[0].data.description ?? '';
  assert.match(body, /USDT/);
  assert.match(body, /Tron \(TRC20\)/);
  // A donation flow is a phishing target: somebody DMs a fake address while the
  // donor waits. The message has to say that up front.
  assert.match(body, /direct message/i);
  assert.match(body, /wrong/i);
});

test('the form asks for the coin and the network, and both are required', () => {
  const json = cryptoModal().toJSON();
  const inputs = json.components.map((r) => r.components[0]);
  assert.deepEqual(inputs.map((i) => i.custom_id), ['coin', 'network']);
  assert.ok(inputs.every((i) => i.required), 'both fields must be required');
  // Discord rejects a modal whose label is over 45 characters, and it fails at
  // open time rather than at build time.
  assert.ok(inputs.every((i) => (i.label ?? '').length <= 45), 'a label is too long for Discord');
});
