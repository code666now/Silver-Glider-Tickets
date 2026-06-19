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

module.exports = { createOrder, getOrderByNumber, getOrdersByEvent, searchOrders, getOrderByExternalId, voidOrderByExternalId };
