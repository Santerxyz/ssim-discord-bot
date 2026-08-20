import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Point the loader at a scratch file before importing it, since the path is read
// once at module load.
const FILE = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ssim-don-')), 'donations.json');
process.env.DONATIONS_FILE = FILE;

const write = (obj: unknown) => fs.writeFileSync(FILE, JSON.stringify(obj));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { loadDonations, donationsConfigured, findCrypto, addressCustomId } = require('../src/donations') as typeof import('../src/donations');

test('loadDonations keeps valid entries and drops broken ones', () => {
  write({
    paypal: 'https://paypal.me/example',
    crypto: [
      { asset: 'BTC', network: 'Bitcoin', address: 'bc1qexample' },
      { asset: 'USDT', network: 'Tron (TRC20)', address: 'TExample' },
      { asset: 'BAD', network: '', address: 'no-network' },
      { asset: '', network: 'Nowhere', address: 'no-asset' },
      { asset: 'NOADDR', network: 'Somewhere' },
    ],
  });
  loadDonations();

  assert.equal(donationsConfigured(), true);
  assert.ok(findCrypto('BTC', 'BITCOIN'));
  assert.ok(findCrypto('USDT', 'TRONTRC20'));
  assert.equal(findCrypto('BAD', ''), undefined);
  assert.equal(findCrypto('NOADDR', 'SOMEWHERE'), undefined);
});

test('a non-https paypal value is rejected rather than shown', () => {
  write({ paypal: 'javascript:alert(1)', crypto: [] });
  loadDonations();
  assert.equal(donationsConfigured(), false);
});

test('an unreadable file disables donations instead of throwing', () => {
  fs.writeFileSync(FILE, '{ not json');
  loadDonations();
  assert.equal(donationsConfigured(), false);
  assert.equal(findCrypto('BTC', 'BITCOIN'), undefined);
});

// The one that matters. A button posted into a ticket carries asset and network,
// so it has to survive the file being reordered or extended underneath it. An
// index would have pointed at whatever moved into that slot, which means showing
// one coin's address under another coin's heading.
test('an address button still resolves correctly after the file is reordered', () => {
  const btc = { asset: 'BTC', network: 'Bitcoin', address: 'bc1qexample' };
  const tron = { asset: 'USDT', network: 'Tron (TRC20)', address: 'TExample' };
  const erc = { asset: 'USDT', network: 'Ethereum (ERC20)', address: '0xExample' };

  write({ paypal: '', crypto: [btc, tron, erc] });
  loadDonations();
  assert.equal(findCrypto('USDT', 'TRONTRC20')?.address, 'TExample');
  assert.equal(findCrypto('USDT', 'ETHEREUMERC20')?.address, '0xExample');

  // Same coins, different order, plus a new one at the front.
  write({ paypal: '', crypto: [{ asset: 'LTC', network: 'Litecoin', address: 'ltc1example' }, erc, btc, tron] });
  loadDonations();
  assert.equal(findCrypto('USDT', 'TRONTRC20')?.address, 'TExample');
  assert.equal(findCrypto('USDT', 'ETHEREUMERC20')?.address, '0xExample');
  assert.equal(findCrypto('BTC', 'BITCOIN')?.address, 'bc1qexample');
});

test('networks of the same asset stay distinct, so one is never served for the other', () => {
  write({
    paypal: '',
    crypto: [
      { asset: 'USDT', network: 'Tron (TRC20)', address: 'TExample' },
      { asset: 'USDT', network: 'Ethereum (ERC20)', address: '0xExample' },
      { asset: 'USDT', network: 'BNB Smart Chain (BEP20)', address: '0xBscExample' },
    ],
  });
  loadDonations();

  const addresses = ['TRONTRC20', 'ETHEREUMERC20', 'BNBSMARTCHAINBEP20'].map((n) => findCrypto('USDT', n)?.address);
  assert.deepEqual(addresses, ['TExample', '0xExample', '0xBscExample']);
  assert.equal(new Set(addresses).size, 3, 'each network must resolve to its own address');
});

test('a customId stays inside Discord 100 character limit even for absurd names', () => {
  const id = addressCustomId('SOMEVERYLONGTICKERSYMBOLTHATNOBODYWOULDEVERUSE', 'A Ludicrously Long Network Name With Many Words In It Indeed');
  assert.ok(id.length <= 100, `customId was ${id.length} characters`);
  assert.ok(id.startsWith('don:addr:'));
});

test('a duplicated asset and network pair keeps the first and drops the second', () => {
  write({
    paypal: '',
    crypto: [
      { asset: 'BTC', network: 'Bitcoin', address: 'first' },
      { asset: 'BTC', network: 'Bitcoin', address: 'second' },
    ],
  });
  loadDonations();
  assert.equal(findCrypto('BTC', 'BITCOIN')?.address, 'first');
});
