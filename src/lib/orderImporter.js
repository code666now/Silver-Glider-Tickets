const {
  createOrder, markEmailAttempt, markEmailSent, recordEmailFailure
} = require('../db/ordersDB');
const { createTicket } = require('../db/ticketsDB');
const { getEventById, getEventByExternalId, upsertEventByExternal } = require('../db/eventsDB');
const { generateOrderNumber, generateTicketId } = require('./idGenerator');
const { generateSecureToken } = require('./tokenGenerator');
const { sendOrderConfirmation } = require('./mailer');
const { fetchEventoFromPrincipal } = require('./principalClient');

// Devuelve el evento local (sg_events) para un external_event_id, creándolo desde el
// principal si todavía no existe (pull-on-import). Lanza 422 solo si tampoco existe
// en el principal.
async function resolveEventByExternalId(externalEventId) {
  let event = await getEventByExternalId(externalEventId);
  if (event) return event;

  console.log(`[orderImporter] evento ${externalEventId} no mapeado; resolviendo desde el principal…`);
  const evento = await fetchEventoFromPrincipal(externalEventId);
  if (!evento) {
    const err = new Error('event not mapped');     // tampoco existe en el principal
    err.statusCode = 422;
    throw err;
  }

  // upsertEventByExternal es idempotente por external_event_id: si otro import lo creó
  // en paralelo, el ON CONFLICT devuelve la fila existente sin duplicar.
  event = await upsertEventByExternal(String(externalEventId), {
    name: evento.titulo,
    event_date: evento.fecha,
    venue: evento.ubicacion || null,
    capacity: null,
    image_url: Array.isArray(evento.galeriaImagenes) ? (evento.galeriaImagenes[0] || null) : null,
  });
  console.log(`[orderImporter] evento ${externalEventId} auto-creado en sg_events (id local ${event.id}).`);
  return event;
}

// Crea la orden y sus tickets, y envía (o deja pendiente de reintento) el correo de
// confirmación. No aplica idempotencia por external_order_id: eso es responsabilidad
// del llamador — ver ordersController.importOrder (HTTP, idempotente) y
// scripts/manual-import-order.js (recuperación manual de una orden atrapada).
async function performImport({
  event_id, external_event_id, external_order_id,
  buyer_first_name, buyer_last_name, buyer_email, buyer_phone,
  total_amount, quantity, ticket_type
}) {
  let resolvedEventId = event_id;
  if (external_event_id) {
    const event = await resolveEventByExternalId(external_event_id);
    resolvedEventId = event.id;
  }
  if (!resolvedEventId) {
    const err = new Error('event_id or external_event_id required');
    err.statusCode = 400;
    throw err;
  }
  console.log(`[orderImporter] ✓ Evento resuelto: id=${resolvedEventId}`);

  const order_number = generateOrderNumber();
  const secure_token = generateSecureToken();

  const order = await createOrder({
    event_id: resolvedEventId, order_number, buyer_first_name, buyer_last_name,
    buyer_email, buyer_phone, total_amount, quantity, secure_token, external_order_id
  });
  console.log(`[orderImporter] ✓ Orden creada: ${order.order_number} (id=${order.id})`);

  const tickets = [];
  for (let i = 0; i < quantity; i++) {
    const ticket = await createTicket({
      order_id: order.id,
      event_id: resolvedEventId,
      ticket_id: generateTicketId(),
      ticket_type: ticket_type || 'General Admission',
      attendee_first_name: buyer_first_name,
      attendee_last_name: buyer_last_name
    });
    tickets.push(ticket);
  }
  console.log(`[orderImporter] ✓ ${tickets.length} ticket(s) generado(s): ${tickets.map(t => t.ticket_id).join(', ')}`);

  // El correo no bloquea el import: la orden y los tickets ya existen y son válidos.
  // Si el envío falla, email_sent_at queda NULL y lib/emailRetry.js lo reintenta.
  if (buyer_email && process.env.RESEND_API_KEY) {
    await markEmailAttempt(order.id);
    try {
      const event = await getEventById(resolvedEventId);
      console.log(`[orderImporter] ✉ Enviando correo de confirmación a ${buyer_email}...`);
      await sendOrderConfirmation({ to: buyer_email, buyer_first_name, event, order, tickets });
      await markEmailSent(order.id);
      console.log(`[orderImporter] ✓ Correo de confirmación enviado a ${buyer_email}`);
    } catch (emailErr) {
      await recordEmailFailure(order.id, emailErr.message);
      console.error(`[orderImporter] ✖ Email failed (se reintentará): ${emailErr.message}`);
    }
  } else if (buyer_email) {
    console.log('[orderImporter] ⚠ Correo omitido (no RESEND_API_KEY); quedará pendiente de reintento');
  } else {
    // Sin destinatario no hay nada que reintentar: se da por cerrado.
    await markEmailSent(order.id);
    console.log('[orderImporter] ⚠ Correo omitido (orden sin buyer_email)');
  }

  return { order, tickets };
}

module.exports = { performImport, resolveEventByExternalId };
