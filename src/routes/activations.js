const express = require('express');
const router = express.Router();
const db = require('../db/activationsDB');
const { requireAuth, requireRole } = require('../middleware/auth');
const path = require('path');

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
