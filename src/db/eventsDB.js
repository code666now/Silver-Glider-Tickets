const pool = require('../config/db');

async function getAllEvents() {
  const result = await pool.query('SELECT * FROM sg_events ORDER BY event_date DESC');
  return result.rows;
}

async function getEventById(id) {
  const result = await pool.query('SELECT * FROM sg_events WHERE id = $1', [id]);
  return result.rows[0];
}

async function createEvent({ name, event_date, venue, capacity, image_url }) {
  const result = await pool.query(
    'INSERT INTO sg_events (name, event_date, venue, capacity, image_url) VALUES ($1,$2,$3,$4,$5) RETURNING *',
    [name, event_date, venue, capacity, image_url]
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

module.exports = { getAllEvents, getEventById, createEvent, updateEvent };
