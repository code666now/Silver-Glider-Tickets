const express = require('express');
const router = express.Router();
const { getOrderByNumber } = require('../db/ordersDB');
const { getTicketsByOrder } = require('../db/ticketsDB');
const { getEventById } = require('../db/eventsDB');
const QRCode = require('qrcode');
const path = require('path');

router.get('/', async (req, res) => {
  const { order, token } = req.query;
  if (!order || !token) return res.status(400).send('Invalid link');
  const orderRecord = await getOrderByNumber(order);
  if (!orderRecord || orderRecord.secure_token !== token) return res.status(403).send('Access denied');
  res.sendFile(path.resolve(__dirname, '../views/wallet.html'));
});

router.get('/data', async (req, res) => {
  const { order, token } = req.query;
  if (!order || !token) return res.status(400).json({ error: 'Invalid link' });
  const orderRecord = await getOrderByNumber(order);
  if (!orderRecord || orderRecord.secure_token !== token) return res.status(403).json({ error: 'Access denied' });
  const tickets = await getTicketsByOrder(orderRecord.id);
  const event = await getEventById(orderRecord.event_id);

  const ticketsWithQR = await Promise.all(tickets.map(async (t) => {
    const qrData = t.qr_token || t.ticket_id;
    const qrImage = await QRCode.toDataURL(qrData, { width: 300, margin: 2, color: { dark: '#000000', light: '#ffffff' } });
    return { ...t, qr_image: qrImage };
  }));

  res.json({ order: orderRecord, tickets: ticketsWithQR, event });
});

module.exports = router;
