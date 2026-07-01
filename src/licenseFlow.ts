// ════════════════════════════════════════════════════════════════════════════
//  licenseFlow.ts — the "License / Get Access" category (Feature B automation).
//
//  SECURITY: the FULL key is only ever delivered by DM or an EPHEMERAL reply, and
//  the lookup is ALWAYS scoped to interaction.user.id (the invoker), so a rename /
//  a staff member in the channel can never surface someone else's key. Channel
//  messages, transcripts, and audit logs carry only a redacted reference.
// ════════════════════════════════════════════════════════════════════════════
import {
  GuildMember, TextChannel, User, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
  ButtonInteraction, ModalSubmitInteraction, ModalBuilder, TextInputBuilder, TextInputStyle,
} from 'discord.js';
import { config } from './config';
import { logger } from './logger';
import { BRAND, redactKey, createRateLimiter } from './util';
import { licenseApi, License } from './licenseApi';
import { audit } from './audit';
import { closeRow } from './tickets';

const revealLimiter = createRateLimiter(60_000, 8);
const claimLimiter = createRateLimiter(60_000, 5);

async function grantBetaTester(member: GuildMember | null): Promise<boolean> {
  if (!member) return false;
  try { await member.roles.add(config.roles.betaTester, 'SSIM license retrieved/claimed'); return true; }
  catch (err) { logger.error('grant Beta Tester failed', { err: (err as Error).message, user: member.id }); return false; }
}

async function memberOf(interaction: { guild: { members: { fetch: (id: string) => Promise<GuildMember> } } | null; user: User }): Promise<GuildMember | null> {
  if (!interaction.guild) return null;
  try { return await interaction.guild.members.fetch(interaction.user.id); } catch { return null; }
}

function keyEmbed(license: License): EmbedBuilder {
  return new EmbedBuilder().setColor(BRAND).setAuthor({ name: 'Santer' }).setTitle('🔑 Your SSIM License')
    .setDescription(`\`\`\`\n${license.key}\n\`\`\`\nKeep it private — treat it like a password.`)
    .addFields(
      { name: 'Tier', value: String(license.tier), inline: true },
      { name: 'Seats', value: `${license.usedSeats ?? 0} / ${license.seats}`, inline: true },
      { name: 'Expires', value: license.expiresAt ? String(license.expiresAt).slice(0, 10) : 'never', inline: true },
    );
}

/** Try DM first; returns true if the key reached the user's DMs. */
async function dmKey(user: User, license: License): Promise<boolean> {
  try { await user.send({ embeds: [keyEmbed(license)] }); return true; } catch { return false; }
}

// ── License action buttons (posted inside a license ticket) ─────────────────────
export function licenseActionRow(): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId('lic:reveal').setLabel('Reveal my key').setStyle(ButtonStyle.Success).setEmoji('🔑'),
    new ButtonBuilder().setCustomId('lic:generate').setLabel('Generate my key').setStyle(ButtonStyle.Primary).setEmoji('✨'),
    new ButtonBuilder().setCustomId('lic:claim').setLabel('I already have a key').setStyle(ButtonStyle.Secondary),
  );
}

// ── Auto-lookup when a License ticket opens ─────────────────────────────────────
export async function onLicenseTicketOpen(channel: TextChannel, opener: GuildMember): Promise<void> {
  await channel.send({
    content: `<@${opener.id}>`,
    embeds: [new EmbedBuilder().setColor(BRAND).setTitle('🔑 License / Get Access')
      .setDescription('Checking for a license linked to your account… Use the buttons below at any time.')],
    components: [licenseActionRow()],
    allowedMentions: { users: [opener.id] },
  });

  const res = await licenseApi.byDiscord(opener.id);
  if (res.ok && res.data) {
    const granted = await grantBetaTester(opener);
    const dm = await dmKey(opener.user, res.data);
    await channel.send({
      embeds: [new EmbedBuilder().setColor(BRAND).setTitle('✅ License found').setDescription(
        `${dm ? 'Sent your key by **DM**.' : 'I could not DM you — click **Reveal my key** to see it privately.'}\n` +
        `Reference: \`${redactKey(res.data.key)}\`\n` +
        (granted ? 'Role **Beta Tester** granted — the server is unlocked. 🎉' : '⚠ Could not grant the role automatically; staff will help.'),
      )],
      components: [closeRow()],
      allowedMentions: { parse: [] },
    });
    await audit(channel.client, 'license_reveal', { user: opener.user.tag, key: redactKey(res.data.key), delivery: dm ? 'dm' : 'pending' });
  } else if (res.status === 404) {
    await channel.send({
      embeds: [new EmbedBuilder().setColor(BRAND).setTitle('Get your license').setDescription(
        'You don’t have a license linked yet — grab one below:\n' +
        '• **✨ Generate my key** — create a fresh license instantly.\n' +
        '• **I already have a key** — link an existing one.',
      )],
      allowedMentions: { parse: [] },
    });
    await audit(channel.client, 'license_no_match', { user: opener.user.tag });
  } else {
    await channel.send({ embeds: [new EmbedBuilder().setColor(BRAND).setTitle('Temporary problem')
      .setDescription('Could not reach the license service. Please try **Reveal my key** again shortly, or wait for staff.')] });
    logger.warn('license lookup transient failure', { status: res.status, err: res.error });
  }
}

// ── "Reveal my key" button — scoped to the INVOKER, ephemeral/DM only ───────────
export async function handleReveal(interaction: ButtonInteraction): Promise<void> {
  const rl = revealLimiter(interaction.user.id);
  if (!rl.ok) { await interaction.reply({ ephemeral: true, content: `Slow down — try again in ${Math.ceil(rl.retryAfterMs / 1000)}s.` }); return; }
  await interaction.deferReply({ ephemeral: true });
  const res = await licenseApi.byDiscord(interaction.user.id); // INVOKER — never the channel opener
  if (res.ok && res.data) {
    await grantBetaTester(await memberOf(interaction));
    const dm = await dmKey(interaction.user, res.data);
    if (dm) await interaction.editReply({ content: '📬 Sent your key by DM and unlocked your access (Beta Tester).' });
    else await interaction.editReply({ content: 'Here is your key (only you can see this). Access unlocked.', embeds: [keyEmbed(res.data)] });
    await audit(interaction.client, 'license_reveal', { user: interaction.user.tag, key: redactKey(res.data.key), delivery: dm ? 'dm' : 'ephemeral' });
  } else if (res.status === 404) {
    await interaction.editReply({ content: 'No license is linked to your account yet. Use **✨ Generate my key** to get one, or **I already have a key** to link an existing one.' });
  } else {
    await interaction.editReply({ content: 'Could not reach the license service — please try again shortly.' });
  }
}

// ── "Generate my key" — open self-service issuing (one license per account) ─────
export async function handleGenerate(interaction: ButtonInteraction): Promise<void> {
  const rl = claimLimiter(interaction.user.id);
  if (!rl.ok) { await interaction.reply({ ephemeral: true, content: `Slow down — try again in ${Math.ceil(rl.retryAfterMs / 1000)}s.` }); return; }
  await interaction.deferReply({ ephemeral: true });
  const res = await licenseApi.selfIssue({ discordId: interaction.user.id, discordUsername: interaction.user.tag });
  if (res.ok && res.data) {
    const granted = await grantBetaTester(await memberOf(interaction));
    const dm = await dmKey(interaction.user, res.data);
    const created = res.status === 201;
    const line = created ? '✨ Created your license' : 'You already have a license';
    if (dm) await interaction.editReply({ content: `${line} and sent it by **DM**.${granted ? ' Access unlocked (**Beta Tester**).' : ''}` });
    else await interaction.editReply({ content: `${line} — here it is (only you can see this):`, embeds: [keyEmbed(res.data)] });
    await audit(interaction.client, created ? 'license_selfissue' : 'license_reveal', { user: interaction.user.tag, key: redactKey(res.data.key), delivery: dm ? 'dm' : 'ephemeral' });
  } else if (res.status === 403) {
    await interaction.editReply({ content: 'Self-service key generation is currently disabled — a staff member will help.' });
  } else {
    await interaction.editReply({ content: 'Could not generate a key right now — please try again shortly.' });
  }
}

// ── Self-service claim ──────────────────────────────────────────────────────────
export function buildClaimModal(): ModalBuilder {
  return new ModalBuilder().setCustomId('lic:claimModal').setTitle('Link your license key').addComponents(
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder().setCustomId('key').setLabel('License key').setStyle(TextInputStyle.Short)
        .setRequired(true).setMinLength(19).setMaxLength(24).setPlaceholder('SSIM-XXXX-XXXX-XXXX-XXXX'),
    ),
  );
}

export async function handleClaimModal(interaction: ModalSubmitInteraction): Promise<void> {
  const rl = claimLimiter(interaction.user.id);
  if (!rl.ok) { await interaction.reply({ ephemeral: true, content: `Too many attempts — try again in ${Math.ceil(rl.retryAfterMs / 1000)}s.` }); return; }
  const key = interaction.fields.getTextInputValue('key').trim().toUpperCase();
  await interaction.deferReply({ ephemeral: true });
  const res = await licenseApi.claim({ key, discordId: interaction.user.id, discordUsername: interaction.user.tag });
  if (res.ok && res.data) {
    const granted = await grantBetaTester(await memberOf(interaction));
    await interaction.editReply({ content: `✅ Linked \`${redactKey(res.data.key)}\` to your account${granted ? ' and unlocked access (**Beta Tester**).' : '. ⚠ Could not grant the role — staff will help.'}` });
    await audit(interaction.client, 'license_claim', { user: interaction.user.tag, key: redactKey(res.data.key) });
  } else {
    // Generic messages — never reveal whether a key exists for another account.
    const msg = res.error === 'already_claimed' ? 'That key is already linked to another account.'
      : res.error === 'discord_taken' ? 'Your account already has a license linked. Use **Reveal my key**.'
      : res.status === 404 || res.error === 'not_found' ? 'That key was not found. Double-check it and try again.'
      : res.status === 403 || res.error === 'revoked' || res.error === 'expired' ? 'That key is not active (revoked or expired).'
      : 'Could not link that key. Please try again or contact staff.';
    await interaction.editReply({ content: `❌ ${msg}` });
    await audit(interaction.client, 'license_claim_fail', { user: interaction.user.tag, reason: res.error || String(res.status) });
  }
}
