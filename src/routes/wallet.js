const express = require('express');
const router = express.Router();
const { requireAuth, requireRole } = require('../middleware/auth');
const { getOrderByNumber } = require('../db/ordersDB');
const { getTicketsByOrder } = require('../db/ticketsDB');
const { getEventById } = require('../db/eventsDB');
const path = require('path');

router.get('/', async (req, res) => {
  const { order, token } = req.query;
  if (!order || !token) return res.status(400).send('Invalid link');

  const orderRecord = await getOrderByNumber(order);
  if (!orderRecord || orderRecord.secure_token !== token) {
    return res.status(403).send('Access denied');
  }

  res.sendFile(path.join(__dirname, '../views/wallet.html'));
});

router.get('/data', async (req, res) => {
  const { order, token } = req.query;
  if (!order || !token) return res.status(400).json({ error: 'Invalid link' });

  const orderRecord = await getOrderByNumber(order);
  if (!orderRecord || orderRecord.secure_token !== token) {
    return res.status(403).json({ error: 'Access denied' });
  }

  const tickets = await getTicketsByOrder(orderRecord.id);
  const event = await getEventById(orderRecord.event_id);

  res.json({ order: orderRecord, tickets, event });
});

module.exports = router;
