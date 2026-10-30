const pool = require('../config/db');

// Marca el jti como usado. Devuelve false si ya se había canjeado (reuso del token).
// Aprovecha para borrar los vencidos: la tabla nunca crece más allá de ~5 min de logins.
async function consumeSsoToken(jti, expiresAt) {
  await pool.query('DELETE FROM sg_sso_used_tokens WHERE expires_at < NOW()');
  const result = await pool.query(
    'INSERT INTO sg_sso_used_tokens (jti, expires_at) VALUES ($1, $2) ON CONFLICT (jti) DO NOTHING RETURNING jti',
    [jti, expiresAt]
  );
  return result.rowCount === 1;
}

module.exports = { consumeSsoToken };
