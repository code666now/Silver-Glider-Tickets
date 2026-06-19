// Prueba de integración end-to-end del acople (Parte 1 del PLAN_DE_ACOPLE.md).
//
// Qué hace, de forma autónoma:
//   1. Aplica migraciones + siembra un admin de prueba (vía DATABASE_URL).
//   2. Arranca el servidor (src/index.js) en un proceso aparte.
//   3. Ejercita el flujo S2S y de puerta, y al final lo apaga.
//
// Requisitos: PostgreSQL accesible vía DATABASE_URL en .env.
// Uso:  node scripts/test-integration.js   (o: npm run test:integration)
//
// Crea datos de prueba con prefijos evt-/ord- y el usuario qa-admin@silverglider.test.

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const bcrypt = require('bcryptjs');
const { Pool } = require('pg');

const PORT = process.env.PORT || 3000;
const BASE_URL = process.env.TEST_BASE_URL || `http://localhost:${PORT}`;

// La API key debe ser la misma en el test y en el servidor que arrancamos.
if (!process.env.SERVICE_API_KEY) {
  process.env.SERVICE_API_KEY = crypto.randomBytes(16).toString('hex');
  console.log('• SERVICE_API_KEY no estaba definida; se generó una temporal para la prueba.');
}
const SERVICE_API_KEY = process.env.SERVICE_API_KEY;

const ADMIN_EMAIL = process.env.TEST_ADMIN_EMAIL || 'qa-admin@silverglider.test';
const ADMIN_PASSWORD = process.env.TEST_ADMIN_PASSWORD || 'qa-password-123';

let passed = 0;
let failed = 0;
function check(name, cond, extra = '') {
  if (cond) {
    console.log(`  ✅ ${name}`);
    passed++;
  } else {
    console.log(`  ❌ ${name}${extra ? '  -> ' + extra : ''}`);
    failed++;
  }
}

async function api(method, pathname, { body, token, serviceKey } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (serviceKey) headers['x-api-key'] = serviceKey;
  const res = await fetch(`${BASE_URL}${pathname}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try {
    data = await res.json();
  } catch {
    /* respuesta sin JSON */
  }
  return { status: res.status, data };
}

async function setupDb() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  });
  try {
    await pool.query('CREATE EXTENSION IF NOT EXISTS pgcrypto');
  } catch (e) {
    console.warn('  aviso pgcrypto:', e.message);
  }

  const dir = path.join(__dirname, '../src/migrations');
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.sql')).sort()) {
    await pool.query(fs.readFileSync(path.join(dir, f), 'utf8'));
  }

  const hash = await bcrypt.hash(ADMIN_PASSWORD, 10);
  await pool.query(
    `INSERT INTO sg_users (email, password_hash, first_name, last_name, role)
     VALUES ($1, $2, 'QA', 'Admin', 'admin')
     ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash, role = 'admin'`,
    [ADMIN_EMAIL, hash]
  );
  await pool.end();
}

function waitForServer(timeoutMs = 15000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    (async function poll() {
      try {
        await fetch(`${BASE_URL}/api/events`); // cualquier respuesta = servidor arriba
        resolve();
      } catch {
        if (Date.now() - start > timeoutMs) return reject(new Error('El servidor no arrancó a tiempo'));
        setTimeout(poll, 400);
      }
    })();
  });
}

async function main() {
  console.log(`\n▶ Prueba de integración contra ${BASE_URL}\n`);

  console.log('• Preparando BD (migraciones + admin de prueba)...');
  await setupDb();

  console.log('• Arrancando el servidor...');
  const server = spawn(process.execPath, ['src/index.js'], {
    env: { ...process.env, SERVICE_API_KEY },
    stdio: ['ignore', 'ignore', 'inherit'],
  });

  try {
    await waitForServer();
    console.log('  servidor arriba.\n');

    // 1. Login admin (JWT para rutas de personal)
    const login = await api('POST', '/api/auth/login', {
      body: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
    });
    check('login admin -> 200 + token', login.status === 200 && !!login.data?.token, JSON.stringify(login.data));
    const token = login.data?.token;

    // 2. Upsert de evento por id externo (S2S, x-api-key)
    const extEvent = `evt-${Date.now()}`;
    const upsert = await api('PUT', `/api/events/by-external/${extEvent}`, {
      serviceKey: SERVICE_API_KEY,
      body: { name: 'QA Show', event_date: '2026-12-31T20:00:00Z', venue: 'QA Venue', capacity: 100, image_url: '' },
    });
    check('upsert evento -> 200 + id', upsert.status === 200 && !!upsert.data?.id, JSON.stringify(upsert.data));

    // 2b. Upsert de nuevo -> mismo id (idempotente)
    const upsert2 = await api('PUT', `/api/events/by-external/${extEvent}`, {
      serviceKey: SERVICE_API_KEY,
      body: { name: 'QA Show (editado)', event_date: '2026-12-31T20:00:00Z', venue: 'QA Venue', capacity: 120, image_url: '' },
    });
    check('upsert evento idempotente -> mismo id', upsert2.data?.id === upsert.data?.id);

    // 3. Import de orden (S2S) con external_event_id + external_order_id
    const extOrder = `ord-${Date.now()}`;
    const imp = await api('POST', '/api/orders/import', {
      serviceKey: SERVICE_API_KEY,
      body: {
        external_order_id: extOrder,
        external_event_id: extEvent,
        buyer_first_name: 'Jane',
        buyer_last_name: 'Doe',
        buyer_email: 'jane@example.com',
        buyer_phone: '+10000000000',
        total_amount: 90.0,
        quantity: 2,
        ticket_type: 'General Admission',
      },
    });
    check('import -> 201 + 2 tickets', imp.status === 201 && imp.data?.tickets?.length === 2, JSON.stringify(imp.data).slice(0, 200));
    check('tickets nacen con qr_token (Cambio 1)', !!imp.data?.tickets?.every((t) => !!t.qr_token));
    const order = imp.data?.order || {};
    const tickets = imp.data?.tickets || [];

    // 4. Import idempotente (mismo external_order_id) -> misma orden, sin duplicar
    const imp2 = await api('POST', '/api/orders/import', {
      serviceKey: SERVICE_API_KEY,
      body: { external_order_id: extOrder, external_event_id: extEvent, buyer_first_name: 'Jane', buyer_last_name: 'Doe', quantity: 2 },
    });
    check('import idempotente -> misma orden (Cambio 4)', imp2.data?.order?.id === order.id && imp2.data?.idempotent === true);

    // 5. Evento no mapeado -> 422
    const unmapped = await api('POST', '/api/orders/import', {
      serviceKey: SERVICE_API_KEY,
      body: { external_order_id: `ord-x-${Date.now()}`, external_event_id: 'no-existe', quantity: 1 },
    });
    check('import con evento no mapeado -> 422 (Cambio 5)', unmapped.status === 422);

    // 6. Import sin x-api-key -> 401
    const noKey = await api('POST', '/api/orders/import', { body: { external_order_id: 'x', quantity: 1 } });
    check('import sin api key -> 401 (Cambio 3)', noKey.status === 401);

    // 7. Wallet data -> tickets con QR (imagen)
    const wRes = await fetch(`${BASE_URL}/wallet/data?order=${order.order_number}&token=${order.secure_token}`);
    const wData = await wRes.json().catch(() => ({}));
    check('wallet/data -> tickets con qr_image', wRes.status === 200 && !!wData.tickets?.every((t) => !!t.qr_image));

    // 8. Scan ticket 1 -> success
    const scan1 = await api('POST', `/api/tickets/scan/${tickets[0]?.qr_token}`, { token });
    check('scan ticket 1 -> success', scan1.data?.result === 'success', JSON.stringify(scan1.data));

    // 9. Scan ticket 1 de nuevo -> already_checked_in
    const scan1b = await api('POST', `/api/tickets/scan/${tickets[0]?.qr_token}`, { token });
    check('scan ticket 1 repetido -> already_checked_in', scan1b.data?.result === 'already_checked_in');

    // 10. Void de la orden (S2S, propagación de refund)
    const voided = await api('POST', `/api/orders/${extOrder}/void`, { serviceKey: SERVICE_API_KEY });
    check('void orden -> success (Cambio 7)', voided.status === 200 && voided.data?.success === true);

    // 11. Scan ticket 2 tras refund -> refunded (puerta cerrada)
    const scan2 = await api('POST', `/api/tickets/scan/${tickets[1]?.qr_token}`, { token });
    check('scan ticket 2 tras refund -> refunded', scan2.data?.result === 'refunded', JSON.stringify(scan2.data));
  } catch (err) {
    console.error('\nError inesperado durante la prueba:', err.message);
    failed++;
  } finally {
    server.kill();
  }

  console.log(`\n── Resultado: ${passed} OK, ${failed} fallidos ──\n`);
  process.exit(failed ? 1 : 0);
}

main();
