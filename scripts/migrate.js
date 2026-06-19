// Runner simple de migraciones: aplica en orden todos los .sql de src/migrations.
// Uso: node scripts/migrate.js   (o: npm run migrate)
const fs = require('fs');
const path = require('path');
const pool = require('../src/config/db');

async function migrate() {
  const dir = path.join(__dirname, '../src/migrations');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();

  // pgcrypto: necesario para gen_random_bytes() en 002. No-op si ya existe.
  try {
    await pool.query('CREATE EXTENSION IF NOT EXISTS pgcrypto');
  } catch (e) {
    console.warn('Aviso: no se pudo asegurar pgcrypto:', e.message);
  }

  for (const f of files) {
    const sql = fs.readFileSync(path.join(dir, f), 'utf8');
    process.stdout.write(`Aplicando ${f} ... `);
    await pool.query(sql);
    console.log('OK');
  }

  await pool.end();
  console.log('Migraciones aplicadas.');
}

migrate().catch((err) => {
  console.error('Falló la migración:', err.message);
  process.exit(1);
});
