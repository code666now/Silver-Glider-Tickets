# Guía de Integración — Acople de Silver Glider Tickets al Backend Principal

> Cómo conectar **Silver Glider Tickets** (servicio de ticketing, este repo) como un
> **servicio aparte** consumido por el **backend principal** (marketplace de venta +
> Stripe Connect descrito en `ANALISIS_BACKEND.md`).
>
> Documentos relacionados:
> - `DOCUMENTACION_FUNCIONAL_TICKETING.md` — qué hace este servicio.
> - `ANALISIS_BACKEND.md` — qué hace el backend principal.

---

## 1. Reparto de responsabilidades

La idea del acople es una **separación limpia entre cobro y entrega**:

| Responsabilidad | Dueño |
|---|---|
| Catálogo de eventos de cara al público, precios, ventana de venta | **Backend principal** |
| Checkout, pago, Stripe Connect, comisiones, refunds, disputas | **Backend principal** |
| Confirmación de pago (webhook `checkout.session.completed`) | **Backend principal** |
| **Emisión de tickets, QR, wallet, email de entrada** | **Ticketing (este servicio)** |
| **Check-in en puerta (scan / doorlist)** | **Ticketing (este servicio)** |
| Reembolso → anulación de tickets | Coordinado (principal dispara, ticketing aplica) |

**Regla de oro:** el ticketing **nunca** cobra ni conoce Stripe. El backend principal
**nunca** genera QR ni hace check-in. El punto de contacto es una **orden ya pagada**.

```
   Cliente ─compra─▶ Backend principal ─pago Stripe─▶ webhook "paid"
                                                          │
                                          (al confirmar la orden)
                                                          ▼
                                   POST /api/orders/import  ──▶  Silver Glider Tickets
                                                                  │ emite tickets + QR
                                                                  │ envía email con wallet
                                                                  ▼
                                                      Comprador abre la wallet / entra a la puerta
```

---

## 2. El seam de integración: `POST /api/orders/import`

El único punto por el que el backend principal **inyecta datos** en el ticketing es
[`POST /api/orders/import`](src/routes/orders.js) (ver `ordersController.importOrder`).

**Contrato actual:**
```http
POST /api/orders/import
Authorization: Bearer <JWT de un usuario admin del ticketing>
Content-Type: application/json

{
  "event_id": 12,                       // id del evento EN EL TICKETING (ver §3)
  "buyer_first_name": "Jane",
  "buyer_last_name": "Doe",
  "buyer_email": "jane@example.com",
  "buyer_phone": "+1...",
  "total_amount": 90.00,                // informativo
  "quantity": 2,                        // nº de tickets a emitir
  "ticket_type": "General Admission"
}
```
**Respuesta:** `{ order, tickets }` — incluye `order.order_number` (`SGC-…`) y
`order.secure_token` (llave de la wallet).

> Este endpoint es **idempotente-inseguro**: cada llamada crea una orden nueva. El
> backend principal debe llamarlo **exactamente una vez por pago confirmado**. Ver §6.

### Cuándo lo llama el backend principal

En el handler del webhook de Stripe del backend principal
(`checkout.session.completed`), **después** de marcar la `Order` como `paid`
(ver `services/order.service.js` → `confirmOrder` en `ANALISIS_BACKEND.md`), añadir un
paso que haga el `POST /api/orders/import` al ticketing con los datos del comprador.

---

## 3. Problema clave: mapeo de `event_id`

Los dos sistemas tienen **catálogos de eventos independientes**:
- Backend principal: `Eventos.id` (Sequelize).
- Ticketing: `sg_events.id` (SERIAL local).

`import` espera el `event_id` **del ticketing**. Hay que resolver la correspondencia.
Opciones, de menor a mayor esfuerzo:

| Opción | Cómo | Pros / Contras |
|---|---|---|
| **A. Columna de mapeo** (recomendada) | Añadir `external_event_id` a `sg_events` y guardar el `Eventos.id` del principal. El principal resuelve `sg_events.id` por ese campo antes de importar. | Limpio, desacoplado. Requiere mantener el alta de eventos en ambos lados. |
| **B. Tabla de correspondencia en el principal** | El backend principal guarda `{ eventoId → sgEventId }` y lo consulta al importar. | No toca el esquema del ticketing. Estado duplicado. |
| **C. Crear el evento en el ticketing al vuelo** | Antes del primer import, el principal hace `POST /api/events` y cachea el id devuelto. | Automático. Hay que evitar duplicados (idempotencia por nombre/fecha). |

> Sea cual sea la opción, **el alta de eventos debe propagarse del principal al
> ticketing** (manual o vía API). Hoy `POST /api/events` (admin) permite hacerlo.

Sugerencia de esquema para Opción A:
```sql
ALTER TABLE sg_events ADD COLUMN IF NOT EXISTS external_event_id VARCHAR(64) UNIQUE;
```

---

## 4. Autenticación entre servicios (S2S)

Hoy `import`, `events` y `register` exigen un **JWT con rol `admin`** firmado con el
`JWT_SECRET` del ticketing. Para llamadas servicio-a-servicio hay dos caminos:

| Enfoque | Descripción | Recomendación |
|---|---|---|
| **Usuario de servicio + JWT** | Crear un `admin` dedicado (p. ej. `svc-backend@…`) en `sg_users`; el backend principal hace `login` y reutiliza el token (12h) o re-loguea al expirar. | Funciona sin tocar código. Gestionar expiración. |
| **API key / secret compartido** (mejor) | Añadir un middleware que acepte `x-api-key: <SERVICE_API_KEY>` para rutas S2S, evitando el ciclo de login. | Más simple y estable para S2S. Requiere ~20 líneas nuevas. |

> **Importante:** los dos servicios deben tener `JWT_SECRET` **distintos** (son dominios
> de confianza separados). Un token del backend principal **no** debe ser válido en el
> ticketing y viceversa. No compartir el secreto.

Recomendación: implementar el middleware de API key para `/api/orders/import` (y, si se
usa Opción C, para `/api/events`), dejando el JWT para el personal humano (checkin, admin).

---

## 5. Pre-requisitos en el ticketing antes de integrar

Estos puntos (detallados en `DOCUMENTACION_FUNCIONAL_TICKETING.md` §8) deben resolverse
**antes** de conectar el flujo real:

1. **Generar `qr_token` al emitir tickets.** Hoy `createTicket` no lo hace, así que los
   tickets importados no son escaneables en puerta. Corregir el `INSERT` en
   [src/db/ticketsDB.js](src/db/ticketsDB.js#L3) para incluir
   `qr_token = encode(gen_random_bytes(32),'hex')` (o generarlo en Node). **Bloqueante.**
2. **Configurar CORS** si el front del backend principal llamará directo al ticketing.
3. **Definir variables de entorno faltantes**: `APP_URL` (link de wallet en el email),
   `RESEND_API_KEY`, `RESEND_FROM`. Sin `APP_URL`, el email sale con link roto.
4. **Auth S2S** (§4): usuario de servicio o API key.
5. **Mapeo de eventos** (§3).
6. **Idempotencia del import** (§6).

---

## 6. Idempotencia y consistencia

El riesgo principal: el webhook de Stripe del backend principal puede **reintentarse**,
provocando importaciones duplicadas (órdenes y tickets repetidos).

Estrategias:

- **Clave de idempotencia (recomendada):** añadir a `sg_orders` una columna
  `external_order_id VARCHAR(64) UNIQUE` con el id de la `Order` (o `payment_intent`) del
  backend principal. En `import`, si ya existe esa clave, devolver la orden existente en
  lugar de crear otra (upsert idempotente). Esto requiere modificar `createOrder` y el
  controller.
  ```sql
  ALTER TABLE sg_orders ADD COLUMN IF NOT EXISTS external_order_id VARCHAR(64) UNIQUE;
  ```
- **Reintentos con backoff** desde el backend principal si el ticketing está caído, y
  **registro del resultado** (p. ej. guardar `order_number` devuelto en la `Order` del
  principal para saber que ya se emitió).
- **No bloquear el webhook**: la emisión de tickets no debería hacer fallar el ACK del
  webhook de Stripe. Si el import falla, encolar para reintento (o marcar la orden como
  "pendiente de emisión") en lugar de devolver error al webhook.

---

## 7. Flujo de reembolso (refund) coordinado

El backend principal maneja `charge.refunded` (marca `Order=refunded`, revierte la
transferencia al partner — ver `ANALISIS_BACKEND.md` §5.3). Para que la entrada deje de
ser válida en puerta, debe **propagar la anulación** al ticketing.

Hoy el ticketing **no expone** un endpoint de anulación. Propuesta:
- Añadir `POST /api/orders/:external_order_id/void` (S2S, admin/API key) que ponga
  `order_status='cancel'` y todos sus `sg_tickets.ticket_status='refunded'`.
- El check-in por escaneo ya rechaza tickets `refunded`/`void` (devuelve ese `result`),
  así que con marcar el estado basta para cerrar la puerta.

Sin esto, un ticket reembolsado en el principal **seguiría entrando** por la puerta.

---

## 8. Resumen de cambios requeridos para el acople

### En el ticketing (este repo)
| # | Cambio | Archivo(s) | Prioridad |
|---|---|---|---|
| 1 | Generar `qr_token` al crear ticket | [src/db/ticketsDB.js](src/db/ticketsDB.js) | 🔴 Bloqueante |
| 2 | `external_order_id` + import idempotente | `ordersDB.js`, `ordersController.js`, migración | 🔴 Alta |
| 3 | `external_event_id` + resolución de evento | `eventsDB.js`, migración | 🟠 Alta |
| 4 | Middleware de API key S2S | `middleware/` nuevo + `routes/orders.js` | 🟠 Alta |
| 5 | Endpoint de anulación por refund | `routes/orders.js`, `ordersDB.js` | 🟠 Media |
| 6 | CORS | `src/index.js` | 🟡 Media |
| 7 | Completar `.env` (`APP_URL`, `RESEND_*`) | `.env.example` | 🟡 Media |
| 8 | Rate-limit en `/lookup` y `/resend-tickets` | `routes/orders.js` | 🟢 Baja |

### En el backend principal
| # | Cambio | Dónde |
|---|---|---|
| A | Tras confirmar pago, llamar `POST /api/orders/import` | handler del webhook / `order.service.confirmOrder` |
| B | Propagar alta/edición de eventos al ticketing (o mantener mapeo) | `evento.service` |
| C | Tras `charge.refunded`, llamar al endpoint de anulación del ticketing | handler del webhook |
| D | Guardar `order_number` del ticketing en la `Order` para trazabilidad | `Order` (Sequelize) |
| E | Config: URL base del ticketing + `SERVICE_API_KEY` | env |

---

## 9. Modelo de despliegue

- **Servicios separados, BBDD separadas.** Cada uno con su PostgreSQL, su `JWT_SECRET` y
  su ciclo de vida. No compartir conexiones ni esquemas.
- **Red:** el ticketing solo necesita ser alcanzable por (a) el backend principal (S2S),
  (b) el personal de puerta (páginas `/checkin`, `/doorlist`, `/admin`), y (c) los
  compradores (wallet y `/tickets`). Considerar exponer S2S y público por rutas/redes
  distintas si es posible.
- **Secretos:** `SERVICE_API_KEY` y `JWT_SECRET` del ticketing nunca viajan al cliente.
  El `secure_token` de cada orden sí va al comprador (es su llave de wallet), por diseño.

---

## 10. Checklist de puesta en marcha

- [ ] `qr_token` se genera en cada ticket emitido (#1).
- [ ] `import` es idempotente por `external_order_id` (#2).
- [ ] Eventos mapeados entre ambos sistemas (#3).
- [ ] Auth S2S decidida e implementada (API key recomendada) (#4).
- [ ] Backend principal llama a `import` tras `checkout.session.completed`.
- [ ] Flujo de refund propaga anulación al ticketing (#5, C).
- [ ] `APP_URL`, `RESEND_API_KEY`, `RESEND_FROM`, `DATABASE_URL`, `JWT_SECRET` definidas.
- [ ] CORS configurado si aplica.
- [ ] Prueba end-to-end: compra → pago → email con wallet → QR → check-in en puerta.
- [ ] Prueba de refund: reembolso en principal → ticket rechazado en puerta.

---

*Guía de integración basada en `DOCUMENTACION_FUNCIONAL_TICKETING.md` (este servicio) y
`ANALISIS_BACKEND.md` (marketplace Stripe Connect). El acople se reduce a un único seam
—`POST /api/orders/import`— más la propagación de eventos y de anulaciones por refund.*
