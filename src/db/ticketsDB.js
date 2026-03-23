const pool = require('../config/db');

async function createTicket({ order_id, event_id, ticket_id, ticket_type, attendee_first_name, attendee_last_name }) {
  const result = await pool.query(
    `INSERT INTO sg_tickets (order_id, event_id, ticket_id, ticket_type, attendee_first_name, attendee_last_name)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [order_id, event_id, ticket_id, ticket_type, attendee_first_name, attendee_last_name]
  );
  return result.rows[0];
}

async function getTicketsByOrder(order_id) {
  const result = await pool.query('SELECT * FROM sg_tickets WHERE order_id = $1', [order_id]);
  return result.rows;
}

async function getTicketsByEvent(event_id) {
  const result = await pool.query('SELECT * FROM sg_tickets WHERE event_id = $1', [event_id]);
  return result.rows;
}

async function checkInTicket(ticket_id) {
  const result = await pool.query(
    `UPDATE sg_tickets SET checkin_status='checked_in', checkin_at=NOW(), updated_at=NOW()
     WHERE ticket_id=$1 AND checkin_status='not_checked_in' RETURNING *`,
    [ticket_id]
  );
  return result.rows[0];
}

module.exports = { createTicket, getTicketsByOrder, getTicketsByEvent, checkInTicket };
