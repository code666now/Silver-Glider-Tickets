const pool = require('../config/db');

async function getActivationBySlug(slug) {
  const r = await pool.query('SELECT * FROM sg_activations WHERE slug = $1', [slug]);
  return r.rows[0];
}

async function getAllActivations() {
  const r = await pool.query('SELECT * FROM sg_activations ORDER BY created_at DESC');
  return r.rows;
}

async function createActivation({ name, slug, description }) {
  const r = await pool.query(
    'INSERT INTO sg_activations (name, slug, description) VALUES ($1, $2, $3) RETURNING *',
    [name, slug, description]
  );
  return r.rows[0];
}

async function updateActivation(id, { name, description, active }) {
  const r = await pool.query(
    'UPDATE sg_activations SET name=$1, description=$2, active=$3 WHERE id=$4 RETURNING *',
    [name, description, active, id]
  );
  return r.rows[0];
}

async function getParticipantsByActivation(activation_id) {
  const r = await pool.query(
    "SELECT * FROM sg_participants WHERE activation_id = $1 AND status = 'approved' ORDER BY name ASC",
    [activation_id]
  );
  return r.rows;
}

async function getParticipantBySlug(activation_id, slug) {
  const r = await pool.query(
    'SELECT * FROM sg_participants WHERE activation_id = $1 AND slug = $2',
    [activation_id, slug]
  );
  return r.rows[0];
}

async function createParticipant({ activation_id, name, slug, description, image_url, status = 'approved', contact_email, contact_phone }) {
  const r = await pool.query(
    'INSERT INTO sg_participants (activation_id, name, slug, description, image_url, status, contact_email, contact_phone) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *',
    [activation_id, name, slug, description, image_url, status, contact_email, contact_phone]
  );
  return r.rows[0];
}

async function getPendingParticipants(activation_id) {
  const r = await pool.query(
    "SELECT * FROM sg_participants WHERE activation_id = $1 AND status = 'pending' ORDER BY created_at ASC",
    [activation_id]
  );
  return r.rows;
}

async function approveParticipant(id) {
  const r = await pool.query("UPDATE sg_participants SET status='approved' WHERE id=$1 RETURNING *", [id]);
  return r.rows[0];
}

async function rejectParticipant(id) {
  const r = await pool.query("DELETE FROM sg_participants WHERE id=$1 RETURNING *", [id]);
  return r.rows[0];
}

async function updateParticipant(id, { name, slug, description, image_url }) {
  const r = await pool.query(
    'UPDATE sg_participants SET name=$1, slug=$2, description=$3, image_url=$4 WHERE id=$5 RETURNING *',
    [name, slug, description, image_url, id]
  );
  return r.rows[0];
}

async function castVote({ participant_id, activation_id, vote, browser_fingerprint }) {
  const existing = await pool.query(
    'SELECT id FROM sg_activation_votes WHERE participant_id=$1 AND browser_fingerprint=$2',
    [participant_id, browser_fingerprint]
  );
  if (existing.rows.length > 0) return { duplicate: true };
  const r = await pool.query(
    'INSERT INTO sg_activation_votes (participant_id, activation_id, vote, browser_fingerprint) VALUES ($1,$2,$3,$4) RETURNING *',
    [participant_id, activation_id, vote, browser_fingerprint]
  );
  return { duplicate: false, vote: r.rows[0] };
}

async function getResultsByActivation(activation_id) {
  const r = await pool.query(`
    SELECT
      p.id, p.name, p.slug,
      COUNT(v.id) FILTER (WHERE v.vote = 'rules') AS rules,
      COUNT(v.id) FILTER (WHERE v.vote = 'hell_yeah') AS hell_yeah,
      COUNT(v.id) FILTER (WHERE v.vote = 'no_thanks') AS no_thanks,
      COUNT(v.id) AS total
    FROM sg_participants p
    LEFT JOIN sg_activation_votes v ON v.participant_id = p.id
    WHERE p.activation_id = $1
    GROUP BY p.id, p.name, p.slug
    ORDER BY total DESC
  `, [activation_id]);
  return r.rows;
}

async function createOptin({ activation_id, participant_id, phone }) {
  const r = await pool.query(
    'INSERT INTO sg_activation_optins (activation_id, participant_id, phone) VALUES ($1,$2,$3) RETURNING *',
    [activation_id, participant_id, phone]
  );
  return r.rows[0];
}

async function getOptinsByActivation(activation_id) {
  const r = await pool.query(
    'SELECT * FROM sg_activation_optins WHERE activation_id = $1 ORDER BY created_at DESC',
    [activation_id]
  );
  return r.rows;
}

module.exports = {
  getActivationBySlug, getAllActivations, createActivation, updateActivation,
  getParticipantsByActivation, getParticipantBySlug, createParticipant, updateParticipant,
  getPendingParticipants, approveParticipant, rejectParticipant,
  castVote, getResultsByActivation, createOptin, getOptinsByActivation
};
