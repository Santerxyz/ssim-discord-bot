# SSIM Discord Bot (Santer)

A persistent Discord bot for SSIM that takes recurring manual work off the owner's hands:

1. **Automated release announcements** — every `npm run publish-update` posts a changelog to Discord in the owner's exact hand-posted style (bold header → `diff` fence → `⬇️ Manual update` link), via a webhook named **Santer**.
2. **Support tickets + automatic license retrieval** — a branded ticket panel (License / Support / Bug / Billing). The **License** category auto-returns the key bound to the requester's Discord account and grants the existing **Beta Tester** role. Also supports self-service (“I already have a key”).
3. **Staff tooling** — `/assign`, `/unassign`, `/whois`, `/close`, `/add`, `/remove`, `/announce`, `/panel`.

Brand: **Santer** · accent `#9333ea`.

> **Full setup & the acceptance test live in [SETUP.md](./SETUP.md).** Read that before deploying.

---

## Architecture

```
 build/publish.js ──HMAC──▶ POST /internal/announce ─┐
 (CS2_Manager)                                        ├─▶ maybeAnnounce() ──▶ re-fetch GET /version ──▶ "Santer" webhook
                       every 10 min: poll /version ───┘        (idempotent, forward-only)

 Discord user ──▶ ticket panel ──▶ private ticket channel ──▶ License category ──▶ ssim-license-server
                                                                 · GET  /admin/api/bot/by-discord/:id   (reveal)
                                                                 · POST /admin/api/bot/claim            (self-service)
                                                                 · POST /admin/api/bot/assign|unassign  (staff)
                                                              (Bearer BOT_API_TOKEN — never the admin password)
```

The push is only a **low-latency trigger**: the bot always re-fetches the canonical `/version` and posts from that, so the push path and the poll path produce byte-identical output and the manual-update link is always exactly what the server serves. A promise-chain mutex + a persisted `lastAnnouncedVersion` guarantee **exactly-once, forward-only** announcements.

## Security

- **License keys are secrets.** The full key is delivered **only** by DM or an **ephemeral** reply, and the lookup is always scoped to `interaction.user.id` (the invoker) — a rename or a staff member in the channel can never surface someone else's key. Channels, transcripts, and audit logs store only a redacted reference (`SSIM-••••-••••-••••-1234`).
- **Least privilege.** The bot authenticates to the license server with a scoped `BOT_API_TOKEN`, never the admin password or DB access.
- **Untrusted display text.** Release notes are sanitized (fence-break + `@everyone`/`@here` neutralised) and sent with `allowedMentions: { parse: [] }`.
- **Signed push.** `/internal/announce` requires a valid `X-SSIM-Signature` HMAC over the exact body.

## Scripts

| Command | What |
|---|---|
| `npm install` | install deps |
| `npm run build` | compile TypeScript → `dist/` |
| `npm start` | run the bot (`dist/index.js`) |
| `npm run dev` | run from source with `tsx watch` |
| `npm run register` | (re)register slash commands and exit |
| `npm test` | run the pure-logic tests (format fidelity, HMAC, semver, redact) |
| `npm run typecheck` | `tsc --noEmit` |

## Layout

```
src/util.ts        pure helpers (semver, redact, HMAC verify, sanitize, date) — no discord.js
src/format.ts      the EXACT release-post formatter (pixel-fidelity, unit-tested)
src/config.ts      env + ticket-category config (fails fast on missing vars)
src/store.ts       JSON atomic persistence (lastAnnouncedVersion, tickets, counter)
src/licenseApi.ts  client for the license-server bot API + /version
src/announce.ts    push + poll + idempotent post via the "Santer" webhook
src/httpServer.ts  POST /internal/announce (HMAC) + GET /health
src/tickets.ts     panel, lifecycle, transcript, bug modal, auto-close
src/licenseFlow.ts License category: reveal / self-service claim / grant Beta Tester
src/commands.ts    slash commands + registration + staff handlers
src/interactions.ts the InteractionCreate router
src/perms.ts       staff-role gate
src/audit.ts       audit-channel logging (redacted)
src/index.ts       entry point
```
