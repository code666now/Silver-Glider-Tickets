const jwt = require('jsonwebtoken');
const { isPublisherRoleAllowed } = require('../lib/sso');
const { getEventById } = require('../db/eventsDB');

function verifyBearer(req) {
  const header = req.headers.authorization;
  if (!header) return { error: 'No token provided' };
  const token = header.split(' ')[1];
  try {
    return { user: jwt.verify(token, process.env.JWT_SECRET) };
  } catch {
    return { error: 'Invalid token' };
  }
}

function isPublisher(user) {
  return user?.kind === 'publisher';
}

// Solo personal local (sg_users: admin/staff). Las sesiones de publicador (SSO del
// principal) se rechazan: firman con el mismo JWT_SECRET pero no deben llegar a
// check-in, scan, órdenes completas ni panel admin.
function requireAuth(req, res, next) {
  const { user, error } = verifyBearer(req);
  if (error) return res.status(401).json({ error });
  if (isPublisher(user)) return res.status(403).json({ error: 'Forbidden' });
  req.user = user;
  next();
}

// Personal local o publicador. Al publicador se le vuelve a validar el rol contra
// SSO_ALLOWED_ROLES en cada request: quitar un rol corta también las sesiones abiertas.
function requireStaffOrPublisher(req, res, next) {
  const { user, error } = verifyBearer(req);
  if (error) return res.status(401).json({ error });
  if (isPublisher(user) && !isPublisherRoleAllowed(user.role)) {
    return res.status(401).json({ error: 'Role no longer allowed' });
  }
  req.user = user;
  next();
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    next();
  };
}

// Carga el evento de req.params[param] en req.event. Un publicador solo accede a los
// eventos de su sesión (external_event_id ∈ eventIds); a uno ajeno se le responde 404
// para no revelar qué ids existen. Va después de requireStaffOrPublisher.
function requireEventAccess(param = 'id') {
  return async (req, res, next) => {
    const id = Number(req.params[param]);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'Invalid event id' });

    const event = await getEventById(id);
    const allowed = event && (!isPublisher(req.user)
      || (event.external_event_id && req.user.eventIds?.includes(String(event.external_event_id))));
    if (!allowed) return res.status(404).json({ error: 'Event not found' });

    req.event = event;
    next();
  };
}

module.exports = { requireAuth, requireStaffOrPublisher, requireRole, requireEventAccess, isPublisher };
