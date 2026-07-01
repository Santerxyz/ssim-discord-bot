// ════════════════════════════════════════════════════════════════════════════
//  announce.ts — release announcements (Feature A).
//
//  TWO triggers, ONE idempotent core:
//    • push  — build/publish.js POSTs an HMAC-signed nudge to /internal/announce
//    • poll  — every POLL_INTERVAL_MS we reconcile against /version
//  Both call maybeAnnounce(), which re-fetches the CANONICAL /version and posts only
//  if `latest` is strictly newer than the last announced version. A promise-chain
//  mutex + compare-after-fetch guarantee exactly-once, forward-only posts — so push
//  and poll can never double-post, and the poll always catches a missed push.
// ════════════════════════════════════════════════════════════════════════════
import { WebhookClient, Client, TextChannel } from 'discord.js';
import { config } from './config';
import { store } from './store';
import { logger } from './logger';
import { isNewer } from './util';
import { formatReleasePost } from './format';
import { licenseApi, VersionManifest } from './licenseApi';

let discordClient: Client | null = null;
export function bindAnnounceClient(c: Client): void { discordClient = c; }

// Serialise every announce attempt (push + poll + manual) so they can't overlap.
let chain: Promise<void> = Promise.resolve();

async function post(manifest: VersionManifest): Promise<void> {
  const content = formatReleasePost({
    version: manifest.latest, notes: manifest.notes, url: manifest.url, publishedAt: manifest.publishedAt,
  });
  // Preferred: the "Santer" webhook → renders pixel-identically to the hand-posts. allowedMentions
  // none so a stray @everyone in notes can never ping. Fall back to posting as the bot user.
  if (config.announceWebhookUrl) {
    const wh = new WebhookClient({ url: config.announceWebhookUrl });
    await wh.send({ content, username: 'Santer', allowedMentions: { parse: [] } });
  } else if (discordClient && config.channels.announce) {
    const ch = await discordClient.channels.fetch(config.channels.announce).catch(() => null);
    if (ch && ch.isTextBased()) await (ch as TextChannel).send({ content, allowedMentions: { parse: [] } });
    else throw new Error('announce channel not usable and no ANNOUNCE_WEBHOOK_URL');
  } else {
    throw new Error('no ANNOUNCE_WEBHOOK_URL and no ANNOUNCE_CHANNEL_ID configured');
  }
}

/** Idempotent, forward-only. Re-fetches /version and posts iff it's newer than the last announced. */
export function maybeAnnounce(reason: string): Promise<void> {
  chain = chain.then(async () => {
    const res = await licenseApi.getVersion();
    if (!res.ok || !res.data || !res.data.latest) {
      logger.warn(`announce(${reason}): could not fetch /version`, { status: res.status });
      return;
    }
    const latest = res.data.latest;
    const last = store.lastAnnouncedVersion;
    if (!isNewer(latest, last)) { logger.debug(`announce(${reason}): v${latest} not newer than v${last} — skip`); return; }
    try {
      await post(res.data);
      store.setLastAnnouncedVersion(latest);           // advance ONLY on a successful post
      logger.info(`announced v${latest} (${reason})`);
    } catch (err) {
      logger.error(`announce(${reason}): post failed — will retry on next poll`, { err: (err as Error).message });
    }
  }).catch((err) => logger.error('announce chain error', { err: (err as Error).message }));
  return chain;
}

/** Force-post the CURRENT /version regardless of idempotency (staff /announce). */
export async function announceNow(): Promise<{ ok: boolean; version?: string; error?: string }> {
  const res = await licenseApi.getVersion();
  if (!res.ok || !res.data || !res.data.latest) return { ok: false, error: 'could not fetch /version' };
  try {
    await post(res.data);
    store.setLastAnnouncedVersion(res.data.latest);
    return { ok: true, version: res.data.latest };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

/**
 * Wire up announcements. On the FIRST run (no prior state) we BASELINE to the current release so a
 * freshly-deployed bot doesn't announce a pre-existing version; only future releases post. On a
 * restart we reconcile once (in case a release landed while we were down), then poll forever.
 */
export async function initAnnounce(): Promise<void> {
  if (store.lastAnnouncedVersion === '0.0.0') {
    const res = await licenseApi.getVersion();
    if (res.ok && res.data && res.data.latest) {
      store.setLastAnnouncedVersion(res.data.latest);
      logger.info(`announce baseline = v${res.data.latest} (first run — existing release not announced)`);
    }
  } else {
    maybeAnnounce('startup');
  }
  setInterval(() => maybeAnnounce('poll'), config.pollIntervalMs).unref();
  logger.info(`announce poller every ${Math.round(config.pollIntervalMs / 1000)}s`);
}
