const express = require('express');
const router = express.Router();
const { listTicketsByOrder, listTicketsByEvent, checkIn } = require('../controllers/ticketsController');
const { requireAuth } = require('../middleware/auth');

router.get('/order/:order_id', requireAuth, listTicketsByOrder);
router.get('/event/:event_id', requireAuth, listTicketsByEvent);
router.post('/checkin/:ticket_id', requireAuth, checkIn);

module.exports = router;
