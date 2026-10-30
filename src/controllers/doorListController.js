const { getDoorList, logDoorListExport } = require('../db/doorListDB');
const { buildDoorListCsv, buildDoorListPdf } = require('../lib/doorListExport');
const { isPublisher } = require('../middleware/auth');

const FORMATS = {
  csv: { contentType: 'text/csv; charset=utf-8', build: (rows, _event, opts) => buildDoorListCsv(rows, opts) },
  pdf: { contentType: 'application/pdf', build: buildDoorListPdf },
};

// GET /api/events/:id/door-list — lista para la vista (req.event lo carga requireEventAccess).
async function getEventDoorList(req, res) {
  try {
    const rows = await getDoorList(req.event.id);
    res.json({ event: req.event, orders: rows });
  } catch (err) {
    console.error('[doorList] ✖ Error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
}

function slug(text) {
  return String(text || 'event').normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-').toLowerCase().slice(0, 60) || 'event';
}

// GET /api/events/:id/door-list/export?format=csv|pdf&include=email,phone
async function exportEventDoorList(req, res) {
  const format = String(req.query.format || 'csv').toLowerCase();
  const spec = FORMATS[format];
  if (!spec) return res.status(400).json({ error: 'format must be csv or pdf' });

  const include = String(req.query.include || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  const unknown = include.filter((f) => f !== 'email' && f !== 'phone');
  if (unknown.length) return res.status(400).json({ error: `Unknown include field(s): ${unknown.join(', ')}` });
  const options = { includeEmail: include.includes('email'), includePhone: include.includes('phone') };

  try {
    const rows = await getDoorList(req.event.id);
    const file = await spec.build(rows, req.event, options);

    const publisher = isPublisher(req.user);
    await logDoorListExport({
      event_id: req.event.id,
      actor_kind: publisher ? 'publisher' : 'staff',
      actor_ref: publisher ? req.user.sub : req.user.id,
      actor_email: req.user.email,
      format,
      include_email: options.includeEmail,
      include_phone: options.includePhone,
      row_count: rows.length,
    });

    const filename = `door-list-${slug(req.event.name)}-${new Date().toISOString().slice(0, 10)}.${format}`;
    res.set({
      'Content-Type': spec.contentType,
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    });
    res.send(file);
  } catch (err) {
    console.error('[doorList] ✖ Export error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
}

module.exports = { getEventDoorList, exportEventDoorList };
