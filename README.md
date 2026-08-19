# SSIM Discord Bot

**The Discord bot that runs the [SSIM](https://github.com/Santerxyz/SSIM) community server.**

It announces every new release, keeps a downloads channel pointed at the current
build, and gives members a private ticket to talk to staff in.

[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%E2%89%A5%2020-green.svg)](#requirements)
[![Discord](https://img.shields.io/badge/Discord-join-5865F2.svg?logo=discord&logoColor=white)](https://discord.gg/rnDWYtkbxN)

## What it does

**Release announcements.** The bot watches the GitHub Releases API for the SSIM
repository and posts each new release to your announcements channel, formatted as
a version header, the release notes in a `diff` block, and a pointer to the
downloads channel. Announcements are idempotent and forward-only: a given version
is posted exactly once, and an older version can never overwrite a newer one. A
freshly deployed bot records the current release as its baseline instead of
announcing something everybody has already installed.

**Corrections follow the release.** Fix a typo in the release notes on GitHub and
the message already posted is edited to match, in place, rather than a correction
being posted underneath it. GitHub stays the single source of truth, so the two
cannot drift apart. See [keeping an announcement current](#keeping-an-announcement-current).

**A downloads channel that stays current.** One message, edited in place on every
release, linking the current executable and the release page it came from so the
checksums are one click away. Everything on it is read from the GitHub release, so
there is no separately hosted link to keep alive. Members always have one place to
look, and old posts never linger with stale links.

**Members are handled on arrival.** Everyone who joins is given a role
automatically, and the join is written to a log channel with the invite they came
in on and who created it. Leaves are logged too, with the roles the member held,
which is otherwise gone the moment they are.

**An introduction that stays editable.** `/intro` posts a standing description of
the project as an ordinary message rather than an embed, since an embed narrows the
column and greys the text at that length. Running it again edits what is already
there instead of posting a second copy.

**Support tickets.** A panel with one button. A member clicks it and gets a private
channel with staff, no menus and no confirmation step in between. Tickets can be
claimed, users can be added or removed, and closing one produces an HTML transcript
that goes to the staff log channel and to the person who opened it. Optional
inactivity auto-close posts a warning first and gives a two hour grace period.

**Staff posts.** `/post` publishes a branded embed under a short name, and
running `/post` with the same name again reopens the editor prefilled and edits
the original message in place. Useful for rules, FAQs, and anything else that
needs to stay editable.

## Requirements

* Node.js 20 or newer
* A Discord server you administer
* A GitHub repository that publishes releases, public, so the bot can read it
  anonymously

## Setup

### 1. Create the Discord application

1. Go to the [Discord Developer Portal](https://discord.com/developers/applications)
   and select **New Application**.
2. On the **Bot** tab, select **Reset Token** and copy the value. This is
   `DISCORD_TOKEN`. Treat it as a password: anyone holding it controls the bot.
3. Still on the **Bot** tab, under **Privileged Gateway Intents**, enable
   **Server Members Intent** and **Message Content Intent**, then save. The first
   carries joins and leaves and lets the bot resolve members, the second is what
   makes transcripts possible. Both are off by default and neither can be replaced
   by a permission.
4. On **General Information**, copy the **Application ID**. This is
   `DISCORD_CLIENT_ID`.

### 2. Invite it to your server

Under **OAuth2**, then **URL Generator**, select the scopes `bot` and
`applications.commands`, then these permissions:

View Channels, Send Messages, Embed Links, Attach Files, Read Message History,
Manage Channels, Manage Messages, Manage Roles, Manage Server.

Open the generated URL and pick your server. Three of those are less obvious than
the rest:

* **Manage Channels** creates and deletes ticket channels.
* **Manage Roles** writes the channel permission overwrites that make a ticket
  private, and grants `MEMBER_ROLE_ID` on join.
* **Manage Server** reads the invite list. Discord never says which invite somebody
  used, so the only way to attribute a join is to watch the use counts, and reading
  them needs this. Without it everything else still works and joins are logged with
  the invite left as undetermined.

If you would rather build the URL by hand, that permission set is the integer
`268561456`:

```
https://discord.com/oauth2/authorize?client_id=YOUR_CLIENT_ID&scope=bot+applications.commands&permissions=268561456
```

### 3. Create the channels and the staff role

Turn on Developer Mode in Discord (**User Settings**, **Advanced**) so you can
right-click anything and copy its ID. You need:

| Thing | Env var | Required |
|---|---|---|
| Channel holding the ticket panel | `ONBOARDING_CHANNEL_ID` | yes |
| **Category** that ticket channels are created under | `TICKET_CATEGORY_ID` | yes |
| Role whose members are staff | `STAFF_ROLE_ID` | yes |
| Channel for release announcements | `ANNOUNCE_CHANNEL_ID` | no |
| Channel for the downloads message | `DOWNLOADS_CHANNEL_ID` | no |
| Staff-only channel for the audit trail | `AUDIT_CHANNEL_ID` | no |
| Staff-only channel that receives transcripts | `TICKET_LOG_CHANNEL_ID` | no |
| Staff-only channel for joins and leaves | `MEMBER_LOG_CHANNEL_ID` | no |
| Role granted to everyone who joins | `MEMBER_ROLE_ID` | no |

`TICKET_CATEGORY_ID` must be a category, not a text channel. The bot creates each
ticket as a child of it.

If you set `MEMBER_ROLE_ID`, open **Server Settings**, **Roles**, and drag the
bot's own role **above** the member role. Discord refuses to grant a role that sits
at or above the granting bot's highest role, and it fails silently from the joiner's
point of view: they get in with no role and only the bot's log records why.

### 4. Create the announce webhook, optional

In the announcements channel, open **Edit Channel**, then **Integrations**, then
**Webhooks**, and create one. Copy its URL into `ANNOUNCE_WEBHOOK_URL`. Posting
through a webhook lets announcements carry your project's name and avatar rather
than the bot's.

Without it the bot posts as itself in `ANNOUNCE_CHANNEL_ID`. Set one or the
other, or announcements have nowhere to go.

### 5. Configure

```bash
cp .env.example .env
```

Fill it in. [`.env.example`](.env.example) documents every variable and is the
source of truth; the tables below are the summary.

**Required**

| Variable | Meaning |
|---|---|
| `DISCORD_TOKEN` | Bot token from the developer portal |
| `DISCORD_CLIENT_ID` | Application ID |
| `GUILD_ID` | Your server's ID. Commands register per guild, so they appear instantly |
| `ONBOARDING_CHANNEL_ID` | Where `/panel` posts the ticket panel |
| `TICKET_CATEGORY_ID` | Category that ticket channels are created under |
| `STAFF_ROLE_ID` | Role that gates every staff command and the claim button |

**Optional**

| Variable | Default | Meaning |
|---|---|---|
| `ANNOUNCE_CHANNEL_ID` | none | Fallback target for announcements when no webhook is set |
| `DOWNLOADS_CHANNEL_ID` | none | Home of the edited-in-place downloads message |
| `AUDIT_CHANNEL_ID` | none | Ticket opens, claims, and closes are mirrored here |
| `TICKET_LOG_CHANNEL_ID` | none | Receives transcripts on close |
| `MEMBER_LOG_CHANNEL_ID` | none | Receives a line for every join and leave |
| `MEMBER_ROLE_ID` | none | Granted to every person who joins. Bots are skipped |
| `ANNOUNCE_WEBHOOK_URL` | none | Preferred way to post announcements |
| `GITHUB_REPO` | `Santerxyz/SSIM` | The `owner/repo` the release watcher reads |
| `ANNOUNCE_HMAC_SECRET` | none | Shared secret for push-triggered announcements. Unset disables the endpoint |
| `HTTP_PORT` | `8787` | Port for the health and announce endpoints |
| `HTTP_HOST` | `0.0.0.0` | Bind address. `.env.example` ships `127.0.0.1`; widen it only if something off-machine must reach the endpoint |
| `POLL_INTERVAL_MS` | `600000` | Release poll interval. Values below 60000 are clamped |
| `TICKET_AUTOCLOSE_HOURS` | `0` | Hours of silence before a ticket is warned and closed. `0` disables it |
| `DATA_DIR` | `./data` | Where `state.json` is written |

### 6. Install and run

```bash
npm install
```

```bash
npm run build
```

```bash
npm start
```

On a healthy first start the log reads `logged in as ...`, then
`announce baseline = v<current>`, then `http listening on ...`, then `bot ready`.
Run `/panel` in the onboarding channel to post the ticket panel. That is the only
manual step; the panel is persistent and survives restarts.

## Commands

Every command is restricted to `STAFF_ROLE_ID`, checked in the handler rather
than through Discord permissions, so a server admin without the role does not
pass.

| Command | Effect |
|---|---|
| `/panel` | Post the ticket panel in this channel |
| `/intro [channel]` | Post the introduction, or update the one already posted |
| `/post name:<key> [channel]` | Publish a branded embed, or edit the one already stored under that name |
| `/announce` | Edit the latest release announcement to match its current GitHub notes |
| `/announce repost:true` | Post a fresh announcement instead of editing the existing one |
| `/close [reason]` | Close the current ticket and issue the transcript |
| `/add user:<@user>` | Give someone access to the current ticket |
| `/remove user:<@user>` | Take it away |

Tickets can also be claimed and closed from the buttons in the ticket header. The
person who opened a ticket may close it themselves.

## How announcements work

```
  publisher  --HMAC-->  POST /internal/announce  --+
                                                   |
                                                   +-->  reconcile against the
                                                   |     GitHub Releases API
  every POLL_INTERVAL_MS: poll  -------------------+              |
                                                                  v
                                            newer than the last announced version?
                                                   yes: post it, and remember
                                                        the message
                                                   no:  do the notes still match
                                                        the message? if not,
                                                        edit it in place
```

Both paths call the same reconciler, which fetches the latest release itself and
posts only if the version is strictly newer than the one on record. The stored
version advances only after a post succeeds, so a Discord outage means a retry on
the next poll rather than a silently skipped release. Attempts are serialised, so
a push and a poll arriving together cannot double-post.

The push is a latency optimisation, nothing more. If you never wire it up, the
poll still posts every release within one interval.

`/releases/latest` on the GitHub API excludes drafts and prereleases, so neither
can trigger a public announcement.

### Keeping an announcement current

Release notes get corrected after publication. When that happens, the message on
the board should change, not gain a reply saying it was wrong.

The bot stores the message it posted along with the exact body it sent. Every
reconcile re-renders the release and compares. If the body still matches, nothing
happens and no API call is made. If it differs, because the notes were edited on
GitHub, the message is edited in place to match. Nothing is ever posted twice.

So the workflow is: edit the release on GitHub, then either wait for the next poll
or run `/announce` to apply it immediately. Both do the same thing.

```
/announce                  edit the posted message to match the current notes
/announce repost:true      post a new message instead, and track that one
```

`/announce` reports which happened, including when the announcement already matched
and nothing needed doing. Use `repost:true` when the original was deleted, or when
the message predates this feature and is therefore untracked.

Two cases stop the tracking rather than fighting it. If the message was deleted, or
the webhook it was posted through was removed, the next edit attempt gets `Unknown
Message` or `Unknown Webhook` from Discord. The bot logs that once, forgets the
message, and stops retrying every poll. `/announce repost:true` starts a new one.

Only the latest release is tracked. `/releases/latest` is the only thing the bot
reads, so editing the notes of an older release does not update its announcement.

### Triggering a push from your publisher

`POST /internal/announce` accepts any body and requires the header
`X-SSIM-Signature: sha256=<hex>`, where the hex is `HMAC-SHA256` over the exact
request body bytes, keyed with `ANNOUNCE_HMAC_SECRET`. The body's contents are
ignored, since the bot re-reads GitHub itself. A valid signature returns `202`,
an invalid one `401`, and an unset secret `503`.

Generate a secret with:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

`GET /health` returns `{"ok":true,"ready":<bool>}` and needs no signature.
`ready` turns true once the gateway connection is up.

## Members

Set `MEMBER_ROLE_ID` and everyone who joins is given that role. Bots are skipped,
since an application added through OAuth is not a member in the sense the role
means. The grant runs before anything is logged, because a member actually getting
in matters more than the audit line about it.

Set `MEMBER_LOG_CHANNEL_ID` and every join and leave is written there. A join
records the member, how old the account is, the server's new size, the invite used,
and who created that invite. A leave records how long they were here and the roles
they held, which is the part worth keeping: once someone is gone, that is the only
trace of what they had.

### How the invite is worked out

Discord does not tell you which invite a member used. There is no field for it. The
only way to know is to keep a count of every invite's uses and see which one moved.

So the bot reads the invite list on startup, and again on each join, and compares.
One count going up by one identifies the invite. When nothing has gone up, it looks
for an invite that has disappeared instead, because Discord deletes a single-use
invite the moment it is consumed, and a vanished code is the same evidence.

Four cases end with the invite recorded as undetermined, and all four are honest
answers rather than bugs:

* The bot is missing **Manage Server**, so it cannot read the list at all.
* The member came in on the server's vanity URL, which has no entry in the list.
* The bot was offline when they joined, so there is no baseline to compare.
* Two people joined close enough together that one join absorbed the other's delta.

The log says which of these it was where it can tell. Everything else about the
join is still recorded either way.

Joins that happened while the bot was down are not backfilled. Discord does not
report them after the fact, and the role is granted on the join event, so anyone who
arrived during an outage needs the role by hand.

## Deploying

The bot holds a persistent gateway connection, so it needs a host that keeps it
running rather than one that sleeps between requests.

### Windows, as a service

Build first, then install the compiled entry point as a service with
[NSSM](https://nssm.cc/):

```bash
nssm install SSIMDiscordBot "C:\Program Files\nodejs\node.exe" "C:\path\to\ssim-discord-bot\dist\index.js"
```

```bash
nssm set SSIMDiscordBot AppDirectory C:\path\to\ssim-discord-bot
```

```bash
nssm set SSIMDiscordBot AppStdout C:\path\to\ssim-discord-bot\logs\bot.log
```

```bash
nssm set SSIMDiscordBot AppStderr C:\path\to\ssim-discord-bot\logs\bot.err.log
```

```bash
nssm set SSIMDiscordBot AppRotateFiles 1
```

```bash
nssm set SSIMDiscordBot Start SERVICE_AUTO_START
```

```bash
nssm start SSIMDiscordBot
```

`AppDirectory` matters: `.env` and `data/` resolve relative to the working
directory, so pointing it at the repository root is what makes configuration and
state load. The service starts at boot without anyone logging in, and NSSM
restarts the process if it exits.

### Linux, as a systemd unit

```ini
[Unit]
Description=SSIM Discord Bot
After=network-online.target

[Service]
WorkingDirectory=/opt/ssim-discord-bot
ExecStart=/usr/bin/node dist/index.js
Restart=always
RestartSec=5
User=ssimbot

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable --now ssim-discord-bot
```

### Updating

```bash
git pull && npm install && npm run build
```

#### Pointing an existing deployment at this repository

A deployment that predates this repository has no git remote, so `git pull` has
nothing to pull from. Attach one once:

```bash
cd /opt/ssim-discord-bot
git remote add origin https://github.com/Santerxyz/ssim-discord-bot.git
git fetch origin
git reset --hard origin/main
```

`git reset --hard` discards local edits to tracked files. It does not touch
`.env` or `data/`, which are ignored, but check `git status` first if the
server was ever edited in place.

While the repository is private, git will ask for credentials. Use a personal
access token with read-only `Contents` scope rather than a password, or add a
read-only deploy key to the repository and clone over SSH.

An `.env` from an earlier version needs no changes. `LICENSE_API_URL`,
`BOT_API_TOKEN` and `BETA_TESTER_ROLE_ID` are no longer read and are ignored if
present, and `GITHUB_REPO` defaults to the right value when absent.

Then restart the service. Slash commands re-register automatically on every
start, so a changed command definition needs no extra step. `npm run register`
registers them and exits, which is occasionally useful on its own.

## Development

```bash
npm run dev
```

runs from source and reloads on change. The full set of scripts:

| Script | Purpose |
|---|---|
| `npm run build` | Compile TypeScript to `dist/` |
| `npm start` | Run the compiled bot |
| `npm run dev` | Run from source, reloading on change |
| `npm run register` | Register slash commands and exit |
| `npm test` | Run the unit tests |
| `npm run typecheck` | `tsc --noEmit` |

The tests cover the pure logic: announcement formatting, semver comparison, HMAC
verification, and note sanitisation. Two of them pin the properties the announcement
edit relies on, that an unchanged release renders byte-identically and an edited one
does not, since a body that varied on its own would make the bot edit the message on
every poll. Nothing in the suite touches Discord or the network, so `npm test` runs
offline and without a token.

### Project layout

```
src/util.ts          pure helpers: semver, HMAC verify, sanitise, dates
src/format.ts        the release post body, unit tested for exact output
src/config.ts        env loading and validation, ticket topic definitions
src/store.ts         JSON persistence with atomic writes
src/releaseApi.ts    GitHub Releases API client
src/announce.ts      the idempotent announce reconciler and downloads message
src/httpServer.ts    POST /internal/announce and GET /health
src/tickets.ts       panel, lifecycle, transcripts, auto-close
src/members.ts       join and leave handling, the member role, invite attribution
src/intro.ts         the standing introduction text and its /intro editor
src/post.ts          the /post editor
src/commands.ts      slash command definitions, registration, staff handlers
src/interactions.ts  the interaction router
src/perms.ts         the staff role gate
src/audit.ts         audit channel logging
src/logger.ts        structured console logging
src/index.ts         entry point
```

Ticket topics are data, not code. Add or remove entries in `TICKET_CATEGORIES` in
[`src/config.ts`](src/config.ts) and the panel and the channel naming both follow.
The panel adapts to how many there are: a single topic renders as one **Open a
ticket** button, and two or more render as a select menu listing them. Either way
the next click opens the ticket.

Keep the `id` of an existing topic stable, because it is embedded in the
interaction custom IDs of panels already posted. Changing a `label` or a
`description` is safe; changing an `id` orphans every panel already in the channel.

## Security

Release notes arrive from outside and are treated as untrusted: code fence breaks
are neutralised, mass mentions are defanged, and every message is sent with
mentions disabled, so nothing in a release body can ping your server.

The announce endpoint verifies its HMAC in constant time and refuses every
request when no secret is configured. Ticket channels are private by permission
overwrite rather than by obscurity, and transcripts are HTML-escaped so nothing
pasted into a ticket can alter the document.

Transcripts otherwise reproduce what was said verbatim. Anything a member pastes
into a ticket, including a credential they should not have shared, ends up in the
transcript sent to the log channel and to their DMs. Treat that channel as
sensitive.

`.env` is gitignored and must stay that way. To report a vulnerability, see
[SECURITY.md](SECURITY.md).

## License

Apache License 2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE).

The SSIM name and branding are not covered by that license. See the main
[SSIM repository](https://github.com/Santerxyz/SSIM) for the trademark terms.
