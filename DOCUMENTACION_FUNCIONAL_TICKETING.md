# Documentación Funcional — Silver Glider Tickets (Servicio de Ticketing)

> Microservicio independiente de **emisión, distribución y validación de entradas**
> (tickets) para eventos. Se encarga del ciclo de vida *posterior al pago*: importar
> órdenes ya cobradas, emitir tickets con QR, entregarlos en una *wallet* web,
> reenviarlos por email y validarlos en puerta (check-in por escaneo o lista).
>
> **No procesa pagos.** Está pensado para operar como **servicio aparte**, alimentado
> por un backend principal (el marketplace con Stripe Connect documentado en
> `ANALISIS_BACKEND.md`).

---

## 1. Resumen ejecutivo

| Aspecto | Detalle |
|---|---|
| **Runtime** | Node.js + Express **5** |
| **Base de datos** | PostgreSQL (driver `pg` directo, **sin ORM**, SQL plano) |
| **Auth** | JWT (`jsonwebtoken`, expiración **12h**) + `bcryptjs` para hashing |
| **Roles** | `admin`, `staff` (por defecto) |
| **Email** | Resend (degradación silenciosa si falta `RESEND_API_KEY`) |
| **QR** | Librería `qrcode` (genera data-URL PNG en caliente) |
| **Puerto** | `process.env.PORT || 3000` |
| **Prefijo API** | `/api` (+ rutas de páginas HTML sin prefijo) |
| **Arranque** | `npm start` → `node src/index.js` · `npm run dev` (watch) |
| **Prefijo de tablas** | `sg_` (`sg_users`, `sg_events`, `sg_orders`, `sg_tickets`, `sg_event_staff`) |

### Identidad y diferencia con el backend principal

| | **Backend principal** (`ANALISIS_BACKEND.md`) | **Este servicio** (Silver Glider Tickets) |
|---|---|---|
| Rol | Marketplace de venta + pagos | Emisión y validación de entradas |
| Pagos | Stripe Checkout + Connect | **Ninguno** (recibe órdenes ya pagadas) |
| ORM | Sequelize | SQL plano sobre `pg.Pool` |
| Usuarios | Clientes, artistas, partners, admin | Solo personal interno: `admin` / `staff` |
| Foco | Catálogo, comisiones, onboarding | QR, wallet, check-in en puerta, doorlist |

### Arquitectura por capas

```
Request → Routes → Middleware (requireAuth / requireRole) → Controllers → DB layer (SQL) → PostgreSQL
                                                                  │
                                              Integraciones: Resend (email) · qrcode (QR)
```

Patrón **Route → Controller → DB**: los controllers validan el `req` y delegan el
acceso a datos a módulos `db/*DB.js` que ejecutan SQL parametrizado. No hay capa de
"services" intermedia; la lógica de negocio (mínima) vive en controllers y rutas.

---

## 2. Punto de entrada (`src/index.js`)

Flujo de arranque ([src/index.js](src/index.js)):

1. `express.json()` — parser de JSON (sin límite explícito configurado).
2. Sirve estáticos desde `/public`.
3. Monta las rutas de API:
   - `/api/auth`, `/api/events`, `/api/orders`, `/api/tickets`
   - `/wallet` (entrega de entradas al comprador, **sin** prefijo `/api`)
4. Sirve cuatro páginas HTML operativas (vistas en `src/views/`):
   - `GET /checkin` → escaneo de QR en puerta
   - `GET /doorlist` → lista de asistentes / check-in manual
   - `GET /admin` → panel admin (crear staff, ver usuarios)
   - `GET /tickets` → consulta pública de entradas por email
5. Registra el `errorHandler` global al final.
6. Levanta el servidor en `PORT` (default `3000`).

> ⚠️ **Observación:** no hay `cors()` configurado. Si el frontend o el backend
> principal viven en otro origen, habrá que añadir CORS antes de integrarlo.

---

## 3. Modelo de datos

Definido en [src/migrations/001_initial_schema.sql](src/migrations/001_initial_schema.sql)
y [src/migrations/002_qr_checkin.sql](src/migrations/002_qr_checkin.sql).
Todas las tablas usan prefijo `sg_`.

### `sg_users` — personal interno
| Campo | Tipo | Notas |
|---|---|---|
| `id` | SERIAL PK | |
| `email` | VARCHAR UNIQUE | |
| `password_hash` | VARCHAR | bcrypt |
| `first_name`, `last_name` | VARCHAR | |
| `role` | VARCHAR | `staff` (default) o `admin` |
| `created_at` | TIMESTAMP | |

### `sg_events` — eventos
| Campo | Tipo | Notas |
|---|---|---|
| `id` | SERIAL PK | |
| `name` | VARCHAR | |
| `event_date` | TIMESTAMP | |
| `venue` | VARCHAR | |
| `capacity` | INT | |
| `image_url` | TEXT | |

> Nota: el `id` del evento aquí es **local** y no necesariamente coincide con el
> `Evento.id` del backend principal. Ver §3 de la guía de integración.

### `sg_event_staff` — asignación de staff a eventos
Tabla puente `event_id` ↔ `user_id`. **Definida pero sin rutas/uso activo** en el
código actual (preparada para restringir check-in por evento en el futuro).

### `sg_orders` — órdenes (ya pagadas)
| Campo | Tipo | Notas |
|---|---|---|
| `id` | SERIAL PK | |
| `event_id` | INT FK → `sg_events` | |
| `order_number` | VARCHAR UNIQUE | formato `SGC-XXXXXX` |
| `buyer_first_name`, `buyer_last_name` | VARCHAR | |
| `buyer_email`, `buyer_phone` | VARCHAR | |
| `total_amount` | DECIMAL(10,2) | informativo (no se cobra aquí) |
| `currency` | VARCHAR | default `USD` |
| `payment_status` | VARCHAR | default `paid` |
| `order_status` | VARCHAR | default `active` |
| `quantity` | INT | nº de tickets a emitir |
| `secure_token` | TEXT | 32 bytes hex; llave de acceso a la wallet |
| `created_at`, `updated_at` | TIMESTAMP | |

### `sg_tickets` — entradas individuales
| Campo | Tipo | Notas |
|---|---|---|
| `id` | SERIAL PK | |
| `order_id` | INT FK → `sg_orders` | |
| `event_id` | INT FK → `sg_events` | |
| `ticket_id` | VARCHAR UNIQUE | formato `SGT-XXXXXX` |
| `ticket_type` | VARCHAR | default `General Admission` |
| `attendee_first_name`, `attendee_last_name` | VARCHAR | |
| `ticket_status` | VARCHAR | `valid` (default) / `void` / `refunded` |
| `checkin_status` | VARCHAR | `not_checked_in` (default) / `checked_in` |
| `checkin_at` | TIMESTAMP | |
| `checkin_method` | VARCHAR | `scan` (migración 002) |
| `checked_in_by` | INT FK → `sg_users` | quién validó (migración 002) |
| `qr_token` | TEXT | secreto del QR (migración 002) |

### Relaciones
```
sg_events 1─N sg_orders 1─N sg_tickets
sg_events 1─N sg_tickets        (event_id duplicado en ticket para consultas directas)
sg_users  1─N sg_tickets        (checked_in_by)
sg_events N─M sg_users          (vía sg_event_staff, inactiva)
```

---

## 4. Autenticación y autorización

### Generación / verificación de token — [src/controllers/authController.js](src/controllers/authController.js) · [src/middleware/auth.js](src/middleware/auth.js)

- `login`: valida email+password con bcrypt, firma JWT con
  `{ id, email, role, first_name }`, `expiresIn: '12h'`. Devuelve `{ token, role, first_name }`.
- `register`: crea usuario (`role` default `staff`), hash bcrypt (10 rounds).
  **Protegido**: solo un `admin` autenticado puede registrar staff.
- `requireAuth`: lee `Authorization: Bearer <token>`, verifica firma, inyecta `req.user`.
- `requireRole(...roles)`: autoriza por `req.user.role`. Debe ir tras `requireAuth`.

### Mapa de protección por ruta

| Endpoint | Auth | Rol |
|---|---|---|
| `POST /api/auth/login` | — | público |
| `POST /api/auth/register` | ✅ | `admin` |
| `GET /api/auth/users` | ✅ | `admin` |
| `GET /api/events` `GET /api/events/:id` | ✅ | cualquiera |
| `POST /api/events` `PUT /api/events/:id` | ✅ | `admin` |
| `POST /api/orders/import` | ✅ | `admin` |
| `GET /api/orders` `GET /api/orders/:order_number` | ✅ | cualquiera |
| `POST /api/orders/lookup` | — | **público** |
| `POST /api/orders/resend-tickets` | — | **público** |
| `GET /api/tickets/order/:order_id` | ✅ | cualquiera |
| `GET /api/tickets/event/:event_id` | ✅ | cualquiera |
| `POST /api/tickets/checkin/:ticket_id` | ✅ | cualquiera |
| `POST /api/tickets/scan/:qr_token` | ✅ | cualquiera |
| `GET /wallet` `GET /wallet/data` | token de orden | público (con `secure_token`) |

> La wallet **no** usa JWT: autentica por la combinación `order_number` + `secure_token`
> en la query string (modelo de "magic link"). El `secure_token` es un secreto de 32
> bytes por orden, no adivinable.

---

## 5. Flujos funcionales por dominio

### 5.1 Autenticación de personal — [routes/auth.js](src/routes/auth.js)
- `POST /api/auth/login` → `{ token, role, first_name }`.
- `POST /api/auth/register` (admin) → alta de staff/admin.
- `GET /api/auth/users` (admin) → listado de usuarios.

### 5.2 Eventos — [controllers/eventsController.js](src/controllers/eventsController.js) · [db/eventsDB.js](src/db/eventsDB.js)
CRUD básico (sin delete). Lectura para cualquier usuario autenticado; creación y
edición solo admin. Campos: `name, event_date, venue, capacity, image_url`.

### 5.3 Órdenes y emisión de tickets — el flujo central

**Importar una orden** (`POST /api/orders/import`, admin) — [ordersController.js](src/controllers/ordersController.js):
```
1. Recibe { event_id, buyer_*, total_amount, quantity, ticket_type }
2. Genera order_number (SGC-XXXXXX) y secure_token (32 bytes hex)
3. Inserta sg_orders
4. Emite `quantity` tickets en sg_tickets (cada uno con ticket_id SGT-XXXXXX)
5. Si hay buyer_email + RESEND_API_KEY → envía email de confirmación con link a la wallet
6. Devuelve { order, tickets }
```
Este es **el punto de entrada de datos del servicio**: aquí es donde el backend
principal "deposita" las órdenes ya cobradas. Ver guía de integración.

> ⚠️ **Gap detectado:** `createTicket` ([db/ticketsDB.js:3](src/db/ticketsDB.js#L3))
> **no asigna `qr_token`** a los tickets nuevos. La migración `002` solo rellenó los
> existentes. Como el check-in por escaneo (`checkInTicketByScan`) y la wallet dependen
> del `qr_token`, **los tickets importados hoy nacen sin QR escaneable**. Debe corregirse
> antes de integrar (generar `qr_token` en el `INSERT`). La wallet hace *fallback* a
> `ticket_id` como dato del QR, pero el escaneo en puerta busca por `qr_token` y fallaría.

**Consultar órdenes** (`GET /api/orders?event_id=&q=`, auth): lista por evento, con
búsqueda opcional por apellido / email / nº de orden (`searchOrders`).

**Detalle de orden** (`GET /api/orders/:order_number`, auth).

**Lookup público** (`POST /api/orders/lookup`, body `{ email }`): responde
`{ found, count }` de órdenes activas para ese email. Alimenta la página `/tickets`.

**Reenvío público** (`POST /api/orders/resend-tickets`, body `{ email }`): reenvía
por email las entradas de todas las órdenes activas de ese email.

### 5.4 Tickets y check-in — [ticketsController.js](src/controllers/ticketsController.js) · [routes/tickets.js](src/routes/tickets.js)

- `GET /api/tickets/order/:order_id` — tickets de una orden.
- `GET /api/tickets/event/:event_id` — tickets de un evento (alimenta el doorlist).
- `POST /api/tickets/checkin/:ticket_id` — **check-in manual** (por `ticket_id`).
  Actualiza a `checked_in` solo si estaba `not_checked_in` (idempotente: 409 si ya estaba).
- `POST /api/tickets/scan/:qr_token` — **check-in por escaneo de QR**. Devuelve un
  `result` discreto para la UI de puerta:

  | `result` | Significado |
  |---|---|
  | `success` | Check-in correcto (devuelve `ticket_id`, `ticket_type`) |
  | `already_checked_in` | Ya había entrado |
  | `void` | Ticket anulado |
  | `refunded` | Ticket reembolsado |
  | `invalid` | QR no corresponde a ningún ticket |
  | `error` | Error interno |

  El escaneo registra `checkin_method='scan'` y `checked_in_by = req.user.id`, y solo
  procede si `ticket_status='valid'`.

### 5.5 Wallet (entrega al comprador) — [routes/wallet.js](src/routes/wallet.js)
- `GET /wallet?order=...&token=...` → sirve `wallet.html` si el `secure_token` coincide.
- `GET /wallet/data?order=...&token=...` → JSON con `{ order, tickets, event }` y un
  **QR en data-URL PNG** por ticket (generado en caliente con `qrcode`, usando
  `qr_token` o, en su defecto, `ticket_id`).

### 5.6 Páginas operativas (HTML servidas por el backend)
| Ruta | Vista | Uso |
|---|---|---|
| `/checkin` | `views/checkin.html` | Escáner de QR en puerta (consume `/api/tickets/scan`) |
| `/doorlist` | `views/doorlist.html` | Lista de asistentes + check-in manual |
| `/admin` | `views/admin.html` | Alta de staff y listado de usuarios |
| `/tickets` | `views/tickets.html` | Consulta/reenvío público de entradas por email |

---

## 6. Integraciones externas

| Servicio | Uso | Config (env) |
|---|---|---|
| **PostgreSQL** | Persistencia (SQL plano) | `DATABASE_URL` |
| **Resend** | Email de confirmación / reenvío de entradas | `RESEND_API_KEY`, `RESEND_FROM` |
| **qrcode** | Generación de QR (in-process, sin servicio externo) | — |
| **JWT** | Auth de personal | `JWT_SECRET` |
| **App URL** | Construcción del link de wallet en el email | `APP_URL` |

Variables de entorno (de [.env.example](.env.example) + uso en código):
`DATABASE_URL`, `JWT_SECRET`, `PORT`, `NODE_ENV`, y además `RESEND_API_KEY`,
`RESEND_FROM`, `APP_URL` (referenciadas en [lib/mailer.js](src/lib/mailer.js), no
listadas en `.env.example`).

> El email degrada con un log si falta `RESEND_API_KEY`; no rompe el flujo de importación.

---

## 7. Contrato de API (resumen para integradores)

| Método | Ruta | Auth | Body / Query | Respuesta |
|---|---|---|---|---|
| POST | `/api/auth/login` | — | `{ email, password }` | `{ token, role, first_name }` |
| POST | `/api/auth/register` | admin | `{ email, password, first_name, last_name, role? }` | `{ id, email, role }` |
| GET | `/api/auth/users` | admin | — | `[users]` |
| GET | `/api/events` | auth | — | `[events]` |
| GET | `/api/events/:id` | auth | — | `event` |
| POST | `/api/events` | admin | `{ name, event_date, venue, capacity, image_url }` | `event` |
| PUT | `/api/events/:id` | admin | idem | `event` |
| POST | `/api/orders/import` | admin | `{ event_id, buyer_first_name, buyer_last_name, buyer_email, buyer_phone, total_amount, quantity, ticket_type }` | `{ order, tickets }` |
| GET | `/api/orders?event_id=&q=` | auth | — | `[orders]` |
| GET | `/api/orders/:order_number` | auth | — | `order` |
| POST | `/api/orders/lookup` | — | `{ email }` | `{ found, count }` |
| POST | `/api/orders/resend-tickets` | — | `{ email }` | `{ found, count }` |
| GET | `/api/tickets/order/:order_id` | auth | — | `[tickets]` |
| GET | `/api/tickets/event/:event_id` | auth | — | `[tickets]` |
| POST | `/api/tickets/checkin/:ticket_id` | auth | — | `{ success, ticket }` |
| POST | `/api/tickets/scan/:qr_token` | auth | — | `{ result, message, ... }` |
| GET | `/wallet?order=&token=` | token de orden | — | HTML |
| GET | `/wallet/data?order=&token=` | token de orden | — | `{ order, tickets[qr_image], event }` |

---

## 8. Observaciones y deuda técnica

1. **`qr_token` no se genera al emitir tickets** (`createTicket`) — bloquea el escaneo
   en puerta para órdenes nuevas. *Prioridad alta antes de integrar.* (Ver §5.3.)
2. **Sin CORS** — necesario si el backend principal o un front separado consumen la API.
3. **Endpoints públicos sin rate-limit** (`/lookup`, `/resend-tickets`) — permiten
   enumeración de emails y reenvío masivo. Añadir throttling/captcha.
4. **`sg_event_staff` definida pero inactiva** — el check-in no está restringido por
   evento; cualquier staff autenticado puede validar cualquier evento.
5. **`APP_URL`, `RESEND_API_KEY`, `RESEND_FROM` ausentes de `.env.example`** — riesgo de
   despliegue con wallet-link roto / email silenciosamente desactivado.
6. **`module.exports` duplicado / parcial** en varios archivos de rutas y db
   (`Object.assign` posterior) — funciona pero es frágil; conviene consolidar.
7. **`event_id` local vs. del backend principal** — sin mapeo explícito, la importación
   puede apuntar a un evento equivocado. (Ver guía de integración.)
8. **`total_amount`/`currency`/`payment_status` son informativos** — este servicio
   confía en que el backend principal ya cobró; no valida ni reconcilia importes.

---

*Documento funcional generado a partir del análisis del código en `src/` —
estructura Route→Controller→DB sobre Express 5 + `pg` + PostgreSQL, con Resend y
`qrcode` como únicas integraciones. Servicio de ticketing desacoplado del cobro.*
