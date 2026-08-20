// ════════════════════════════════════════════════════════════════════════════
//  interactions.ts: the single InteractionCreate router. Dispatches slash
//  commands, the panel control (button or select, depending on how many ticket
//  topics are configured), the in-ticket buttons, and modal submits. Wraps
//  everything so a handler throw becomes a friendly ephemeral reply rather than
//  a silent dead interaction.
// ════════════════════════════════════════════════════════════════════════════
import {
  Interaction, StringSelectMenuInteraction, ButtonInteraction, ModalSubmitInteraction, TextChannel,
} from 'discord.js';
import { logger } from './logger';
import { store } from './store';
import { memberHasStaff } from './perms';
import { handleCommand } from './commands';
import { categoryById, createTicket, claimTicket, closeTicket } from './tickets';
import { handlePostModal } from './post';
import { handleDonationButton, handleDonationModal } from './donations';

export async function handleInteraction(interaction: Interaction): Promise<void> {
  try {
    if (interaction.isChatInputCommand()) return void (await handleCommand(interaction));
    if (interaction.isStringSelectMenu() && interaction.customId === 'ticket:select') return void (await openTicket(interaction, interaction.values[0]));
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

// ── Opening a ticket ────────────────────────────────────────────────────────────
// Both panel shapes land here: the "Open a ticket" button when there is a single
// topic, and the topic select menu when there is more than one. The reply is always
// a fresh ephemeral rather than an update(), because these components live on the
// public panel message and updating would overwrite the panel itself.
async function openTicket(
  interaction: ButtonInteraction | StringSelectMenuInteraction, categoryId: string,
): Promise<void> {
  const category = categoryById(categoryId);
  if (!category || !interaction.guild) { await interaction.reply({ ephemeral: true, content: 'Unknown topic.' }); return; }
  await interaction.deferReply({ ephemeral: true });
  const reused = !!store.openTicketFor(interaction.user.id, category.id);
  const opener = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
  if (!opener) { await interaction.editReply({ content: 'Could not resolve your membership.' }); return; }
  const channel = await createTicket(interaction.guild, opener.user, category);
  if (!channel) { await interaction.editReply({ content: 'We could not create your ticket. Staff have been notified.' }); return; }
  await interaction.editReply({ content: `${reused ? 'You already have an open ticket: ' : 'Your ticket is ready: '}<#${channel.id}>` });
}

// ── Buttons ─────────────────────────────────────────────────────────────────────
async function onButton(interaction: ButtonInteraction): Promise<void> {
  const id = interaction.customId;
  if (await handleDonationButton(interaction)) return;
  if (id.startsWith('ticket:open:')) return openTicket(interaction, id.slice('ticket:open:'.length));
  switch (id) {
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
  if (await handleDonationModal(interaction)) return;
  if (interaction.customId.startsWith('post:submit:')) return handlePostModal(interaction);
}
