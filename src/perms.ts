// ════════════════════════════════════════════════════════════════════════════
//  perms.ts — staff-role gate. Works for both a full GuildMember (roles.cache)
//  and the raw APIInteractionGuildMember (roles: string[]).
// ════════════════════════════════════════════════════════════════════════════
import { GuildMember, APIInteractionGuildMember } from 'discord.js';
import { config } from './config';

export function memberHasStaff(member: GuildMember | APIInteractionGuildMember | null | undefined): boolean {
  if (!member) return false;
  const roles = member.roles as unknown;
  if (Array.isArray(roles)) return roles.includes(config.roles.staff);           // API member → string[]
  const cache = (roles as GuildMember['roles'])?.cache;
  return cache ? cache.has(config.roles.staff) : false;                          // GuildMember
}
