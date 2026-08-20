import { test } from 'node:test';
import assert from 'node:assert';
import { CRYPTO, findAsset, findNetwork, networkCustomId, requestView } from '../src/donations';

test('the catalog holds no addresses, only questions', () => {
  // The bot must never store a receiving address. If a field like this ever
  // appears, the whole safety argument for the manual step is gone.
  for (const c of CRYPTO) {
    assert.ok(Array.isArray(c.networks) && c.networks.length > 0, `${c.asset} needs at least one network`);
    assert.equal('address' in c, false, `${c.asset} must not carry an address`);
    for (const n of c.networks) assert.equal(typeof n, 'string');
  }
});

test('every coin and network resolves from its own key', () => {
  for (const c of CRYPTO) {
    const assetKey = c.asset.toUpperCase().replace(/[^A-Z0-9]/g, '');
    assert.equal(findAsset(assetKey)?.asset, c.asset);
    for (const n of c.networks) {
      const netKey = n.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 40);
      assert.equal(findNetwork(assetKey, netKey), n, `${c.asset} on ${n} did not resolve`);
    }
  }
});

test('networks of one coin stay distinct, so a button cannot land on the wrong one', () => {
  const usdt = findAsset('USDT');
  assert.ok(usdt);
  const ids = usdt.networks.map((n) => networkCustomId(usdt.asset, n));
  assert.equal(new Set(ids).size, ids.length, 'two networks produced the same customId');
});

test('an unknown coin or network resolves to nothing rather than a guess', () => {
  assert.equal(findAsset('DOGE'), undefined);
  assert.equal(findAsset(''), undefined);
  assert.equal(findNetwork('USDT', 'NOSUCHCHAIN'), undefined);
  assert.equal(findNetwork('NOSUCHCOIN', 'SOLANA'), undefined);
});

test('a customId stays inside Discord 100 character limit even for absurd names', () => {
  const id = networkCustomId('SOMEVERYLONGTICKERSYMBOLTHATNOBODYWOULDEVERUSE', 'A Ludicrously Long Network Name With Many Words In It Indeed');
  assert.ok(id.length <= 100, `customId was ${id.length} characters`);
  assert.ok(id.startsWith('don:net:'));
});

test('every configured customId is within the limit', () => {
  for (const c of CRYPTO) {
    for (const n of c.networks) {
      const id = networkCustomId(c.asset, n);
      assert.ok(id.length <= 100, `${id} is ${id.length} characters`);
    }
  }
});

test('the closing message names the coin and network, and warns about addresses elsewhere', () => {
  const body = requestView('USDT', 'Tron (TRC20)').embeds[0].data.description ?? '';
  assert.match(body, /USDT/);
  assert.match(body, /Tron \(TRC20\)/);
  // A donation flow is a phishing target: somebody DMs a fake address while the
  // donor waits. The message has to say that up front.
  assert.match(body, /direct message/i);
});
