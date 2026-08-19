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
//
//  The same reconciler keeps an already-posted announcement in step with its
//  release. GitHub stays the single source of truth: edit the release notes there
//  and the message on the board is edited to match, rather than a correction being
//  posted underneath it or the two versions drifting apart.
// ════════════════════════════════════════════════════════════════════════════
import { WebhookClient, Client, TextChannel, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { config } from './config';
import { store, AnnouncementRecord } from './store';
import { logger } from './logger';
import { isNewer, BRAND } from './util';
import { formatReleasePost } from './format';
import { getLatestRelease, VersionManifest } from './releaseApi';

let discordClient: Client | null = null;
export function bindAnnounceClient(c: Client): void { discordClient = c; }

// Serialise every announce attempt (push + poll + manual) so they can't overlap.
let chain: Promise<void> = Promise.resolve();

/** The exact message body for a release. Posting and editing both go through this,
 *  so a stored body can be compared against a fresh render to detect a notes edit. */
function renderPost(manifest: VersionManifest): string {
  return formatReleasePost({
    version: manifest.latest, notes: manifest.notes, publishedAt: manifest.publishedAt,
    downloadsMention: config.channels.downloads ? `<#${config.channels.downloads}>` : '',
  });
}

/** Post a new announcement and return what is needed to edit it later. Throws if
 *  there is nowhere to post. */
async function postUpdate(version: string, content: string): Promise<AnnouncementRecord> {
  // Preferred: the "Santer" webhook (posts pixel-identically). allowedMentions none so a stray
  // @everyone in notes can never ping. Fall back to posting as the bot user in the announce channel.
  if (config.announceWebhookUrl) {
    const wh = new WebhookClient({ url: config.announceWebhookUrl });
    const msg = await wh.send({ content, username: 'Santer', allowedMentions: { parse: [] } });
    return { version, messageId: msg.id, channelId: '', viaWebhook: true, content };
  }
  if (discordClient && config.channels.announce) {
    const ch = await discordClient.channels.fetch(config.channels.announce).catch(() => null);
    if (!ch || !ch.isTextBased()) throw new Error('announce channel not usable and no ANNOUNCE_WEBHOOK_URL');
    const msg = await (ch as TextChannel).send({ content, allowedMentions: { parse: [] } });
    return { version, messageId: msg.id, channelId: ch.id, viaWebhook: false, content };
  }
  throw new Error('no ANNOUNCE_WEBHOOK_URL and no ANNOUNCE_CHANNEL_ID configured');
}

/**
 * Edit a posted announcement in place.
 *   'edited' the message now matches the notes
 *   'gone'   the message or its webhook no longer exists, so stop tracking it
 *   'failed' something transient; the record is kept and the next poll retries
 */
async function editUpdate(rec: AnnouncementRecord, content: string): Promise<'edited' | 'gone' | 'failed'> {
  try {
    if (rec.viaWebhook) {
      if (!config.announceWebhookUrl) { logger.warn('cannot edit the announcement: it was posted by webhook and ANNOUNCE_WEBHOOK_URL is now unset'); return 'failed'; }
      const wh = new WebhookClient({ url: config.announceWebhookUrl });
      await wh.editMessage(rec.messageId, { content, allowedMentions: { parse: [] } });
      return 'edited';
    }
    if (!discordClient || !rec.channelId) return 'failed';
    const ch = await discordClient.channels.fetch(rec.channelId).catch(() => null);
    if (!ch || !ch.isTextBased()) return 'failed';
    await (ch as TextChannel).messages.edit(rec.messageId, { content, allowedMentions: { parse: [] } });
    return 'edited';
  } catch (err) {
    // 10008 Unknown Message, 10015 Unknown Webhook. Both mean the target is gone for good.
    const code = (err as { code?: number }).code;
    if (code === 10008 || code === 10015) return 'gone';
    logger.error('announcement edit failed', { err: (err as Error).message });
    return 'failed';
  }
}

/** Bring the posted announcement in line with the current release notes. No-op when
 *  nothing is tracked for this version or the body is already identical. */
async function syncAnnouncement(version: string, content: string, reason: string): Promise<'edited' | 'unchanged' | 'untracked' | 'failed'> {
  const rec = store.announcement;
  if (!rec || rec.version !== version) return 'untracked';
  if (rec.content === content) return 'unchanged';
  const outcome = await editUpdate(rec, content);
  if (outcome === 'edited') {
    store.setAnnouncement({ ...rec, content });
    logger.info(`announcement for v${version} edited to match the release notes (${reason})`);
    return 'edited';
  }
  if (outcome === 'gone') {
    store.setAnnouncement(null);
    logger.warn(`announcement message for v${version} no longer exists, stopped tracking it`);
  }
  return 'failed';
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

/**
 * Idempotent and forward-only. Re-fetches the latest release, then either posts it
 * because it is newer than anything announced, or edits the message already posted
 * for it so the notes on the board match the notes on GitHub.
 */
export function maybeAnnounce(reason: string): Promise<void> {
  chain = chain.then(async () => {
    const res = await getLatestRelease();
    if (!res.ok || !res.data || !res.data.latest) {
      logger.warn(`announce(${reason}): could not fetch the latest GitHub release`, { status: res.status });
      return;
    }
    const manifest = res.data;
    const latest = manifest.latest;
    const content = renderPost(manifest);

    if (!isNewer(latest, store.lastAnnouncedVersion)) {
      // Not a new release. The notes behind it may still have been corrected.
      await syncAnnouncement(latest, content, reason);
      return;
    }

    // The version looks new, but a message for it may already be on the board: the
    // record below is written before the version is advanced, so a crash in between
    // used to leave the release announced yet unmarked, and the next poll posted it
    // twice. Having posted it is the fact that settles it.
    if (store.announcement && store.announcement.version === latest) {
      logger.warn(`announce(${reason}): v${latest} was already posted but not recorded, adopting it instead of posting again`);
      await syncAnnouncement(latest, content, reason);
      store.setLastAnnouncedVersion(latest);
      return;
    }

    try {
      const rec = await postUpdate(latest, content);
      store.setAnnouncement(rec);                      // record it BEFORE advancing the version
      await upsertDownloads(manifest);
      store.setLastAnnouncedVersion(latest);           // advance ONLY on a successful post
      logger.info(`announced v${latest} (${reason})`);
    } catch (err) {
      logger.error(`announce(${reason}): post failed, will retry on next poll`, { err: (err as Error).message });
    }
  }).catch((err) => logger.error('announce chain error', { err: (err as Error).message }));
  return chain;
}

export type AnnounceAction = 'posted' | 'edited' | 'unchanged';

/**
 * Staff /announce. By default this reconciles the latest release: it edits the
 * message already posted for it, or posts one if none is tracked. `repost` forces a
 * brand new message instead, which is the way to recover when the original was
 * deleted or was posted before the bot started tracking them.
 */
export async function announceNow(repost: boolean): Promise<{ ok: boolean; version?: string; action?: AnnounceAction; error?: string }> {
  const res = await getLatestRelease();
  if (!res.ok || !res.data || !res.data.latest) return { ok: false, error: 'could not fetch the latest GitHub release' };
  const manifest = res.data;
  const version = manifest.latest;
  const content = renderPost(manifest);

  if (!repost) {
    const outcome = await syncAnnouncement(version, content, 'manual');
    if (outcome === 'edited') return { ok: true, version, action: 'edited' };
    if (outcome === 'unchanged') return { ok: true, version, action: 'unchanged' };
    if (outcome === 'failed') return { ok: false, error: 'the tracked announcement could not be edited. Run `/announce repost:true` to post a fresh one.' };
    // 'untracked' falls through and posts, so the first run after an upgrade still works.
  }

  try {
    const rec = await postUpdate(version, content);
    store.setAnnouncement(rec);
    await upsertDownloads(manifest);
    store.setLastAnnouncedVersion(version);
    return { ok: true, version, action: 'posted' };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

/**
 * Wire up announcements. On the FIRST run (no prior state) we BASELINE to the current release so a
 * freshly-deployed bot doesn't announce a pre-existing version; only future releases post. On a
 * restart we reconcile once, which posts a release that landed while we were down and otherwise
 * picks up any edit made to the notes in the meantime. Then poll forever.
 */
export async function initAnnounce(): Promise<void> {
  const res = await getLatestRelease();
  if (res.ok && res.data && res.data.latest) {
    if (store.lastAnnouncedVersion === '0.0.0') {
      store.setLastAnnouncedVersion(res.data.latest);
      logger.info(`announce baseline = v${res.data.latest} (first run, existing release not announced)`);
      await upsertDownloads(res.data);                 // still publish the downloads message on first boot
    } else {
      // maybeAnnounce refreshes downloads only when it posts, so cover the other case here.
      const willPost = isNewer(res.data.latest, store.lastAnnouncedVersion);
      await maybeAnnounce('startup');
      if (!willPost) await upsertDownloads(res.data);   // keep the downloads message current
    }
  }
  setInterval(() => maybeAnnounce('poll'), config.pollIntervalMs).unref();
  logger.info(`announce poller every ${Math.round(config.pollIntervalMs / 1000)}s`);
}
