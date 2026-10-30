const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { findUserByEmail, createUser } = require('../db/usersDB');
const { consumeSsoToken } = require('../db/ssoDB');
const { verifyPrincipalToken, issuePublisherSession } = require('../lib/sso');

async function login(req, res) {
  const { email, password } = req.body;
  try {
    const user = await findUserByEmail(email);
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(401).json({ error: 'Invalid credentials' });

    const token = jwt.sign(
      { id: user.id, email: user.email, role: user.role, first_name: user.first_name },
      process.env.JWT_SECRET,
      { expiresIn: '12h' }
    );

    res.json({ token, role: user.role, first_name: user.first_name });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function register(req, res) {
  const { email, password, first_name, last_name, role } = req.body;
  try {
    const password_hash = await bcrypt.hash(password, 10);
    const user = await createUser({ email, password_hash, first_name, last_name, role: role || 'staff' });
    res.status(201).json({ id: user.id, email: user.email, role: user.role });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// Canjea el token SSO del principal (5 min, un solo uso) por una sesión local de publicador.
async function ssoExchange(req, res) {
  const { token } = req.body || {};
  if (!token || typeof token !== 'string') return res.status(400).json({ error: 'Token required' });
  try {
    const sso = verifyPrincipalToken(token);
    const fresh = await consumeSsoToken(sso.jti, sso.expiresAt);
    if (!fresh) return res.status(401).json({ error: 'SSO token already used' });

    console.log(`[sso] ✓ Sesión de publicador para usuario ${sso.externalUserId} (${sso.role}), ${sso.eventIds.length} evento(s)`);
    res.json({
      token: issuePublisherSession(sso),
      kind: 'publisher',
      role: sso.role,
      first_name: sso.firstName,
    });
  } catch (err) {
    if (err.statusCode) return res.status(err.statusCode).json({ error: err.message });
    console.error('[sso] ✖ Error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
}

// Identidad de la sesión actual, para que las vistas sepan qué mostrar.
function me(req, res) {
  const { kind, role, first_name, email } = req.user;
  res.json({ kind: kind || 'staff', role, first_name: first_name || null, email: email || null });
}

module.exports = { login, register, ssoExchange, me };
