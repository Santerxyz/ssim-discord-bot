// ════════════════════════════════════════════════════════════════════════════
//  donations.ts: the donation methods shown inside a donation ticket.
//
//  Addresses are read from a local JSON file and from nowhere else. They are
//  never taken from a message, a command argument, or anything a user can
//  influence. A donation address is the one thing here worth attacking: swap it
//  and the money goes to somebody else, silently, with no way to get it back.
//  Keeping the only source of truth on the operator's own disk is what stops
//  that, so do not add a path that lets one be supplied at runtime.
//
//  The file lives under DATA_DIR, which is gitignored, so nobody publishes their
//  own wallet addresses by pushing the repo. donations.example.json shows the
//  shape.
// ════════════════════════════════════════════════════════════════════════════
import fs from 'node:fs';
import path from 'node:path';
import {
  EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, TextChannel, ButtonInteraction,
  MessageActionRowComponentBuilder,
} from 'discord.js';
import { DATA_DIR } from './store';
import { logger } from './logger';
import { BRAND } from './util';

export interface CryptoOption {
  asset: string;    // "USDT"
  network: string;  // "Tron (TRC20)"
  address: string;
  memo?: string;    // some chains reject a deposit without a memo or tag
}

interface DonationConfig {
  paypal: string;
  crypto: CryptoOption[];
}

const FILE = process.env.DONATIONS_FILE || path.join(DATA_DIR, 'donations.json');

let cfg: DonationConfig = { paypal: '', crypto: [] };

/**
 * A stable identifier for a customId.
 *
 * Buttons are addressed by asset and network, never by position in the array. A
 * message posted today has to still resolve to the same address after the file is
 * edited and the bot restarts, and an index would quietly point at whatever moved
 * into that slot. Renaming an asset or a network in the file breaks old buttons
 * instead, which is the safe direction to fail: the donor sees the coin list again
 * rather than somebody else's address.
 */
// 40 leaves a customId of at most 9 + 40 + 1 + 40 = 90, inside Discord's limit of
// 100, and is long enough that two real network names cannot collide by truncation.
const key = (s: string, max = 40) => s.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, max);

/** The entry a `don:addr:<asset>:<network>` button points at, or undefined. */
export function findCrypto(assetKey: string, networkKey: string): CryptoOption | undefined {
  return cfg.crypto.find((c) => key(c.asset) === assetKey && key(c.network) === networkKey);
}

/** Exported so a test can hold it to Discord's 100 character customId limit. */
export const addressCustomId = (asset: string, network: string) => `don:addr:${key(asset)}:${key(network)}`;

const idFor = (o: CryptoOption) => addressCustomId(o.asset, o.network);

/** Read the file. Anything malformed is dropped with a warning rather than
 *  crashing the bot or, worse, showing half an address. */
export function loadDonations(): void {
  cfg = { paypal: '', crypto: [] };
  if (!fs.existsSync(FILE)) {
    logger.info(`no donations file at ${FILE}, the donation topic stays hidden`);
    return;
  }
  try {
    const raw = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    const paypal = typeof raw.paypal === 'string' ? raw.paypal.trim() : '';
    if (paypal && !/^https:\/\//i.test(paypal)) {
      logger.warn('donations: paypal must be an https URL, ignoring it');
    } else {
      cfg.paypal = paypal;
    }
    if (Array.isArray(raw.crypto)) {
      for (const e of raw.crypto) {
        const asset = typeof e?.asset === 'string' ? e.asset.trim() : '';
        const network = typeof e?.network === 'string' ? e.network.trim() : '';
        const address = typeof e?.address === 'string' ? e.address.trim() : '';
        if (!asset || !network || !address) { logger.warn('donations: skipping an entry missing asset, network or address'); continue; }
        const memo = typeof e?.memo === 'string' && e.memo.trim() ? e.memo.trim() : undefined;
        // Two entries sharing an asset and network would be indistinguishable to a
        // button, so the second is dropped rather than silently shadowed.
        if (findCrypto(key(asset), key(network))) {
          logger.warn(`donations: ${asset} on ${network} is listed twice, keeping the first`);
          continue;
        }
        cfg.crypto.push({ asset, network, address, memo });
      }
    }
    logger.info(`donations loaded: ${cfg.paypal ? 'paypal, ' : ''}${cfg.crypto.length} crypto option(s)`);
  } catch (err) {
    logger.error('donations file unreadable, donations stay disabled', { err: (err as Error).message });
    cfg = { paypal: '', crypto: [] };
  }
}

export function donationsConfigured(): boolean {
  return Boolean(cfg.paypal) || cfg.crypto.length > 0;
}

const assets = () => [...new Set(cfg.crypto.map((c) => c.asset))];
const networksFor = (asset: string) => cfg.crypto.filter((c) => key(c.asset) === key(asset));

const backRow = (...extra: ButtonBuilder[]) =>
  new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
    ...extra,
    new ButtonBuilder().setCustomId('don:home').setLabel('Back').setStyle(ButtonStyle.Secondary),
  );

type View = { embeds: EmbedBuilder[]; components: ActionRowBuilder<MessageActionRowComponentBuilder>[] };

/** The first screen: pick a method. */
export function methodView(): View {
  const embed = new EmbedBuilder()
    .setColor(BRAND)
    .setTitle('Support SSIM')
    .setDescription(
      'Thank you for considering it.\n\n' +
      'Donations are never required and no feature is locked behind them. They cover the running costs and nothing more.\n\n' +
      'Pick a method below and the details appear here.',
    );
  const row = new ActionRowBuilder<MessageActionRowComponentBuilder>();
  if (cfg.paypal) row.addComponents(new ButtonBuilder().setCustomId('don:paypal').setLabel('PayPal').setStyle(ButtonStyle.Primary));
  if (cfg.crypto.length) row.addComponents(new ButtonBuilder().setCustomId('don:coins').setLabel('Crypto').setStyle(ButtonStyle.Primary));
  if (!row.components.length) {
    return { embeds: [embed.setDescription('Donation methods are not set up yet. Staff will follow up here.')], components: [] };
  }
  return { embeds: [embed], components: [row] };
}

function paypalView(): View {
  const embed = new EmbedBuilder()
    .setColor(BRAND)
    .setTitle('PayPal')
    .setDescription(
      'Use the button below.\n\n' +
      'If PayPal offers the choice, sending as **Friends and Family** avoids the fee. Only do that if you are comfortable with it, since it gives up buyer protection, and there is nothing to protect here anyway: this is a donation, not a purchase.',
    );
  const link = new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('Open PayPal').setURL(cfg.paypal);
  return { embeds: [embed], components: [backRow(link)] };
}

function coinsView(): View {
  const list = assets();
  const embed = new EmbedBuilder()
    .setColor(BRAND)
    .setTitle('Crypto')
    .setDescription(list.length ? 'Pick the coin you want to send.' : 'No crypto options are configured.');

  const rows: ActionRowBuilder<MessageActionRowComponentBuilder>[] = [];
  // Five buttons to a row, four rows at most, because the fifth row is the Back button.
  for (let i = 0; i < Math.min(list.length, 20); i += 5) {
    const row = new ActionRowBuilder<MessageActionRowComponentBuilder>();
    for (const asset of list.slice(i, i + 5)) {
      row.addComponents(new ButtonBuilder().setCustomId(`don:asset:${key(asset)}`).setLabel(asset).setStyle(ButtonStyle.Secondary));
    }
    rows.push(row);
  }
  rows.push(backRow());
  return { embeds: [embed], components: rows };
}

function networkView(asset: string): View {
  const options = networksFor(asset);
  if (options.length === 0) return coinsView();
  // One network means there is no choice to present, so skip straight to the address.
  if (options.length === 1) return addressView(options[0]);

  const embed = new EmbedBuilder()
    .setColor(BRAND)
    .setTitle(`${options[0].asset}: choose a network`)
    .setDescription(
      `**${options[0].asset}** exists on more than one network, and they are not interchangeable.\n\n` +
      'Pick the one you will actually send from. Sending on the wrong network loses the funds permanently.',
    );
  const row = new ActionRowBuilder<MessageActionRowComponentBuilder>();
  for (const o of options.slice(0, 5)) {
    row.addComponents(
      new ButtonBuilder().setCustomId(idFor(o)).setLabel(o.network.slice(0, 80)).setStyle(ButtonStyle.Secondary),
    );
  }
  const back = new ButtonBuilder().setCustomId('don:coins').setLabel('Back to coins').setStyle(ButtonStyle.Secondary);
  return { embeds: [embed], components: [row, backRow(back)] };
}

function addressView(o: CryptoOption | undefined): View {
  if (!o) return coinsView();

  const embed = new EmbedBuilder()
    .setColor(BRAND)
    .setTitle(`${o.asset} on ${o.network}`)
    .setDescription(
      `Send **${o.asset}** on the **${o.network}** network to this address, and nothing else. ` +
      'A different coin, or the right coin on a different network, is lost and cannot be recovered.\n\n' +
      `\`\`\`\n${o.address}\n\`\`\``,
    )
    .setFooter({ text: 'Check the first and last characters against the address in your wallet before you send.' });

  if (o.memo) {
    embed.addFields({
      name: 'Memo or tag, required',
      value: `\`\`\`\n${o.memo}\n\`\`\`\nA transfer without this may not be credited.`,
    });
  }

  const back = new ButtonBuilder().setCustomId('don:coins').setLabel('Back to coins').setStyle(ButtonStyle.Secondary);
  return { embeds: [embed], components: [backRow(back)] };
}

/** Posted into a donation ticket when it opens. */
export async function sendDonationPanel(channel: TextChannel): Promise<void> {
  await channel.send(methodView()).catch((err) => logger.warn('donation panel post failed', { err: (err as Error).message }));
}

/** Routes every `don:` button. Returns false when the id is not ours. */
export async function handleDonationButton(interaction: ButtonInteraction): Promise<boolean> {
  const id = interaction.customId;
  if (!id.startsWith('don:')) return false;

  if (id === 'don:home') { await interaction.update(methodView()); return true; }
  if (id === 'don:paypal') { await interaction.update(cfg.paypal ? paypalView() : methodView()); return true; }
  if (id === 'don:coins') { await interaction.update(coinsView()); return true; }
  if (id.startsWith('don:asset:')) { await interaction.update(networkView(id.slice('don:asset:'.length))); return true; }
  if (id.startsWith('don:addr:')) {
    const [asset, network] = id.slice('don:addr:'.length).split(':');
    // findCrypto returning nothing means the file changed under a live button. The
    // coin list is the right answer there, never a guess at what was meant.
    await interaction.update(addressView(findCrypto(asset || '', network || '')));
    return true;
  }
  return false;
}
