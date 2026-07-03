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
| `ACTIVATIONS_ADMIN_SECRET` | ⚠️ In Railway as `CTIVATIONS_ADMIN_SECRET` | **Typo — missing the A.** Fix the name when copying to new service |
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

## What He Needs To Do

- [ ] 1. Create new GitHub repo from `feature/silver-glider-activations` branch
- [ ] 2. In Railway → Silver-Glider-Activations → Settings → Source → point at new repo
- [ ] 3. Set all env vars from the table above
- [ ] 4. Deploy and hit `/health` — confirm `{ status: "ok" }`
- [ ] 5. Set instance RAM to at least 1GB in Railway settings before event day
- [ ] 6. (Optional) Add custom domain `vote.thriftfest.com` — CNAME to Railway URL

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

## Architecture Notes

- **Node.js + Express 5, CommonJS** — no build step, `node src/index.js` to run
- **All activations routes** live in `src/routes/activations.js`
- **DB functions** in `src/db/activationsDB.js` — migrations run automatically on startup
- **Photo uploads** via Cloudinary (`src/lib/cloudinary.js`)
- **Emails** via Resend (`src/lib/mailer.js` → `sendBoothConfirmation`)
- **Admin auth** is JWT-based, separate from main app auth
- **Vote dedup** is browser fingerprint (localStorage) + DB check — no login required from voters
- **Rate limit** is 150 votes per IP per hour, in-memory (resets on restart)
- **pg pool** set to 20 connections — should handle burst traffic comfortably

---

## Contacts
- **Adrian** — product, has Railway access, Resend account, Cloudinary account
- Questions on env vars → ask Adrian directly
