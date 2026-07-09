const pool = require('../config/db');

async function createOrder({ event_id, order_number, buyer_first_name, buyer_last_name, buyer_email, buyer_phone, total_amount, quantity, secure_token, external_order_id }) {
  const result = await pool.query(
    `INSERT INTO sg_orders (event_id, order_number, buyer_first_name, buyer_last_name, buyer_email, buyer_phone, total_amount, quantity, secure_token, external_order_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
    [event_id, order_number, buyer_first_name, buyer_last_name, buyer_email, buyer_phone, total_amount, quantity, secure_token, external_order_id || null]
  );
  return result.rows[0];
}

async function getOrderByExternalId(external_order_id) {
  const result = await pool.query('SELECT * FROM sg_orders WHERE external_order_id = $1', [external_order_id]);
  return result.rows[0];
}

// Anula una orden y todos sus tickets (propagación de refund desde el principal).
async function voidOrderByExternalId(external_order_id) {
  const order = await getOrderByExternalId(external_order_id);
  if (!order) return null;
  await pool.query("UPDATE sg_orders SET order_status='cancel', updated_at=NOW() WHERE id=$1", [order.id]);
  await pool.query("UPDATE sg_tickets SET ticket_status='refunded', updated_at=NOW() WHERE order_id=$1", [order.id]);
  return { ...order, order_status: 'cancel' };
}

// Sella el intento antes de enviar. Sin esto, email_last_attempt_at quedaría NULL y el
// barredor reclamaría la orden en su siguiente tick en vez de esperar el retardo.
async function markEmailAttempt(order_id) {
  await pool.query(
    'UPDATE sg_orders SET email_attempts = email_attempts + 1, email_last_attempt_at = NOW() WHERE id = $1',
    [order_id]
  );
}

async function markEmailSent(order_id) {
  await pool.query(
    'UPDATE sg_orders SET email_sent_at = NOW(), email_last_error = NULL, updated_at = NOW() WHERE id = $1',
    [order_id]
  );
}

async function recordEmailFailure(order_id, message) {
  await pool.query(
    'UPDATE sg_orders SET email_last_error = $2, updated_at = NOW() WHERE id = $1',
    [order_id, String(message).slice(0, 500)]
  );
}

// Reclama hasta `limit` órdenes cuyo correo sigue pendiente y cuyo último intento es
// más viejo que `delayMinutes`. El UPDATE incrementa el contador y sella el intento en
// la misma sentencia que las selecciona: si hubiera dos instancias del servicio, el
// FOR UPDATE SKIP LOCKED impide que ambas reclamen la misma orden y dupliquen el correo.
async function claimOrdersPendingEmail({ delayMinutes, maxAttempts, limit }) {
  const result = await pool.query(
    `UPDATE sg_orders SET email_attempts = email_attempts + 1, email_last_attempt_at = NOW()
     WHERE id IN (
       SELECT id FROM sg_orders
       WHERE email_sent_at IS NULL
         AND buyer_email IS NOT NULL
         AND order_status = 'active'
         AND email_attempts < $1::int
         AND (email_last_attempt_at IS NULL OR email_last_attempt_at <= NOW() - ($2::int * INTERVAL '1 minute'))
       ORDER BY created_at
       LIMIT $3
       FOR UPDATE SKIP LOCKED
     )
     RETURNING *`,
    [maxAttempts, delayMinutes, limit]
  );
  return result.rows;
}

async function getOrderByNumber(order_number) {
  const result = await pool.query('SELECT * FROM sg_orders WHERE order_number = $1', [order_number]);
  return result.rows[0];
}

async function getOrdersByEvent(event_id) {
  const result = await pool.query(
    'SELECT * FROM sg_orders WHERE event_id = $1 ORDER BY buyer_last_name ASC',
    [event_id]
  );
  return result.rows;
}

async function searchOrders(event_id, query) {
  const result = await pool.query(
    `SELECT * FROM sg_orders WHERE event_id = $1 AND (
      LOWER(buyer_last_name) LIKE LOWER($2) OR
      LOWER(buyer_email) LIKE LOWER($2) OR
      LOWER(order_number) LIKE LOWER($2)
    ) ORDER BY buyer_last_name ASC`,
    [event_id, `%${query}%`]
  );
  return result.rows;
}

module.exports = {
  createOrder, getOrderByNumber, getOrdersByEvent, searchOrders,
  getOrderByExternalId, voidOrderByExternalId,
  markEmailAttempt, markEmailSent, recordEmailFailure, claimOrdersPendingEmail
};
