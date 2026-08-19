// ════════════════════════════════════════════════════════════════════════════
//  commands.ts: slash-command definitions, idempotent guild registration, and
//  the staff command handlers (/close, /add, /remove, /announce, /panel, /post).
//  All are gated on STAFF_ROLE_ID inside the handler.
// ════════════════════════════════════════════════════════════════════════════
import {
  SlashCommandBuilder, REST, Routes, ChatInputCommandInteraction, TextChannel, PermissionFlagsBits, ChannelType,
} from 'discord.js';
import { config } from './config';
import { logger } from './logger';
import { memberHasStaff } from './perms';
import { announceNow } from './announce';
import { store } from './store';
import { closeTicket, addUser, removeUser, postPanel } from './tickets';
import { handlePostCommand } from './post';
import { postIntro } from './intro';

// setDefaultMemberPermissions(ManageMessages) merely de-clutters the picker for non-staff; the real
// gate is the STAFF_ROLE check in handleCommand (roles ≠ Discord perms).
const staffPerm = PermissionFlagsBits.ManageMessages;

export const commands = [
  new SlashCommandBuilder().setName('close').setDescription('Staff: close this ticket')
    .addStringOption((o) => o.setName('reason').setDescription('Reason (optional)').setRequired(false))
    .setDefaultMemberPermissions(staffPerm),
  new SlashCommandBuilder().setName('add').setDescription('Staff: add a user to this ticket')
    .addUserOption((o) => o.setName('user').setDescription('User to add').setRequired(true))
    .setDefaultMemberPermissions(staffPerm),
  new SlashCommandBuilder().setName('remove').setDescription('Staff: remove a user from this ticket')
    .addUserOption((o) => o.setName('user').setDescription('User to remove').setRequired(true))
    .setDefaultMemberPermissions(staffPerm),
  new SlashCommandBuilder().setName('announce').setDescription('Staff: update the latest release announcement from its GitHub notes')
    .addBooleanOption((o) => o.setName('repost').setDescription('Post a new message instead of editing the one already there').setRequired(false))
    .setDefaultMemberPermissions(staffPerm),
  new SlashCommandBuilder().setName('panel').setDescription('Staff: post the support/ticket panel here')
    .setDefaultMemberPermissions(staffPerm),
  new SlashCommandBuilder().setName('intro').setDescription('Staff: post the SSIM introduction, or update the one already posted')
    .addChannelOption((o) => o.setName('channel').setDescription('Target channel (default: here)').addChannelTypes(ChannelType.GuildText).setRequired(false))
    .setDefaultMemberPermissions(staffPerm),
  new SlashCommandBuilder().setName('post').setDescription('Staff: post or edit a bot message (embed)')
    .addStringOption((o) => o.setName('name').setDescription('Short key to identify/edit this post later').setRequired(true))
    .addChannelOption((o) => o.setName('channel').setDescription('Target channel (default: here)').addChannelTypes(ChannelType.GuildText).setRequired(false))
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
    case 'close': return cmdClose(interaction);
    case 'add': return cmdAddRemove(interaction, true);
    case 'remove': return cmdAddRemove(interaction, false);
    case 'announce': return cmdAnnounce(interaction);
    case 'panel': return cmdPanel(interaction);
    case 'intro': return cmdIntro(interaction);
    case 'post': return handlePostCommand(interaction);
    default: await interaction.reply({ ephemeral: true, content: 'Unknown command.' });
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
  const r = await announceNow(interaction.options.getBoolean('repost') ?? false);
  if (!r.ok) { await interaction.editReply({ content: `❌ ${r.error}` }); return; }
  const said = r.action === 'posted' ? `📣 Announced v${r.version}.`
    : r.action === 'edited' ? `📣 Updated the v${r.version} announcement to match the release notes.`
    : `✅ The v${r.version} announcement already matches the release notes.`;
  await interaction.editReply({ content: said });
}

async function cmdIntro(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply({ ephemeral: true });
  const target = (interaction.options.getChannel('channel') ?? interaction.channel) as TextChannel | null;
  if (!target || !target.isTextBased()) { await interaction.editReply({ content: '❌ Pick a text channel.' }); return; }
  try {
    const r = await postIntro(interaction.client, target);
    await interaction.editReply({
      content: r.action === 'posted'
        ? `📣 Introduction posted in <#${target.id}>. Run \`/intro\` again to update it in place.`
        : `📣 Updated the introduction in <#${target.id}>.`,
    });
  } catch (err) {
    await interaction.editReply({ content: `❌ ${(err as Error).message}` });
  }
}

async function cmdPanel(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply({ ephemeral: true });
  try { await postPanel(interaction.client); await interaction.editReply({ content: '✅ Panel posted.' }); }
  catch (err) { await interaction.editReply({ content: `❌ ${(err as Error).message}` }); }
}
