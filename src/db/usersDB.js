const pool = require('../config/db');

async function findUserByEmail(email) {
  const result = await pool.query('SELECT * FROM sg_users WHERE email = $1', [email]);
  return result.rows[0];
}

async function createUser({ email, password_hash, first_name, last_name, role }) {
  const result = await pool.query(
    'INSERT INTO sg_users (email, password_hash, first_name, last_name, role) VALUES ($1,$2,$3,$4,$5) RETURNING *',
    [email, password_hash, first_name, last_name, role]
  );
  return result.rows[0];
}

module.exports = { findUserByEmail, createUser };
