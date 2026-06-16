const jwt = require('jsonwebtoken');

function requireAuth(req, res, next) {
  const header = req.headers.authorization;
  if (!header) return res.status(401).json({ error: 'No token provided' });

  const token = header.split(' ')[1];
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    next();
  };
}

function requireActivationsAdmin(req, res, next) {
  const header = req.headers.authorization;
  if (!header) return res.status(401).json({ error: 'Unauthorized' });
  const token = header.split(' ')[1];
  try {
    const payload = jwt.verify(token, process.env.ACTIVATIONS_ADMIN_SECRET || 'activations-secret');
    if (payload.role !== 'activations_admin') return res.status(403).json({ error: 'Forbidden' });
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
}

module.exports = { requireAuth, requireRole, requireActivationsAdmin };
