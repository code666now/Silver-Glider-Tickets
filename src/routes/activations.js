const express = require('express');
const router = express.Router();
const db = require('../db/activationsDB');
const { requireActivationsAdmin } = require('../middleware/auth');
const jwt = require('jsonwebtoken');
const path = require('path');
const multer = require('multer');
const { uploadImage } = require('../lib/cloudinary');
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

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

router.post('/admin/activations/:id/participants', requireActivationsAdmin, async (req, res) => {
  try {
    const { name, slug, description, image_url } = req.body;
    const participant = await db.createParticipant({
      activation_id: req.params.id,
      name, slug: slug.toLowerCase().replace(/\s+/g, '-'),
      description, image_url
    });
    res.json(participant);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/admin/activations/participants/:id', requireActivationsAdmin, async (req, res) => {
  try {
    const { name, slug, description, image_url } = req.body;
    const participant = await db.updateParticipant(req.params.id, { name, slug, description, image_url });
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
    const { name, description, contact_email, contact_phone } = req.body;
    if (!name) return res.status(400).json({ error: 'Name required' });
    let image_url = null;
    if (req.file) {
      const result = await uploadImage(req.file.buffer);
      image_url = result.secure_url;
    }
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const participant = await db.createParticipant({
      activation_id: activation.id, name, slug, description, image_url,
      status: 'pending', contact_email, contact_phone
    });
    res.json({ success: true, participant });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:activationSlug', async (req, res) => {
  const activation = await db.getActivationBySlug(req.params.activationSlug);
  if (!activation || !activation.active) return res.status(404).send('Not found');
  const participants = await db.getParticipantsByActivation(activation.id);
  res.send(renderActivationLanding(activation, participants));
});

router.get('/:activationSlug/:participantSlug', async (req, res) => {
  const activation = await db.getActivationBySlug(req.params.activationSlug);
  if (!activation || !activation.active) return res.status(404).send('Not found');
  const participant = await db.getParticipantBySlug(activation.id, req.params.participantSlug);
  if (!participant) return res.status(404).send('Not found');
  res.send(renderVotingPage(activation, participant));
});

router.post('/:activationSlug/:participantSlug/vote', async (req, res) => {
  try {
    const activation = await db.getActivationBySlug(req.params.activationSlug);
    if (!activation) return res.status(404).json({ error: 'Not found' });
    const participant = await db.getParticipantBySlug(activation.id, req.params.participantSlug);
    if (!participant) return res.status(404).json({ error: 'Not found' });
    const { vote, fingerprint } = req.body;
    if (!['rules', 'hell_yeah', 'no_thanks'].includes(vote)) return res.status(400).json({ error: 'Invalid vote' });
    const result = await db.castVote({ participant_id: participant.id, activation_id: activation.id, vote, browser_fingerprint: fingerprint });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/:activationSlug/:participantSlug/optin', async (req, res) => {
  try {
    const activation = await db.getActivationBySlug(req.params.activationSlug);
    if (!activation) return res.status(404).json({ error: 'Not found' });
    const participant = await db.getParticipantBySlug(activation.id, req.params.participantSlug);
    if (!participant) return res.status(404).json({ error: 'Not found' });
    const { phone } = req.body;
    if (!phone) return res.status(400).json({ error: 'Phone required' });
    const optin = await db.createOptin({ activation_id: activation.id, participant_id: participant.id, phone });
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
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>Join ${activation.name}</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{color:#f0f0f0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;min-height:100vh;background:#0a0a0a url('/thrift-bg.jpg') center/cover fixed}
body::before{content:'';position:fixed;inset:0;background:rgba(0,0,0,.82);z-index:0}
header,.container,#success{position:relative;z-index:1}
header{padding:20px 16px;text-align:center;border-bottom:1px solid rgba(255,255,255,.08)}
header h1{font-size:26px;font-weight:700;margin-top:12px}
header .sub{font-size:14px;color:#888;margin-top:6px}
.container{max-width:480px;margin:0 auto;padding:24px 16px 48px}
label{display:block;font-size:11px;color:#555;text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px;margin-top:20px}
input,textarea{width:100%;background:rgba(0,0,0,.45);border:1px solid rgba(255,255,255,.12);color:#f0f0f0;padding:14px;border-radius:10px;font-size:16px;outline:none;font-family:inherit;-webkit-appearance:none;backdrop-filter:blur(4px)}
input:focus,textarea:focus{border-color:#444}
input::placeholder,textarea::placeholder{color:#333}
textarea{resize:vertical;min-height:80px}
.upload-area input[type=file]{position:absolute;inset:0;opacity:0;cursor:pointer;width:100%;height:100%}
.btn{width:100%;background:#1CC5BE;color:#0a0a0a;border:none;padding:18px;border-radius:12px;font-size:17px;font-weight:700;cursor:pointer;margin-top:28px;-webkit-appearance:none}
.btn:disabled{opacity:.5;cursor:not-allowed}
#success{display:none;text-align:center;padding:48px 0}
#success h2{font-size:24px;font-weight:700;margin-bottom:8px}
#success p{font-size:15px;color:#666}
#error-msg{color:#ff4444;font-size:13px;margin-top:10px;text-align:center}
.progress{height:4px;background:#222;border-radius:2px;margin-top:16px;display:none}
.progress-bar{height:100%;background:#1CC5BE;border-radius:2px;width:0%;transition:width .3s}
.sg-logo{display:inline-flex;align-items:center;gap:10px;background:rgba(22,22,22,.9);border:1px solid #2a2a2a;border-radius:40px;padding:8px 18px 8px 10px;text-decoration:none}
.sg-logo img{width:28px;height:28px;object-fit:contain}
.sg-logo-name{display:block;font-size:13px;font-weight:700;color:#fff;letter-spacing:.08em;text-transform:uppercase}
.sg-logo-sub{display:block;font-size:9px;color:#666;letter-spacing:.15em;text-transform:uppercase}
@media(max-width:480px){
  header h1{font-size:22px}
  .container{padding:20px 16px 60px}
}
</style>
</head>
<body>
<header>
  <a href="/" class="sg-logo"><img src="/logo.png" alt="Silver Glider"><div><span class="sg-logo-name">Silver Glider</span><span class="sg-logo-sub">Music Discovery</span></div></a>
  <h1>${activation.name}</h1>
  <p class="sub">Best Booth Award — Register to compete</p>
</header>
<div class="container">
  <div style="background:#111;border:1px solid #1a1a1a;border-radius:12px;padding:20px;margin-bottom:24px">
    <p style="font-size:13px;color:#1CC5BE;font-weight:700;letter-spacing:.08em;text-transform:uppercase;margin-bottom:10px">The Prize</p>
    <div style="display:flex;flex-direction:column;gap:8px">
      <div style="display:flex;align-items:center;gap:12px;font-size:14px">
        <span style="font-size:20px">🥇</span>
        <div><span style="color:#f0f0f0;font-weight:600">1st Place</span> <span style="color:#666">— 2 tickets to The Fox Theatre</span></div>
      </div>
      <div style="display:flex;align-items:center;gap:12px;font-size:14px">
        <span style="font-size:20px">🥈</span>
        <div><span style="color:#f0f0f0;font-weight:600">2nd Place</span> <span style="color:#666">— 2 tickets to The Independent</span></div>
      </div>
      <div style="display:flex;align-items:center;gap:12px;font-size:14px">
        <span style="font-size:20px">🥉</span>
        <div><span style="color:#f0f0f0;font-weight:600">3rd Place</span> <span style="color:#666">— 2 tickets to The Make Out Room</span></div>
      </div>
    </div>
    <p style="font-size:12px;color:#444;margin-top:12px">Festival attendees vote for their favorite booth. Top vote-getter wins. Silver Glider is a music discovery service — we drop concert picks straight to your phone.</p>
  </div>
  <div id="form-view">
    <label>Booth name *</label>
    <input type="text" id="name" placeholder="e.g. Vintage Threads" maxlength="100">

    <label>Description</label>
    <textarea id="description" placeholder="Tell people what makes your booth special..." maxlength="300"></textarea>

    <label>Photo</label>
    <div id="upload-area" style="margin-top:6px">
      <div id="upload-placeholder">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px">
          <label style="all:unset;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;background:#111;border:1px solid #222;border-radius:12px;padding:20px;cursor:pointer;font-size:13px;color:#aaa;text-align:center">
            <span style="font-size:28px">📸</span>
            Take a photo
            <input type="file" accept="image/*" capture="environment" style="display:none" onchange="previewImage(this)">
          </label>
          <label style="all:unset;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;background:#111;border:1px solid #222;border-radius:12px;padding:20px;cursor:pointer;font-size:13px;color:#aaa;text-align:center">
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

    <label>Your email (optional)</label>
    <input type="email" id="contact-email" placeholder="you@example.com">

    <label>Your phone (optional)</label>
    <input type="tel" id="contact-phone" placeholder="+1 (555) 000-0000">

    <div class="progress" id="progress-bar-wrap">
      <div class="progress-bar" id="progress-bar"></div>
    </div>

    <button class="btn" id="submit-btn" onclick="submitForm()">Register My Booth</button>
    <div id="error-msg"></div>
  </div>

  <div id="success">
    <div style="font-size:48px;margin-bottom:16px">🎉</div>
    <h2>You're registered.</h2>
    <p>Your booth is pending review and will appear on the voting page once approved.</p>
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
  const contactPhone = document.getElementById('contact-phone').value.trim();
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
  if (selectedFile) formData.append('image', selectedFile);

  document.getElementById('progress-bar').style.width = '70%';

  try {
    const res = await fetch(window.location.pathname, { method: 'POST', body: formData });
    const data = await res.json();
    document.getElementById('progress-bar').style.width = '100%';
    if (data.error) { errEl.textContent = data.error; btn.disabled = false; btn.textContent = 'Register My Booth'; return; }
    document.getElementById('form-view').style.display = 'none';
    document.getElementById('success').style.display = 'block';
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

function renderActivationLanding(activation, participants) {
  const cards = participants.map(p => `
    <a href="/activations/${activation.slug}/${p.slug}" class="booth-card">
      ${p.image_url
        ? `<div class="booth-img" style="background-image:url('${p.image_url}')"></div>`
        : `<div class="booth-img booth-img-placeholder"><span>${p.name[0]}</span></div>`}
      <div class="booth-body">
        <div class="booth-meta">
          <h3>${p.name}</h3>
          ${p.description ? `<p>${p.description}</p>` : ''}
        </div>
        <div class="vote-btn-wrap">
          <span class="vote-btn">Vote</span>
        </div>
      </div>
    </a>
  `).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>${activation.name}</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{background:#0a0a0a;color:#f0f0f0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;min-height:100vh}
header{padding:20px 16px 16px;text-align:center;border-bottom:1px solid #1a1a1a}
header h1{font-size:26px;font-weight:800;margin-top:12px;letter-spacing:-.02em}
header .tagline{font-size:13px;color:#555;margin-top:6px}
.sg-logo{display:inline-flex;align-items:center;gap:10px;background:#161616;border:1px solid #2a2a2a;border-radius:40px;padding:8px 18px 8px 10px;text-decoration:none}
.sg-logo img{width:28px;height:28px;object-fit:contain}
.sg-logo-name{display:block;font-size:13px;font-weight:700;color:#fff;letter-spacing:.08em;text-transform:uppercase}
.sg-logo-sub{display:block;font-size:9px;color:#1CC5BE;letter-spacing:.15em;text-transform:uppercase}
.stats-bar{display:flex;align-items:center;justify-content:center;gap:6px;margin-top:10px;font-size:12px;color:#555}
.stats-bar span{color:#1CC5BE;font-weight:700}
.prize-card{margin:16px 16px 0;background:#111;border:1px solid #1a1a1a;border-radius:14px;padding:16px 20px}
.prize-label{font-size:11px;color:#1CC5BE;font-weight:700;letter-spacing:.1em;text-transform:uppercase;margin-bottom:12px}
.prize-row{display:flex;align-items:center;gap:12px;padding:6px 0;font-size:14px}
.prize-row:not(:last-child){border-bottom:1px solid #1a1a1a}
.prize-venue{color:#f0f0f0;font-weight:600}
.prize-desc{color:#555;font-size:12px}
.container{max-width:600px;margin:0 auto;padding:16px}
.booth-card{display:block;background:#111;border:1px solid #1a1a1a;border-radius:16px;margin-bottom:14px;text-decoration:none;color:inherit;overflow:hidden;transition:border-color .2s,transform .1s}
.booth-card:active{transform:scale(.98)}
.booth-img{width:100%;height:200px;background-size:cover;background-position:center;background-color:#1a1a1a}
.booth-img-placeholder{display:flex;align-items:center;justify-content:center}
.booth-img-placeholder span{font-size:64px;font-weight:800;color:#333}
.booth-body{display:flex;align-items:center;justify-content:space-between;padding:14px 16px;gap:12px}
.booth-meta h3{font-size:17px;font-weight:700;margin-bottom:3px}
.booth-meta p{font-size:13px;color:#666;line-height:1.4}
.vote-btn-wrap{flex-shrink:0}
.vote-btn{display:inline-block;background:#1CC5BE;color:#0a0a0a;font-size:14px;font-weight:700;padding:10px 20px;border-radius:8px;white-space:nowrap}
.empty{color:#444;text-align:center;padding:60px 0;font-size:15px}
footer{text-align:center;padding:32px;font-size:12px;color:#333;border-top:1px solid #1a1a1a;margin-top:8px}
@media(max-width:480px){
  .booth-img{height:180px}
  header h1{font-size:22px}
}
</style>
</head>
<body>
<header>
  <a href="/" class="sg-logo"><img src="/logo.png" alt="Silver Glider"><div class="sg-logo-text"><span class="sg-logo-name">Silver Glider</span><span class="sg-logo-sub">Music Discovery</span></div></a>
  <h1>${activation.name}</h1>
  <div class="stats-bar"><span>${participants.length}</span> booth${participants.length !== 1 ? 's' : ''} competing — tap one to vote</div>
</header>

<div class="prize-card">
  <p class="prize-label">Best Booth Award — Prizes</p>
  <div class="prize-row"><span>🥇</span><div><div class="prize-venue">The Fox Theatre</div><div class="prize-desc">1st place — 2 concert tickets</div></div></div>
  <div class="prize-row"><span>🥈</span><div><div class="prize-venue">The Independent</div><div class="prize-desc">2nd place — 2 concert tickets</div></div></div>
  <div class="prize-row"><span>🥉</span><div><div class="prize-venue">The Make Out Room</div><div class="prize-desc">3rd place — 2 concert tickets</div></div></div>
</div>

<div class="container">
  ${cards || '<p class="empty">No booths yet.</p>'}
</div>
<footer>Powered by Silver Glider</footer>
</body>
</html>`;
}

function renderVotingPage(activation, participant) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>${participant.name} — ${activation.name}</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{color:#f0f0f0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;min-height:100vh;background:#0a0a0a url('/voting-bg.jpg') center/cover fixed}
body::before{content:'';position:fixed;inset:0;background:rgba(0,0,0,.82);z-index:0}
header,.container,footer{position:relative;z-index:1}
header{padding:16px 24px;border-bottom:1px solid rgba(255,255,255,.08);display:flex;align-items:center;gap:12px}
header a{color:#555;text-decoration:none;font-size:13px}
header span{color:#333}
.container{max-width:480px;margin:0 auto;padding:32px 24px;text-align:center}
.participant-img{width:120px;height:120px;border-radius:16px;object-fit:cover;margin:0 auto 20px}
.placeholder-img{width:120px;height:120px;border-radius:16px;background:#1a1a1a;display:flex;align-items:center;justify-content:center;font-size:48px;font-weight:700;color:#333;margin:0 auto 20px}
h1{font-size:24px;font-weight:700;margin-bottom:8px}
.desc{font-size:15px;color:#666;margin-bottom:32px}
.question{font-size:13px;color:#555;letter-spacing:.05em;text-transform:uppercase;margin-bottom:16px}
.vote-buttons{display:flex;flex-direction:column;gap:12px;margin-bottom:32px}
.vote-btn{background:#111;border:1px solid #222;color:#f0f0f0;padding:16px;border-radius:12px;font-size:18px;cursor:pointer;transition:border-color .2s,background .2s;width:100%}
.vote-btn:hover{border-color:#444;background:#1a1a1a}
.vote-btn.selected{border-color:#1CC5BE;background:#1a1a1a}
#thank-you{display:none;padding:32px 0}
#thank-you h2{font-size:22px;font-weight:700;margin-bottom:8px}
#thank-you p{font-size:15px;color:#666;margin-bottom:32px}
.optin-box{background:#111;border:1px solid #222;border-radius:12px;padding:24px;text-align:left}
.optin-box h3{font-size:15px;font-weight:600;margin-bottom:4px}
.optin-box p{font-size:13px;color:#666;margin-bottom:16px}
.optin-row{display:flex;gap:8px}
.optin-row input{flex:1;background:#1a1a1a;border:1px solid #2a2a2a;color:#f0f0f0;padding:12px 14px;border-radius:8px;font-size:15px;outline:none}
.optin-row input::placeholder{color:#444}
.optin-row input:focus{border-color:#444}
.optin-row button{background:#1CC5BE;color:#0a0a0a;border:none;padding:12px 20px;border-radius:8px;font-size:15px;font-weight:600;cursor:pointer}
#optin-done{display:none;font-size:13px;color:#4caf50;margin-top:8px}
#duplicate-msg{display:none;font-size:13px;color:#888;margin-top:8px}
footer{text-align:center;padding:32px;font-size:12px;color:#333}
</style>
</head>
<body>
<header>
  <a href="/activations/${activation.slug}">&larr; Back</a>
  <span>/</span>
  <span style="color:#666;font-size:13px">${activation.name}</span>
</header>
<div class="container">
  ${participant.image_url
    ? `<img class="participant-img" src="${participant.image_url}" alt="${participant.name}">`
    : `<div class="placeholder-img">${participant.name[0]}</div>`}
  <h1>${participant.name}</h1>
  ${participant.description ? `<p class="desc">${participant.description}</p>` : ''}

  <div id="vote-section">
    <p class="question">Best Booth Award — cast your vote</p>
    <p style="font-size:12px;color:#444;margin-bottom:20px;margin-top:-8px">Top booth wins 2 concert tickets. Powered by Silver Glider.</p>
    <div class="vote-buttons">
      <button class="vote-btn" onclick="castVote('rules')">🔥 This Booth Rules!</button>
      <button class="vote-btn" onclick="castVote('hell_yeah')">🤘 Hell Yeah</button>
      <button class="vote-btn" onclick="castVote('no_thanks')">👎 No Thanks</button>
    </div>
    <div id="duplicate-msg">You already voted for this booth.</div>
  </div>

  <div id="thank-you">
    <h2>Vote counted.</h2>
    <p style="font-size:15px;color:#666;margin-bottom:28px">Thanks for sharing your take.</p>
    <div class="optin-box">
      <h3>Get 3 SF shows every Friday by text.</h3>
      <p>Silver Glider is a music discovery service. Every Friday we send 3 concerts worth going to this week — straight to your phone. Free.</p>
      <div class="optin-row">
        <input type="tel" id="phone-input" placeholder="Your phone number">
        <button onclick="submitOptin()">Join</button>
      </div>
      <div id="optin-done" style="display:none">
        <p style="font-size:14px;color:#1CC5BE;font-weight:700;margin-top:12px">You're on The Line.</p>
        <p style="font-size:13px;color:#555;margin-top:4px">First drop hits Friday. See you there.</p>
      </div>
    </div>
    <div id="instagram-follow" style="margin-top:20px;text-align:center">
      <a href="https://instagram.com/silverglidertix" target="_blank" rel="noopener noreferrer" style="display:inline-flex;align-items:center;gap:8px;color:#555;font-size:13px;text-decoration:none;border:1px solid #222;border-radius:8px;padding:10px 16px;transition:border-color .2s" onmouseover="this.style.borderColor='#444'" onmouseout="this.style.borderColor='#222'">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2" width="20" height="20" rx="5" ry="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r="1.5" fill="currentColor" stroke="none"/></svg>
        @silverglidertix
      </a>
    </div>
  </div>
</div>
<footer>Powered by Silver Glider</footer>
<script>
function getFingerprint() {
  let fp = localStorage.getItem('sg_fp');
  if (!fp) {
    fp = Math.random().toString(36).slice(2) + Date.now().toString(36);
    localStorage.setItem('sg_fp', fp);
  }
  return fp;
}

async function castVote(vote) {
  const fp = getFingerprint();
  const res = await fetch(window.location.pathname + '/vote', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ vote, fingerprint: fp })
  });
  const data = await res.json();
  if (data.duplicate) {
    document.getElementById('duplicate-msg').style.display = 'block';
    return;
  }
  document.getElementById('vote-section').style.display = 'none';
  document.getElementById('thank-you').style.display = 'block';
}

async function submitOptin() {
  const phone = document.getElementById('phone-input').value.trim();
  if (!phone) return;
  await fetch(window.location.pathname + '/optin', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone })
  });
  document.getElementById('optin-done').style.display = 'block';
  document.getElementById('phone-input').disabled = true;
}

const fp = getFingerprint();
</script>
</body>
</html>`;
}

module.exports = router;
