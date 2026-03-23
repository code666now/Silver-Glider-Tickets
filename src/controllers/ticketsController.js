const { getTicketsByOrder, getTicketsByEvent, checkInTicket } = require('../db/ticketsDB');

async function listTicketsByOrder(req, res) {
  try {
    const tickets = await getTicketsByOrder(req.params.order_id);
    res.json(tickets);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function listTicketsByEvent(req, res) {
  try {
    const tickets = await getTicketsByEvent(req.params.event_id);
    res.json(tickets);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function checkIn(req, res) {
  try {
    const ticket = await checkInTicket(req.params.ticket_id);
    if (!ticket) return res.status(409).json({ error: 'Already checked in or not found' });
    res.json({ success: true, ticket });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

module.exports = { listTicketsByOrder, listTicketsByEvent, checkIn };
