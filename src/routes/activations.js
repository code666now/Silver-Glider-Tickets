const express = require('express');
const router = express.Router();
const db = require('../db/activationsDB');
const { requireAuth, requireRole } = require('../middleware/auth');
const path = require('path');
const multer = require('multer');
const { uploadImage } = require('../lib/cloudinary');
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

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

router.get('/admin/activations', requireAuth, requireRole('admin'), async (req, res) => {
  res.sendFile(path.resolve(__dirname, '../views/activations-admin.html'));
});

router.get('/admin/activations/data', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const activations = await db.getAllActivations();
    res.json(activations);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/admin/activations/create', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const { name, slug, description } = req.body;
    const activation = await db.createActivation({ name, slug: slug.toLowerCase().replace(/\s+/g, '-'), description });
    res.json(activation);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/admin/activations/:id/participants', requireAuth, requireRole('admin'), async (req, res) => {
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

router.put('/admin/activations/participants/:id', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const { name, slug, description, image_url } = req.body;
    const participant = await db.updateParticipant(req.params.id, { name, slug, description, image_url });
    res.json(participant);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/admin/activations/:id/pending', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const pending = await db.getPendingParticipants(req.params.id);
    res.json(pending);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/admin/activations/participants/:id/approve', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const participant = await db.approveParticipant(req.params.id);
    res.json(participant);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/admin/activations/participants/:id/reject', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const participant = await db.rejectParticipant(req.params.id);
    res.json(participant);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/admin/activations/:id/results', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const results = await db.getResultsByActivation(req.params.id);
    const optins = await db.getOptinsByActivation(req.params.id);
    res.json({ results, optins });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/admin/activations/:id/participants', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const participants = await db.getParticipantsByActivation(req.params.id);
    res.json(participants);
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
body{background:#0a0a0a;color:#f0f0f0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;min-height:100vh}
header{padding:24px;text-align:center;border-bottom:1px solid #1a1a1a}
header p{font-size:12px;letter-spacing:.15em;color:#555;margin-bottom:8px}
header h1{font-size:22px;font-weight:700}
header .sub{font-size:14px;color:#666;margin-top:6px}
.container{max-width:480px;margin:0 auto;padding:32px 24px}
label{display:block;font-size:12px;color:#555;text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px;margin-top:20px}
input,textarea{width:100%;background:#111;border:1px solid #222;color:#f0f0f0;padding:12px 14px;border-radius:10px;font-size:15px;outline:none;font-family:inherit}
input:focus,textarea:focus{border-color:#444}
input::placeholder,textarea::placeholder{color:#333}
textarea{resize:vertical;min-height:80px}
.upload-area{border:2px dashed #222;border-radius:12px;padding:32px;text-align:center;cursor:pointer;transition:border-color .2s;position:relative;margin-top:6px}
.upload-area:hover{border-color:#444}
.upload-area.has-image{border-style:solid;border-color:#333;padding:0;overflow:hidden}
.upload-area img{width:100%;height:200px;object-fit:cover;border-radius:10px;display:block}
.upload-area .upload-label{font-size:14px;color:#555;margin-top:8px}
.upload-area .upload-icon{font-size:32px;margin-bottom:8px}
.upload-area input[type=file]{position:absolute;inset:0;opacity:0;cursor:pointer;width:100%;height:100%}
.btn{width:100%;background:#f0f0f0;color:#0a0a0a;border:none;padding:16px;border-radius:10px;font-size:16px;font-weight:700;cursor:pointer;margin-top:24px}
.btn:disabled{opacity:.5;cursor:not-allowed}
#success{display:none;text-align:center;padding:40px 0}
#success h2{font-size:22px;font-weight:700;margin-bottom:8px}
#success p{font-size:15px;color:#666}
#error-msg{color:#ff4444;font-size:13px;margin-top:8px;text-align:center}
.progress{height:4px;background:#222;border-radius:2px;margin-top:16px;display:none}
.progress-bar{height:100%;background:#f0f0f0;border-radius:2px;width:0%;transition:width .3s}
</style>
</head>
<body>
<header>
  <p>⬡ SILVER GLIDER</p>
  <h1>${activation.name}</h1>
  <p class="sub">Register your booth</p>
</header>
<div class="container">
  <div id="form-view">
    <label>Booth name *</label>
    <input type="text" id="name" placeholder="e.g. Vintage Threads" maxlength="100">

    <label>Description</label>
    <textarea id="description" placeholder="Tell people what makes your booth special..." maxlength="300"></textarea>

    <label>Photo</label>
    <div class="upload-area" id="upload-area">
      <div id="upload-placeholder">
        <div class="upload-icon">📷</div>
        <div>Tap to upload a photo</div>
        <div class="upload-label">JPG, PNG — max 10MB</div>
      </div>
      <img id="preview-img" style="display:none">
      <input type="file" id="image-file" accept="image/*" onchange="previewImage(this)">
    </div>

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
function previewImage(input) {
  const file = input.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    const img = document.getElementById('preview-img');
    img.src = e.target.result;
    img.style.display = 'block';
    document.getElementById('upload-placeholder').style.display = 'none';
    document.getElementById('upload-area').classList.add('has-image');
  };
  reader.readAsDataURL(file);
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
  if (imageFile) formData.append('image', imageFile);

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
    <a href="/activations/${activation.slug}/${p.slug}" class="participant-card">
      ${p.image_url ? `<img src="${p.image_url}" alt="${p.name}">` : `<div class="placeholder-img">${p.name[0]}</div>`}
      <div class="participant-info">
        <h3>${p.name}</h3>
        ${p.description ? `<p>${p.description}</p>` : ''}
      </div>
      <span class="vote-cta">Vote &rarr;</span>
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
header{padding:24px;text-align:center;border-bottom:1px solid #1a1a1a}
header p{font-size:12px;letter-spacing:.15em;color:#555;margin-bottom:8px}
header h1{font-size:28px;font-weight:700}
header .desc{font-size:15px;color:#666;margin-top:8px}
.container{max-width:600px;margin:0 auto;padding:24px}
.participant-card{display:flex;align-items:center;gap:16px;background:#111;border:1px solid #222;border-radius:12px;padding:16px;margin-bottom:12px;text-decoration:none;color:inherit;transition:border-color .2s}
.participant-card:hover{border-color:#444}
.participant-card img,.placeholder-img{width:64px;height:64px;border-radius:10px;object-fit:cover;flex-shrink:0}
.placeholder-img{background:#1a1a1a;display:flex;align-items:center;justify-content:center;font-size:24px;font-weight:700;color:#444}
.participant-info{flex:1}
.participant-info h3{font-size:16px;font-weight:600;margin-bottom:4px}
.participant-info p{font-size:13px;color:#666}
.vote-cta{font-size:13px;color:#555;flex-shrink:0}
footer{text-align:center;padding:32px;font-size:12px;color:#333}
</style>
</head>
<body>
<header>
  <p>⬡ SILVER GLIDER</p>
  <h1>${activation.name}</h1>
  ${activation.description ? `<p class="desc">${activation.description}</p>` : ''}
</header>
<div class="container">
  <p style="font-size:13px;color:#555;margin-bottom:20px">Tap a booth to vote</p>
  ${cards || '<p style="color:#444;text-align:center;padding:40px 0">No participants yet.</p>'}
</div>
<footer>Silver Glider</footer>
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
body{background:#0a0a0a;color:#f0f0f0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;min-height:100vh}
header{padding:16px 24px;border-bottom:1px solid #1a1a1a;display:flex;align-items:center;gap:12px}
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
.vote-btn.selected{border-color:#f0f0f0;background:#1a1a1a}
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
.optin-row button{background:#f0f0f0;color:#0a0a0a;border:none;padding:12px 20px;border-radius:8px;font-size:15px;font-weight:600;cursor:pointer}
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
    <p class="question">Best Booth Awards — How was this booth?</p>
    <div class="vote-buttons">
      <button class="vote-btn" onclick="castVote('rules')">🔥 This Booth Rules!</button>
      <button class="vote-btn" onclick="castVote('hell_yeah')">🤘 Hell Yeah</button>
      <button class="vote-btn" onclick="castVote('no_thanks')">👎 No Thanks</button>
    </div>
    <div id="duplicate-msg">You already voted for this booth.</div>
  </div>

  <div id="thank-you">
    <h2>Vote counted.</h2>
    <p>Thanks for sharing your take.</p>
    <div class="optin-box">
      <h3>Want local concert recommendations by text?</h3>
      <p>Silver Glider drops music picks straight to your phone.</p>
      <div class="optin-row">
        <input type="tel" id="phone-input" placeholder="Your phone number">
        <button onclick="submitOptin()">Join</button>
      </div>
      <div id="optin-done">You're in. Watch for a text soon.</div>
    </div>
  </div>
</div>
<footer>Silver Glider</footer>
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
