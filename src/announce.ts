// ════════════════════════════════════════════════════════════════════════════
//  announce.ts: release announcements.
//
//  Two triggers, one idempotent core:
//    push: a publisher POSTs an HMAC-signed nudge to /internal/announce
//    poll: every POLL_INTERVAL_MS we reconcile against the GitHub Releases API
//  Both call maybeAnnounce(), which re-fetches the release itself and posts only
//  if `latest` is strictly newer than the last announced version. A promise-chain
//  mutex plus compare-after-fetch guarantee exactly-once, forward-only posts, so
//  push and poll can never double-post and the poll always catches a missed push.
// ════════════════════════════════════════════════════════════════════════════
import { WebhookClient, Client, TextChannel, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { config } from './config';
import { store } from './store';
import { logger } from './logger';
import { isNewer, BRAND } from './util';
import { formatReleasePost } from './format';
import { getLatestRelease, VersionManifest } from './releaseApi';

let discordClient: Client | null = null;
export function bindAnnounceClient(c: Client): void { discordClient = c; }

// Serialise every announce attempt (push + poll + manual) so they can't overlap.
let chain: Promise<void> = Promise.resolve();

async function postUpdate(manifest: VersionManifest): Promise<void> {
  const content = formatReleasePost({
    version: manifest.latest, notes: manifest.notes, publishedAt: manifest.publishedAt,
    downloadsMention: config.channels.downloads ? `<#${config.channels.downloads}>` : '',
  });
  // Preferred: the "Santer" webhook (posts pixel-identically). allowedMentions none so a stray
  // @everyone in notes can never ping. Fall back to posting as the bot user in the announce channel.
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

// The downloads channel holds ONE message with two download buttons, edited IN PLACE each release:
//   Full install (ZIP): first-time setup.   Update (EXE): just this version.
async function upsertDownloads(manifest: VersionManifest): Promise<void> {
  if (!discordClient || !config.channels.downloads) return;
  const ch = await discordClient.channels.fetch(config.channels.downloads).catch(() => null);
  if (!ch || !ch.isTextBased()) { logger.warn('downloads channel not usable'); return; }
  const embed = new EmbedBuilder()
    .setColor(BRAND)
    .setTitle(`Downloads: SSIM v${manifest.latest}`)
    .setDescription(
      '**Full install (ZIP)**: download this for a first-time setup; it contains everything you need.\n' +
      '**Update (EXE)**: installs just this version; use it to update an existing install.',
    )
    .setFooter({ text: `Current version: v${manifest.latest}` })
    .setTimestamp();
  const row = new ActionRowBuilder<ButtonBuilder>();
  if (config.downloadZipUrl) row.addComponents(new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('Full install (ZIP)').setURL(config.downloadZipUrl));
  if (manifest.url) row.addComponents(new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel(`Update to v${manifest.latest} (EXE)`).setURL(manifest.url));
  const payload = { embeds: [embed], components: row.components.length ? [row] : [] };

  const existing = store.downloadsMessageId;
  if (existing) {
    const ok = await (ch as TextChannel).messages.edit(existing, payload).then(() => true).catch(() => false);
    if (ok) return; // edited the existing message in place
  }
  const msg = await (ch as TextChannel).send(payload).catch((err) => { logger.error('downloads post failed', { err: (err as Error).message }); return null; });
  if (msg) store.setDownloadsMessageId(msg.id);
}

/** Idempotent and forward-only. Re-fetches the latest release and posts only if it is newer. */
export function maybeAnnounce(reason: string): Promise<void> {
  chain = chain.then(async () => {
    const res = await getLatestRelease();
    if (!res.ok || !res.data || !res.data.latest) {
      logger.warn(`announce(${reason}): could not fetch the latest GitHub release`, { status: res.status });
      return;
    }
    const latest = res.data.latest;
    const last = store.lastAnnouncedVersion;
    if (!isNewer(latest, last)) { logger.debug(`announce(${reason}): v${latest} not newer than v${last}, skipping`); return; }
    try {
      await postUpdate(res.data);
      await upsertDownloads(res.data);
      store.setLastAnnouncedVersion(latest);           // advance ONLY on a successful post
      logger.info(`announced v${latest} (${reason})`);
    } catch (err) {
      logger.error(`announce(${reason}): post failed, will retry on next poll`, { err: (err as Error).message });
    }
  }).catch((err) => logger.error('announce chain error', { err: (err as Error).message }));
  return chain;
}

/** Force-post the current release regardless of idempotency (staff /announce). */
export async function announceNow(): Promise<{ ok: boolean; version?: string; error?: string }> {
  const res = await getLatestRelease();
  if (!res.ok || !res.data || !res.data.latest) return { ok: false, error: 'could not fetch the latest GitHub release' };
  try {
    await postUpdate(res.data);
    await upsertDownloads(res.data);
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
  const res = await getLatestRelease();
  if (res.ok && res.data && res.data.latest) {
    if (store.lastAnnouncedVersion === '0.0.0') {
      store.setLastAnnouncedVersion(res.data.latest);
      logger.info(`announce baseline = v${res.data.latest} (first run, existing release not announced)`);
      await upsertDownloads(res.data);                 // still publish the downloads message on first boot
    } else if (isNewer(res.data.latest, store.lastAnnouncedVersion)) {
      await maybeAnnounce('startup');                   // posts the update AND refreshes downloads
    } else {
      await upsertDownloads(res.data);                  // keep the downloads message current
    }
  }
  setInterval(() => maybeAnnounce('poll'), config.pollIntervalMs).unref();
  logger.info(`announce poller every ${Math.round(config.pollIntervalMs / 1000)}s`);
}
