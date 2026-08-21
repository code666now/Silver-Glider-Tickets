// Lista el estado de envío de correo de las órdenes activas: cuáles ya se enviaron y
// cuáles siguen pendientes. Pensado para correr antes de send-pending-emails.js y
// confirmar qué se va a reenviar.
//
// Uso en la Shell de Railway:
//   node scripts/list-pending-emails.js            (todas)
//   node scripts/list-pending-emails.js --pending   (solo las pendientes)
require('dotenv').config();
const pool = require('../src/config/db');

async function main() {
  const onlyPending = process.argv.includes('--pending');

  const result = await pool.query(
    `SELECT order_number, buyer_email, quantity, email_sent_at, email_attempts,
            email_last_attempt_at, email_last_error, created_at
     FROM sg_orders
     WHERE order_status = 'active' AND buyer_email IS NOT NULL
     ORDER BY created_at DESC`
  );

  const sent = result.rows.filter((o) => o.email_sent_at);
  const pending = result.rows.filter((o) => !o.email_sent_at);

  if (!onlyPending) {
    console.log(`\n✓ Enviados (${sent.length})`);
    for (const o of sent) {
      console.log(`  ${o.order_number}  ${o.buyer_email}  enviado ${o.email_sent_at.toISOString()}`);
    }
  }

  console.log(`\n✗ Pendientes (${pending.length})`);
  for (const o of pending) {
    console.log(
      `  ${o.order_number}  ${o.buyer_email}  intentos=${o.email_attempts}` +
      `${o.email_last_error ? `  último error: ${o.email_last_error}` : ''}`
    );
  }

  if (pending.length) {
    console.log('\nPara reenviarlas todas: npm run send-pending-emails');
  }
  console.log('');
}

main()
  .catch((err) => {
    console.error('✖ Error:', err.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
