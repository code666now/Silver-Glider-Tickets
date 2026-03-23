const express = require('express');
const router = express.Router();
const { importOrder, listOrders, getOrder } = require('../controllers/ordersController');
const { requireAuth, requireRole } = require('../middleware/auth');

router.post('/import', requireAuth, requireRole('admin'), importOrder);
router.get('/', requireAuth, listOrders);
router.get('/:order_number', requireAuth, getOrder);

module.exports = router;
