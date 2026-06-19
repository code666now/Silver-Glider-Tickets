const pool = require('../config/db');
const { generateSecureToken } = require('../lib/tokenGenerator');

async function createTicket({ order_id, event_id, ticket_id, ticket_type, attendee_first_name, attendee_last_name }) {
  const qr_token = generateSecureToken();
  const result = await pool.query(
    `INSERT INTO sg_tickets (order_id, event_id, ticket_id, ticket_type, attendee_first_name, attendee_last_name, qr_token)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [order_id, event_id, ticket_id, ticket_type, attendee_first_name, attendee_last_name, qr_token]
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

async function getTicketByQrToken(qr_token) {
  const result = await pool.query('SELECT * FROM sg_tickets WHERE qr_token = $1', [qr_token]);
  return result.rows[0];
}

async function checkInTicketByScan(qr_token, checked_in_by) {
  const result = await pool.query(
    `UPDATE sg_tickets 
     SET checkin_status='checked_in', checkin_at=NOW(), updated_at=NOW(),
         checkin_method='scan', checked_in_by=$2
     WHERE qr_token=$1 AND checkin_status='not_checked_in' 
     AND ticket_status='valid'
     RETURNING *`,
    [qr_token, checked_in_by]
  );
  return result.rows[0];
}

module.exports = Object.assign(module.exports, { getTicketByQrToken, checkInTicketByScan });
