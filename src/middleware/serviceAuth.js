const jwt = require('jsonwebtoken');

// Solo servicio: exige la API key compartida (canal S2S con el backend principal).
function requireServiceKey(req, res, next) {
  const key = req.headers['x-api-key'];
  if (!key || !process.env.SERVICE_API_KEY || key !== process.env.SERVICE_API_KEY) {
    return res.status(401).json({ error: 'Invalid service key' });
  }
  req.isService = true;
  next();
}

// Servicio (API key) O admin humano (JWT). No rompe el panel admin existente.
function requireServiceOrAdmin(req, res, next) {
  const key = req.headers['x-api-key'];
  if (key && process.env.SERVICE_API_KEY && key === process.env.SERVICE_API_KEY) {
    req.isService = true;
    return next();
  }

  const header = req.headers.authorization;
  if (!header) return res.status(401).json({ error: 'No credentials provided' });

  const token = header.split(' ')[1];
  try {
    const user = jwt.verify(token, process.env.JWT_SECRET);
    if (user.role !== 'admin') return res.status(403).json({ error: 'Forbidden' });
    req.user = user;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
}

module.exports = { requireServiceKey, requireServiceOrAdmin };
