// ════════════════════════════════════════════════════════════════════════════
//  index.ts: entry point. Boots the Discord client, the internal HTTP server
//  (publish → announce trigger), the announce poller, the member join and leave
//  handling, and the ticket auto-close sweep. `--register-only` just (re)registers
//  slash commands and exits.
// ════════════════════════════════════════════════════════════════════════════
import { Client, GatewayIntentBits, Partials, Events } from 'discord.js';
import { config } from './config';
import { logger } from './logger';
import { registerCommands } from './commands';
import { handleInteraction } from './interactions';
import { bindAnnounceClient, initAnnounce } from './announce';
import { startHttpServer } from './httpServer';
import { sweepAutoClose, trackActivity } from './tickets';
import { cacheInvites, onMemberAdd, onMemberRemove, trackInviteCreate, trackInviteDelete } from './members';

async function main(): Promise<void> {
  if (process.argv.includes('--register-only')) {
    await registerCommands();
    logger.info('slash-command registration complete, exiting (--register-only)');
    return;
  }

  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMembers,   // role grants, joins and leaves (enable in the dev portal)
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent, // transcripts + activity tracking (enable in the dev portal)
      GatewayIntentBits.GuildInvites,   // keeps the invite cache fresh so joins can be attributed
    ],
    partials: [
      Partials.Channel,                 // receive DMs / uncached channels
      Partials.GuildMember,             // without this, leaves by uncached members never fire
    ],
  });

  let ready = false;
  startHttpServer(() => ready); // up immediately so /health works even before the gateway connects

  client.once(Events.ClientReady, async (c) => {
    logger.info(`logged in as ${c.user.tag}`);
    bindAnnounceClient(client);
    try { await registerCommands(); } catch (err) { logger.error('command registration failed', { err: (err as Error).message }); }
    await initAnnounce();
    // Prime the invite counts before anyone can join, otherwise the first join of the
    // session has no baseline to compare against and cannot be attributed.
    const guild = await client.guilds.fetch(config.guildId).catch(() => null);
    if (guild) await cacheInvites(guild);
    if (config.roles.member) logger.info(`member role grant enabled (${config.roles.member})`);
    if (config.ticketAutocloseHours > 0) {
      setInterval(() => { sweepAutoClose(client).catch((err) => logger.error('auto-close sweep failed', { err: (err as Error).message })); }, 30 * 60 * 1000).unref();
      logger.info(`ticket auto-close enabled (${config.ticketAutocloseHours}h idle)`);
    }
    ready = true;
    logger.info('bot ready');
  });

  client.on(Events.InteractionCreate, (i) => { handleInteraction(i).catch((err) => logger.error('interaction dispatch error', { err: (err as Error).message })); });
  client.on(Events.MessageCreate, (m) => trackActivity(m));
  client.on(Events.GuildMemberAdd, (m) => { onMemberAdd(m).catch((err) => logger.error('member join handler failed', { err: (err as Error).message })); });
  client.on(Events.GuildMemberRemove, (m) => { onMemberRemove(m).catch((err) => logger.error('member leave handler failed', { err: (err as Error).message })); });
  client.on(Events.InviteCreate, (inv) => trackInviteCreate(inv));
  client.on(Events.InviteDelete, (inv) => trackInviteDelete(inv));
  client.on(Events.Error, (err) => logger.error('client error', { err: err.message }));

  process.on('unhandledRejection', (err) => logger.error('unhandledRejection', { err: String(err) }));
  process.on('SIGINT', () => { logger.info('SIGINT received, shutting down'); client.destroy(); process.exit(0); });
  process.on('SIGTERM', () => { logger.info('SIGTERM received, shutting down'); client.destroy(); process.exit(0); });

  await client.login(config.token);
}

main().catch((err) => { logger.error('fatal', { err: (err as Error).message }); process.exit(1); });
