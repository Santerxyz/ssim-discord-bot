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

SSIM is a Windows app for running many Steam accounts from one window. It handles inventories, trade locks, trading and the Steam Market for every account you own, all on your own machine.

I built SSIM for myself. For personal reasons I no longer use it that way, so it is now here for the community. I maintain it in my free time.

That is why it is free. Donations help with the running costs, but nobody has to give anything. Every feature is free either way.

The source code is public under Apache-2.0. There are no keys and no paid version. Your passwords and 2FA secrets stay encrypted on your own disk. They are only sent to Steam when you log in.

The current build is in the downloads channel. Before you run it, check your file against the SHA256SUMS file on the release page. SSIM handles your Steam login, so never use a copy from anywhere else.

<https://github.com/Santerxyz/SSIM>

If something breaks or you have a question, open a ticket. Enjoy SSIM.`;

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
