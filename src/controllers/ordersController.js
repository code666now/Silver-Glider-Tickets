const { createOrder, getOrderByNumber, getOrdersByEvent, searchOrders } = require('../db/ordersDB');
const { createTicket } = require('../db/ticketsDB');
const { generateOrderNumber, generateTicketId } = require('../lib/idGenerator');
const { generateSecureToken } = require('../lib/tokenGenerator');

async function importOrder(req, res) {
  const { event_id, buyer_first_name, buyer_last_name, buyer_email, buyer_phone, total_amount, quantity, ticket_type } = req.body;
  try {
    const order_number = generateOrderNumber();
    const secure_token = generateSecureToken();

    const order = await createOrder({
      event_id, order_number, buyer_first_name, buyer_last_name,
      buyer_email, buyer_phone, total_amount, quantity, secure_token
    });

    const tickets = [];
    for (let i = 0; i < quantity; i++) {
      const ticket = await createTicket({
        order_id: order.id,
        event_id,
        ticket_id: generateTicketId(),
        ticket_type: ticket_type || 'General Admission',
        attendee_first_name: buyer_first_name,
        attendee_last_name: buyer_last_name
      });
      tickets.push(ticket);
    }

    res.status(201).json({ order, tickets });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function listOrders(req, res) {
  try {
    const { event_id, q } = req.query;
    const orders = q
      ? await searchOrders(event_id, q)
      : await getOrdersByEvent(event_id);
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

module.exports = { importOrder, listOrders, getOrder };
