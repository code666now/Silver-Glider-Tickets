const express = require('express');
const rateLimit = require('express-rate-limit');
const router = express.Router();
const { importOrder, listOrders, getOrder, voidOrder } = require('../controllers/ordersController');
const { requireAuth, requireRole } = require('../middleware/auth');
const { requireServiceOrAdmin } = require('../middleware/serviceAuth');

const publicLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, try again later' }
});

router.post('/import', requireServiceOrAdmin, importOrder);
router.post('/:external_order_id/void', requireServiceOrAdmin, voidOrder);
router.get('/', requireAuth, listOrders);
router.get('/:order_number', requireAuth, getOrder);

module.exports = router;

router.post('/lookup', publicLimiter, async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email required' });
    const pool = require('../config/db');
    const result = await pool.query(
      'SELECT * FROM sg_orders WHERE LOWER(buyer_email) = LOWER($1) AND order_status = $2 ORDER BY created_at DESC',
      [email, 'active']
    );
    if (!result.rows.length) return res.json({ found: false });
    res.json({ found: true, count: result.rows.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/resend-tickets', publicLimiter, async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email required' });
    const pool = require('../config/db');
    const { getEventById } = require('../db/eventsDB');
    const { sendOrderConfirmation } = require('../lib/mailer');

    const result = await pool.query(
      'SELECT * FROM sg_orders WHERE LOWER(buyer_email) = LOWER($1) AND order_status = $2 ORDER BY created_at DESC',
      [email, 'active']
    );

    if (!result.rows.length) return res.json({ found: false });

    for (const order of result.rows) {
      const tickets = await pool.query('SELECT * FROM sg_tickets WHERE order_id = $1', [order.id]);
      const event = await getEventById(order.event_id);
      if (process.env.RESEND_API_KEY) {
        await sendOrderConfirmation({
          to: email,
          buyer_first_name: order.buyer_first_name,
          event,
          order,
          tickets: tickets.rows
        });
      }
    }

    res.json({ found: true, count: result.rows.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
