# SSIM Discord Bot — Setup & Acceptance Runbook

This is the end-to-end setup for the three moving parts (bot ⇄ license server ⇄ publisher) and the
**acceptance test** that defines "done". Work top to bottom; each step says which repo it touches.

- **bot** = this repo (`ssim-discord-bot`)
- **server** = `ssim-license-server` (sibling)
- **publisher** = `CS2_Manager/build/publish.js`

---

## 0. Prerequisites

- Node ≥ 20 (this repo built on Node 24).
- Admin on the SSIM Discord server, with the existing **Beta Tester** role and a **staff** role.
- The license server reachable at `LICENSE_API_URL` (canonical `https://license.ssim.dev`).

---

## 1. Create the Discord application + bot  (Discord dev portal)

1. https://discord.com/developers/applications → **New Application** → name it *SSIM* / *Santer*.
2. **Bot** tab → **Reset Token** → copy it → `DISCORD_TOKEN`.
3. **General Information** → copy **Application ID** → `DISCORD_CLIENT_ID`.
4. **Bot** tab → **Privileged Gateway Intents** → enable **SERVER MEMBERS INTENT** and **MESSAGE CONTENT INTENT** (both are required — members for role grants, message content for transcripts). Save.

## 2. Invite the bot

In the dev portal → **OAuth2 → URL Generator**: tick scopes **`bot`** + **`applications.commands`**, then tick
these bot permissions:

- View Channels · Send Messages · Embed Links · Attach Files · Read Message History
- **Manage Channels** (create/delete ticket channels) · **Manage Roles** (grant Beta Tester) · **Manage Messages**

Copy the generated URL and open it to invite the bot. (That set = permissions integer **`268561424`**, if you
prefer to hand-build the URL: `…&scope=bot+applications.commands&permissions=268561424`. Granting the bot an
admin role also works for a private server.)

## 3. Role hierarchy (critical for the Beta Tester grant)

- In **Server Settings → Roles**, drag the **bot's own role ABOVE the Beta Tester role**. A bot can only grant
  roles that sit **below** its highest role. If it's below, `/`-reveal will report "could not grant the role".
- Copy the **Beta Tester** role ID → `BETA_TESTER_ROLE_ID`.
- Copy your **staff** role ID → `STAFF_ROLE_ID`.

## 4. Channels + the Tickets category

Create (or pick) and copy IDs (right-click → *Copy ID*, Developer Mode on):

| Env var | What |
|---|---|
| `ANNOUNCE_CHANNEL_ID` | where releases are posted |
| `ONBOARDING_CHANNEL_ID` | the restricted area that holds the ticket panel (visible to members WITHOUT Beta Tester) |
| `TICKET_CATEGORY_ID` | a **category** channel that new ticket channels are created under |
| `AUDIT_CHANNEL_ID` | staff-only audit log (reveals/claims/assigns/opens/closes) |
| `TICKET_LOG_CHANNEL_ID` | staff-only channel that receives ticket transcripts on close |

> Gate the server so members **without Beta Tester** can only see `ONBOARDING_CHANNEL_ID` (deny View on your
> normal channels for `@everyone`, allow for Beta Tester). The panel there is their only entry point.

## 5. Announce webhook ("Santer")

- In the **announce channel** → Edit Channel → **Integrations → Webhooks → New Webhook**.
- Name it **`Santer`**, set the Santer avatar (so posts render pixel-identically). Copy URL → `ANNOUNCE_WEBHOOK_URL`.
- (If you omit the webhook, the bot posts as itself in `ANNOUNCE_CHANNEL_ID` — but the webhook is the pixel-identical path.)

## 6. License server — enable the bot API  (server)

1. Generate a bot token: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
2. In the server's `.env` set `BOT_API_TOKEN=<that value>` and restart the server.
3. Deploy the server changes on `feature/discord-bot` (`bot-api.js`, `changelog.js`, `licenses.js` Discord
   fields, `requireBotToken`). Verify: `curl -H "Authorization: Bearer <token>" https://license.ssim.dev/admin/api/bot/audit`
   should return `[]` (not 503/401).

## 7. Bot `.env`

`cp .env.example .env` and fill everything from steps 1–6. Two secrets to generate/share:

- `BOT_API_TOKEN` — the SAME value you set on the server in step 6.
- `ANNOUNCE_HMAC_SECRET` — generate one; it must MATCH the publisher (step 9). Generate:
  `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`

## 8. Install, build, register, run  (bot)

```bash
npm install
npm run build
npm run register     # registers the 8 slash commands to your guild (instant)
npm start            # or: npm run dev
```

On first start you'll see `logged in as …`, `announce baseline = v<current>` (it will NOT announce the
existing release — only future ones), and `http listening on 0.0.0.0:8787`. Then run **`/panel`** in the
onboarding channel to post the ticket panel.

## 9. Wire the publisher → bot  (publisher)

1. Expose the bot's `POST /internal/announce` to the publisher machine (reverse-proxy `https://your-host/internal/announce`, or open `HTTP_PORT`).
2. In `CS2_Manager/secrets.local.bat`, **uncomment + fill** the two lines added at the bottom:
   ```bat
   set "BOT_ANNOUNCE_URL=https://your-bot-host/internal/announce"
   set "ANNOUNCE_HMAC_SECRET=<same value as the bot's .env>"
   ```
3. Write this release's notes into `CS2_Manager/RELEASE_NOTES.md` (the `+`/`-` lines that go inside the diff
   block). Publishing **requires** it unless you pass `--no-notes`.

---

## Deploy order (do NOT skip)

1. **Server** first: set `BOT_API_TOKEN`, deploy `feature/discord-bot`, restart. (Additive — deployed apps + the updater are unaffected.)
2. **Bot**: `.env` → build → `register` → `start` → `/panel`.
3. **Publisher**: fill `BOT_ANNOUNCE_URL` + `ANNOUNCE_HMAC_SECRET`. Until then, the bot's 10-min poll still posts every release.

---

## Acceptance test (definition of done — §8)

Run these once everything is deployed. ✅ each:

- [ ] **Announce (push).** Write `RELEASE_NOTES.md`, bump `CS2_Manager/package.json`, `npm run publish-update`.
      → Exactly **one** "Santer" post appears within seconds, visually identical to the hand-posts, ending with a
      working `⬇️ Manual update:` link to the new build. The 10-min poll produces **no duplicate**.
- [ ] **Announce (poll fallback).** Temporarily point `BOT_ANNOUNCE_URL` at a dead URL and publish a bump →
      publish logs a loud non-fatal announce warning, and within one poll interval the bot posts exactly once.
- [ ] **Assign.** `/assign @NewCustomer SSIM-…` → the dashboard row + `db.json` show the Discord ID + username.
- [ ] **Pre-assigned retrieval.** As `@NewCustomer` (no Beta Tester yet): open panel → **License / Get Access** →
      a private ticket opens → the **exact key** arrives by DM (or ephemeral) → **Beta Tester** granted → the
      server unlocks. No owner action in the moment; the full key appears in **no** public message/log.
- [ ] **Self-service claim.** As another user: **License** → **I already have a key** → paste a valid unclaimed
      key → it binds to their ID → **Beta Tester** granted.
- [ ] **Bug report.** Open **Bug Report** → fill the modal → a structured report lands in a private ticket for
      staff. `/close` it → a transcript appears in `TICKET_LOG_CHANNEL_ID` **and** in the opener's DMs.
- [ ] **No-match path.** An unbound user with no key gets the graceful "no license on file" message, staff are
      pinged, and **nothing leaks** (no indication whether any key exists).
- [ ] **Redaction.** Confirm the audit channel, ticket channel, and transcript only ever show
      `SSIM-••••-••••-••••-1234`, never a full key.

---

## Troubleshooting

- **"could not grant the role"** → the bot's role is below Beta Tester (step 3), or it lacks Manage Roles.
- **Slash commands missing** → run `npm run register`; confirm `GUILD_ID`/`DISCORD_CLIENT_ID`.
- **Transcripts empty** → enable the **Message Content** intent (step 1.4).
- **`/internal/announce` 401** → `ANNOUNCE_HMAC_SECRET` differs between the bot and `secrets.local.bat`.
- **Bot API 503** → `BOT_API_TOKEN` not set on the server. **401** → the bot's token ≠ the server's.
- **Announce posted an OLD release on first boot** → shouldn't happen (first run baselines). To force a
  (re)post, run `/announce`. To reset idempotency, delete `data/state.json`.
- **Duplicate announce** → both push and poll are guarded by `lastAnnouncedVersion`; if you see dupes, check
  you aren't running two bot instances against the same guild with separate `data/` dirs.
