// ════════════════════════════════════════════════════════════════════════════
//  interactions.ts — the single InteractionCreate router. Dispatches slash
//  commands, the panel select, ticket/license buttons, and modal submits.
//  Wraps everything so a handler throw becomes a friendly ephemeral, never a
//  silent dead interaction.
// ════════════════════════════════════════════════════════════════════════════
import {
  Interaction, StringSelectMenuInteraction, ButtonInteraction, ModalSubmitInteraction, TextChannel,
} from 'discord.js';
import { logger } from './logger';
import { store } from './store';
import { memberHasStaff } from './perms';
import { handleCommand } from './commands';
import {
  categoryById, createTicket, claimTicket, closeTicket, buildBugModal, bugEmbed,
} from './tickets';
import {
  onLicenseTicketOpen, handleReveal, handleGenerate, handleClaimModal, buildClaimModal,
} from './licenseFlow';

export async function handleInteraction(interaction: Interaction): Promise<void> {
  try {
    if (interaction.isChatInputCommand()) return void (await handleCommand(interaction));
    if (interaction.isStringSelectMenu() && interaction.customId === 'ticket:open') return void (await onOpenSelect(interaction));
    if (interaction.isButton()) return void (await onButton(interaction));
    if (interaction.isModalSubmit()) return void (await onModal(interaction));
  } catch (err) {
    logger.error('interaction handler error', { err: (err as Error).message, customId: 'customId' in interaction ? (interaction as { customId?: string }).customId : undefined });
    if (interaction.isRepliable()) {
      const msg = { ephemeral: true as const, content: '⚠ Something went wrong. Please try again or contact staff.' };
      try { (interaction.replied || interaction.deferred) ? await interaction.followUp(msg) : await interaction.reply(msg); } catch { /* interaction gone */ }
    }
  }
}

// ── Panel select → open a ticket ────────────────────────────────────────────────
async function onOpenSelect(interaction: StringSelectMenuInteraction): Promise<void> {
  const category = categoryById(interaction.values[0]);
  if (!category || !interaction.guild) { await interaction.reply({ ephemeral: true, content: 'Unknown category.' }); return; }

  // Bug Report shows a modal FIRST (you cannot defer before showModal) → the channel is created on submit.
  if (category.kind === 'bug') { await interaction.showModal(buildBugModal()); return; }

  const reused = !!store.openTicketFor(interaction.user.id, category.id);
  await interaction.deferReply({ ephemeral: true });
  const opener = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
  if (!opener) { await interaction.editReply({ content: 'Could not resolve your membership.' }); return; }

  const channel = await createTicket(interaction.guild, opener.user, category);
  if (!channel) { await interaction.editReply({ content: 'Could not create your ticket — staff have been notified.' }); return; }
  if (category.kind === 'license') await onLicenseTicketOpen(channel, opener);
  await interaction.editReply({ content: `${reused ? 'You already had an open ticket: ' : 'Ticket created: '}<#${channel.id}>` });
}

// ── Buttons ─────────────────────────────────────────────────────────────────────
async function onButton(interaction: ButtonInteraction): Promise<void> {
  switch (interaction.customId) {
    case 'lic:reveal': return handleReveal(interaction);
    case 'lic:generate': return handleGenerate(interaction);
    case 'lic:claim': return void (await interaction.showModal(buildClaimModal()));
    case 'ticket:claim': return onClaimButton(interaction);
    case 'ticket:close': return onCloseButton(interaction);
  }
}

async function onClaimButton(interaction: ButtonInteraction): Promise<void> {
  if (!memberHasStaff(interaction.member)) { await interaction.reply({ ephemeral: true, content: 'Only staff can claim tickets.' }); return; }
  if (!interaction.guild || !store.getTicket(interaction.channelId)) { await interaction.reply({ ephemeral: true, content: 'This is not a ticket channel.' }); return; }
  const member = await interaction.guild.members.fetch(interaction.user.id);
  await claimTicket(interaction.channel as TextChannel, member);
  await interaction.reply({ ephemeral: true, content: 'Claimed.' });
}

async function onCloseButton(interaction: ButtonInteraction): Promise<void> {
  const t = store.getTicket(interaction.channelId);
  if (!t) { await interaction.reply({ ephemeral: true, content: 'This is not a ticket channel.' }); return; }
  // opener OR staff may close
  if (interaction.user.id !== t.openerId && !memberHasStaff(interaction.member)) {
    await interaction.reply({ ephemeral: true, content: 'Only the opener or staff can close this ticket.' });
    return;
  }
  await interaction.reply({ ephemeral: true, content: 'Closing…' });
  await closeTicket(interaction.channel as TextChannel, interaction.user);
}

// ── Modals ────────────────────────────────────────────────────────────────────
async function onModal(interaction: ModalSubmitInteraction): Promise<void> {
  if (interaction.customId === 'lic:claimModal') return handleClaimModal(interaction);
  if (interaction.customId === 'bug:modal') return onBugModal(interaction);
}

async function onBugModal(interaction: ModalSubmitInteraction): Promise<void> {
  const category = categoryById('bug');
  if (!category || !interaction.guild) { await interaction.reply({ ephemeral: true, content: 'Could not open a bug ticket.' }); return; }
  await interaction.deferReply({ ephemeral: true });
  const field = (id: string) => { try { return interaction.fields.getTextInputValue(id); } catch { return ''; } };
  const fields = { summary: field('summary'), steps: field('steps'), expected: field('expected'), actual: field('actual'), version: field('version') };
  const opener = await interaction.guild.members.fetch(interaction.user.id);
  const channel = await createTicket(interaction.guild, opener.user, category, { extraEmbeds: [bugEmbed(fields)] });
  if (!channel) { await interaction.editReply({ content: 'Could not create your ticket — staff notified.' }); return; }
  await interaction.editReply({ content: `Bug report submitted: <#${channel.id}>` });
}
