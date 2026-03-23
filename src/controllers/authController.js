const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { findUserByEmail, createUser } = require('../db/usersDB');

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

module.exports = { login, register };
