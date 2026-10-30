const express = require('express');
const router = express.Router();
const { listEvents, getEvent, addEvent, editEvent, upsertEvent } = require('../controllers/eventsController');
const { getEventDoorList, exportEventDoorList } = require('../controllers/doorListController');
const { requireAuth, requireStaffOrPublisher, requireRole, requireEventAccess } = require('../middleware/auth');
const { requireServiceOrAdmin } = require('../middleware/serviceAuth');

// Publicadores (SSO) ven solo sus eventos; el filtro lo aplica el controller.
router.get('/', requireStaffOrPublisher, listEvents);
// Upsert S2S por id externo (debe ir antes de '/:id' para no ser capturada como id).
router.put('/by-external/:external_event_id', requireServiceOrAdmin, upsertEvent);
router.get('/:id/door-list', requireStaffOrPublisher, requireEventAccess('id'), getEventDoorList);
router.get('/:id/door-list/export', requireStaffOrPublisher, requireEventAccess('id'), exportEventDoorList);
router.get('/:id', requireAuth, getEvent);
router.post('/', requireAuth, requireRole('admin'), addEvent);
router.put('/:id', requireAuth, requireRole('admin'), editEvent);

module.exports = router;
