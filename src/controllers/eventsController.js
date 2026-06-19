const { getAllEvents, getEventById, createEvent, updateEvent, upsertEventByExternal } = require('../db/eventsDB');

async function listEvents(req, res) {
  try {
    const events = await getAllEvents();
    res.json(events);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function getEvent(req, res) {
  try {
    const event = await getEventById(req.params.id);
    if (!event) return res.status(404).json({ error: 'Event not found' });
    res.json(event);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function addEvent(req, res) {
  try {
    const event = await createEvent(req.body);
    res.status(201).json(event);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function editEvent(req, res) {
  try {
    const event = await updateEvent(req.params.id, req.body);
    res.json(event);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function upsertEvent(req, res) {
  try {
    const event = await upsertEventByExternal(req.params.external_event_id, req.body);
    res.json(event);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

module.exports = { listEvents, getEvent, addEvent, editEvent, upsertEvent };
