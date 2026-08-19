// ════════════════════════════════════════════════════════════════════════════
//  tickets.ts: the ticket system. Persistent panel, lifecycle (create, claim,
//  close), transcripts to the log channel and the opener's DMs, and inactivity
//  auto-close.
// ════════════════════════════════════════════════════════════════════════════
import {
  Client, Guild, GuildMember, TextChannel, ChannelType, PermissionFlagsBits, Message,
  EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder,
  MessageActionRowComponentBuilder, User, OverwriteResolvable,
} from 'discord.js';
import { config, TICKET_CATEGORIES, TicketCategory } from './config';
import { store, Ticket } from './store';
import { logger } from './logger';
import { BRAND } from './util';
import { audit } from './audit';

export function categoryById(id: string): TicketCategory | undefined {
  return TICKET_CATEGORIES.find((c) => c.id === id);
}

const pad4 = (n: number) => String(n).padStart(4, '0');
const cleanName = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 20) || 'user';

// ── The persistent panel ──────────────────────────────────────────────────────
// One topic gets a single button, because a dropdown holding one option asks the
// reader to make a choice that does not exist. Two or more get the select menu,
// which is what TICKET_CATEGORIES is for. Either way the next click opens the
// ticket: there is no separate confirmation step, since the panel already names
// every topic and createTicket() returns the existing channel on a second press.
export function buildPanel(): { embeds: EmbedBuilder[]; components: ActionRowBuilder<MessageActionRowComponentBuilder>[] } {
  const only = TICKET_CATEGORIES.length === 1 ? TICKET_CATEGORIES[0] : undefined;
  const embed = new EmbedBuilder()
    .setColor(BRAND)
    .setTitle('Support')
    .setDescription(
      only
        ? `${only.description}.\n\nOpening a ticket creates a private channel between you and our team.`
        : 'Open a private ticket with our team. Select a topic below to begin.\n\n' +
          TICKET_CATEGORIES.map((c) => `**${c.label}**\n${c.description}`).join('\n\n'),
    )
    .setFooter({ text: 'SSIM' });

  const row = new ActionRowBuilder<MessageActionRowComponentBuilder>();
  if (only) {
    row.addComponents(
      new ButtonBuilder().setCustomId(`ticket:open:${only.id}`).setLabel('Open a ticket').setStyle(ButtonStyle.Primary),
    );
  } else {
    row.addComponents(
      new StringSelectMenuBuilder()
        .setCustomId('ticket:select')
        .setPlaceholder('Select a topic to continue')
        .addOptions(TICKET_CATEGORIES.map((c) => ({ label: c.label, value: c.id, description: c.description }))),
    );
  }
  return { embeds: [embed], components: [row] };
}

export async function postPanel(client: Client): Promise<TextChannel> {
  const ch = await client.channels.fetch(config.channels.onboarding);
  if (!ch || ch.type !== ChannelType.GuildText) throw new Error('ONBOARDING_CHANNEL_ID is not a text channel');
  await (ch as TextChannel).send(buildPanel());
  return ch as TextChannel;
}

// ── Create ──────────────────────────────────────────────────────────────────────
export async function createTicket(
  guild: Guild, opener: User, category: TicketCategory, opts?: { extraEmbeds?: EmbedBuilder[] },
): Promise<TextChannel | null> {
  // one open ticket per user per category. Reuse it if the channel still exists.
  const existing = store.openTicketFor(opener.id, category.id);
  if (existing) {
    const ch = await guild.channels.fetch(existing.channelId).catch(() => null);
    if (ch && ch.type === ChannelType.GuildText) return ch as TextChannel;
    store.removeTicket(existing.channelId); // stale entry
  }

  const number = store.nextTicketNumber();
  const overwrites: OverwriteResolvable[] = [
    { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
    { id: opener.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.AttachFiles] },
    { id: config.roles.staff, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ManageMessages] },
  ];
  if (guild.members.me) {
    overwrites.push({ id: guild.members.me.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ManageChannels] });
  }

  let channel: TextChannel;
  try {
    channel = await guild.channels.create({
      name: `${category.id}-${cleanName(opener.username)}-${pad4(number)}`,
      type: ChannelType.GuildText,
      parent: config.channels.ticketCategory || undefined,
      topic: `${category.label} • opener:${opener.id} • #${pad4(number)}`,
      permissionOverwrites: overwrites,
    });
  } catch (err) {
    logger.error('createTicket: channel create failed', { err: (err as Error).message });
    return null;
  }

  const t: Ticket = {
    channelId: channel.id, number, categoryId: category.id, openerId: opener.id, openerTag: opener.tag,
    claimedBy: null, createdAt: new Date().toISOString(), lastActivityAt: new Date().toISOString(),
  };
  store.addTicket(t);

  const header = new EmbedBuilder()
    .setColor(BRAND)
    .setTitle(`${category.label} · Ticket #${pad4(number)}`)
    .setDescription(category.intro)
    .addFields({ name: 'Opened by', value: `<@${opener.id}>`, inline: true }, { name: 'Status', value: 'Open', inline: true })
    .setTimestamp();
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId('ticket:claim').setLabel('Claim').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('ticket:close').setLabel('Close').setStyle(ButtonStyle.Danger),
  );
  const ping = category.staffPing ? `<@&${config.roles.staff}> ` : '';
  await channel.send({
    content: `${ping}<@${opener.id}>`,
    embeds: [header, ...(opts?.extraEmbeds || [])],
    components: [row],
    allowedMentions: { users: [opener.id], roles: category.staffPing ? [config.roles.staff] : [] },
  });

  await audit(guild.client, 'ticket_open', { ticket: `#${pad4(number)}`, category: category.label, opener: opener.tag });
  return channel;
}

// ── Claim ─────────────────────────────────────────────────────────────────────
export async function claimTicket(channel: TextChannel, staff: GuildMember): Promise<void> {
  const t = store.getTicket(channel.id);
  if (!t) return;
  store.updateTicket(channel.id, { claimedBy: staff.id });
  await channel.send({ content: `Ticket claimed by <@${staff.id}>.`, allowedMentions: { parse: [] } });
  await audit(channel.client, 'ticket_claim', { ticket: `#${pad4(t.number)}`, staff: staff.user.tag });
}

// ── Close (transcript → log + opener DM, then delete) ───────────────────────────
export async function closeTicket(channel: TextChannel, closedBy: User, reason?: string): Promise<void> {
  const t = store.getTicket(channel.id);
  const number = t ? pad4(t.number) : '????';
  await channel.send({ content: `Closing ticket #${number}${reason ? `, reason: ${reason}` : ''}. Generating transcript...`, allowedMentions: { parse: [] } }).catch(() => {});

  const transcript = await buildTranscript(channel, t);

  if (config.channels.ticketLog) {
    const log = await channel.client.channels.fetch(config.channels.ticketLog).catch(() => null);
    if (log && log.isTextBased()) {
      const embed = new EmbedBuilder().setColor(BRAND).setTitle(`Ticket #${number} closed`).setTimestamp().addFields(
        { name: 'Category', value: t ? (categoryById(t.categoryId)?.label || t.categoryId) : '-', inline: true },
        { name: 'Opened by', value: t ? `<@${t.openerId}>` : '-', inline: true },
        { name: 'Closed by', value: `<@${closedBy.id}>`, inline: true },
      );
      if (reason) embed.addFields({ name: 'Reason', value: reason });
      await (log as TextChannel).send({ embeds: [embed], files: [{ attachment: transcript.buffer, name: transcript.filename }], allowedMentions: { parse: [] } }).catch((err) => logger.warn('ticket log post failed', { err: (err as Error).message }));
    }
  }

  if (t) {
    const opener = await channel.client.users.fetch(t.openerId).catch(() => null);
    if (opener) {
      await opener.send({
        content: `Your SSIM ticket #${number} has been closed.${reason ? ` Reason: ${reason}` : ''}\nA transcript is attached for your records.`,
        files: [{ attachment: transcript.buffer, name: transcript.filename }],
      }).catch(() => logger.warn('could not DM transcript to opener (DMs closed?)'));
    }
  }

  await audit(channel.client, 'ticket_close', { ticket: `#${number}`, closedBy: closedBy.tag, reason: reason || '-' });

  store.updateTicket(channel.id, { closed: true });
  const deleted = await channel.delete(`ticket #${number} closed by ${closedBy.tag}`).then(() => true).catch((err) => { logger.error('ticket delete failed', { err: (err as Error).message }); return false; });
  if (deleted) store.removeTicket(channel.id);
}

const escHtml = (s: string) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c] as string));

async function buildTranscript(channel: TextChannel, t?: Ticket): Promise<{ buffer: Buffer; filename: string }> {
  const collected: { at: string; author: string; content: string }[] = [];
  let before: string | undefined;
  for (let i = 0; i < 5; i++) { // up to ~500 messages, newest→oldest
    const batch = await channel.messages.fetch({ limit: 100, before }).catch(() => null);
    if (!batch || batch.size === 0) break;
    for (const m of batch.values()) {
      const extras = `${m.embeds.length ? ' [embed]' : ''}${m.attachments.size ? ' [attachment]' : ''}`;
      collected.push({ at: new Date(m.createdTimestamp).toISOString(), author: m.author?.tag || 'unknown', content: (m.content || '') + extras });
    }
    before = batch.last()?.id;
    if (batch.size < 100) break;
  }
  collected.reverse();
  const number = t ? pad4(t.number) : 'unknown';
  const rows = collected.map((m) => {
    const safe = (s: string) => escHtml(s);
    return `<div class="m"><span class="t">${m.at}</span> <span class="a">${safe(m.author)}</span><div class="c">${safe(m.content) || '<i>(no text)</i>'}</div></div>`;
  }).join('\n');
  const html =
    `<!doctype html><meta charset="utf-8"><title>SSIM Ticket #${number}</title>` +
    `<style>body{font-family:system-ui,sans-serif;background:#0a0a0f;color:#e5e7eb;padding:24px}` +
    `.m{border-bottom:1px solid #23232e;padding:8px 0}.t{color:#6b7280;font-size:12px}` +
    `.a{color:#a78bfa;font-weight:600;margin-left:6px}.c{white-space:pre-wrap;margin-top:2px}h1{color:#9333ea}</style>` +
    `<h1>SSIM • Ticket #${number}</h1>` +
    `<p>Category: ${t ? escHtml(categoryById(t.categoryId)?.label || t.categoryId) : '-'} · Opener: ${escHtml(t?.openerTag || '-')} · ${collected.length} messages</p>` +
    rows;
  return { buffer: Buffer.from(html, 'utf8'), filename: `ticket-${number}.html` };
}

// ── add / remove a participant ──────────────────────────────────────────────────
export async function addUser(channel: TextChannel, user: User): Promise<void> {
  await channel.permissionOverwrites.edit(user.id, { ViewChannel: true, SendMessages: true, ReadMessageHistory: true });
}
export async function removeUser(channel: TextChannel, user: User): Promise<void> {
  await channel.permissionOverwrites.edit(user.id, { ViewChannel: false });
}

// ── activity tracking + inactivity auto-close ───────────────────────────────────
export function trackActivity(message: Message): void {
  if (message.author?.bot) return;
  const t = store.getTicket(message.channelId);
  if (t && !t.closed) store.updateTicket(message.channelId, { lastActivityAt: new Date().toISOString(), warnedAt: undefined });
}

export async function sweepAutoClose(client: Client): Promise<void> {
  const hours = config.ticketAutocloseHours;
  if (hours <= 0) return;
  const idleMs = hours * 3_600_000;
  const graceMs = 2 * 3_600_000;
  const now = Date.now();
  for (const t of store.listTickets()) {
    if (t.closed) continue;
    if (now - new Date(t.lastActivityAt).getTime() < idleMs) continue;
    const ch = await client.channels.fetch(t.channelId).catch(() => null);
    if (!ch || !ch.isTextBased()) { store.removeTicket(t.channelId); continue; }
    if (!t.warnedAt) {
      store.updateTicket(t.channelId, { warnedAt: new Date().toISOString() });
      await (ch as TextChannel).send({ content: `This ticket has been inactive for ${hours}h and will close automatically in ${graceMs / 3_600_000}h unless there is a reply.`, allowedMentions: { parse: [] } }).catch(() => {});
    } else if (now - new Date(t.warnedAt).getTime() > graceMs) {
      await closeTicket(ch as TextChannel, client.user!, 'inactivity');
    }
  }
}
