# Security Policy

This bot holds two secrets: a **Discord bot token**, which is full control of the
application in your server, and the **`ANNOUNCE_HMAC_SECRET`**, which is the only
thing standing between the internet and your announcements channel. Both live in
`.env`, which is gitignored and must never be committed.

## Reporting a vulnerability

**Please do not open a public issue for a security problem.**

Use **GitHub Private Vulnerability Reporting** on this repository: the *Security*
tab, then *Report a vulnerability*. If you would rather make contact first, DM
the maintainer (`Santer.xyz`) on [Discord](https://discord.gg/rnDWYtkbxN) and say
only that you have a security report, with no details in the first message.

Useful to include: what the issue is, how to reproduce it, what an attacker gets
out of it, and the commit you found it on.

Expect acknowledgement within 7 days and an assessment within 30. There is no bug
bounty. Credit in the release notes is offered by default, so tell us if you would
rather stay anonymous.

## A leaked Discord token cannot be patched

If your bot token is exposed, in a commit, a screenshot, a log paste, or a
pastebin, the token itself is the vulnerability and there is no fix to ship.
Regenerate it:

1. Open the [Discord Developer Portal](https://discord.com/developers/applications),
   select the application, go to **Bot**, then **Reset Token**.
2. Put the new token in `.env` and restart the bot.
3. Audit the server's audit log for anything the old token did.

The same applies to `ANNOUNCE_HMAC_SECRET`: generate a new one, update `.env` and
any publisher configured to sign pushes, then restart. Discord scans public
repositories and will usually invalidate a committed token on its own, but do not
rely on that.

## Deployment notes that are your responsibility

- **`HTTP_HOST`.** The bot's HTTP server exposes `POST /internal/announce`. Bind
  it to `127.0.0.1` unless something outside the machine genuinely needs to reach
  it, and put a reverse proxy with TLS in front if it does. Binding `0.0.0.0`
  puts the endpoint on every interface.
- **`ANNOUNCE_HMAC_SECRET`.** If it is unset, the announce endpoint returns 503
  and refuses every push. That is deliberate. Do not work around it by removing
  the check.
- **`data/state.json`** holds ticket metadata and Discord user IDs. It is
  gitignored. Treat backups of it as personal data.
- **Transcripts** are generated from real conversations and are sent to the log
  channel and to the ticket opener. Keep the log channel staff-only.

## Scope

**In scope:** authentication bypass on `/internal/announce`, the staff-role gate
on commands and buttons, privilege escalation through ticket channel permissions,
secret leakage into logs or transcripts, and injection through release notes or
user-supplied ticket content.

**Out of scope:** anything requiring an attacker to already hold the bot token or
shell access on the host, Discord platform issues that should go to Discord, and
scanner output with no working proof of concept.
