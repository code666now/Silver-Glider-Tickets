# Why Activations Can't Run on Netlify

For Gabriel — the short technical answer to "Netlify is frontend, why not use it?"

## The short version

Netlify-for-frontend + Railway-for-backend is a real, common pattern. It just doesn't apply to this app, because **this app doesn't have a separate frontend.** The Express server on Railway renders the actual HTML pages itself — there's no static build or React app that calls out to an API. Splitting it that way would require rearchitecting the app first, which is real work we shouldn't start days before Thrift Fest.

## The longer version

### How the app is actually built

Open `src/routes/activations.js`. When someone visits a voting page, this is what runs:

```js
router.get('/:activationSlug/:participantSlug', async (req, res) => {
  const activation = await db.getActivationBySlug(req.params.activationSlug);
  const participant = await db.getParticipantBySlug(activation.id, req.params.participantSlug);
  const allParticipants = await db.getParticipantsByActivation(activation.id);
  res.send(renderVotingPage(activation, participant, activation.voting_closed, allParticipants));
});
```

`renderVotingPage()` is a function *inside this same file* that returns a complete HTML string — head, body, inline CSS, inline `<script>` tags, all of it. The server builds the page fresh on every request and sends the finished HTML straight to the browser. Same pattern for the landing page, the winner page, the admin panel, the signup form — everything.

This is called **server-side rendering** (or more specifically, server-rendered HTML with no separate frontend build step). It's a legitimate, simple architecture — but it means the "frontend" and "backend" are the same program, running in the same process, on the same server.

### Why that rules out Netlify

Netlify is built to serve two things well:
1. **Static files** — pre-built HTML/CSS/JS that doesn't change per-request
2. **Serverless functions** — small, short-lived bits of code that spin up per-request and shut down immediately after

Three things this app needs don't fit that model:

**1. A persistent database connection.** `src/config/db.js` opens a `pg.Pool` with up to 20 connections and keeps it alive for the life of the process. Every page render, every vote, every admin action reuses that pool. Netlify functions are stateless and short-lived — there's no long-running process to hold a pool open, so every request would have to open and close its own DB connection, which is slow and doesn't support the atomic operations this app relies on (like the UNIQUE constraint + `ON CONFLICT` vote dedup).

**2. A background timer.** `src/routes/activations.js` runs:

```js
setInterval(async () => {
  const closed = await db.autoCloseExpired().catch(() => []);
}, 60 * 1000);
```

This checks every 60 seconds whether any activation's voting window has ended, and closes it automatically. That only works because the Node process stays running continuously. Netlify functions don't stay running between requests — there's no place for a `setInterval` to live.

**3. Server-side vote validation that has to be trustworthy.** The ballot cap (5 positive votes per device), the fingerprint dedup, the rate limiting — all of it lives in request handlers on this one server, backed directly by the database. That's what makes it tamper-resistant. Moving any of that logic to the client (which is what a Netlify-hosted static frontend would require) would mean trusting the browser instead of the server — exactly the kind of hole we closed during today's scale-hardening pass.

### What splitting it would actually take

If we wanted a real Netlify (frontend) + Railway (API) split later, the work would be:

1. Turn every `render*Page()` function into a JSON API endpoint instead of an HTML-returning one
2. Build a separate frontend project (static HTML/JS or a framework like React) that fetches from those endpoints
3. Move the vote/optin submission logic to fetch calls from that frontend
4. Deploy the frontend to Netlify and the API to Railway as two separate projects
5. Re-run the full load test against the new shape, since request patterns change completely

That's a legitimate rewrite, not a config change — new repo, new deploy pipeline, new failure modes to test. Good candidate for after Thrift Fest, not before it.

### For now

Everything — rendering, votes, admin, emails, auto-close — stays on the single Railway service, which is what's been built, load-tested (5,800 requests, zero errors), and hardened all week. See `HANDOFF.md` for its current status and what's left before the event.
