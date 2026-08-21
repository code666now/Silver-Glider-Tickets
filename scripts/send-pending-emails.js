// Envía (o reintenta) de una sola pasada el correo de confirmación de TODAS las
// órdenes activas con email_sent_at en NULL, sin esperar el retardo entre intentos ni
// respetar el tope de reintentos que usa el barredor automático (lib/emailRetry.js).
// Pensado para forzar el envío a mano desde la Shell de Railway después de revisar
// list-pending-emails.js.
//
// Uso:
//   node scripts/send-pending-emails.js
require('dotenv').config();
const { retryPendingEmails } = require('../src/lib/emailRetry');
const pool = require('../src/config/db');

async function main() {
  if (!process.env.RESEND_API_KEY) {
    console.error('✖ No hay RESEND_API_KEY en el entorno; no se puede enviar nada.');
    process.exitCode = 1;
    return;
  }

  const { claimed, sent, failed } = await retryPendingEmails({
    delayMinutes: 0,                       // no esperar el retardo normal entre intentos
    maxAttempts: Number.MAX_SAFE_INTEGER,  // tampoco respetar el tope de intentos
    limit: 500
  });

  if (!claimed) {
    console.log('\nNo hay órdenes con correo pendiente.');
    return;
  }
  console.log(`\n${claimed} orden(es) pendiente(s) -> ${sent} enviada(s), ${failed} fallida(s).`);
  if (failed) {
    console.log('Revisá los logs [emailRetry] de arriba para el detalle (queda también en email_last_error).');
  }
}

main()
  .catch((err) => {
    console.error('✖ Error:', err.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
