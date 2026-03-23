const express = require('express');
const router = express.Router();
const { login, register } = require('../controllers/authController');
const { requireAuth, requireRole } = require('../middleware/auth');

router.post('/login', login);
router.post('/register', requireAuth, requireRole('admin'), register);

module.exports = router;
