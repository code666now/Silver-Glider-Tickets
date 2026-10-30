const pool = require('../config/db');

// Lista de puerta: una fila por orden activa con el conteo de sus tickets. No devuelve
// secure_token ni qr_token (abrirían la wallet o harían pasar el QR en puerta).
async function getDoorList(event_id) {
  const result = await pool.query(
    `SELECT o.id, o.order_number, o.buyer_first_name, o.buyer_last_name,
            o.buyer_email, o.buyer_phone, o.quantity,
            COUNT(t.id)::int AS tickets_total,
            (COUNT(t.id) FILTER (WHERE t.checkin_status = 'checked_in'))::int AS tickets_checked_in,
            COALESCE(string_agg(DISTINCT t.ticket_type, ', '), '') AS ticket_type,
            COALESCE(
              json_agg(json_build_object('ticket_id', t.ticket_id, 'checkin_status', t.checkin_status) ORDER BY t.id)
                FILTER (WHERE t.id IS NOT NULL),
              '[]'
            ) AS tickets
     FROM sg_orders o
     LEFT JOIN sg_tickets t ON t.order_id = o.id AND t.ticket_status = 'valid'
     WHERE o.event_id = $1 AND o.order_status = 'active'
     GROUP BY o.id
     ORDER BY LOWER(o.buyer_last_name), LOWER(o.buyer_first_name), o.id`,
    [event_id]
  );
  return result.rows;
}

async function logDoorListExport({ event_id, actor_kind, actor_ref, actor_email, format, include_email, include_phone, row_count }) {
  await pool.query(
    `INSERT INTO sg_doorlist_exports (event_id, actor_kind, actor_ref, actor_email, format, include_email, include_phone, row_count)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [event_id, actor_kind, String(actor_ref), actor_email || null, format, include_email, include_phone, row_count]
  );
}

module.exports = { getDoorList, logDoorListExport };
