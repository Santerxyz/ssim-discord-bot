// ════════════════════════════════════════════════════════════════════════════
//  audit.ts — mirror every sensitive action to the audit channel (and console).
//  Callers MUST pass redacted key references — this never receives a full key.
// ════════════════════════════════════════════════════════════════════════════
import { Client, EmbedBuilder, TextChannel } from 'discord.js';
import { config } from './config';
import { logger } from './logger';
import { BRAND } from './util';

export async function audit(client: Client, event: string, fields: Record<string, string>): Promise<void> {
  logger.info(`audit: ${event}`, fields);
  if (!config.channels.audit) return;
  try {
    const ch = await client.channels.fetch(config.channels.audit).catch(() => null);
    if (!ch || !ch.isTextBased()) return;
    const embed = new EmbedBuilder().setColor(BRAND).setTitle(`🛡️ ${event}`).setTimestamp();
    for (const [k, v] of Object.entries(fields)) embed.addFields({ name: k, value: (v || '—').slice(0, 1024), inline: true });
    await (ch as TextChannel).send({ embeds: [embed], allowedMentions: { parse: [] } });
  } catch (err) {
    logger.warn('audit post failed', { err: (err as Error).message });
  }
}
