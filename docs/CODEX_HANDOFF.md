# Codex Handoff — Silver Glider Activations

If you're picking this up cold, read the files below **in this order** before touching anything. Each one answers a specific question you'll otherwise have to rediscover the hard way.

## Read in this order

1. **`CLAUDE.md`** (repo root) — stack, conventions, deploy method, known tech debt. Non-negotiable rules: don't `git push` without asking, deploy is `railway up` not GitHub push, admin panel is `uht-admin.html` not `admin.html` (that's a different app — see note below).
2. **`HANDOFF.md`** (repo root) — the engineer-facing status doc. Env var checklist, voting rules as built, load test results, email trigger table, test checklist before going live.
3. **`docs/WHY_NOT_NETLIFY.md`** — read this before suggesting any frontend/backend split. This app is server-rendered (Express builds and returns full HTML per request, see `src/routes/activations.js`), not a decoupled frontend+API. There is no separate frontend build to deploy to Netlify/Vercel/etc. without a real rearchitecture.
4. **`docs/MARKETING_SERVICE_PLAN.md`** — planning doc for a future third microservice. Not built yet. Don't start it unless explicitly asked — Thrift Fest has a hard date and takes priority.
5. **Source files, in this order:**
   - `src/routes/activations.js` — all routes, all page-rendering functions (`render*Page`), rate limiters, the vote/optin endpoints
   - `src/db/activationsDB.js` — every DB query, the `runMigrations()` block (runs on startup, safe to re-run)
   - `src/lib/mailer.js` — all outbound email templates and triggers
   - `src/config/db.js` — pg Pool config (note: SSL is gated on `NODE_ENV === 'production'`)
   - `src/index.js` — mount points, `/health`, `/unsubscribe`

## Important context this repo's history won't tell you

- **There is a separate note-important repo split in progress.** `Silver-Glider-Tickets` (this repo, `code666now/Silver-Glider-Tickets`) is the original monorepo with the main ticketing app AND the activations feature (on branch `feature/silver-glider-activations`). A **second, dedicated repo** `code666now/Silver-Glider-Activations` was created from that branch and is now the actual production source for the Activations Railway service. **When making changes, confirm which repo you're actually editing and which one Railway is deploying from** — this exact confusion caused a same-day outage (see incident note below).
- **This app is one server, not a frontend+API split.** See `docs/WHY_NOT_NETLIFY.md`. Don't suggest Netlify, Vercel static hosting, or similar for this service.
- **Duplicate route handlers exist in the main `server.js`** of the sibling UHT project pattern — check `CLAUDE.md`-equivalent docs per-repo before assuming a route handler is the only one.
- **Migrations run automatically on boot** via `runMigrations()` in `activationsDB.js` — they use `ADD COLUMN IF NOT EXISTS` and similar idempotent patterns. Don't write a separate manual migration step; add to that function.
- **Vote dedup is enforced at the database level** — a UNIQUE index on `(participant_id, browser_fingerprint)`, with `INSERT ... ON CONFLICT DO NOTHING` in `castVote()`. Don't reintroduce a SELECT-then-INSERT pattern; it's a race condition (this was an actual bug fixed today).
- **Winner ranking must exclude `no_thanks` votes.** `getWinner()` and the landing page vote map both filter to `vote IN ('rules','hell_yeah')`. If you touch either query, keep that filter.
- **The 5-vote ballot cap is enforced server-side** in the `/vote` route via `countPositiveVotes()`, not client-side. Don't move this logic to the browser.

## Incident note (2026-07-08) — for context on why some of the above rules exist

The Railway service's GitHub source drifted to `main` on the **old** `Silver-Glider-Tickets` repo (instead of the dedicated Activations repo), which silently deployed unrelated ticketing code over the working Activations app — a same-day outage during final pre-event testing. Root cause was fixed by repointing the service's source via the Railway API (`serviceConnect` mutation) to `code666now/Silver-Glider-Activations` on `main`. Two more bugs were found and fixed at the same time: the Resend API key env var was named `RESEND_KEY` instead of `RESEND_API_KEY` (silently disabled all outbound email), and `NODE_ENV` was set to `development` instead of `production` (disables Postgres SSL in `src/config/db.js`).

**Lesson for future work on this repo: always verify which repo + branch a Railway service is actually building from before debugging application code.** A 404 or missing feature can mean the deployed source is stale or wrong, not that the code is broken.

## How to verify the live service quickly

```bash
curl -s https://silver-glider-tickets-production-e4a0.up.railway.app/health
curl -s https://silver-glider-tickets-production-e4a0.up.railway.app/activations/best-booth-award/votes-left?fp=test123
```

`/health` should return `{"status":"ok","sha":"..."}`. If it 404s or returns HTML instead of JSON, the deployed source is wrong before anything else — check Railway's Settings → Source for the connected repo/branch first.

## Where things stand as of this handoff

See `HANDOFF.md` for the live checklist. Short version: application code and Railway service are correct and load-tested; the custom domain (`activations.silverglidertickets.com`) cutover from a stray Netlify project to Railway is in progress, and one DNS record (Resend DKIM on the `activations` subdomain) needs verification.
