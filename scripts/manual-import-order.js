// Recupera manualmente una orden "atrapada" detrás de un external_order_id que ya
// estaba en uso (colisión detectada por el aviso "⚠ MISMATCH" que loguea
// ordersController.importOrder). Crea la orden + tickets correctos y envía el correo
// de confirmación al comprador real, sin pasar por la idempotencia normal de /import.
//
// Uso en la Shell de Railway (el servicio ya tiene DATABASE_URL y RESEND_API_KEY
// cargadas como variables de entorno, así que no hace falta nada más):
//
//   node scripts/manual-import-order.js '{"external_event_id":"13","buyer_email":"davidleonardo220@gmail.com","buyer_first_name":"David","buyer_last_name":"Leonardo","quantity":1,"ticket_type":"General Admission"}'
//
// Campos aceptados (mismo payload que POST /api/orders/import):
//   external_event_id | event_id   -> al menos uno de los dos
//   buyer_email        -> obligatorio: es a quién se le envía el correo
//   buyer_first_name, buyer_last_name, buyer_phone, total_amount, ticket_type
//   quantity            -> por defecto 1
//   external_order_id   -> opcional; si se omite se genera uno sintético "manual-<timestamp>"
//                          para no chocar con el external_order_id original ya ocupado
require('dotenv').config();
const { performImport } = require('../src/lib/orderImporter');
const pool = require('../src/config/db');

async function main() {
  const raw = process.argv[2];
  if (!raw) {
    console.error('Uso: node scripts/manual-import-order.js \'{"external_event_id":"13","buyer_email":"...","buyer_first_name":"...","buyer_last_name":"...","quantity":1,"ticket_type":"General Admission"}\'');
    process.exitCode = 1;
    return;
  }

  let payload;
  try {
    payload = JSON.parse(raw);
  } catch (e) {
    console.error('El argumento no es JSON válido:', e.message);
    process.exitCode = 1;
    return;
  }

  if (!payload.buyer_email) {
    console.error('buyer_email es obligatorio: sin destinatario no hay a quién enviarle el correo.');
    process.exitCode = 1;
    return;
  }
  if (!payload.event_id && !payload.external_event_id) {
    console.error('Hace falta event_id o external_event_id.');
    process.exitCode = 1;
    return;
  }
  if (!payload.quantity) payload.quantity = 1;

  const external_order_id = payload.external_order_id || `manual-${Date.now()}`;
  if (!payload.external_order_id) {
    console.log(`(sin external_order_id en el payload; se usa uno sintético para no chocar con el original: ${external_order_id})`);
  }

  try {
    const { order, tickets } = await performImport({ ...payload, external_order_id });
    console.log(`\n✓ Orden creada manualmente: ${order.order_number} (id=${order.id})`);
    console.log(`  buyer_email: ${order.buyer_email}`);
    console.log(`  tickets: ${tickets.map(t => t.ticket_id).join(', ')}`);
    console.log(`  external_order_id guardado: ${external_order_id}`);
    console.log('  (revisá los logs [orderImporter] de arriba para confirmar el envío del correo; si falló, el barredor de emailRetry lo reintentará solo)');
  } catch (err) {
    console.error('✖ Error:', err.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

main();
