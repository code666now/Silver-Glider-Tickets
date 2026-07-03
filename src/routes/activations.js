const express = require('express');
const router = express.Router();
const db = require('../db/activationsDB');
const { requireActivationsAdmin } = require('../middleware/auth');
const jwt = require('jsonwebtoken');
const path = require('path');
const multer = require('multer');
const { uploadImage } = require('../lib/cloudinary');
const QRCode = require('qrcode');
const { sendBoothConfirmation, sendWelcomeEmail, sendAdminBoothNotification } = require('../lib/mailer');
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

// Auto-close activations whose voting_ends_at has passed — runs every 60 seconds
setInterval(async () => {
  const closed = await db.autoCloseExpired().catch(() => []);
  if (closed.length) console.log('Auto-closed voting for:', closed.map(a => a.name).join(', '));
}, 60 * 1000);

function spotifyEmbedUrl(url) {
  if (!url) return null;
  const match = url.match(/open\.spotify\.com\/(track|album|playlist)\/([a-zA-Z0-9]+)/);
  if (!match) return null;
  return `https://open.spotify.com/embed/${match[1]}/${match[2]}?utm_source=generator&theme=0`;
}

// In-memory rate limiter factory — one Map per limiter, swept every minute
function makeRateLimiter({ windowMs, max, keyFn, message }) {
  const counts = new Map();
  setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of counts) {
      if (now - entry.start > windowMs) counts.delete(key);
    }
  }, 60 * 1000);
  return (req, res, next) => {
    const now = Date.now();
    const key = keyFn(req);
    const entry = counts.get(key) || { count: 0, start: now };
    if (now - entry.start > windowMs) { entry.count = 0; entry.start = now; }
    entry.count++;
    counts.set(key, entry);
    if (entry.count > max) return res.status(429).json({ error: message });
    next();
  };
}

const ipOf = req => req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket.remoteAddress;

// Per device (IP + fingerprint): normal voter tops out around one vote per booth.
// Festival WiFi and carrier NAT put hundreds of phones behind one IP, so the
// pure-IP cap is high — it only exists to stop a single script hammering us.
const voteLimitPerDevice = makeRateLimiter({
  windowMs: 60 * 60 * 1000, max: 150,
  keyFn: req => ipOf(req) + ':' + (req.body?.fingerprint || 'none'),
  message: 'Too many votes. Try again later.'
});
const voteLimitPerIp = makeRateLimiter({
  windowMs: 60 * 60 * 1000, max: 800,
  keyFn: ipOf,
  message: 'Too many votes. Try again later.'
});
const optinLimit = makeRateLimiter({
  windowMs: 60 * 60 * 1000, max: 10,
  keyFn: ipOf,
  message: 'Too many signups. Try again later.'
});

router.post('/admin/login', async (req, res) => {
  const { password } = req.body;
  const correct = process.env.ACTIVATIONS_ADMIN_PASS || 'activations2026';
  if (password !== correct) return res.status(401).json({ error: 'Wrong password' });
  const token = jwt.sign({ role: 'activations_admin' }, process.env.ACTIVATIONS_ADMIN_SECRET || 'activations-secret', { expiresIn: '7d' });
  res.json({ token });
});

router.get('/admin/activations', (req, res) => {
  res.sendFile(path.resolve(__dirname, '../views/activations-admin.html'));
});

router.get('/admin/activations/data', requireActivationsAdmin, async (req, res) => {
  try {
    const activations = await db.getAllActivations();
    res.json(activations);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/admin/activations/create', requireActivationsAdmin, async (req, res) => {
  try {
    const { name, slug, description } = req.body;
    const activation = await db.createActivation({ name, slug: slug.toLowerCase().replace(/\s+/g, '-'), description });
    res.json(activation);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/admin/upload-image', requireActivationsAdmin, upload.single('image'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file provided' });
    const result = await uploadImage(req.file.buffer);
    res.json({ url: result.secure_url });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/admin/activations/:id/participants', requireActivationsAdmin, upload.single('image'), async (req, res) => {
  try {
    let { name, slug, description, image_url, instagram_handle, booth_song_url } = req.body;
    if (req.file) {
      const uploaded = await uploadImage(req.file.buffer);
      image_url = uploaded.secure_url;
    }
    const participant = await db.createParticipant({
      activation_id: req.params.id,
      name, slug: slug.toLowerCase().replace(/\s+/g, '-'),
      description, image_url, instagram_handle, booth_song_url: booth_song_url || null
    });
    res.json(participant);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/admin/activations/participants/:id', requireActivationsAdmin, upload.single('image'), async (req, res) => {
  try {
    let { name, slug, description, image_url, instagram_handle, booth_song_url } = req.body;
    if (req.file) {
      const uploaded = await uploadImage(req.file.buffer);
      image_url = uploaded.secure_url;
    }
    const participant = await db.updateParticipant(req.params.id, { name, slug, description, image_url, instagram_handle, booth_song_url: booth_song_url || null });
    res.json(participant);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/admin/activations/:id/pending', requireActivationsAdmin, async (req, res) => {
  try {
    const pending = await db.getPendingParticipants(req.params.id);
    res.json(pending);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/admin/activations/participants/:id/approve', requireActivationsAdmin, async (req, res) => {
  try {
    const participant = await db.approveParticipant(req.params.id);
    res.json(participant);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/admin/activations/participants/:id/reject', requireActivationsAdmin, async (req, res) => {
  try {
    const participant = await db.rejectParticipant(req.params.id);
    res.json(participant);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/admin/activations/:id/results', requireActivationsAdmin, async (req, res) => {
  try {
    const results = await db.getResultsByActivation(req.params.id);
    const optins = await db.getOptinsByActivation(req.params.id);
    res.json({ results, optins });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/admin/activations/:id/participants', requireActivationsAdmin, async (req, res) => {
  try {
    const participants = await db.getParticipantsByActivation(req.params.id);
    res.json(participants);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:activationSlug/join', async (req, res) => {
  const activation = await db.getActivationBySlug(req.params.activationSlug);
  if (!activation || !activation.active) return res.status(404).send('Not found');
  res.send(renderSignupPage(activation));
});

router.post('/:activationSlug/join', upload.single('image'), async (req, res) => {
  try {
    const activation = await db.getActivationBySlug(req.params.activationSlug);
    if (!activation || !activation.active) return res.status(404).json({ error: 'Not found' });
    const { name, description, contact_email, contact_phone, instagram_handle, booth_song_url } = req.body;
    if (!name) return res.status(400).json({ error: 'Name required' });
    let image_url = null;
    if (req.file) {
      const result = await uploadImage(req.file.buffer);
      image_url = result.secure_url;
    }
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const existing = await db.getParticipantBySlug(activation.id, slug);
    if (existing) return res.status(400).json({ error: 'A booth with that name is already registered. Try adding your location or a unique word to your booth name.' });
    const participant = await db.createParticipant({
      activation_id: activation.id, name, slug, description, image_url,
      status: 'approved', contact_email, contact_phone, instagram_handle, booth_song_url: booth_song_url || null
    });
    if (contact_email) {
      const baseUrl = process.env.RAILWAY_BASE_URL
        || (process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : '');
      const profileUrl = `${baseUrl}/activations/${activation.slug}/${slug}/profile`;
      sendBoothConfirmation({ to: contact_email, boothName: name, activationName: activation.name, profileUrl }).catch(() => {});
      sendAdminBoothNotification({ boothName: name, activationName: activation.name, contactEmail: contact_email, contactPhone: contact_phone, instagramHandle: instagram_handle, profileUrl }).catch(() => {});
    }
    res.json({ success: true, participant });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Landing page cache — the master QR sends every attendee here, so at peak this
// page gets hammered. 30 seconds of staleness on the leaderboard is invisible;
// the ~95% cut in DB queries is not.
const landingCache = new Map();
const LANDING_TTL_MS = 30 * 1000;

router.get('/:activationSlug', async (req, res) => {
  const cached = landingCache.get(req.params.activationSlug);
  if (cached && Date.now() - cached.at < LANDING_TTL_MS) return res.send(cached.html);
  const activation = await db.getActivationBySlug(req.params.activationSlug);
  if (!activation || !activation.active) return res.status(404).send('Not found');
  const participants = await db.getParticipantsByActivation(activation.id);
  const results = await db.getResultsByActivation(activation.id);
  const voteMap = {};
  results.forEach(r => { voteMap[r.slug] = parseInt(r.positive) || 0; });
  const html = renderActivationLanding(activation, participants, voteMap);
  landingCache.set(req.params.activationSlug, { html, at: Date.now() });
  res.send(html);
});

router.post('/admin/activations/:id/close-voting', requireActivationsAdmin, async (req, res) => {
  try {
    const activation = await db.closeVoting(req.params.id);
    res.json(activation);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/admin/activations/:id/reset-votes', requireActivationsAdmin, async (req, res) => {
  try {
    const result = await db.resetVotes(req.params.id);
    landingCache.clear();
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/admin/activations/:id/set-voting-ends', requireActivationsAdmin, async (req, res) => {
  try {
    const { voting_ends_at } = req.body;
    const activation = await db.setVotingEndsAt(req.params.id, voting_ends_at || null);
    res.json(activation);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:activationSlug/winner', async (req, res) => {
  const activation = await db.getActivationBySlug(req.params.activationSlug);
  if (!activation) return res.status(404).send('Not found');
  const winner = await db.getWinner(activation.id);
  res.send(renderWinnerPage(activation, winner));
});

router.get('/:activationSlug/qr', async (req, res) => {
  const activation = await db.getActivationBySlug(req.params.activationSlug);
  if (!activation) return res.status(404).send('Not found');
  const baseUrl = process.env.RAILWAY_BASE_URL
    || (process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : '');
  const landingUrl = `${baseUrl}/activations/${activation.slug}`;
  const qrDataUrl = await QRCode.toDataURL(landingUrl, { width: 320, margin: 2, color: { dark: '#0a0a0a', light: '#f5f0eb' } });
  res.send(renderMasterQRPage(activation, landingUrl, qrDataUrl));
});

// Lightweight votes-left lookup — pages personalize their badges with this,
// since the landing page HTML is cached and shared across attendees.
// Must be registered before /:activationSlug/:participantSlug or it gets swallowed.
router.get('/:activationSlug/votes-left', async (req, res) => {
  try {
    const fp = String(req.query.fp || '');
    if (fp.length < 4 || fp.length > 128) return res.json({ votesLeft: MAX_BALLOTS, maxVotes: MAX_BALLOTS });
    const activation = await db.getActivationBySlug(req.params.activationSlug);
    if (!activation) return res.status(404).json({ error: 'Not found' });
    const used = await db.countPositiveVotes(activation.id, fp);
    res.json({ votesLeft: Math.max(0, MAX_BALLOTS - used), maxVotes: MAX_BALLOTS });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:activationSlug/:participantSlug/profile', async (req, res) => {
  const activation = await db.getActivationBySlug(req.params.activationSlug);
  if (!activation) return res.status(404).send('Not found');
  const participant = await db.getParticipantBySlug(activation.id, req.params.participantSlug);
  if (!participant) return res.status(404).send('Not found');
  const baseUrl = process.env.RAILWAY_BASE_URL
    || (process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : '');
  const voteUrl = `${baseUrl}/activations/${activation.slug}/${participant.slug}`;
  const qrDataUrl = await QRCode.toDataURL(voteUrl, { width: 280, margin: 2, color: { dark: '#0a0a0a', light: '#f5f0eb' } });
  res.send(renderProfilePage(activation, participant, voteUrl, qrDataUrl));
});

router.get('/:activationSlug/:participantSlug', async (req, res) => {
  const activation = await db.getActivationBySlug(req.params.activationSlug);
  if (!activation || !activation.active) return res.status(404).send('Not found');
  const participant = await db.getParticipantBySlug(activation.id, req.params.participantSlug);
  if (!participant) return res.status(404).send('Not found');
  const allParticipants = await db.getParticipantsByActivation(activation.id);
  res.send(renderVotingPage(activation, participant, activation.voting_closed, allParticipants));
});

const MAX_BALLOTS = 5;

router.post('/:activationSlug/:participantSlug/vote', voteLimitPerIp, voteLimitPerDevice, async (req, res) => {
  try {
    const { vote, fingerprint } = req.body;
    // Without a real fingerprint the dedup constraint can't hold — reject early
    if (typeof fingerprint !== 'string' || fingerprint.trim().length < 4 || fingerprint.length > 128) {
      return res.status(400).json({ error: 'Invalid request' });
    }
    if (!['rules', 'hell_yeah', 'no_thanks'].includes(vote)) return res.status(400).json({ error: 'Invalid vote' });
    const activation = await db.getActivationBySlug(req.params.activationSlug);
    if (!activation) return res.status(404).json({ error: 'Not found' });
    const participant = await db.getParticipantBySlug(activation.id, req.params.participantSlug);
    if (!participant) return res.status(404).json({ error: 'Not found' });
    const votingOver = activation.voting_closed || (activation.voting_ends_at && new Date(activation.voting_ends_at) <= new Date());
    if (votingOver) return res.status(403).json({ error: 'Voting is closed' });

    const isPositive = vote !== 'no_thanks';
    let used = await db.countPositiveVotes(activation.id, fingerprint);
    if (isPositive && used >= MAX_BALLOTS) {
      return res.status(403).json({ error: `That's all ${MAX_BALLOTS} of your votes.`, outOfVotes: true, votesLeft: 0 });
    }
    const result = await db.castVote({ participant_id: participant.id, activation_id: activation.id, vote, browser_fingerprint: fingerprint });
    if (isPositive && !result.duplicate) used++;
    res.json({ ...result, votesLeft: Math.max(0, MAX_BALLOTS - used), maxVotes: MAX_BALLOTS });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/:activationSlug/:participantSlug/optin', optinLimit, async (req, res) => {
  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
      return res.status(400).json({ error: 'Enter a valid email' });
    }
    const activation = await db.getActivationBySlug(req.params.activationSlug);
    if (!activation) return res.status(404).json({ error: 'Not found' });
    const participant = await db.getParticipantBySlug(activation.id, req.params.participantSlug);
    if (!participant) return res.status(404).json({ error: 'Not found' });
    // Already on the list — succeed quietly, no duplicate row, no second welcome email
    const existing = await db.getOptinByEmail(activation.id, email);
    if (existing) return res.json({ success: true });
    const optin = await db.createOptin({ activation_id: activation.id, participant_id: participant.id, email });
    sendWelcomeEmail({ to: email }).catch(() => {});
    res.json({ success: true, optin });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

function renderSignupPage(activation) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0,viewport-fit=cover">
<meta name="theme-color" content="#0a0a0a">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<title>Join ${activation.name}</title>
<style>
*{box-sizing:border-box;margin:0;padding:0;-webkit-tap-highlight-color:transparent}
body{color:#f0f0f0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;min-height:100vh;background:#0a0a0a url('/thrift-bg.jpg') center/cover fixed;-webkit-text-size-adjust:100%}
body::before{content:'';position:fixed;inset:0;background:rgba(0,0,0,.82);z-index:0}
header,.container,#success{position:relative;z-index:1}
header{padding:max(20px,env(safe-area-inset-top)) 16px 20px;text-align:center;border-bottom:1px solid rgba(255,255,255,.08)}
header h1{font-size:clamp(20px,5vw,26px);font-weight:700;margin-top:12px}
header .sub{font-size:14px;color:#888;margin-top:6px}
.container{max-width:480px;margin:0 auto;padding:24px max(16px,env(safe-area-inset-right)) max(80px,calc(env(safe-area-inset-bottom) + 48px)) max(16px,env(safe-area-inset-left))}
.field{position:relative;margin-top:20px}
.field input,.field textarea{width:100%;background:rgba(0,0,0,.45);border:1px solid rgba(255,255,255,.12);color:#f0f0f0;padding:22px 14px 8px;border-radius:10px;font-size:16px;outline:none;font-family:inherit;-webkit-appearance:none;backdrop-filter:blur(4px);touch-action:manipulation;transition:border-color .2s}
.field input:focus,.field textarea:focus{border-color:rgba(255,255,255,.35);background:rgba(0,0,0,.6)}
.field input::placeholder,.field textarea::placeholder{color:transparent}
.field textarea{resize:none;min-height:88px}
.field-label{position:absolute;left:14px;top:50%;transform:translateY(-50%);font-size:14px;color:rgba(255,255,255,.35);pointer-events:none;transition:all .2s ease;letter-spacing:.01em}
.field textarea~.field-label{top:18px;transform:none}
.field input:focus~.field-label,.field input:not(:placeholder-shown)~.field-label,
.field textarea:focus~.field-label,.field textarea:not(:placeholder-shown)~.field-label{top:8px;transform:none;font-size:10px;color:rgba(255,255,255,.4);letter-spacing:.06em;text-transform:uppercase}
.field-hint{font-size:11px;color:rgba(255,255,255,.2);margin-top:5px;padding-left:2px}
.btn{width:100%;background:#1CC5BE;color:#0a0a0a;border:none;padding:18px;border-radius:12px;font-size:17px;font-weight:700;cursor:pointer;margin-top:28px;-webkit-appearance:none;min-height:56px;touch-action:manipulation;transition:opacity .15s}
.btn:active{opacity:.8}
.btn:disabled{opacity:.5;cursor:not-allowed}
#success{display:none;text-align:center;padding:48px 0}
#success h2{font-size:24px;font-weight:700;margin-bottom:8px}
#success p{font-size:15px;color:#666}
#error-msg{color:#ff4444;font-size:13px;margin-top:10px;text-align:center}
.progress{height:4px;background:#222;border-radius:2px;margin-top:16px;display:none}
.progress-bar{height:100%;background:#1CC5BE;border-radius:2px;width:0%;transition:width .3s}
.sg-logo{display:inline-flex;align-items:center;gap:7px;text-decoration:none;opacity:.45}
.sg-logo img{width:16px;height:16px;object-fit:contain;filter:grayscale(1)}
.sg-logo-name{display:block;font-size:10px;font-weight:600;color:#fff;letter-spacing:.1em;text-transform:uppercase}
.sg-logo-sub{display:none}
</style>
</head>
<body>
<header>
  <a href="/" class="sg-logo"><img src="/logo.png" alt="Silver Glider"><div><span class="sg-logo-name">Silver Glider</span><span class="sg-logo-sub">Music Discovery</span></div></a>
  <h1>${activation.name}</h1>
  <p class="sub">Best Booth Award — Register to compete</p>
</header>
<div class="container">
  <div style="background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.1);border-radius:16px;padding:20px;margin-bottom:24px;backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px)">
    <p style="font-size:11px;color:#1CC5BE;font-weight:700;letter-spacing:.1em;text-transform:uppercase;margin-bottom:12px">The Prize</p>
    <div style="display:flex;flex-direction:column;gap:10px">
      <div style="display:flex;align-items:flex-start;gap:12px;font-size:14px">
        <span style="font-size:20px">🥇</span>
        <div><span style="color:#f0f0f0;font-weight:600">1st Place — Silver Glider Guest List for Two</span><br><span style="color:rgba(255,255,255,.4);font-size:13px">Choose a show at The Make-Out Room, Kilowatt, or Bottom of the Hill.</span></div>
      </div>
      <div style="display:flex;align-items:flex-start;gap:12px;font-size:14px">
        <span style="font-size:20px">🥈</span>
        <div><span style="color:#f0f0f0;font-weight:600">2nd Place — Portable Suitcase Record Player</span><br><span style="color:rgba(255,255,255,.4);font-size:13px">A vintage-inspired portable record player, yours to keep.</span></div>
      </div>
      <div style="display:flex;align-items:flex-start;gap:12px;font-size:14px">
        <span style="font-size:20px">🥉</span>
        <div><span style="color:#f0f0f0;font-weight:600">3rd Place — Mystery 3 Record Pack</span><br><span style="color:rgba(255,255,255,.4);font-size:13px">Three mystery records hand-picked by Silver Glider.</span></div>
      </div>
    </div>
    <p style="font-size:12px;color:rgba(255,255,255,.2);margin-top:14px;line-height:1.5">Festival attendees vote for their favorite booth. Top vote-getter wins. Silver Glider is a music discovery service — we drop concert picks straight to your phone.</p>
  </div>
  <div style="display:flex;align-items:center;gap:12px;margin:28px 0 24px">
    <div style="flex:1;height:1px;background:rgba(255,255,255,.07)"></div>
    <span style="font-size:11px;color:rgba(255,255,255,.2);letter-spacing:.1em;text-transform:uppercase;white-space:nowrap">Register your booth</span>
    <div style="flex:1;height:1px;background:rgba(255,255,255,.07)"></div>
  </div>

  <div id="form-view">
    <div class="field">
      <input type="text" id="name" placeholder="Booth name" maxlength="100">
      <span class="field-label">Booth name *</span>
    </div>

    <div class="field">
      <textarea id="description" placeholder="Description" maxlength="300"></textarea>
      <span class="field-label">Description</span>
    </div>

    <label style="display:block;font-size:10px;color:rgba(255,255,255,.3);text-transform:uppercase;letter-spacing:.06em;margin-top:20px;margin-bottom:8px">Photo</label>
    <div id="upload-area" style="margin-top:6px">
      <div id="upload-placeholder">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px">
          <label style="all:unset;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.1);border-radius:12px;padding:20px;cursor:pointer;font-size:13px;color:#888;text-align:center;backdrop-filter:blur(4px)">
            <span style="font-size:28px">📸</span>
            Take a photo
            <input type="file" accept="image/*" capture="environment" style="display:none" onchange="previewImage(this)">
          </label>
          <label style="all:unset;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.1);border-radius:12px;padding:20px;cursor:pointer;font-size:13px;color:#888;text-align:center;backdrop-filter:blur(4px)">
            <span style="font-size:28px">🖼️</span>
            Choose from library
            <input type="file" accept="image/*" style="display:none" onchange="previewImage(this)">
          </label>
        </div>
      </div>
      <div id="preview-wrap" style="display:none;position:relative">
        <img id="preview-img" style="width:100%;height:220px;object-fit:cover;border-radius:12px;display:block">
        <button onclick="clearImage()" style="position:absolute;top:8px;right:8px;background:rgba(0,0,0,.7);color:#fff;border:none;border-radius:50%;width:28px;height:28px;font-size:16px;cursor:pointer;line-height:1">×</button>
      </div>
    </div>
    <input type="file" id="image-file" accept="image/*" style="display:none">

    <div class="field">
      <input type="text" id="instagram-handle" placeholder="Instagram handle">
      <span class="field-label">Instagram handle (optional)</span>
    </div>

    <div class="field">
      <input type="email" id="contact-email" placeholder="Email">
      <span class="field-label">Your email (optional)</span>
    </div>


<div class="progress" id="progress-bar-wrap">
      <div class="progress-bar" id="progress-bar"></div>
    </div>

    <button class="btn" id="submit-btn" onclick="submitForm()" style="margin-top:36px">Register My Booth</button>
    <div id="error-msg"></div>
  </div>

  <div id="success">
    <div style="font-size:48px;margin-bottom:16px">🎉</div>
    <h2>You're live.</h2>
    <p style="margin-bottom:8px">Your booth is on the voting page now.</p>
    <p id="success-email-note" style="font-size:13px;color:#555;display:none">Check your email — we sent your printable QR code.</p>
  </div>
</div>
<script>
let selectedFile = null;

function previewImage(input) {
  const file = input.files[0];
  if (!file) return;
  selectedFile = file;
  document.getElementById('image-file').files; // keep ref
  const reader = new FileReader();
  reader.onload = e => {
    document.getElementById('preview-img').src = e.target.result;
    document.getElementById('upload-placeholder').style.display = 'none';
    document.getElementById('preview-wrap').style.display = 'block';
  };
  reader.readAsDataURL(file);
}

function clearImage() {
  selectedFile = null;
  document.getElementById('preview-img').src = '';
  document.getElementById('preview-wrap').style.display = 'none';
  document.getElementById('upload-placeholder').style.display = 'block';
}

async function submitForm() {
  const name = document.getElementById('name').value.trim();
  const description = document.getElementById('description').value.trim();
  const contactEmail = document.getElementById('contact-email').value.trim();
  const contactPhone = document.getElementById('contact-phone') ? document.getElementById('contact-phone').value.trim() : '';
  const instagramHandle = document.getElementById('instagram-handle').value.trim().replace(/^@/, '');
  const boothSongUrl = document.getElementById('booth-song-url').value.trim();
  const imageFile = document.getElementById('image-file').files[0];
  const errEl = document.getElementById('error-msg');
  const btn = document.getElementById('submit-btn');

  errEl.textContent = '';
  if (!name) { errEl.textContent = 'Booth name is required.'; return; }

  btn.disabled = true;
  btn.textContent = 'Uploading...';
  document.getElementById('progress-bar-wrap').style.display = 'block';
  document.getElementById('progress-bar').style.width = '30%';

  const formData = new FormData();
  formData.append('name', name);
  formData.append('description', description);
  formData.append('contact_email', contactEmail);
  formData.append('contact_phone', contactPhone);
  if (instagramHandle) formData.append('instagram_handle', instagramHandle);
  if (boothSongUrl) formData.append('booth_song_url', boothSongUrl);
  if (selectedFile) formData.append('image', selectedFile);

  document.getElementById('progress-bar').style.width = '70%';

  try {
    const res = await fetch(window.location.pathname, { method: 'POST', body: formData });
    const data = await res.json();
    document.getElementById('progress-bar').style.width = '100%';
    if (data.error) { errEl.textContent = data.error; btn.disabled = false; btn.textContent = 'Register My Booth'; return; }
    document.getElementById('form-view').style.display = 'none';
    document.getElementById('success').style.display = 'block';
    if (contactEmail) document.getElementById('success-email-note').style.display = 'block';
  } catch (e) {
    errEl.textContent = 'Something went wrong. Try again.';
    btn.disabled = false;
    btn.textContent = 'Register My Booth';
  }
}
</script>
</body>
</html>`;
}

function renderActivationLanding(activation, participants, voteMap = {}) {
  const slugList = JSON.stringify(participants.map(p => p.slug));
  const voteData = JSON.stringify(voteMap);
  const cards = participants.map(p => `
    <a href="/activations/${activation.slug}/${p.slug}" class="booth-card" data-slug="${p.slug}" data-name="${p.name.toLowerCase()}" data-votes="${voteMap[p.slug] || 0}" id="card-${p.slug}">
      ${p.image_url
        ? `<div class="booth-img" style="background-image:url('${p.image_url}')"></div>`
        : `<div class="booth-img booth-img-placeholder"><span>${p.name[0]}</span></div>`}
      <div class="booth-body">
        <div class="booth-meta">
          <h3>${p.name}</h3>
          ${p.description ? `<p>${p.description}</p>` : ''}
        </div>
        <div class="vote-btn-wrap">
          <span class="vote-btn" id="vbtn-${p.slug}">Vote</span>
        </div>
      </div>
    </a>
  `).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0,viewport-fit=cover">
<meta name="theme-color" content="#0a0a0a">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<title>${activation.name}</title>
<style>
*{box-sizing:border-box;margin:0;padding:0;-webkit-tap-highlight-color:transparent}
body{color:#f0f0f0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;min-height:100vh;background:#0a0a0a url('/landing-bg.jpg') center/cover fixed;-webkit-text-size-adjust:100%}
body::before{content:'';position:fixed;inset:0;background:rgba(0,0,0,.82);z-index:0}
header,.prize-card,.container,footer{position:relative;z-index:1}
header{padding:max(20px,env(safe-area-inset-top)) max(16px,env(safe-area-inset-right)) 16px max(16px,env(safe-area-inset-left));text-align:center;border-bottom:1px solid rgba(255,255,255,.08)}
header h1{font-size:clamp(20px,5vw,26px);font-weight:800;margin-top:12px;letter-spacing:-.02em}
header .tagline{font-size:13px;color:#555;margin-top:6px}
.sg-logo{display:inline-flex;align-items:center;gap:7px;text-decoration:none;opacity:.45}
.sg-logo img{width:16px;height:16px;object-fit:contain;filter:grayscale(1)}
.sg-logo-name{display:block;font-size:10px;font-weight:600;color:#fff;letter-spacing:.1em;text-transform:uppercase}
.sg-logo-sub{display:none}
.stats-bar{display:flex;align-items:center;justify-content:center;gap:6px;margin-top:10px;font-size:12px;color:#555}
.stats-bar span{color:#1CC5BE;font-weight:700}
.prize-card{margin:16px max(16px,env(safe-area-inset-right)) 0 max(16px,env(safe-area-inset-left));background:#111;border:1px solid #1a1a1a;border-radius:14px;padding:16px 20px}
.prize-label{font-size:11px;color:#1CC5BE;font-weight:700;letter-spacing:.1em;text-transform:uppercase;margin-bottom:12px}
.prize-row{display:flex;align-items:center;gap:12px;padding:6px 0;font-size:14px}
.prize-row:not(:last-child){border-bottom:1px solid #1a1a1a}
.prize-venue{color:#f0f0f0;font-weight:600}
.prize-desc{color:#555;font-size:12px}
.container{max-width:600px;margin:0 auto;padding:16px max(16px,env(safe-area-inset-right)) max(32px,calc(env(safe-area-inset-bottom)+16px)) max(16px,env(safe-area-inset-left))}
.booth-card{display:block;background:#111;border:1px solid #1a1a1a;border-radius:16px;margin-bottom:14px;text-decoration:none;color:inherit;overflow:hidden;transition:border-color .15s,transform .1s;-webkit-user-select:none;user-select:none}
.booth-card:active{transform:scale(.985);border-color:#333}
.booth-img{width:100%;height:clamp(160px,40vw,220px);background-size:cover;background-position:center;background-color:#1a1a1a}
.booth-img-placeholder{display:flex;align-items:center;justify-content:center}
.booth-img-placeholder span{font-size:clamp(48px,12vw,72px);font-weight:800;color:#333}
.booth-body{display:flex;align-items:center;justify-content:space-between;padding:14px 16px;gap:12px}
.booth-meta h3{font-size:clamp(15px,4vw,17px);font-weight:700;margin-bottom:3px}
.booth-meta p{font-size:13px;color:#666;line-height:1.4}
.vote-btn-wrap{flex-shrink:0}
.vote-btn{display:inline-block;background:#1CC5BE;color:#0a0a0a;font-size:14px;font-weight:700;padding:11px 20px;border-radius:8px;white-space:nowrap;min-height:44px;display:flex;align-items:center}
.empty{color:#444;text-align:center;padding:60px 0;font-size:15px}
footer{text-align:center;padding:32px max(20px,env(safe-area-inset-right)) max(32px,calc(env(safe-area-inset-bottom)+20px)) max(20px,env(safe-area-inset-left));font-size:12px;color:#333;border-top:1px solid #1a1a1a;margin-top:8px}
</style>
</head>
<body>
<header>
  <a href="/" class="sg-logo"><img src="/logo.png" alt="Silver Glider"><div class="sg-logo-text"><span class="sg-logo-name">Silver Glider</span><span class="sg-logo-sub">Music Discovery</span></div></a>
  <h1>${activation.name}</h1>
  <div class="stats-bar"><span>${participants.length}</span> booth${participants.length !== 1 ? 's' : ''} competing — tap one to vote</div>
  <div id="ballots-badge" style="display:none;text-align:center;margin-top:10px"><span style="display:inline-block;font-size:13px;font-weight:600;color:#1CC5BE;background:rgba(28,197,190,.08);border:1px solid rgba(28,197,190,.2);border-radius:20px;padding:7px 16px"></span></div>
  <div id="progress-wrap" style="display:none;margin-top:14px;width:100%;max-width:400px;margin-left:auto;margin-right:auto">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
      <span style="font-size:12px;color:#555;font-weight:600" id="progress-label">0 of ${participants.length} voted</span>
      <span style="font-size:12px;color:#1CC5BE;font-weight:700" id="progress-pct">0%</span>
    </div>
    <div style="height:4px;background:#1a1a1a;border-radius:2px;overflow:hidden">
      <div id="progress-bar" style="height:100%;background:#1CC5BE;border-radius:2px;width:0%;transition:width .4s ease"></div>
    </div>
  </div>
</header>

<div class="prize-card">
  <p class="prize-label">Best Booth Award — Prizes</p>
  <div class="prize-row"><span>🥇</span><div><div class="prize-venue">Silver Glider Guest List for Two</div><div class="prize-desc">1st place — The Make-Out Room, Kilowatt, or Bottom of the Hill</div></div></div>
  <div class="prize-row"><span>🥈</span><div><div class="prize-venue">Portable Suitcase Record Player</div><div class="prize-desc">2nd place — vintage-inspired, yours to keep</div></div></div>
  <div class="prize-row"><span>🥉</span><div><div class="prize-venue">Mystery 3 Record Pack</div><div class="prize-desc">3rd place — hand-picked by Silver Glider</div></div></div>
</div>

<div style="position:relative;z-index:1;max-width:600px;margin:16px auto 0;padding:0 16px">
  <button id="start-btn" onclick="startVoting()" style="width:100%;background:rgba(255,255,255,.06);color:#e0e0e0;border:1px solid rgba(255,255,255,.1);padding:16px;border-radius:14px;font-size:16px;font-weight:600;cursor:pointer;min-height:54px;-webkit-appearance:none;touch-action:manipulation;transition:opacity .15s;display:flex;align-items:center;justify-content:center;gap:10px;letter-spacing:.01em">
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>
    <span id="start-label">Start voting</span>
  </button>
</div>

<div style="position:relative;z-index:1;max-width:600px;margin:16px auto 0;padding:0 16px;display:flex;align-items:center;justify-content:space-between">
  <span style="font-size:12px;color:#444;font-weight:500">Sort by</span>
  <div style="display:flex;background:#111;border:1px solid #1a1a1a;border-radius:8px;overflow:hidden">
    <button id="sort-votes" onclick="setSort('votes')" style="padding:8px 14px;font-size:12px;font-weight:600;border:none;cursor:pointer;background:#1CC5BE;color:#0a0a0a;transition:all .15s">Most votes</button>
    <button id="sort-az" onclick="setSort('az')" style="padding:8px 14px;font-size:12px;font-weight:600;border:none;cursor:pointer;background:transparent;color:#555;transition:all .15s">A–Z</button>
  </div>
</div>

<div class="container" id="booth-list">
  ${cards || '<p class="empty">No booths yet.</p>'}
</div>
<footer style="text-align:center;padding:32px 20px">
  <a href="https://instagram.com/silverglidertix" target="_blank" rel="noopener noreferrer" style="display:inline-block;color:#666;text-decoration:none">
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2" width="20" height="20" rx="5" ry="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r="1.5" fill="currentColor" stroke="none"/></svg>
  </a>
  <a href="/" style="display:inline-flex;align-items:center;gap:7px;text-decoration:none;opacity:.4;margin-top:10px">
    <img src="/logo.png" alt="" style="width:18px;height:18px;object-fit:contain;filter:grayscale(1)">
    <span style="font-size:10px;font-weight:600;color:#fff;letter-spacing:.1em;text-transform:uppercase">Silver Glider</span>
  </a>
</footer>
<script>
(function(){
  var slugs = ${slugList};
  var total = slugs.length;
  var key = 'sg_voted_${activation.slug}';
  var currentSort = 'votes';

  window.setSort = function(mode) {
    currentSort = mode;
    document.getElementById('sort-votes').style.background = mode === 'votes' ? '#1CC5BE' : 'transparent';
    document.getElementById('sort-votes').style.color = mode === 'votes' ? '#0a0a0a' : '#555';
    document.getElementById('sort-az').style.background = mode === 'az' ? '#1CC5BE' : 'transparent';
    document.getElementById('sort-az').style.color = mode === 'az' ? '#0a0a0a' : '#555';
    var list = document.getElementById('booth-list');
    var cards = Array.from(list.querySelectorAll('.booth-card'));
    cards.sort(function(a, b) {
      if (mode === 'votes') return parseInt(b.dataset.votes) - parseInt(a.dataset.votes);
      return a.dataset.name.localeCompare(b.dataset.name);
    });
    cards.forEach(function(c) { list.appendChild(c); });
  };

  // default to votes on load
  window.setSort('votes');
  var base = '/activations/${activation.slug}/';

  function getVoted() { return JSON.parse(localStorage.getItem(key) || '[]'); }

  // Personal votes-left badge — fetched per device since this page is cached and shared
  (async function () {
    var badge = document.getElementById('ballots-badge');
    var pill = badge.querySelector('span');
    var fp = localStorage.getItem('sg_fp');
    if (!fp) {
      badge.style.display = 'block';
      pill.textContent = 'You have 5 votes — spend them well';
      return;
    }
    try {
      var res = await fetch('/activations/${activation.slug}/votes-left?fp=' + encodeURIComponent(fp));
      var data = await res.json();
      badge.style.display = 'block';
      if (data.votesLeft <= 0) {
        pill.textContent = 'All ' + data.maxVotes + ' votes used — winner announced when voting closes';
        pill.style.color = '#888';
        pill.style.background = 'rgba(255,255,255,.04)';
        pill.style.borderColor = 'rgba(255,255,255,.1)';
      } else {
        pill.textContent = 'You have ' + data.votesLeft + ' of ' + data.maxVotes + ' votes — spend them well';
      }
    } catch (e) {}
  })();

  function getFirstUnvisited() {
    var voted = getVoted();
    for (var i = 0; i < slugs.length; i++) {
      if (!voted.includes(slugs[i])) return slugs[i];
    }
    return null;
  }

  function updateProgress() {
    var voted = getVoted();
    var count = voted.length;
    var startBtn = document.getElementById('start-btn');
    var startLabel = document.getElementById('start-label');

    if (count > 0) {
      document.getElementById('progress-wrap').style.display = 'block';
      document.getElementById('progress-label').textContent = count + ' of ' + total + ' voted';
      var pct = Math.round((count / total) * 100);
      document.getElementById('progress-pct').textContent = pct + '%';
      document.getElementById('progress-bar').style.width = pct + '%';
    }

    var next = getFirstUnvisited();
    if (!next) {
      startLabel.textContent = 'All booths voted — see results';
      startBtn.style.background = 'rgba(28,197,190,.15)';
      startBtn.style.color = '#1CC5BE';
      startBtn.style.border = '1px solid rgba(28,197,190,.3)';
    } else if (count > 0) {
      startLabel.textContent = 'Continue voting';
    }

    voted.forEach(function(slug) {
      var btn = document.getElementById('vbtn-' + slug);
      var card = document.getElementById('card-' + slug);
      if (btn) { btn.textContent = 'Voted'; btn.style.background = 'transparent'; btn.style.color = '#1CC5BE'; btn.style.border = '1px solid #1CC5BE'; }
      if (card) { card.style.borderColor = 'rgba(28,197,190,.3)'; }
    });
  }

  window.startVoting = function() {
    var next = getFirstUnvisited();
    if (next) {
      window.location.href = base + next;
    } else {
      window.location.href = '/activations/${activation.slug}/winner';
    }
  };

  updateProgress();
})();
</script>
</body>
</html>`;
}

function renderVotingPage(activation, participant, votingClosed = false, allParticipants = []) {
  const slugList = JSON.stringify(allParticipants.map(p => p.slug));
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0,viewport-fit=cover">
<meta name="theme-color" content="#0a0a0a">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<title>${participant.name} — ${activation.name}</title>
<style>
*{box-sizing:border-box;margin:0;padding:0;-webkit-tap-highlight-color:transparent}
body{color:#f0f0f0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;min-height:100vh;background:#0a0a0a url('/voting-bg.jpg') center/cover fixed;-webkit-text-size-adjust:100%}
body::before{content:'';position:fixed;inset:0;background:rgba(0,0,0,.82);z-index:0}
header,.hero,.container,footer{position:relative;z-index:1}
header{padding:14px 20px;padding-top:max(14px,env(safe-area-inset-top));display:flex;align-items:center;gap:10px}
header a{color:#555;text-decoration:none;font-size:13px;padding:6px 0;min-height:44px;display:flex;align-items:center}
header span{color:#2a2a2a}
.hero{width:100%;max-width:480px;margin:0 auto;aspect-ratio:4/5;position:relative;overflow:hidden}
.hero img{width:100%;height:100%;object-fit:cover;display:block}
.hero-placeholder{width:100%;height:100%;background:#1a1a1a;display:flex;align-items:center;justify-content:center;font-size:80px;font-weight:700;color:#333}
.hero-overlay{position:absolute;bottom:0;left:0;right:0;padding:24px 20px 20px;background:linear-gradient(transparent,rgba(0,0,0,.88))}
.hero-overlay h1{font-size:26px;font-weight:700;margin-bottom:4px}
.hero-overlay .desc{font-size:15px;color:rgba(255,255,255,.8);font-weight:500}
.container{max-width:480px;margin:0 auto;padding:20px 16px;padding-bottom:max(24px,env(safe-area-inset-bottom))}
.vote-label{font-size:13px;color:#ccc;letter-spacing:.06em;text-transform:uppercase;margin-bottom:14px;text-align:center;font-weight:600}
.vote-buttons{display:flex;flex-direction:column;gap:10px;margin-bottom:8px}
.vote-btn-primary{background:#1CC5BE;border:none;color:#0a0a0a;padding:18px;border-radius:14px;font-size:19px;font-weight:700;cursor:pointer;width:100%;min-height:58px;transition:opacity .15s;-webkit-appearance:none}
.vote-btn-primary:active{opacity:.8}
.vote-btn-secondary{background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.1);color:#f0f0f0;padding:15px;border-radius:14px;font-size:17px;cursor:pointer;width:100%;min-height:52px;transition:background .15s;-webkit-appearance:none}
.vote-btn-secondary:active{background:rgba(255,255,255,.12)}
.vote-hint{font-size:13px;color:#aaa;text-align:center;margin-top:8px;font-weight:500}
#duplicate-msg{font-size:13px;color:#888;text-align:center;margin-top:12px;display:none}
#thank-you{display:none}
.share-block{background:rgba(28,197,190,.08);border:1px solid rgba(28,197,190,.2);border-radius:14px;padding:20px;margin-bottom:14px;text-align:center}
.share-block h2{font-size:20px;font-weight:700;margin-bottom:6px}
.share-block p{font-size:14px;color:#888;margin-bottom:16px}
.share-btn{display:inline-flex;align-items:center;gap:8px;background:#1CC5BE;color:#0a0a0a;border:none;padding:14px 28px;border-radius:10px;font-size:15px;font-weight:700;cursor:pointer;min-height:48px;-webkit-appearance:none}
.share-btn:active{opacity:.8}
.optin-box{background:#111;border:1px solid #222;border-radius:14px;padding:20px;margin-bottom:14px}
.optin-box h3{font-size:15px;font-weight:600;margin-bottom:4px}
.optin-box p{font-size:13px;color:#666;margin-bottom:16px}
.optin-row{display:flex;gap:8px}
.optin-row input{flex:1;background:#1a1a1a;border:1px solid #2a2a2a;color:#f0f0f0;padding:12px 14px;border-radius:8px;font-size:16px;outline:none;-webkit-appearance:none;min-height:48px}
.optin-row input::placeholder{color:#444}
.optin-row input:focus{border-color:#444}
.optin-row button{background:#1CC5BE;color:#0a0a0a;border:none;padding:12px 18px;border-radius:8px;font-size:15px;font-weight:700;cursor:pointer;min-height:48px;-webkit-appearance:none;white-space:nowrap}
.optin-row button:active{opacity:.8}
#optin-done{display:none;margin-top:12px}
footer{text-align:center;padding:24px 20px;padding-bottom:max(24px,env(safe-area-inset-bottom));font-size:12px}
footer a{color:#1CC5BE;text-decoration:none;font-weight:600}
footer span{color:#333}
</style>
</head>
<body>
<header>
  <a href="/activations/${activation.slug}">&larr; All Booths</a>
  <span>/</span>
  <span style="color:#444;font-size:13px">${activation.name}</span>
</header>

<div class="hero">
  ${participant.image_url
    ? `<img src="${participant.image_url}" alt="${participant.name}">`
    : `<div class="hero-placeholder">${participant.name[0]}</div>`}
  <div class="hero-overlay">
    <h1>${participant.name}</h1>
    ${participant.description ? `<p class="desc">${participant.description}</p>` : ''}
    ${participant.instagram_handle ? `<a href="https://instagram.com/${participant.instagram_handle}" target="_blank" rel="noopener noreferrer" style="display:inline-flex;align-items:center;gap:5px;color:rgba(255,255,255,.5);text-decoration:none;font-size:12px;margin-top:8px">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2" width="20" height="20" rx="5" ry="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r="1.5" fill="currentColor" stroke="none"/></svg>
      @${participant.instagram_handle}
    </a>` : ''}
  </div>
</div>

<div class="container">
  <div id="vote-section">
    ${votingClosed ? `
    <div style="background:rgba(28,197,190,.08);border:1px solid rgba(28,197,190,.2);border-radius:14px;padding:24px;text-align:center;margin-bottom:16px">
      <div style="font-size:28px;margin-bottom:8px">🏁</div>
      <p style="font-size:16px;font-weight:700;margin-bottom:6px">Voting is closed</p>
      <p style="font-size:14px;color:#888;margin-bottom:16px">The winner has been announced.</p>
      <a href="/activations/${activation.slug}/winner" style="display:inline-block;background:#1CC5BE;color:#0a0a0a;padding:12px 28px;border-radius:10px;font-size:15px;font-weight:700;text-decoration:none">See the winner</a>
    </div>
    ` : `
    <p class="vote-label">Best Booth Award — cast your vote</p>
    <p id="votes-left-badge" style="display:none;text-align:center;font-size:13px;font-weight:600;color:#1CC5BE;background:rgba(28,197,190,.08);border:1px solid rgba(28,197,190,.2);border-radius:20px;padding:7px 16px;margin:0 auto 16px;width:fit-content"></p>
    <div class="vote-buttons">
      <button class="vote-btn-primary" onclick="castVote('rules')">
        🔥 This Booth Rules!
        <span style="display:block;font-size:12px;font-weight:500;opacity:.7;margin-top:3px">My top pick — give it the gold</span>
      </button>
      <button class="vote-btn-secondary" onclick="castVote('hell_yeah')">
        🤘 Hell Yeah
        <span style="display:block;font-size:12px;font-weight:400;opacity:.6;margin-top:3px">Solid booth, I liked it</span>
      </button>
      <button class="vote-btn-secondary" onclick="castVote('no_thanks')">
        😬 Not My Vibe
        <span style="display:block;font-size:12px;font-weight:400;opacity:.6;margin-top:3px">Not for me — doesn't use one of your votes</span>
      </button>
    </div>
    <p class="vote-hint">Top booth wins 2 concert tickets.</p>
    <div id="duplicate-msg">You already voted for this booth.</div>
    <div id="out-of-votes-msg" style="display:none;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.1);border-radius:12px;padding:16px;text-align:center;font-size:14px;color:#ccc;margin-top:12px">That's all 5 of your votes. You can still browse booths — winner announced when voting closes.</div>
    `}
  </div>

  <div id="thank-you">
    <a id="next-booth-btn" href="/activations/${activation.slug}" style="display:flex;align-items:center;justify-content:center;gap:8px;background:#1CC5BE;color:#0a0a0a;border:none;border-radius:14px;padding:17px;font-size:17px;font-weight:700;text-decoration:none;margin-bottom:10px;min-height:54px">
      Next booth <span style="font-size:20px">→</span>
    </a>

    <div class="share-block">
      <h2 id="thanks-headline">Vote counted.</h2>
      <p id="thanks-sub">Help ${participant.name} win — share this page.</p>
      <button class="share-btn" onclick="shareVote()">Share this booth</button>
    </div>

    <div class="optin-box">
      <h3>Get 3 SF shows every Friday by email.</h3>
      <p>Every Friday we send 3 concerts worth going to this week — straight to your inbox. Free.</p>
      <div class="optin-row">
        <input type="email" id="email-input" placeholder="Your email" inputmode="email" autocapitalize="none">
        <button onclick="submitOptin()">I'm in</button>
      </div>
      <div id="optin-done">
        <p style="font-size:14px;color:#1CC5BE;font-weight:700">You're on The Line.</p>
        <p style="font-size:13px;color:#555;margin-top:4px">First drop hits Friday. See you there.</p>
      </div>
    </div>
  </div>
</div>

<footer>
  <a href="https://instagram.com/silverglidertix" target="_blank" rel="noopener noreferrer" style="display:inline-block;color:#666;text-decoration:none">
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2" width="20" height="20" rx="5" ry="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r="1.5" fill="currentColor" stroke="none"/></svg>
  </a>
  <div style="margin-top:10px;color:#666;font-size:12px;font-weight:500">Powered by Silver Glider</div>
</footer>
<script>
var SLUG_LIST = ${slugList};
var ACTIVATION_SLUG = '${activation.slug}';
var THIS_SLUG = '${participant.slug}';
var VOTED_KEY = 'sg_voted_' + ACTIVATION_SLUG;

function getFingerprint() {
  let fp = localStorage.getItem('sg_fp');
  if (!fp) {
    fp = Math.random().toString(36).slice(2) + Date.now().toString(36);
    localStorage.setItem('sg_fp', fp);
  }
  return fp;
}

function markVisited() {
  var voted = JSON.parse(localStorage.getItem(VOTED_KEY) || '[]');
  if (!voted.includes(THIS_SLUG)) {
    voted.push(THIS_SLUG);
    localStorage.setItem(VOTED_KEY, JSON.stringify(voted));
  }
}

function getNextBooth() {
  var voted = JSON.parse(localStorage.getItem(VOTED_KEY) || '[]');
  var idx = SLUG_LIST.indexOf(THIS_SLUG);
  for (var i = 1; i <= SLUG_LIST.length; i++) {
    var next = SLUG_LIST[(idx + i) % SLUG_LIST.length];
    if (!voted.includes(next)) return next;
  }
  return null;
}

function updateNextBtn() {
  var next = getNextBooth();
  var btn = document.getElementById('next-booth-btn');
  if (next) {
    btn.href = '/activations/' + ACTIVATION_SLUG + '/' + next;
    btn.style.display = 'flex';
  } else {
    btn.href = '/activations/' + ACTIVATION_SLUG;
    btn.innerHTML = 'See all booths <span style="color:#1CC5BE;font-size:18px">→</span>';
    btn.style.display = 'flex';
  }
}

function showVotesLeftBadge(left, max) {
  var badge = document.getElementById('votes-left-badge');
  if (!badge) return;
  badge.style.display = 'block';
  if (left <= 0) {
    badge.textContent = 'All ' + max + ' votes used';
    badge.style.color = '#888';
    badge.style.background = 'rgba(255,255,255,.04)';
    badge.style.borderColor = 'rgba(255,255,255,.1)';
  } else {
    badge.textContent = 'You have ' + left + ' of ' + max + ' votes left';
  }
}

async function loadVotesLeft() {
  try {
    var res = await fetch('/activations/' + ACTIVATION_SLUG + '/votes-left?fp=' + encodeURIComponent(getFingerprint()));
    var data = await res.json();
    showVotesLeftBadge(data.votesLeft, data.maxVotes);
  } catch (e) {}
}
loadVotesLeft();

async function castVote(vote) {
  const fp = getFingerprint();
  const res = await fetch(window.location.pathname + '/vote', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ vote, fingerprint: fp })
  });
  const data = await res.json();
  if (data.outOfVotes) {
    showVotesLeftBadge(0, data.maxVotes || 5);
    document.getElementById('out-of-votes-msg').style.display = 'block';
    return;
  }
  if (data.duplicate) {
    markVisited();
    updateNextBtn();
    document.getElementById('vote-section').style.display = 'none';
    document.getElementById('thank-you').style.display = 'block';
    document.getElementById('duplicate-msg').style.display = 'block';
    return;
  }
  markVisited();
  updateNextBtn();
  var headline = document.getElementById('thanks-headline');
  var sub = document.getElementById('thanks-sub');
  if (typeof data.votesLeft === 'number') {
    if (vote === 'no_thanks') {
      headline.textContent = 'Noted.';
      sub.textContent = "Didn't use one of your votes — " + data.votesLeft + ' of ' + data.maxVotes + ' left.';
    } else if (data.votesLeft <= 0) {
      headline.textContent = "That's all " + data.maxVotes + ' votes.';
      sub.textContent = 'Winner announced when voting closes. Help ${participant.name} win — share this page.';
    } else {
      headline.textContent = 'Vote counted — ' + data.votesLeft + ' left.';
      sub.textContent = 'Spend them well. Help ${participant.name} win — share this page.';
    }
  }
  document.getElementById('vote-section').style.display = 'none';
  document.getElementById('thank-you').style.display = 'block';
}

function shareVote() {
  const url = window.location.href;
  if (navigator.share) {
    navigator.share({ title: '${participant.name} — Best Booth Award', text: 'Vote for ${participant.name} at ${activation.name}', url });
  } else {
    navigator.clipboard.writeText(url);
    const btn = document.querySelector('.share-btn');
    btn.textContent = 'Link copied!';
    setTimeout(() => { btn.innerHTML = 'Share this booth'; }, 2000);
  }
}

async function submitOptin() {
  const email = document.getElementById('email-input').value.trim();
  if (!email) return;
  await fetch(window.location.pathname + '/optin', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email })
  });
  document.getElementById('optin-done').style.display = 'block';
  document.getElementById('email-input').disabled = true;
}

const fp = getFingerprint();
</script>
</body>
</html>`;
}

function renderWinnerPage(activation, winner) {
  const winnerUrl = `${process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : ''}/activations/${activation.slug}/winner`;
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0,viewport-fit=cover">
<meta name="theme-color" content="#0a0a0a">
<title>🏆 ${winner ? winner.name : 'Winner'} — ${activation.name}</title>
<style>
*{box-sizing:border-box;margin:0;padding:0;-webkit-tap-highlight-color:transparent}
body{background:#0a0a0a url('/winner-bg.jpg') center/cover fixed;color:#f0f0f0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:24px;padding-top:max(24px,env(safe-area-inset-top))}
body::before{content:'';position:fixed;inset:0;background:rgba(0,0,0,.75);z-index:0}
.confetti,.event-label,h1,.winner-card,footer{position:relative;z-index:1}
.confetti{font-size:40px;margin-bottom:16px;text-align:center;letter-spacing:8px}
.event-label{font-size:11px;color:#555;text-transform:uppercase;letter-spacing:.1em;text-align:center;margin-bottom:8px}
h1{font-size:15px;font-weight:600;color:#666;text-align:center;margin-bottom:32px}
.winner-card{width:100%;max-width:400px;background:#111;border:1px solid rgba(28,197,190,.3);border-radius:20px;overflow:hidden;margin-bottom:24px}
.winner-img{width:100%;aspect-ratio:1/1;object-fit:cover;display:block}
.winner-placeholder{width:100%;aspect-ratio:1/1;background:#1a1a1a;display:flex;align-items:center;justify-content:center;font-size:100px;font-weight:700;color:#222}
.winner-body{padding:24px;text-align:center}
.crown{font-size:36px;margin-bottom:8px}
.winner-name{font-size:28px;font-weight:800;margin-bottom:6px;color:#f0f0f0}
.winner-desc{font-size:14px;color:#666;margin-bottom:16px}
.vote-count{font-size:13px;color:#1CC5BE;font-weight:600}
.share-btn{display:inline-flex;align-items:center;gap:8px;background:#1CC5BE;color:#0a0a0a;border:none;padding:14px 32px;border-radius:12px;font-size:15px;font-weight:700;cursor:pointer;width:100%;justify-content:center;margin-top:20px;-webkit-appearance:none}
.share-btn:active{opacity:.85}
footer{font-size:12px;color:#888;padding:20px;text-align:center;font-weight:500}
</style>
</head>
<body>
<div class="confetti">🎉🏆🎉</div>
<p class="event-label">${activation.name}</p>
<h1>Best Booth Award Winner</h1>

${winner ? `
<div class="winner-card">
  ${winner.image_url
    ? `<img class="winner-img" src="${winner.image_url}" alt="${winner.name}">`
    : `<div class="winner-placeholder">${winner.name[0]}</div>`}
  <div class="winner-body">
    <div class="crown">🏆</div>
    <div class="winner-name">${winner.name}</div>
    ${winner.description ? `<p class="winner-desc">${winner.description}</p>` : ''}
    <p class="vote-count">${winner.total} votes</p>
    ${winner.instagram_handle ? `<a href="https://instagram.com/${winner.instagram_handle}" target="_blank" rel="noopener noreferrer" style="display:inline-flex;align-items:center;gap:6px;color:#555;text-decoration:none;font-size:13px;margin-top:10px">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2" width="20" height="20" rx="5" ry="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r="1.5" fill="currentColor" stroke="none"/></svg>
      @${winner.instagram_handle}
    </a>` : ''}
    <button class="share-btn" onclick="shareWinner()">Share the winner</button>
  </div>
</div>
` : `<p style="color:#555;text-align:center">No winner yet — check back soon.</p>`}

<div style="width:100%;max-width:400px;background:#111;border:1px solid #1a1a1a;border-radius:16px;padding:20px;margin-bottom:24px;position:relative;z-index:1">
  <h3 style="font-size:15px;font-weight:600;margin-bottom:4px">Get 3 SF shows every Friday by email.</h3>
  <p style="font-size:13px;color:#666;margin-bottom:16px">Every Friday we send 3 concerts worth going to this week — straight to your inbox. Free.</p>
  <div style="display:flex;gap:8px">
    <input type="email" id="winner-email" placeholder="Your email" inputmode="email" autocapitalize="none" style="flex:1;background:#1a1a1a;border:1px solid #2a2a2a;color:#f0f0f0;padding:12px 14px;border-radius:8px;font-size:16px;outline:none;-webkit-appearance:none;min-height:48px">
    <button onclick="submitWinnerOptin()" style="background:#1CC5BE;color:#0a0a0a;border:none;padding:12px 18px;border-radius:8px;font-size:15px;font-weight:700;cursor:pointer;min-height:48px;-webkit-appearance:none;white-space:nowrap">I'm in</button>
  </div>
  <div id="winner-optin-done" style="display:none;margin-top:12px">
    <p style="font-size:14px;color:#1CC5BE;font-weight:700">You're on The Line.</p>
    <p style="font-size:13px;color:#555;margin-top:4px">First drop hits Friday. See you there.</p>
  </div>
</div>

<footer style="text-align:center;padding:20px">
  <a href="/" style="display:inline-flex;align-items:center;gap:7px;text-decoration:none;opacity:.4">
    <img src="/logo.png" alt="" style="width:18px;height:18px;object-fit:contain;filter:grayscale(1)">
    <span style="font-size:10px;font-weight:600;color:#fff;letter-spacing:.1em;text-transform:uppercase">Silver Glider</span>
  </a>
</footer>
<script>
function shareWinner() {
  const url = '${winnerUrl}';
  if (navigator.share) {
    navigator.share({ title: '🏆 ${winner ? winner.name : ''} wins ${activation.name}!', url });
  } else {
    navigator.clipboard.writeText(url);
    const btn = document.querySelector('.share-btn');
    btn.textContent = 'Link copied!';
    setTimeout(() => btn.textContent = 'Share the winner', 2000);
  }
}
async function submitWinnerOptin() {
  const email = document.getElementById('winner-email').value.trim();
  if (!email) return;
  await fetch('/activations/${activation.slug}/${winner ? winner.slug : 'winner'}/optin', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email })
  });
  document.getElementById('winner-optin-done').style.display = 'block';
  document.getElementById('winner-email').disabled = true;
}
</script>
</body>
</html>`;
}

function renderMasterQRPage(activation, landingUrl, qrDataUrl) {
  const qrUrl = qrDataUrl;
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0,viewport-fit=cover">
<meta name="theme-color" content="#0a0a0a">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<title>${activation.name} — Master QR</title>
<style>
*{box-sizing:border-box;margin:0;padding:0;-webkit-tap-highlight-color:transparent}
body{background:#0a0a0a;color:#f0f0f0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;min-height:100vh;display:flex;flex-direction:column;align-items:center;-webkit-text-size-adjust:100%}
header{width:100%;max-width:480px;padding:max(16px,env(safe-area-inset-top)) max(20px,env(safe-area-inset-right)) 16px max(20px,env(safe-area-inset-left))}
header a{color:#555;text-decoration:none;font-size:13px;min-height:44px;display:inline-flex;align-items:center}
.card{width:100%;max-width:420px;margin:8px 16px max(32px,calc(env(safe-area-inset-bottom)+16px));background:#111;border:1px solid #1a1a1a;border-radius:20px;padding:32px;text-align:center}
.event-label{font-size:11px;color:#555;text-transform:uppercase;letter-spacing:.1em;margin-bottom:12px}
h1{font-size:24px;font-weight:700;margin-bottom:6px}
.sub{font-size:14px;color:#555;margin-bottom:32px}
.qr-section{background:#f5f0eb;border-radius:16px;padding:28px;margin-bottom:24px}
.qr-section img{width:220px;height:220px;display:block;margin:0 auto 16px}
.qr-label{font-size:14px;color:#1a1a1a;font-weight:700;margin-bottom:4px}
.qr-sub{font-size:12px;color:#888}
.url{font-size:11px;color:#444;font-family:monospace;margin-top:16px;word-break:break-all}
.print-btn{display:flex;align-items:center;justify-content:center;gap:8px;width:100%;background:#1CC5BE;color:#0a0a0a;border:none;padding:15px;border-radius:12px;font-size:15px;font-weight:700;cursor:pointer}
.print-btn:active{opacity:.85}
footer{font-size:11px;color:#2a2a2a;padding:20px}
@media print{
  header,.print-btn{display:none}
  body{background:#f5f0eb;color:#0a0a0a}
  .card{border:none;background:transparent;max-width:100%}
  h1{color:#0a0a0a}
  .sub,.event-label{color:#555}
  .qr-section{background:#fff;border:1px solid #ddd}
  .qr-section img{width:260px;height:260px}
  footer{color:#aaa}
}
</style>
</head>
<body>
<header><a href="/activations/admin/activations">&larr; Back to admin</a></header>
<div class="card">
  <p class="event-label">Master QR Code</p>
  <h1>${activation.name}</h1>
  <p class="sub">Place at entrance — scan to see all booths and vote</p>
  <div class="qr-section">
    <img src="${qrUrl}" alt="QR code for ${activation.name}">
    <p class="qr-label">Vote for Best Booth</p>
    <p class="qr-sub">Scan to see all booths competing</p>
  </div>
  <p class="url">${landingUrl}</p>
  <button class="print-btn" id="qr-action-btn" style="margin-top:20px" onclick="handleQRAction()">
    <span id="qr-action-icon"></span>
    <span id="qr-action-label">Print this page</span>
  </button>
</div>
<footer style="text-align:center;padding:20px max(20px,env(safe-area-inset-right)) max(24px,calc(env(safe-area-inset-bottom)+12px)) max(20px,env(safe-area-inset-left))">
  <a href="/" style="display:inline-flex;align-items:center;gap:7px;text-decoration:none;opacity:.4">
    <img src="/logo.png" alt="" style="width:18px;height:18px;object-fit:contain;filter:grayscale(1)">
    <span style="font-size:10px;font-weight:600;color:#fff;letter-spacing:.1em;text-transform:uppercase">Silver Glider</span>
  </a>
</footer>
<script>
(function(){
  var isMobile=/Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent)||window.innerWidth<600;
  var icon=document.getElementById('qr-action-icon');
  var label=document.getElementById('qr-action-label');
  if(isMobile&&navigator.share){
    icon.innerHTML='<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>';
    label.textContent='Share voting link';
  } else {
    icon.innerHTML='<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>';
    label.textContent='Print this page';
  }
  window.handleQRAction=function(){
    if(isMobile&&navigator.share){
      navigator.share({title:'${activation.name} — Vote for Best Booth',url:'${landingUrl}'}).catch(function(){});
    } else {
      window.print();
    }
  };
})();
</script>
</body>
</html>`;
}

function renderProfilePage(activation, participant, voteUrl, qrDataUrl) {
  const qrUrl = qrDataUrl;
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0,viewport-fit=cover">
<meta name="theme-color" content="#0a0a0a">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<title>${participant.name} — Booth Profile</title>
<style>
*{box-sizing:border-box;margin:0;padding:0;-webkit-tap-highlight-color:transparent}
body{background:#0a0a0a url('/profile-bg.jpg') center/cover fixed;color:#f0f0f0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;min-height:100vh;display:flex;flex-direction:column;align-items:center;-webkit-text-size-adjust:100%}
body::before{content:'';position:fixed;inset:0;background:rgba(0,0,0,.78);z-index:0}
header,div,footer{position:relative;z-index:1}
header{width:100%;max-width:480px;padding:max(16px,env(safe-area-inset-top)) 20px 16px;display:flex;align-items:center;gap:10px}
header a{color:#555;text-decoration:none;font-size:13px;min-height:44px;display:flex;align-items:center}
header span{color:#2a2a2a}
.card{width:100%;max-width:420px;margin:8px 16px 32px;background:#111;border:1px solid #1a1a1a;border-radius:20px;overflow:hidden}
@media(min-width:460px){.card{margin:16px auto 32px}}
.booth-img{width:100%;aspect-ratio:1/1;object-fit:cover;display:block}
.booth-placeholder{width:100%;aspect-ratio:1/1;background:#1a1a1a;display:flex;align-items:center;justify-content:center;font-size:100px;font-weight:700;color:#222}
.card-body{padding:24px}
.activation-label{font-size:11px;color:#555;text-transform:uppercase;letter-spacing:.08em;margin-bottom:8px}
h1{font-size:26px;font-weight:700;margin-bottom:8px}
.desc{font-size:15px;color:#888;margin-bottom:28px;line-height:1.5}
.qr-section{background:#f5f0eb;border-radius:14px;padding:24px;text-align:center}
.qr-section img{width:200px;height:200px;display:block;margin:0 auto 16px}
.qr-label{font-size:13px;color:#2a2020;font-weight:600;margin-bottom:4px}
.qr-sub{font-size:11px;color:#888;margin-bottom:16px}
.vote-link{display:inline-block;font-size:11px;color:#555;font-family:monospace;word-break:break-all}
.print-btn{display:flex;align-items:center;justify-content:center;gap:8px;width:100%;background:#1CC5BE;color:#0a0a0a;border:none;padding:15px;border-radius:12px;font-size:15px;font-weight:700;cursor:pointer;margin-top:20px}
.print-btn:active{opacity:.85}
footer{font-size:11px;color:#2a2a2a;padding:20px;text-align:center}
@media print{
  header,.print-btn,.vendor-banner{display:none}
  body{background:#f5f0eb;color:#0a0a0a}
  .card{border:none;box-shadow:none;max-width:100%}
  .card-body{padding:16px}
  .activation-label{color:#555}
  h1{color:#0a0a0a}
  .desc{color:#444}
  .qr-section{background:#fff;border:1px solid #ddd}
  .qr-section img{width:240px;height:240px}
  footer{color:#aaa}
}
</style>
</head>
<body>
<header>
  <a href="/activations/${activation.slug}/${participant.slug}">&larr; Back to voting</a>
</header>

<div class="vendor-banner" style="position:relative;z-index:1;width:100%;max-width:420px;margin:0 16px 12px;background:rgba(28,197,190,.08);border:1px solid rgba(28,197,190,.2);border-radius:10px;padding:10px 14px;display:flex;align-items:center;gap:10px">
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#1CC5BE" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
  <p style="font-size:12px;color:#1CC5BE;font-weight:600;line-height:1.4">This page is for vendors. Print or save your QR code to display at your booth.</p>
</div>

<div class="card">
  ${participant.image_url
    ? `<img class="booth-img" src="${participant.image_url}" alt="${participant.name}">`
    : `<div class="booth-placeholder">${participant.name[0]}</div>`}
  <div class="card-body">
    <p class="activation-label">${activation.name}</p>
    <h1>${participant.name}</h1>
    ${participant.description ? `<p class="desc">${participant.description}</p>` : ''}

    <div class="qr-section">
      <img src="${qrUrl}" alt="QR code to vote for ${participant.name}">
      <p class="qr-label">Scan to vote for this booth</p>
      <p class="qr-sub">Best Booth Award — top booth wins 2 concert tickets</p>
      <span class="vote-link">${voteUrl}</span>
    </div>

    <button class="print-btn" id="action-btn" onclick="handleAction()">
      <span id="action-icon"></span>
      <span id="action-label">Print this page</span>
    </button>
  </div>
</div>
<script>
(function(){
  var isMobile = /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || window.innerWidth < 600;
  var btn = document.getElementById('action-btn');
  var icon = document.getElementById('action-icon');
  var label = document.getElementById('action-label');
  if (isMobile && navigator.share) {
    icon.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>';
    label.textContent = 'Share this booth';
  } else if (isMobile) {
    icon.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>';
    label.textContent = 'Save QR code';
  } else {
    icon.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>';
    label.textContent = 'Print this page';
  }
  window.handleAction = function() {
    if (isMobile && navigator.share) {
      navigator.share({ title: '${participant.name} — Vote for Best Booth', url: '${voteUrl}' }).catch(function(){});
    } else if (isMobile) {
      var a = document.createElement('a');
      a.href = document.querySelector('.qr-section img').src;
      a.download = '${participant.slug}-qr.png';
      a.click();
    } else {
      window.print();
    }
  };
})();
</script>

<footer style="text-align:center;padding:24px 20px">
  <a href="https://instagram.com/silverglidertix" target="_blank" rel="noopener noreferrer" style="display:inline-block;color:#666;text-decoration:none">
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2" width="20" height="20" rx="5" ry="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r="1.5" fill="currentColor" stroke="none"/></svg>
  </a>
  <a href="/" style="display:inline-flex;align-items:center;gap:7px;text-decoration:none;opacity:.4;margin-top:10px">
    <img src="/logo.png" alt="" style="width:18px;height:18px;object-fit:contain;filter:grayscale(1)">
    <span style="font-size:10px;font-weight:600;color:#fff;letter-spacing:.1em;text-transform:uppercase">Silver Glider</span>
  </a>
</footer>
</body>
</html>`;
}

module.exports = router;
