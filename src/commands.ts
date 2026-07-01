// ════════════════════════════════════════════════════════════════════════════
//  commands.ts — slash-command definitions, idempotent guild registration, and
//  the staff command handlers (/assign /unassign /whois /close /add /remove
//  /announce /panel). All are gated on the STAFF_ROLE in-handler.
// ════════════════════════════════════════════════════════════════════════════
import {
  SlashCommandBuilder, REST, Routes, ChatInputCommandInteraction, TextChannel, PermissionFlagsBits,
} from 'discord.js';
import { config } from './config';
import { logger } from './logger';
import { redactKey } from './util';
import { memberHasStaff } from './perms';
import { licenseApi } from './licenseApi';
import { audit } from './audit';
import { announceNow } from './announce';
import { store } from './store';
import { closeTicket, addUser, removeUser, postPanel } from './tickets';

// setDefaultMemberPermissions(ManageMessages) merely de-clutters the picker for non-staff; the real
// gate is the STAFF_ROLE check in handleCommand (roles ≠ Discord perms).
const staffPerm = PermissionFlagsBits.ManageMessages;

export const commands = [
  new SlashCommandBuilder().setName('assign').setDescription('Staff: link a license key to a Discord user')
    .addUserOption((o) => o.setName('user').setDescription('The Discord user').setRequired(true))
    .addStringOption((o) => o.setName('key').setDescription('SSIM-XXXX-XXXX-XXXX-XXXX').setRequired(true))
    .setDefaultMemberPermissions(staffPerm),
  new SlashCommandBuilder().setName('unassign').setDescription("Staff: unlink a user's license")
    .addUserOption((o) => o.setName('user').setDescription('The Discord user').setRequired(true))
    .setDefaultMemberPermissions(staffPerm),
  new SlashCommandBuilder().setName('whois').setDescription('Staff: show the license linked to a user')
    .addUserOption((o) => o.setName('user').setDescription('The Discord user').setRequired(true))
    .setDefaultMemberPermissions(staffPerm),
  new SlashCommandBuilder().setName('close').setDescription('Staff: close this ticket')
    .addStringOption((o) => o.setName('reason').setDescription('Reason (optional)').setRequired(false))
    .setDefaultMemberPermissions(staffPerm),
  new SlashCommandBuilder().setName('add').setDescription('Staff: add a user to this ticket')
    .addUserOption((o) => o.setName('user').setDescription('User to add').setRequired(true))
    .setDefaultMemberPermissions(staffPerm),
  new SlashCommandBuilder().setName('remove').setDescription('Staff: remove a user from this ticket')
    .addUserOption((o) => o.setName('user').setDescription('User to remove').setRequired(true))
    .setDefaultMemberPermissions(staffPerm),
  new SlashCommandBuilder().setName('announce').setDescription('Staff: re-post the latest release announcement')
    .setDefaultMemberPermissions(staffPerm),
  new SlashCommandBuilder().setName('panel').setDescription('Staff: post the support/ticket panel here')
    .setDefaultMemberPermissions(staffPerm),
].map((c) => c.toJSON());

export async function registerCommands(): Promise<void> {
  const rest = new REST({ version: '10' }).setToken(config.token);
  await rest.put(Routes.applicationGuildCommands(config.clientId, config.guildId), { body: commands });
  logger.info(`registered ${commands.length} guild commands`);
}

export async function handleCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!memberHasStaff(interaction.member)) {
    await interaction.reply({ ephemeral: true, content: '⛔ This command is staff-only.' });
    return;
  }
  switch (interaction.commandName) {
    case 'assign': return cmdAssign(interaction);
    case 'unassign': return cmdUnassign(interaction);
    case 'whois': return cmdWhois(interaction);
    case 'close': return cmdClose(interaction);
    case 'add': return cmdAddRemove(interaction, true);
    case 'remove': return cmdAddRemove(interaction, false);
    case 'announce': return cmdAnnounce(interaction);
    case 'panel': return cmdPanel(interaction);
    default: await interaction.reply({ ephemeral: true, content: 'Unknown command.' });
  }
}

async function cmdAssign(interaction: ChatInputCommandInteraction): Promise<void> {
  const user = interaction.options.getUser('user', true);
  const key = interaction.options.getString('key', true).trim().toUpperCase();
  await interaction.deferReply({ ephemeral: true });
  const res = await licenseApi.assign({ key, discordId: user.id, discordUsername: user.tag });
  if (res.ok && res.data) {
    await interaction.editReply({ content: `✅ Linked \`${redactKey(res.data.key)}\` to <@${user.id}>. They can open a **License** ticket to receive it.` });
    await audit(interaction.client, 'assign', { staff: interaction.user.tag, target: user.tag, key: redactKey(res.data.key) });
  } else if (res.status === 409) {
    const conflictKey = (res.data as { conflictKey?: string } | null)?.conflictKey;
    await interaction.editReply({ content: `⚠ <@${user.id}> already has a license linked${conflictKey ? ` (\`${redactKey(conflictKey)}\`)` : ''}. Run /unassign first.` });
  } else if (res.status === 404) {
    await interaction.editReply({ content: '❌ Key not found.' });
  } else {
    await interaction.editReply({ content: `❌ Assign failed: ${res.error || res.status}` });
  }
}

async function cmdUnassign(interaction: ChatInputCommandInteraction): Promise<void> {
  const user = interaction.options.getUser('user', true);
  await interaction.deferReply({ ephemeral: true });
  const found = await licenseApi.byDiscord(user.id);
  if (!found.ok || !found.data) { await interaction.editReply({ content: `<@${user.id}> has no license linked.` }); return; }
  const key = found.data.key;
  const res = await licenseApi.unassign(key);
  if (res.ok) {
    await interaction.editReply({ content: `✅ Unlinked \`${redactKey(key)}\` from <@${user.id}>.` });
    await audit(interaction.client, 'unassign', { staff: interaction.user.tag, target: user.tag, key: redactKey(key) });
  } else {
    await interaction.editReply({ content: `❌ Unassign failed: ${res.error || res.status}` });
  }
}

async function cmdWhois(interaction: ChatInputCommandInteraction): Promise<void> {
  const user = interaction.options.getUser('user', true);
  await interaction.deferReply({ ephemeral: true });
  const res = await licenseApi.whois(user.id);
  if (res.ok && res.data) {
    const d = res.data;
    await interaction.editReply({ content: `<@${user.id}> → \`${d.keyRedacted}\` · ${d.tier} · ${d.status} · seats ${d.usedSeats}/${d.seats} · expires ${d.expiresAt ? String(d.expiresAt).slice(0, 10) : 'never'}` });
  } else if (res.status === 404) {
    await interaction.editReply({ content: `<@${user.id}> has no license linked.` });
  } else {
    await interaction.editReply({ content: `❌ Lookup failed: ${res.error || res.status}` });
  }
}

async function cmdClose(interaction: ChatInputCommandInteraction): Promise<void> {
  const t = store.getTicket(interaction.channelId);
  if (!t) { await interaction.reply({ ephemeral: true, content: 'This is not a ticket channel.' }); return; }
  const reason = interaction.options.getString('reason') || undefined;
  await interaction.reply({ ephemeral: true, content: 'Closing…' });
  await closeTicket(interaction.channel as TextChannel, interaction.user, reason);
}

async function cmdAddRemove(interaction: ChatInputCommandInteraction, add: boolean): Promise<void> {
  const t = store.getTicket(interaction.channelId);
  if (!t) { await interaction.reply({ ephemeral: true, content: 'This is not a ticket channel.' }); return; }
  const user = interaction.options.getUser('user', true);
  await (add ? addUser : removeUser)(interaction.channel as TextChannel, user);
  await interaction.reply({ ephemeral: true, content: `${add ? 'Added' : 'Removed'} <@${user.id}>.` });
}

async function cmdAnnounce(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply({ ephemeral: true });
  const r = await announceNow();
  await interaction.editReply({ content: r.ok ? `📣 Announced v${r.version}.` : `❌ ${r.error}` });
}

async function cmdPanel(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply({ ephemeral: true });
  try { await postPanel(interaction.client); await interaction.editReply({ content: '✅ Panel posted.' }); }
  catch (err) { await interaction.editReply({ content: `❌ ${(err as Error).message}` }); }
}
