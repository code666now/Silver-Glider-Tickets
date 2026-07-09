// Reintento de correos de confirmación que fallaron en el import.
//
// El envío inicial vive en importOrder. Si Resend lo rechaza, la orden queda con
// email_sent_at NULL y este barredor la recoge pasados EMAIL_RETRY_DELAY_MINUTES.
// El estado vive en la base de datos, no en memoria: Railway reinicia el proceso en
// cada deploy, y un setTimeout pendiente se perdería sin dejar rastro.
const { claimOrdersPendingEmail, markEmailSent, recordEmailFailure } = require('../db/ordersDB');
const { getTicketsByOrder } = require('../db/ticketsDB');
const { getEventById } = require('../db/eventsDB');
const { sendOrderConfirmation } = require('./mailer');

const DELAY_MINUTES = Number(process.env.EMAIL_RETRY_DELAY_MINUTES || 5);
const MAX_ATTEMPTS = Number(process.env.EMAIL_RETRY_MAX_ATTEMPTS || 5);
const TICK_MS = Number(process.env.EMAIL_RETRY_TICK_MS || 60_000);
const BATCH = 20;

async function retryPendingEmails() {
  const orders = await claimOrdersPendingEmail({
    delayMinutes: DELAY_MINUTES,
    maxAttempts: MAX_ATTEMPTS,
    limit: BATCH
  });
  if (!orders.length) return;

  console.log(`[emailRetry] ${orders.length} orden(es) con correo pendiente`);
  for (const order of orders) {
    try {
      const [tickets, event] = await Promise.all([
        getTicketsByOrder(order.id),
        getEventById(order.event_id)
      ]);
      await sendOrderConfirmation({
        to: order.buyer_email,
        buyer_first_name: order.buyer_first_name,
        event,
        order,
        tickets
      });
      await markEmailSent(order.id);
      console.log(`[emailRetry] ✓ ${order.order_number} reenviado (intento ${order.email_attempts})`);
    } catch (err) {
      await recordEmailFailure(order.id, err.message);
      const restantes = MAX_ATTEMPTS - order.email_attempts;
      console.error(
        `[emailRetry] ✖ ${order.order_number} falló (intento ${order.email_attempts}/${MAX_ATTEMPTS}` +
        `${restantes > 0 ? `, reintenta en ${DELAY_MINUTES} min` : ', agotado'}): ${err.message}`
      );
    }
  }
}

function startEmailRetryWorker() {
  if (!process.env.RESEND_API_KEY) {
    console.log('[emailRetry] Desactivado (no RESEND_API_KEY)');
    return null;
  }

  const tick = () => {
    // Un fallo de red contra Postgres no debe tumbar el proceso ni detener el barrido:
    // el siguiente tick vuelve a intentarlo.
    retryPendingEmails().catch((err) => console.error('[emailRetry] ✖ Barrido falló:', err.message));
  };

  const timer = setInterval(tick, TICK_MS);
  timer.unref();
  console.log(
    `[emailRetry] Activo: cada ${TICK_MS / 1000}s, reintenta tras ${DELAY_MINUTES} min, máx ${MAX_ATTEMPTS} intentos`
  );
  return timer;
}

module.exports = { startEmailRetryWorker, retryPendingEmails };
