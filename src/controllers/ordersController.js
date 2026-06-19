const { createOrder, getOrderByNumber, getOrdersByEvent, searchOrders, getOrderByExternalId, voidOrderByExternalId } = require('../db/ordersDB');
const { createTicket, getTicketsByOrder } = require('../db/ticketsDB');
const { getEventById, getEventByExternalId } = require('../db/eventsDB');
const { generateOrderNumber, generateTicketId } = require('../lib/idGenerator');
const { generateSecureToken } = require('../lib/tokenGenerator');
const { sendOrderConfirmation } = require('../lib/mailer');

async function importOrder(req, res) {
  const {
    event_id, external_event_id, external_order_id,
    buyer_first_name, buyer_last_name, buyer_email, buyer_phone,
    total_amount, quantity, ticket_type
  } = req.body;
  try {
    // Idempotencia: si esta orden externa ya se importó, devolver la existente.
    if (external_order_id) {
      const existing = await getOrderByExternalId(external_order_id);
      if (existing) {
        const tickets = await getTicketsByOrder(existing.id);
        return res.status(200).json({ order: existing, tickets, idempotent: true });
      }
    }

    // Resolución de evento (Opción A: por external_event_id; fallback a event_id local).
    let resolvedEventId = event_id;
    if (external_event_id) {
      const event = await getEventByExternalId(external_event_id);
      if (!event) {
        return res.status(422).json({ error: 'event not mapped', external_event_id });
      }
      resolvedEventId = event.id;
    }
    if (!resolvedEventId) {
      return res.status(400).json({ error: 'event_id or external_event_id required' });
    }

    const order_number = generateOrderNumber();
    const secure_token = generateSecureToken();

    const order = await createOrder({
      event_id: resolvedEventId, order_number, buyer_first_name, buyer_last_name,
      buyer_email, buyer_phone, total_amount, quantity, secure_token, external_order_id
    });

    const tickets = [];
    for (let i = 0; i < quantity; i++) {
      const ticket = await createTicket({
        order_id: order.id,
        event_id: resolvedEventId,
        ticket_id: generateTicketId(),
        ticket_type: ticket_type || 'General Admission',
        attendee_first_name: buyer_first_name,
        attendee_last_name: buyer_last_name
      });
      tickets.push(ticket);
    }

    if (buyer_email && process.env.RESEND_API_KEY) {
      try {
        const event = await getEventById(resolvedEventId);
        await sendOrderConfirmation({ to: buyer_email, buyer_first_name, event, order, tickets });
      } catch (emailErr) {
        console.error('Email failed:', emailErr.message);
      }
    }

    res.status(201).json({ order, tickets });
  } catch (err) {
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
