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
//  The coin and network are typed by the donor rather than picked from a list, so
//  nothing has to be kept in step with what is actually accepted. That makes them
//  untrusted text on its way into a message that mentions a role, which is what
//  sanitizeAnswer and the allowedMentions below are for.
//
//  PayPal is different. It is a link, not an address, and a wrong link is visible
//  the moment the page loads, so it comes from the environment.
//
//  process.env is read directly rather than through config.ts so the pure parts
//  stay importable in tests without a full environment.
// ════════════════════════════════════════════════════════════════════════════
import {
  EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, TextChannel, ButtonInteraction,
  ModalBuilder, ModalSubmitInteraction, TextInputBuilder, TextInputStyle,
  MessageActionRowComponentBuilder,
} from 'discord.js';
import { logger } from './logger';
import { BRAND } from './util';

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

/**
 * Make a typed answer safe to put in a message that also mentions the staff role.
 *
 * allowedMentions is the real guard against a ping, and it is set on every send
 * below. This exists so the text cannot break the surrounding formatting either,
 * and so a leftover mention does not sit in the channel looking like one.
 */
export function sanitizeAnswer(input: string, max = 40): string {
  return String(input ?? '')
    .replace(/<@[!&]?\d+>|<#\d+>/g, '')     // raw user, role and channel mentions
    .replace(/@(everyone|here)/gi, '')      // mass mentions
    .replace(/[`*_~|\\<>]/g, '')            // markdown and tag characters
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

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
  row.addComponents(new ButtonBuilder().setCustomId('don:crypto').setLabel('Crypto').setStyle(ButtonStyle.Primary));
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

/** The two questions, asked as a form rather than a list of buttons, so any coin
 *  and any network can be named without the bot keeping a catalog in step. */
export function cryptoModal(): ModalBuilder {
  const row = (input: TextInputBuilder) => new ActionRowBuilder<TextInputBuilder>().addComponents(input);
  return new ModalBuilder()
    .setCustomId('don:crypto:modal')
    .setTitle('Crypto donation')
    .addComponents(
      row(new TextInputBuilder()
        .setCustomId('coin').setLabel('Which coin do you want to send?')
        .setPlaceholder('BTC, ETH, USDT, LTC, SOL, XMR ...')
        .setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(20)),
      row(new TextInputBuilder()
        .setCustomId('network').setLabel('On which network?')
        .setPlaceholder('Bitcoin, Tron (TRC20), Ethereum (ERC20) ...')
        .setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(40)),
    );
}

/** The end of the flow. The answer is stated back, and staff send the address. */
export function requestView(coin: string, network: string): View {
  const embed = new EmbedBuilder()
    .setColor(BRAND)
    .setTitle('Noted')
    .setDescription(
      `**${coin}** on **${network}**.\n\n` +
      'A member of the team will post the address here shortly. Nothing is sent automatically, so wait for it to appear in this ticket.\n\n' +
      'If either of those is wrong, say so here before you send anything.\n\n' +
      'Never send to an address that reached you any other way, including a direct message. Only what is posted in this channel counts.',
    );
  const again = new ButtonBuilder().setCustomId('don:crypto').setLabel('Change the answers').setStyle(ButtonStyle.Secondary);
  return { embeds: [embed], components: [backRow(again)] };
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
  if (id === 'don:paypal') { await interaction.update(paypalView()); return true; }
  // showModal is the reply to this interaction, so nothing else may answer it.
  if (id === 'don:crypto') { await interaction.showModal(cryptoModal()); return true; }
  return false;
}

/** Routes the crypto form. Returns false when the id is not ours. */
export async function handleDonationModal(interaction: ModalSubmitInteraction): Promise<boolean> {
  if (interaction.customId !== 'don:crypto:modal') return false;

  const coin = sanitizeAnswer(interaction.fields.getTextInputValue('coin'), 20);
  const network = sanitizeAnswer(interaction.fields.getTextInputValue('network'), 40);

  // Discord enforces "required", but an answer made only of stripped characters
  // still arrives empty, and staff should not be paged for a blank request.
  if (!coin || !network) {
    await interaction.reply({
      ephemeral: true,
      content: 'That came through empty. Press **Crypto** again and type the coin and the network as plain text.',
    });
    return true;
  }

  const view = requestView(coin, network);
  // Modals opened from a button can edit that button's message. Opened any other
  // way they cannot, so fall back to a normal reply.
  if (interaction.isFromMessage()) await interaction.update(view);
  else await interaction.reply(view);

  await pingStaff(interaction, coin, network);
  return true;
}

/**
 * Page staff once a donor has actually answered. Not when the ticket opens, so
 * reading the options and leaving pages nobody.
 */
async function pingStaff(interaction: ButtonInteraction | ModalSubmitInteraction, coin: string, network: string): Promise<void> {
  const staff = (process.env.STAFF_ROLE_ID || '').trim();
  const channel = interaction.channel as TextChannel | null;
  if (!channel || typeof channel.send !== 'function') return;

  await channel.send({
    content: `${staff ? `<@&${staff}> ` : ''}<@${interaction.user.id}> would like to donate **${coin}** on **${network}**. Please post the receiving address here.`,
    // The coin and network are typed by the donor, so the mention list is stated
    // explicitly and never derived from the message text.
    allowedMentions: { roles: staff ? [staff] : [], users: [interaction.user.id] },
  }).catch((err) => logger.warn('donation staff ping failed', { err: (err as Error).message }));
}
