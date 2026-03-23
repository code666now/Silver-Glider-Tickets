const express = require('express');
const router = express.Router();
const { listEvents, getEvent, addEvent, editEvent } = require('../controllers/eventsController');
const { requireAuth, requireRole } = require('../middleware/auth');

router.get('/', requireAuth, listEvents);
router.get('/:id', requireAuth, getEvent);
router.post('/', requireAuth, requireRole('admin'), addEvent);
router.put('/:id', requireAuth, requireRole('admin'), editEvent);

module.exports = router;
