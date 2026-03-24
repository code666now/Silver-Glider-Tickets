const express = require('express');
const router = express.Router();
const { listTicketsByOrder, listTicketsByEvent, checkIn } = require('../controllers/ticketsController');
const { requireAuth } = require('../middleware/auth');

router.get('/order/:order_id', requireAuth, listTicketsByOrder);
router.get('/event/:event_id', requireAuth, listTicketsByEvent);
router.post('/checkin/:ticket_id', requireAuth, checkIn);

module.exports = router;

const { getTicketByQrToken, checkInTicketByScan } = require('../controllers/ticketsController');
router.post('/scan/:qr_token', require('../middleware/auth').requireAuth, async (req, res) => {
  try {
    const { qr_token } = req.params;
    const { getTicketByQrToken, checkInTicketByScan } = require('../db/ticketsDB');
    const ticket = await getTicketByQrToken(qr_token);
    if (!ticket) return res.json({ result: 'invalid', message: 'Ticket not found' });
    if (ticket.ticket_status === 'void') return res.json({ result: 'void', message: 'Ticket is void' });
    if (ticket.ticket_status === 'refunded') return res.json({ result: 'refunded', message: 'Ticket was refunded' });
    if (ticket.checkin_status === 'checked_in') return res.json({ result: 'already_checked_in', message: 'Already checked in', ticket_id: ticket.ticket_id });
    const updated = await checkInTicketByScan(qr_token, req.user.id);
    if (!updated) return res.json({ result: 'already_checked_in', message: 'Already checked in' });
    res.json({ result: 'success', message: 'Checked in!', ticket_id: updated.ticket_id, ticket_type: updated.ticket_type });
  } catch (err) {
    res.status(500).json({ result: 'error', message: err.message });
  }
});
