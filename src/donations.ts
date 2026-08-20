// ════════════════════════════════════════════════════════════════════════════
//  donations.ts: the donation methods offered inside a donation ticket.
//
//  The bot never holds a crypto address. It asks which coin and which network,
//  states the answer back, and pings staff to send the address by hand. That is
//  deliberate: an address stored in a config file, a database or a message is an
//  address that can be swapped, and a donor who sends to the wrong one has no way
//  to get it back. A human posting it into a private ticket keeps a person in the
//  loop at the one moment where being wrong is unrecoverable.
//
//  PayPal is different. It is a link, not an address, and a wrong link is visible
//  the moment the page loads, so it comes from the environment.
//
//  process.env is read directly rather than through config.ts so the view builders
//  stay importable in tests without a full environment.
// ════════════════════════════════════════════════════════════════════════════
import {
  EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, TextChannel, ButtonInteraction,
  MessageActionRowComponentBuilder,
} from 'discord.js';
import { logger } from './logger';
import { BRAND } from './util';

/**
 * What can be donated, and on which networks.
 *
 * Edit this to match what you actually accept. Nothing here is secret and nothing
 * here is an address: it is only the set of questions the donor is asked. A coin
 * with one network never shows a network question.
 */
export interface CryptoAsset {
  asset: string;
  networks: string[];
}

export const CRYPTO: CryptoAsset[] = [
  { asset: 'BTC', networks: ['Bitcoin'] },
  { asset: 'ETH', networks: ['Ethereum (ERC20)', 'Arbitrum One', 'Base'] },
  { asset: 'USDT', networks: ['Tron (TRC20)', 'Ethereum (ERC20)', 'BNB Smart Chain (BEP20)', 'Solana'] },
  { asset: 'USDC', networks: ['Ethereum (ERC20)', 'Solana', 'Base', 'Polygon'] },
  { asset: 'LTC', networks: ['Litecoin'] },
  { asset: 'SOL', networks: ['Solana'] },
];

const paypalUrl = () => {
  const v = (process.env.DONATE_PAYPAL_URL || '').trim();
  // A link is the one thing a donor follows without reading, so refuse anything
  // that is not plainly an https URL.
  if (v && !/^https:\/\//i.test(v)) {
    logger.warn('DONATE_PAYPAL_URL is not an https URL, ignoring it');
    return '';
  }
  return v;
};

export const donationsConfigured = () => Boolean(paypalUrl()) || CRYPTO.length > 0;

// 40 keeps a customId at 8 + 40 + 1 + 40 = 89, inside Discord's limit of 100, and
// is long enough that two real network names cannot collide by truncation.
const key = (s: string, max = 40) => s.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, max);

export const findAsset = (assetKey: string): CryptoAsset | undefined =>
  CRYPTO.find((c) => key(c.asset) === assetKey);

export const findNetwork = (assetKey: string, networkKey: string): string | undefined =>
  findAsset(assetKey)?.networks.find((n) => key(n) === networkKey);

/** Exported so a test can hold it to Discord's 100 character customId limit. */
export const networkCustomId = (asset: string, network: string) => `don:net:${key(asset)}:${key(network)}`;

type View = { embeds: EmbedBuilder[]; components: ActionRowBuilder<MessageActionRowComponentBuilder>[] };

const backRow = (...extra: ButtonBuilder[]) =>
  new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
    ...extra,
    new ButtonBuilder().setCustomId('don:home').setLabel('Back').setStyle(ButtonStyle.Secondary),
  );

/** Step one: PayPal or crypto. */
export function methodView(): View {
  const embed = new EmbedBuilder()
    .setColor(BRAND)
    .setTitle('Support SSIM')
    .setDescription(
      'Thank you for considering it.\n\n' +
      'Donations are never required and no feature is locked behind them. They cover the running costs and nothing more.\n\n' +
      'How would you like to send it?',
    );

  const row = new ActionRowBuilder<MessageActionRowComponentBuilder>();
  if (paypalUrl()) row.addComponents(new ButtonBuilder().setCustomId('don:paypal').setLabel('PayPal').setStyle(ButtonStyle.Primary));
  if (CRYPTO.length) row.addComponents(new ButtonBuilder().setCustomId('don:coins').setLabel('Crypto').setStyle(ButtonStyle.Primary));

  if (!row.components.length) {
    return { embeds: [embed.setDescription('Donation methods are not set up yet. Staff will follow up here.')], components: [] };
  }
  return { embeds: [embed], components: [row] };
}

function paypalView(): View {
  const url = paypalUrl();
  if (!url) return methodView();

  const embed = new EmbedBuilder()
    .setColor(BRAND)
    .setTitle('PayPal')
    .setDescription(
      'Two things, and they both matter:\n\n' +
      '**Send as Friends and Family.**\n' +
      '**Send in EUR.**\n\n' +
      'Anything sent as Goods and Services, or in another currency, will be refunded.',
    );
  const open = new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('Open PayPal').setURL(url);
  return { embeds: [embed], components: [backRow(open)] };
}

function coinsView(): View {
  const embed = new EmbedBuilder()
    .setColor(BRAND)
    .setTitle('Crypto')
    .setDescription('Which coin would you like to send?');

  const rows: ActionRowBuilder<MessageActionRowComponentBuilder>[] = [];
  // Five to a row, four rows at most, because the fifth row carries Back.
  for (let i = 0; i < Math.min(CRYPTO.length, 20); i += 5) {
    const row = new ActionRowBuilder<MessageActionRowComponentBuilder>();
    for (const c of CRYPTO.slice(i, i + 5)) {
      row.addComponents(new ButtonBuilder().setCustomId(`don:asset:${key(c.asset)}`).setLabel(c.asset).setStyle(ButtonStyle.Secondary));
    }
    rows.push(row);
  }
  rows.push(backRow());
  return { embeds: [embed], components: rows };
}

function networkView(assetKey: string): View {
  const entry = findAsset(assetKey);
  if (!entry) return coinsView();
  // One network is not a question, so skip straight to the request.
  if (entry.networks.length === 1) return requestView(entry.asset, entry.networks[0]);

  const embed = new EmbedBuilder()
    .setColor(BRAND)
    .setTitle(`${entry.asset}: which network?`)
    .setDescription(
      `**${entry.asset}** exists on more than one network and they are not interchangeable.\n\n` +
      'Pick the one you will actually send from. Sending over the wrong network loses the funds permanently, so choose the one your wallet shows.',
    );

  const row = new ActionRowBuilder<MessageActionRowComponentBuilder>();
  for (const n of entry.networks.slice(0, 5)) {
    row.addComponents(
      new ButtonBuilder().setCustomId(networkCustomId(entry.asset, n)).setLabel(n.slice(0, 80)).setStyle(ButtonStyle.Secondary),
    );
  }
  const back = new ButtonBuilder().setCustomId('don:coins').setLabel('Back to coins').setStyle(ButtonStyle.Secondary);
  return { embeds: [embed], components: [row, backRow(back)] };
}

/** The end of the flow. The answer is stated back, and staff send the address. */
export function requestView(asset: string, network: string): View {
  const embed = new EmbedBuilder()
    .setColor(BRAND)
    .setTitle('Noted')
    .setDescription(
      `**${asset}** on **${network}**.\n\n` +
      'A member of the team will post the address here shortly. Nothing is sent automatically, so wait for it to appear in this ticket.\n\n' +
      'Never send to an address that reached you any other way, including a direct message. Only what is posted in this channel counts.',
    );
  const back = new ButtonBuilder().setCustomId('don:coins').setLabel('Pick a different coin').setStyle(ButtonStyle.Secondary);
  return { embeds: [embed], components: [backRow(back)] };
}

/** Posted into a donation ticket when it opens. */
export async function sendDonationPanel(channel: TextChannel): Promise<void> {
  await channel.send(methodView()).catch((err) => logger.warn('donation panel post failed', { err: (err as Error).message }));
}

/**
 * Routes every `don:` button. Returns false when the id is not ours.
 *
 * The staff ping happens here rather than when the ticket opens, so nobody is
 * paged because a member looked at the options and left.
 */
export async function handleDonationButton(interaction: ButtonInteraction): Promise<boolean> {
  const id = interaction.customId;
  if (!id.startsWith('don:')) return false;

  if (id === 'don:home') { await interaction.update(methodView()); return true; }
  if (id === 'don:paypal') { await interaction.update(paypalView()); return true; }
  if (id === 'don:coins') { await interaction.update(coinsView()); return true; }

  if (id.startsWith('don:asset:')) {
    const assetKey = id.slice('don:asset:'.length);
    const entry = findAsset(assetKey);
    await interaction.update(networkView(assetKey));
    // A single-network coin resolves straight to a request, so it needs the ping too.
    if (entry && entry.networks.length === 1) await pingStaff(interaction, entry.asset, entry.networks[0]);
    return true;
  }

  if (id.startsWith('don:net:')) {
    const [assetKey, networkKey] = id.slice('don:net:'.length).split(':');
    const entry = findAsset(assetKey || '');
    const network = findNetwork(assetKey || '', networkKey || '');
    // An unknown pair means the catalog changed under a live button. Showing the
    // coin list again is the right answer, never a guess at what was meant.
    if (!entry || !network) { await interaction.update(coinsView()); return true; }
    await interaction.update(requestView(entry.asset, network));
    await pingStaff(interaction, entry.asset, network);
    return true;
  }

  return false;
}

async function pingStaff(interaction: ButtonInteraction, asset: string, network: string): Promise<void> {
  const staff = (process.env.STAFF_ROLE_ID || '').trim();
  const channel = interaction.channel as TextChannel | null;
  if (!channel || !channel.isTextBased?.()) return;

  const mention = staff ? `<@&${staff}> ` : '';
  await channel.send({
    content: `${mention}<@${interaction.user.id}> would like to donate **${asset}** on **${network}**. Please post the receiving address here.`,
    allowedMentions: { roles: staff ? [staff] : [], users: [interaction.user.id] },
  }).catch((err) => logger.warn('donation staff ping failed', { err: (err as Error).message }));
}
