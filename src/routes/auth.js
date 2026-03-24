const express = require('express');
const router = express.Router();
const { login, register } = require('../controllers/authController');
const { requireAuth, requireRole } = require('../middleware/auth');

router.post('/login', login);
router.post('/register', requireAuth, requireRole('admin'), register);

module.exports = router;

router.get('/users', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const pool = require('../config/db');
    const result = await pool.query('SELECT id, email, first_name, last_name, role, created_at FROM sg_users ORDER BY created_at DESC');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
