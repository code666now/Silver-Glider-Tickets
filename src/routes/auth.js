const express = require('express');
const rateLimit = require('express-rate-limit');
const router = express.Router();
const { login, register, ssoExchange, me } = require('../controllers/authController');
const { requireAuth, requireStaffOrPublisher, requireRole } = require('../middleware/auth');

const ssoLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, try again later' }
});

router.post('/login', login);
router.post('/register', requireAuth, requireRole('admin'), register);
router.post('/sso', ssoLimiter, ssoExchange);
router.get('/me', requireStaffOrPublisher, me);

router.get('/users', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const pool = require('../config/db');
    const result = await pool.query('SELECT id, email, first_name, last_name, role, created_at FROM sg_users ORDER BY created_at DESC');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
