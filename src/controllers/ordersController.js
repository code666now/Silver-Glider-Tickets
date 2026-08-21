const {
  getOrderByNumber, getOrdersByEvent, searchOrders,
  getOrderByExternalId, voidOrderByExternalId
} = require('../db/ordersDB');
const { getTicketsByOrder } = require('../db/ticketsDB');
const { performImport } = require('../lib/orderImporter');

async function importOrder(req, res) {
  const {
    event_id, external_event_id, external_order_id,
    buyer_first_name, buyer_last_name, buyer_email, buyer_phone,
    total_amount, quantity, ticket_type
  } = req.body;
  console.log('[importOrder] ⬇ Petición recibida del backend principal:', {
    external_order_id, external_event_id, event_id, buyer_email, quantity, ticket_type
  });
  try {
    // Idempotencia: si esta orden externa ya se importó, devolver la existente.
    if (external_order_id) {
      const existing = await getOrderByExternalId(external_order_id);
      if (existing) {
        // external_order_id es UNIQUE en sg_orders: si el buyer_email de esta petición
        // no coincide con el de la orden ya guardada, es probable que external_order_id
        // se haya reusado (colisión) y esta petición sea en realidad de OTRO comprador
        // que nunca llega a tener orden ni correo propios. Ver scripts/manual-import-order.js.
        if (buyer_email && existing.buyer_email && buyer_email.toLowerCase() !== existing.buyer_email.toLowerCase()) {
          console.warn(
            `[importOrder] ⚠ MISMATCH: external_order_id=${external_order_id} ya está asociado a ` +
            `${existing.order_number} (${existing.buyer_email}), pero esta petición trae buyer_email=${buyer_email}. ` +
            `Posible colisión/reuso de external_order_id — este comprador no recibirá correo. ` +
            `Recuperar con: node scripts/manual-import-order.js`
          );
        }
        console.log(`[importOrder] ↩ Orden externa ${external_order_id} ya importada (idempotente), devolviendo existente ${existing.order_number}`);
        const tickets = await getTicketsByOrder(existing.id);
        return res.status(200).json({ order: existing, tickets, idempotent: true });
      }
    }

    const { order, tickets } = await performImport({
      event_id, external_event_id, external_order_id,
      buyer_first_name, buyer_last_name, buyer_email, buyer_phone,
      total_amount, quantity, ticket_type
    });

    console.log(`[importOrder] ⬆ Respondiendo 201 con orden ${order.order_number}`);
    res.status(201).json({ order, tickets });
  } catch (err) {
    if (err.statusCode === 422) {
      console.warn(`[importOrder] ✖ Evento no mapeado para external_event_id=${external_event_id}`);
      return res.status(422).json({ error: err.message, external_event_id });
    }
    if (err.statusCode === 400) {
      console.warn('[importOrder] ✖ Falta event_id / external_event_id');
      return res.status(400).json({ error: err.message });
    }
    console.error('[importOrder] ✖ Error:', err.message);
    res.status(500).json({ error: err.message });
  }
}

async function voidOrder(req, res) {
  try {
    const result = await voidOrderByExternalId(req.params.external_order_id);
    if (!result) return res.status(404).json({ error: 'Order not found' });
    res.json({ success: true, order: result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function listOrders(req, res) {
  try {
    const { event_id, q } = req.query;
    const orders = q ? await searchOrders(event_id, q) : await getOrdersByEvent(event_id);
    res.json(orders);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function getOrder(req, res) {
  try {
    const order = await getOrderByNumber(req.params.order_number);
    if (!order) return res.status(404).json({ error: 'Order not found' });
    res.json(order);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

module.exports = { importOrder, listOrders, getOrder, voidOrder };
