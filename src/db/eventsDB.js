const pool = require('../config/db');

async function getAllEvents() {
  const result = await pool.query('SELECT * FROM sg_events ORDER BY event_date DESC');
  return result.rows;
}

async function getEventById(id) {
  const result = await pool.query('SELECT * FROM sg_events WHERE id = $1', [id]);
  return result.rows[0];
}

async function createEvent({ name, event_date, venue, capacity, image_url, external_event_id }) {
  const result = await pool.query(
    'INSERT INTO sg_events (name, event_date, venue, capacity, image_url, external_event_id) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *',
    [name, event_date, venue, capacity, image_url, external_event_id || null]
  );
  return result.rows[0];
}

async function updateEvent(id, { name, event_date, venue, capacity, image_url }) {
  const result = await pool.query(
    'UPDATE sg_events SET name=$1, event_date=$2, venue=$3, capacity=$4, image_url=$5 WHERE id=$6 RETURNING *',
    [name, event_date, venue, capacity, image_url, id]
  );
  return result.rows[0];
}

async function getEventByExternalId(external_event_id) {
  const result = await pool.query('SELECT * FROM sg_events WHERE external_event_id = $1', [external_event_id]);
  return result.rows[0];
}

// Upsert idempotente por external_event_id (propagación de eventos desde el principal).
async function upsertEventByExternal(external_event_id, { name, event_date, venue, capacity, image_url }) {
  const result = await pool.query(
    `INSERT INTO sg_events (external_event_id, name, event_date, venue, capacity, image_url)
     VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (external_event_id) DO UPDATE SET
       name = EXCLUDED.name,
       event_date = EXCLUDED.event_date,
       venue = EXCLUDED.venue,
       capacity = EXCLUDED.capacity,
       image_url = EXCLUDED.image_url
     RETURNING *`,
    [external_event_id, name, event_date, venue, capacity, image_url]
  );
  return result.rows[0];
}

module.exports = { getAllEvents, getEventById, createEvent, updateEvent, getEventByExternalId, upsertEventByExternal };
