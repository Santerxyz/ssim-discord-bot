// ════════════════════════════════════════════════════════════════════════════
//  post.ts: the staff "/post" command. Publishes, and later edits, a branded
//  message under a short NAME. Running /post with the same name re-opens the
//  editor pre-filled and edits the existing message in place.
// ════════════════════════════════════════════════════════════════════════════
import {
  ChatInputCommandInteraction, ModalSubmitInteraction, ModalBuilder, TextInputBuilder, TextInputStyle,
  ActionRowBuilder, EmbedBuilder, TextChannel,
} from 'discord.js';
import { store } from './store';
import { logger } from './logger';
import { BRAND } from './util';
import { memberHasStaff } from './perms';

const NAME_RE = /^[a-z0-9_-]{1,32}$/i;

// /post name:<key> [channel] → open the editor (pre-filled if the name already exists).
export async function handlePostCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  const name = interaction.options.getString('name', true).trim().toLowerCase();
  if (!NAME_RE.test(name)) {
    await interaction.reply({ ephemeral: true, content: 'Name must be 1 to 32 characters: letters, numbers, `-` or `_`.' });
    return;
  }
  const existing = store.getPost(name);
  const channelId = existing?.channelId || interaction.options.getChannel('channel')?.id || interaction.channelId;
  await interaction.showModal(buildPostModal(name, channelId, existing?.title || '', existing?.message || ''));
}

function buildPostModal(name: string, channelId: string, title: string, message: string): ModalBuilder {
  const titleInput = new TextInputBuilder().setCustomId('title').setLabel('Title').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(256);
  const msgInput = new TextInputBuilder().setCustomId('message').setLabel('Message').setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(4000);
  if (title) titleInput.setValue(title);
  if (message) msgInput.setValue(message);
  return new ModalBuilder()
    .setCustomId(`post:submit:${channelId}:${name}`)
    .setTitle((store.getPost(name) ? `Edit post: ${name}` : `New post: ${name}`).slice(0, 45))
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(titleInput),
      new ActionRowBuilder<TextInputBuilder>().addComponents(msgInput),
    );
}

export async function handlePostModal(interaction: ModalSubmitInteraction): Promise<void> {
  if (!memberHasStaff(interaction.member)) { await interaction.reply({ ephemeral: true, content: 'Staff only.' }); return; }
  const parts = interaction.customId.split(':'); // post:submit:<channelId>:<name>
  const channelId = parts[2] || '';
  const name = parts.slice(3).join(':');
  const title = interaction.fields.getTextInputValue('title').trim();
  const message = interaction.fields.getTextInputValue('message');
  await interaction.deferReply({ ephemeral: true });

  const ch = await interaction.client.channels.fetch(channelId).catch(() => null);
  if (!ch || !ch.isTextBased()) { await interaction.editReply({ content: 'Target channel not found or not a text channel.' }); return; }
  const embed = new EmbedBuilder().setColor(BRAND).setTitle(title).setDescription(message).setTimestamp();
  const payload = { embeds: [embed] };

  const existing = store.getPost(name);
  let messageId = '';
  if (existing?.messageId) {
    messageId = await (ch as TextChannel).messages.edit(existing.messageId, payload).then((m) => m.id).catch(() => '');
  }
  if (!messageId) {
    const msg = await (ch as TextChannel).send(payload).catch((err) => { logger.error('post send failed', { err: (err as Error).message }); return null; });
    if (!msg) { await interaction.editReply({ content: 'Could not post. Check that I can send messages + embeds in that channel.' }); return; }
    messageId = msg.id;
  }
  store.setPost(name, { channelId, messageId, title, message });
  await interaction.editReply({ content: `${existing ? 'Updated' : 'Posted'} **${name}** in <#${channelId}>. Run \`/post name:${name}\` again to edit it.` });
}
