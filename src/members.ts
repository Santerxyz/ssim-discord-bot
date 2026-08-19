// ════════════════════════════════════════════════════════════════════════════
//  members.ts: what happens around a member arriving and leaving.
//
//  Two jobs. Grant MEMBER_ROLE_ID on join, and write joins and leaves to
//  MEMBER_LOG_CHANNEL_ID with the invite the member arrived on.
//
//  Discord does not tell you which invite was used. The only way to know is to
//  keep a count of every invite's uses and see which one moved when somebody
//  joined, so the cache below is the whole mechanism. It is refreshed on boot,
//  on every join, and whenever an invite is created or deleted.
// ════════════════════════════════════════════════════════════════════════════
import { Client, Guild, GuildMember, PartialGuildMember, TextChannel, EmbedBuilder, Invite } from 'discord.js';
import { config } from './config';
import { logger } from './logger';
import { BRAND } from './util';

interface CachedInvite {
  uses: number;
  inviterId: string | null;
  inviterTag: string | null;
}

/** code -> what we last knew about it. */
const invites = new Map<string, CachedInvite>();

/** How a member got in, as far as we can tell. */
interface Attribution {
  code: string | null;
  inviterId: string | null;
  inviterTag: string | null;
  note?: string;   // set when the invite could not be identified, and why
}

const snapshot = (inv: Invite): CachedInvite => ({
  uses: inv.uses ?? 0,
  inviterId: inv.inviter?.id ?? null,
  inviterTag: inv.inviter?.tag ?? null,
});

/** Read every invite in the guild. Returns null when Discord refuses, which in
 *  practice means the bot is missing the Manage Server permission. */
async function fetchInvites(guild: Guild) {
  try {
    return await guild.invites.fetch();
  } catch (err) {
    logger.warn('could not read the invite list, so joins cannot be attributed (is Manage Server granted?)', { err: (err as Error).message });
    return null;
  }
}

/** Prime the cache. Called once the gateway is up, and after any gap where the
 *  bot was not listening. */
export async function cacheInvites(guild: Guild): Promise<void> {
  const list = await fetchInvites(guild);
  if (!list) return;
  invites.clear();
  for (const inv of list.values()) invites.set(inv.code, snapshot(inv));
  logger.info(`invite cache primed with ${invites.size} invite(s)`);
}

export function trackInviteCreate(inv: Invite): void {
  invites.set(inv.code, snapshot(inv));
}

export function trackInviteDelete(inv: Invite): void {
  invites.delete(inv.code);
}

/**
 * Work out which invite was just used, then bring the cache back in line.
 *
 * Two shapes of answer. Usually one invite's use count is one higher than we last
 * saw. Sometimes the invite is gone instead: a single-use invite, or one that hit
 * its limit, is deleted by Discord the moment it is consumed, so the thing to look
 * for is a code we knew about that is no longer listed.
 */
async function attributeJoin(guild: Guild): Promise<Attribution> {
  const list = await fetchInvites(guild);
  if (!list) return { code: null, inviterId: null, inviterTag: null, note: 'invite list unreadable' };

  let used: { code: string; entry: CachedInvite } | null = null;
  const present = new Set<string>();

  for (const inv of list.values()) {
    present.add(inv.code);
    const before = invites.get(inv.code);
    if (before && (inv.uses ?? 0) > before.uses) used = { code: inv.code, entry: snapshot(inv) };
  }

  // A code we were tracking that has since disappeared was almost certainly consumed.
  if (!used) {
    const vanished = [...invites.entries()].filter(([code]) => !present.has(code));
    if (vanished.length === 1) used = { code: vanished[0][0], entry: vanished[0][1] };
  }

  // Re-sync wholesale so a missed create or delete cannot leave the cache skewed.
  invites.clear();
  for (const inv of list.values()) invites.set(inv.code, snapshot(inv));

  if (!used) {
    // A vanity URL, an OAuth bot add, a join we were offline for, or two people
    // arriving close enough together that one join absorbed the other's delta.
    return { code: null, inviterId: null, inviterTag: null, note: 'no invite changed' };
  }
  return { code: used.code, inviterId: used.entry.inviterId, inviterTag: used.entry.inviterTag };
}

async function logChannel(client: Client): Promise<TextChannel | null> {
  if (!config.channels.memberLog) return null;
  const ch = await client.channels.fetch(config.channels.memberLog).catch(() => null);
  if (!ch || !ch.isTextBased()) { logger.warn('member log channel not usable'); return null; }
  return ch as TextChannel;
}

/** Discord renders these client-side in the reader's own timezone. */
const stamp = (d: Date | null, style: 'F' | 'R' = 'F') => (d ? `<t:${Math.floor(d.getTime() / 1000)}:${style}>` : 'unknown');

export async function onMemberAdd(member: GuildMember): Promise<void> {
  // Grant first. An audit line is worth less than the member actually being let in.
  if (config.roles.member && !member.user.bot) {
    await member.roles.add(config.roles.member, 'automatic member role on join').catch((err) => {
      logger.error('could not grant the member role', { member: member.user.tag, err: (err as Error).message });
    });
  }

  const who = member.user.bot ? { code: null, inviterId: null, inviterTag: null, note: 'added as an application' } : await attributeJoin(member.guild);

  const ch = await logChannel(member.client);
  if (!ch) return;

  const embed = new EmbedBuilder()
    .setColor(BRAND)
    .setTitle('Member joined')
    .setThumbnail(member.user.displayAvatarURL())
    .addFields(
      { name: 'Member', value: `<@${member.id}>\n${member.user.tag}`, inline: true },
      { name: 'Account created', value: stamp(member.user.createdAt, 'R'), inline: true },
      { name: 'Member count', value: String(member.guild.memberCount), inline: true },
      {
        name: 'Invite',
        value: who.code ? `[discord.gg/${who.code}](https://discord.gg/${who.code})` : `Not determined (${who.note})`,
        inline: true,
      },
      {
        name: 'Invited by',
        value: who.inviterId ? `<@${who.inviterId}>\n${who.inviterTag ?? ''}`.trim() : 'Unknown',
        inline: true,
      },
    )
    .setFooter({ text: `User ID: ${member.id}` })
    .setTimestamp();

  await ch.send({ embeds: [embed], allowedMentions: { parse: [] } })
    .catch((err) => logger.warn('member join log failed', { err: (err as Error).message }));
}

export async function onMemberRemove(member: GuildMember | PartialGuildMember): Promise<void> {
  const ch = await logChannel(member.client);
  if (!ch) return;

  const joinedAt = member.joinedAt ?? null;
  // Roles are worth recording: it is the only trace of what someone had once they are gone.
  const roles = member.partial
    ? 'Unknown (member was not cached)'
    : member.roles.cache.filter((r) => r.id !== member.guild.id).map((r) => r.name).join(', ') || 'None';

  const embed = new EmbedBuilder()
    .setColor(0x4b5563)
    .setTitle('Member left')
    .setThumbnail(member.user.displayAvatarURL())
    .addFields(
      { name: 'Member', value: `<@${member.id}>\n${member.user.tag}`, inline: true },
      { name: 'Joined', value: stamp(joinedAt, 'R'), inline: true },
      { name: 'Member count', value: String(member.guild.memberCount), inline: true },
      { name: 'Roles held', value: roles.slice(0, 1024) },
    )
    .setFooter({ text: `User ID: ${member.id}` })
    .setTimestamp();

  await ch.send({ embeds: [embed], allowedMentions: { parse: [] } })
    .catch((err) => logger.warn('member leave log failed', { err: (err as Error).message }));
}
