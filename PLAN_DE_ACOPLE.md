# Plan de Acople — Silver Glider Tickets ↔ Backend Principal

> Plan de implementación de los cambios necesarios para acoplar **Silver Glider
> Tickets** (este microservicio) con el **backend principal** (marketplace Stripe
> Connect, `ANALISIS_BACKEND.md`).
>
> **Decisiones ya tomadas:**
> - **Problema 3 (mapeo de eventos): Opción A** → columna `external_event_id` en `sg_events`.
> - **Problema 4 (auth servicio-a-servicio): Opción 2** → **API key** (`x-api-key`) compartida.
>
> Documentos relacionados: `DOCUMENTACION_FUNCIONAL_TICKETING.md`,
> `INTEGRACION_CON_BACKEND_PRINCIPAL.md`, `ANALISIS_BACKEND.md`.

---

## 0. Resumen del plan

| # | Cambio | Lado | Tipo | Prioridad |
|---|---|---|---|---|
| 1 | Generar `qr_token` al emitir tickets | Ticketing | Fix bloqueante | 🔴 |
| 2 | Migración: `external_event_id`, `external_order_id` | Ticketing | DB | 🔴 |
| 3 | Middleware de API key S2S (`x-api-key`) | Ticketing | Auth | 🔴 |
| 4 | `import` idempotente por `external_order_id` | Ticketing | Lógica | 🔴 |
| 5 | Resolución de evento por `external_event_id` | Ticketing | Lógica | 🟠 |
| 6 | Upsert de eventos por `external_event_id` | Ticketing | Lógica | 🟠 |
| 7 | Endpoint de anulación (refund) | Ticketing | Lógica | 🟠 |
| 8 | CORS + variables de entorno | Ticketing | Config | 🟡 |
| 9 | Rate-limit en endpoints públicos | Ticketing | Hardening | 🟢 |
| A | Cliente HTTP hacia el ticketing | Principal | Integración | 🔴 |
| B | Llamar `import` tras pago confirmado | Principal | Integración | 🔴 |
| C | Propagar alta/edición de eventos | Principal | Integración | 🟠 |
| D | Propagar refund (anulación) | Principal | Integración | 🟠 |
| E | Persistir `order_number` del ticketing | Principal | Trazabilidad | 🟡 |

---

# PARTE 1 — Cambios en el Ticketing (este repo)

## Cambio 1 — Generar `qr_token` al emitir tickets 🔴

**Por qué:** hoy `createTicket` no asigna `qr_token`; sin él, el check-in por escaneo
(`checkInTicketByScan`) y el QR de la wallet no funcionan para tickets nuevos. **Bloqueante.**

**Archivo:** [src/db/ticketsDB.js](src/db/ticketsDB.js#L3)

**Acción:** incluir la generación del token en el `INSERT`. Dos variantes equivalentes:
- En SQL: `qr_token = encode(gen_random_bytes(32), 'hex')` (requiere `pgcrypto`).
- En Node: reutilizar [`generateSecureToken()`](src/lib/tokenGenerator.js) y pasarlo como parámetro.

Recomendado: generarlo en Node (no depende de extensión de Postgres) e insertarlo como
columna explícita en `createTicket`.

**Criterio de aceptación:** todo ticket creado vía `/api/orders/import` tiene `qr_token`
no nulo y escaneable en `/checkin`.

---

## Cambio 2 — Migración de columnas de integración 🔴

**Por qué:** soportar el mapeo de eventos (Opción A) y la idempotencia de import.

**Archivo nuevo:** `src/migrations/003_integration.sql`

```sql
-- Mapeo de evento del backend principal (Opción A)
ALTER TABLE sg_events ADD COLUMN IF NOT EXISTS external_event_id VARCHAR(64) UNIQUE;

-- Idempotencia de import (id de la Order o payment_intent del principal)
ALTER TABLE sg_orders ADD COLUMN IF NOT EXISTS external_order_id VARCHAR(64) UNIQUE;
```

**Nota:** confirmar el proceso de aplicación de migraciones (hoy se aplican a mano; no
hay runner). Documentar el comando usado.

**Criterio de aceptación:** ambas columnas existen, son `UNIQUE` y admiten NULL para
registros previos.

---

## Cambio 3 — Middleware de API key S2S (`x-api-key`) 🔴

**Por qué (Opción 2 elegida):** el backend principal llama al ticketing sin ciclo de
login. Las rutas S2S aceptan una API key compartida en lugar de un JWT humano.

**Archivo nuevo:** `src/middleware/serviceAuth.js`

```js
module.exports = function requireServiceKey(req, res, next) {
  const key = req.headers['x-api-key'];
  if (!key || key !== process.env.SERVICE_API_KEY) {
    return res.status(401).json({ error: 'Invalid service key' });
  }
  req.isService = true;
  next();
};
```

**Aplicación:** proteger las rutas S2S con este middleware *en lugar de* (o *además de*)
`requireAuth + requireRole('admin')`:
- `POST /api/orders/import`
- `POST /api/orders/:external_order_id/void` (Cambio 7)
- `POST /api/events` y `PUT /api/events/:id` (para el upsert del Cambio 6)

**Decisión de diseño:** permitir **ambos** modos en esas rutas — API key (servicio) o JWT
admin (humano). Implementar un middleware combinado `requireServiceOrAdmin` que pase si
`x-api-key` es válida **o** si hay JWT admin. Así no se rompe el uso desde el panel admin.

**Variables:** añadir `SERVICE_API_KEY` al entorno (secreto largo aleatorio). El backend
principal guarda el mismo valor.

> **Importante:** `JWT_SECRET` del ticketing y del principal siguen siendo **distintos**.
> La API key es un secreto aparte, exclusivo del canal S2S.

**Criterio de aceptación:** `import` responde 401 sin `x-api-key` válida; responde OK con
ella; el panel admin sigue funcionando con JWT.

---

## Cambio 4 — `import` idempotente por `external_order_id` 🔴

**Por qué:** el webhook de Stripe del principal puede reintentarse; sin idempotencia se
duplicarían órdenes y tickets.

**Archivos:** [src/controllers/ordersController.js](src/controllers/ordersController.js),
[src/db/ordersDB.js](src/db/ordersDB.js)

**Acción:**
1. `importOrder` ahora recibe también `external_order_id` (obligatorio en el flujo S2S).
2. Antes de crear, buscar orden existente por `external_order_id`:
   - Si existe → devolver `{ order, tickets }` existentes (200), **sin** crear nada.
   - Si no existe → crear orden + tickets como hoy y guardar `external_order_id`.
3. `createOrder` debe persistir `external_order_id`.

**Pseudo-flujo:**
```
importOrder(body):
  if body.external_order_id:
    existing = getOrderByExternalId(body.external_order_id)
    if existing: return { order: existing, tickets: getTicketsByOrder(existing.id) }
  // crear como hoy (order_number, secure_token, tickets, email)
```

**Criterio de aceptación:** dos `POST /import` con el mismo `external_order_id` producen
una sola orden y un solo set de tickets.

---

## Cambio 5 — Resolver evento por `external_event_id` (Opción A) 🟠

**Por qué:** el principal conoce su `Eventos.id`, no el `sg_events.id`. El import debe
aceptar el id externo y traducirlo.

**Archivos:** `ordersController.js`, [src/db/eventsDB.js](src/db/eventsDB.js)

**Acción:**
1. Añadir `getEventByExternalId(external_event_id)` en `eventsDB.js`.
2. En `importOrder`, aceptar `external_event_id` y resolver el `sg_events.id` local con esa
   función. (Mantener compatibilidad: si llega `event_id` local, usarlo directo.)
3. Si no existe el evento mapeado → error 422 claro (`event not mapped`), para forzar el
   alta previa (Cambio 6 / paso C del principal).

**Criterio de aceptación:** `import` con `external_event_id` válido emite tickets contra el
evento local correcto.

---

## Cambio 6 — Upsert de eventos por `external_event_id` 🟠

**Por qué:** el alta/edición de eventos del principal debe propagarse al ticketing
(Opción A). Evita el error "event not mapped" del Cambio 5.

**Archivos:** [src/controllers/eventsController.js](src/controllers/eventsController.js),
`eventsDB.js`, [src/routes/events.js](src/routes/events.js)

**Acción:**
1. `createEvent` / `updateEvent` aceptan y persisten `external_event_id`.
2. Nuevo endpoint **upsert** S2S: `PUT /api/events/by-external/:external_event_id`
   (protegido por API key) que crea o actualiza el evento según `external_event_id`.
3. Reutilizable también desde el panel admin con JWT.

**Criterio de aceptación:** el principal puede registrar/actualizar un evento en el
ticketing de forma idempotente por `external_event_id`.

---

## Cambio 7 — Endpoint de anulación por refund 🟠

**Por qué:** un ticket reembolsado en el principal debe dejar de entrar en puerta. Hoy no
existe forma de anularlo desde fuera.

**Archivos:** [src/routes/orders.js](src/routes/orders.js), `ordersDB.js`

**Acción:**
1. Nuevo endpoint S2S: `POST /api/orders/:external_order_id/void` (API key).
2. Marca `sg_orders.order_status='cancel'` y todos sus `sg_tickets.ticket_status='refunded'`.
3. El check-in por escaneo ya rechaza `refunded`/`void` → no requiere más cambios en puerta.

**Criterio de aceptación:** tras llamar al endpoint, el escaneo de cualquier ticket de esa
orden devuelve `result: 'refunded'`.

---

## Cambio 8 — CORS + variables de entorno 🟡

**Archivos:** [src/index.js](src/index.js), [.env.example](.env.example)

**Acción:**
1. Añadir `cors()` restringido a los orígenes del front del principal y de las páginas de
   puerta (lista blanca por env, p. ej. `CORS_ORIGINS`).
2. Completar `.env.example` con las variables realmente usadas:
   `DATABASE_URL`, `JWT_SECRET`, `PORT`, `NODE_ENV`, `APP_URL`, `RESEND_API_KEY`,
   `RESEND_FROM`, **`SERVICE_API_KEY`**, `CORS_ORIGINS`.

**Criterio de aceptación:** el front autorizado consume la API sin error CORS; `APP_URL`
produce un link de wallet correcto en el email.

---

## Cambio 9 — Rate-limit en endpoints públicos 🟢

**Por qué:** `/api/orders/lookup` y `/api/orders/resend-tickets` son públicos y permiten
enumeración de emails / reenvío masivo.

**Archivos:** `routes/orders.js` (+ dependencia tipo `express-rate-limit`).

**Acción:** limitar por IP (p. ej. N req/min) ambos endpoints. Opcional: captcha.

**Criterio de aceptación:** ráfagas por encima del umbral reciben 429.

---

# PARTE 2 — Cambios en el Backend Principal

> Referencias a archivos según `ANALISIS_BACKEND.md`. Ajustar a la estructura real.

## Paso A — Cliente HTTP hacia el ticketing 🔴

**Acción:** crear un módulo (p. ej. `services/ticketing.service.js`) que encapsule las
llamadas al ticketing con la `x-api-key`:
- `importOrder(payload)` → `POST {TICKETING_URL}/api/orders/import`
- `upsertEvent(payload)` → `PUT {TICKETING_URL}/api/events/by-external/:id`
- `voidOrder(externalOrderId)` → `POST {TICKETING_URL}/api/orders/:id/void`

**Config (env del principal):** `TICKETING_URL`, `SERVICE_API_KEY` (mismo valor que en el
ticketing).

---

## Paso B — Emitir tickets tras pago confirmado 🔴

**Dónde:** handler del webhook de Stripe `checkout.session.completed`, **después** de
`order.service.confirmOrder` (marca `Order=paid`).

**Acción:** llamar `ticketing.importOrder({ ... })` con:
```json
{
  "external_order_id": "<Order.id o payment_intent del principal>",
  "external_event_id": "<Evento.id>",
  "buyer_first_name": "...",
  "buyer_last_name": "...",
  "buyer_email": "...",
  "buyer_phone": "...",
  "total_amount": 90.00,
  "quantity": 2,
  "ticket_type": "General Admission"
}
```

**Robustez:**
- No hacer fallar el ACK del webhook si el ticketing está caído → encolar/reintentar.
- Guardar el `order_number` devuelto (Paso E).
- La idempotencia del Cambio 4 cubre reintentos del webhook.

---

## Paso C — Propagar alta/edición de eventos 🟠

**Dónde:** `evento.service` del principal (al crear/editar un `Evento`).

**Acción:** llamar `ticketing.upsertEvent({ external_event_id: Evento.id, name, event_date,
venue, capacity, image_url })`. Garantiza que el evento exista en el ticketing antes del
primer import (evita el 422 del Cambio 5).

---

## Paso D — Propagar refund 🟠

**Dónde:** handler del webhook `charge.refunded` del principal (ya revierte transfer y
marca `Order=refunded`).

**Acción:** llamar `ticketing.voidOrder(external_order_id)` para anular los tickets en el
ticketing.

---

## Paso E — Persistir `order_number` del ticketing 🟡

**Acción:** guardar en la `Order` del principal el `order_number` (`SGC-…`) devuelto por
`import`, para trazabilidad y soporte. Opcional: guardar también el link de wallet.

---

# PARTE 3 — Secuencia de implementación recomendada

```
1. Ticketing: Cambio 1 (qr_token)          ← desbloquea el resto
2. Ticketing: Cambio 2 (migración)
3. Ticketing: Cambio 3 (API key S2S)
4. Ticketing: Cambios 5 + 6 (eventos: resolver + upsert)
5. Ticketing: Cambio 4 (import idempotente)
6. Ticketing: Cambio 7 (void)
7. Principal: Paso A (cliente HTTP) + Paso C (upsert eventos)
8. Principal: Paso B (import tras pago)  → prueba E2E de compra
9. Principal: Paso D (refund)            → prueba E2E de refund
10. Ticketing: Cambios 8 y 9 (CORS, env, rate-limit)
```

---

# PARTE 4 — Pruebas end-to-end

**Compra feliz:**
1. Crear evento en el principal → verificar que se replicó en `sg_events` con `external_event_id`.
2. Compra + pago (Stripe test) → webhook `completed`.
3. Verificar 1 sola orden en `sg_orders` con `external_order_id`, N tickets con `qr_token`.
4. Email recibido con link de wallet válido (`APP_URL`).
5. Abrir wallet → QR visible. Escanear en `/checkin` → `result: success`.
6. Reescanear → `already_checked_in`.

**Idempotencia:**
7. Reintentar el webhook (o llamar `import` 2×) → sigue habiendo 1 orden y N tickets.

**Refund:**
8. Reembolsar en el principal → webhook `charge.refunded`.
9. Escanear ticket de esa orden → `result: refunded`.

**Seguridad:**
10. `POST /import` sin `x-api-key` → 401.
11. Ráfaga a `/lookup` → 429.

---

# PARTE 5 — Variables de entorno (consolidado)

### Ticketing (este repo)
| Variable | Uso | Nuevo |
|---|---|---|
| `DATABASE_URL` | Postgres | |
| `JWT_SECRET` | Auth de personal | |
| `PORT`, `NODE_ENV` | Runtime | |
| `APP_URL` | Link de wallet en email | (faltaba) |
| `RESEND_API_KEY`, `RESEND_FROM` | Email | (faltaba) |
| `SERVICE_API_KEY` | Auth S2S (`x-api-key`) | ✅ nuevo |
| `CORS_ORIGINS` | Lista blanca CORS | ✅ nuevo |

### Backend principal
| Variable | Uso | Nuevo |
|---|---|---|
| `TICKETING_URL` | Base URL del ticketing | ✅ nuevo |
| `SERVICE_API_KEY` | Mismo valor que el ticketing | ✅ nuevo |

---

*Plan basado en las decisiones: Problema 3 → Opción A (`external_event_id`), Problema 4 →
Opción 2 (API key S2S). El acople se concentra en el seam `POST /api/orders/import` más la
propagación de eventos (upsert) y de refunds (void). Solo documentación; sin cambios de
código aplicados.*
