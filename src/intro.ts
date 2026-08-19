// ════════════════════════════════════════════════════════════════════════════
//  intro.ts: the standing introduction to SSIM.
//
//  Sent as an ordinary message rather than an embed. An embed constrains the
//  width and greys the text, which reads badly at this length; a plain message
//  gets the full column and normal contrast.
//
//  /intro edits the message it posted rather than posting a second one, so the
//  text can be corrected without the channel filling up with revisions.
// ════════════════════════════════════════════════════════════════════════════
import { Client, TextChannel } from 'discord.js';
import { store } from './store';
import { logger } from './logger';

/** Discord rejects anything over 2000 characters, so this is checked before sending. */
export const INTRO = `**SSIM**

SSIM is a Windows application for anyone running more Steam accounts than they can sensibly sign into one at a time. Inventories, trade locks, trading and the Steam Market, for every account you own, in a single window on your own machine.

It is not a proof of concept. It runs a live fleet of roughly 544 accounts, and nearly everything in it exists because that fleet needed it.

**What you can do with it**

See every account's CS2 inventory at once, with the trade-lock state of each item. Send trades in bulk, with balances and locks checked before anything leaves. Place buy orders, sell at the lowest price or a fixed net payout, and cancel across the whole fleet in one go, priced in each account's own wallet currency. Keep credentials in an encrypted vault and give each account its own proxy.

**Getting it**

The current build is in the downloads channel. Every release comes from the GitHub repository and nowhere else, and each one ships a SHA256SUMS file. Check yours against it before you run it. SSIM holds Steam passwords and 2FA secrets, so a copy that reached you any other way is not worth the risk, whoever sent it.

<https://github.com/Santerxyz/SSIM>

**What it costs**

Nothing. Apache-2.0, no keys, no tiers, nothing held back for a paid version. The source is public, so you can read what it does with your credentials before deciding to trust it with them.

**Before you start**

Everything runs locally. Passwords and 2FA secrets are encrypted on your disk and go nowhere except Steam itself, at login. No server of ours ever sees them.

And running a fleet through any tool carries real risk. Steam can restrict or ban accounts, and nothing here changes that. Start with a couple of accounts, get a feel for how it behaves, and scale up once you are comfortable.

**If something breaks**

Open a ticket. Say which version you are on and what you were doing when it stopped working. Bug reports get read and they are useful.`;

export const INTRO_LIMIT = 2000;

/**
 * Put the introduction in `channel`. Edits the tracked message when it is still
 * there and in the same channel, otherwise posts a fresh one and tracks that.
 */
export async function postIntro(client: Client, channel: TextChannel): Promise<{ action: 'posted' | 'edited'; messageId: string }> {
  if (INTRO.length > INTRO_LIMIT) {
    throw new Error(`the introduction is ${INTRO.length} characters, over Discord's ${INTRO_LIMIT} limit`);
  }
  const payload = { content: INTRO, allowedMentions: { parse: [] as never[] } };

  const tracked = store.intro;
  if (tracked && tracked.channelId === channel.id) {
    const edited = await channel.messages.edit(tracked.messageId, payload).then(() => true).catch(() => false);
    if (edited) return { action: 'edited', messageId: tracked.messageId };
    logger.warn('the tracked introduction could not be edited, posting a new one');
  }

  const msg = await channel.send(payload);
  store.setIntro({ channelId: channel.id, messageId: msg.id });
  return { action: 'posted', messageId: msg.id };
}
