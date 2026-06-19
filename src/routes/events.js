const express = require('express');
const router = express.Router();
const { listEvents, getEvent, addEvent, editEvent, upsertEvent } = require('../controllers/eventsController');
const { requireAuth, requireRole } = require('../middleware/auth');
const { requireServiceOrAdmin } = require('../middleware/serviceAuth');

router.get('/', requireAuth, listEvents);
// Upsert S2S por id externo (debe ir antes de '/:id' para no ser capturada como id).
router.put('/by-external/:external_event_id', requireServiceOrAdmin, upsertEvent);
router.get('/:id', requireAuth, getEvent);
router.post('/', requireAuth, requireRole('admin'), addEvent);
router.put('/:id', requireAuth, requireRole('admin'), editEvent);

module.exports = router;
