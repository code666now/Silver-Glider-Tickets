# Silver Glider Activations — Engineer Handoff

## What this is
A festival booth voting platform. Vendors register their booth, get a QR code, and festival attendees scan and vote for their favorite. Built for Thrift Fest 2026 — expected 4,000 scanners, ~20,000 interactions.

Separate from the main Silver Glider ticketing app. Shares the same PostgreSQL database but runs as its own Railway service.

---

## Railway
- **Project:** honest-beauty
- **Service:** Silver-Glider-Activations
- **Current source:** `feature/silver-glider-activations` branch on `silver-glider-tickets` repo
- **Task:** Move to its own dedicated repo, re-point Railway service at new repo

**Admin panel:** `https://[RAILWAY_URL]/admin/activations`
**Health check:** `https://[RAILWAY_URL]/health` — should return `{ status: "ok", sha: "..." }`

---

## Env Vars Checklist

All vars are already set in Railway → `honest-beauty` project → `Silver-Glider-Activations` service → Variables tab. Copy them directly from there to the new service.

| Var | Status | Notes |
|-----|--------|-------|
| `DATABASE_URL` | ✅ In Railway | Shared Postgres — tables are prefixed `sg_` |
| `ACTIVATIONS_ADMIN_PASS` | ✅ In Railway | `activate666` — login to admin panel |
| `ACTIVATIONS_ADMIN_SECRET` | ✅ In Railway | Fixed — was previously missing the leading A |
| `CLOUDINARY_CLOUD_NAME` | ✅ In Railway | Booth photo uploads |
| `CLOUDINARY_API_KEY` | ✅ In Railway | |
| `CLOUDINARY_API_SECRET` | ✅ In Railway | |
| `APP_URL` | ✅ In Railway | |
| `JWT_SECRET` | ✅ In Railway | |
| `NODE_ENV` | ✅ In Railway | |
| `RESEND_API_KEY` | ❌ Missing — add it | Same key as main Silver Glider app |
| `RESEND_FROM` | ❌ Missing — add it | Set to `activations@silverglidertix.com` |
| `RAILWAY_BASE_URL` | ❌ Missing — add it | `https://[new-service].up.railway.app` — used for QR code URLs |
| `RAILWAY_PUBLIC_DOMAIN` | ❌ Missing — add it | `[new-service].up.railway.app` (no https://) |

---

## What Gabriel Needs To Do

- [ ] 1. Create new GitHub repo from `feature/silver-glider-activations` branch
- [ ] 2. In Railway → `Silver-Glider-Activations` → Settings → Source → point at new repo
- [ ] 3. Copy all env vars from current service Variables tab into new service (see table above)
- [ ] 4. Send Adrian the Railway service URL
- [ ] 5. Adrian adds CNAME in Namecheap: `activations` → `[railway-url].up.railway.app`
- [ ] 6. In Railway → Settings → Networking → Add Custom Domain → `activations.silverglidertickets.com`
- [ ] 7. Update `RAILWAY_BASE_URL` → `https://activations.silverglidertickets.com`
- [ ] 8. Update `RAILWAY_PUBLIC_DOMAIN` → `activations.silverglidertickets.com`
- [ ] 9. Hit `/health` — confirm `{ status: "ok" }`
- [ ] 10. Set instance RAM to at least 1GB in Railway settings before event day
- [ ] 11. Run full test checklist below

---

## Test Checklist Before Going Live

Run through this end to end after deploy:

- [ ] Register a test booth at `/activations/[slug]/join`
- [ ] Confirm booth appears on `/activations/[slug]` landing page immediately
- [ ] Vote on the booth — confirm vote counted, Next booth button works
- [ ] Check admin panel — booth appears in Approved tab
- [ ] Check Email Opt-ins tab works — submit a test email on the voting page
- [ ] Click QR Profile — confirm QR code loads and scans correctly
- [ ] Check confirmation email arrives at the contact email used during registration

---

## Voting Rules (as built)

- Each attendee gets **5 positive votes** per activation ("This Booth Rules" / "Hell Yeah"), enforced server-side per browser fingerprint
- "Not My Vibe" votes are recorded for analytics but don't burn a ballot and don't count toward winning
- **Winner is ranked on positive votes only**
- Vote dedup is a DB-level UNIQUE constraint — one vote per booth per device, race-proof
- Votes-left counter shows on the landing page and every voting page (`GET /:slug/votes-left?fp=`)
- Voting closes automatically at `voting_ends_at` (set in admin, checked every 60s) or via the admin "End Voting Now" button
- Admin "Reset All Votes" button (double confirm) wipes the contest — **run this the morning of the event** to clear test data
- Landing page HTML is cached in-memory for 30s to survive scan bursts

---

## Load Test Results (2026-07-03, against production)

Staged load test simulating event traffic, run against the live service on current settings (8 vCPU / 8 GB, single replica):

| Stage | Requests | Concurrency | Result |
|-------|----------|-------------|--------|
| Booth voting pages (QR scan path) | 2,000 | 100 | 100% 200s, 26 req/s sustained |
| Landing page (master QR, cached) | 1,000 | 100 | 100% 200s, 58 req/s |
| votes-left lookups | 1,000 | 100 | 100% 200s |
| Vote POSTs from unique devices | 300 | 50 | 100% 200s, all counted |
| Mixed traffic | 1,500 | 120 | 100% 200s |

Zero errors across 5,800 requests; `/health` answered in ~500ms immediately after. Event math: 20,000 interactions over 8 hours averages ~1 req/s with realistic peaks of 10–20 req/s — the test sustained 26–58 req/s, so headroom is comfortable even if every booth is scanned 1,000 times. Device vote tracking (fingerprint + DB unique constraint + 5-ballot cap) was verified end to end during the same run.

**Critical sequencing rule: do not let vendors print QR codes until the final domain (`activations.silverglidertickets.com`) is live and `RAILWAY_BASE_URL` points to it.** QR codes encode the URL — codes printed before the domain cutover will be dead on event day.

---

## Emails (all in `src/lib/mailer.js`)

| Function | Trigger | Recipient |
|----------|---------|-----------|
| `sendBoothConfirmation` | Booth registers | Vendor contact email |
| `sendAdminBoothNotification` | Booth registers | rosewoodmarketin@gmail.com |
| `sendWelcomeEmail` | Attendee opts in for SF picks | Attendee email |

Welcome email includes a concert photo header (`public/concert-bg.jpg` served from Railway).

**Still needed:** weekly Friday picks email — subscribers are collecting but no send mechanism exists yet.

---

## Architecture Notes

- **Node.js + Express 5, CommonJS** — no build step, `node src/index.js` to run
- **All activations routes** live in `src/routes/activations.js`
- **DB functions** in `src/db/activationsDB.js` — migrations run automatically on startup
- **Photo uploads** via Cloudinary (`src/lib/cloudinary.js`)
- **Emails** via Resend (`src/lib/mailer.js`) — see Emails section above
- **Admin auth** is JWT-based, separate from main app auth
- **Vote dedup** is browser fingerprint (localStorage) + DB check — no login required from voters
- **Rate limit** is 150 votes per IP per hour, in-memory (resets on restart)
- **pg pool** set to 20 connections — should handle burst traffic comfortably

---

## Contacts
- **Adrian** — product, has Railway access, Resend account, Cloudinary account
- **Gabriel** — engineer, handles repo setup, Railway deploy, DNS
- Questions on env vars → ask Adrian directly
