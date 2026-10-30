# feat: acceso de publicadores al Door List del microservicio (cambios en el backend principal)

> **Repo objetivo:** backend principal (Node + Express + Sequelize, Railway).
> **No** es este repo. Aquí se documenta lo que el principal debe implementar para que
> los usuarios que publican eventos (`artist`, `partner`, `promoter`, `venue`) entren al
> Door List de **Silver Glider Tickets** sin cuenta propia en el micro, y puedan ver y
> descargar (CSV o PDF) la lista de puerta de **sus** eventos.
>
> El lado del microservicio ya está implementado (ver `context.md`, entrada 2026-10-23).
> Documentos relacionados: `INTEGRACION_CON_BACKEND_PRINCIPAL.md`, `BACKEND_OVERVIEW.md`
> y `API_FRONTEND.md` (del principal).

---

## 1. Resumen del flujo

```
Publicador logueado en el principal (JWT del principal)
  │  clic en "Door list" en su dashboard
  ▼
POST /api/ticketing/sso              ← principal (NUEVO)
  · lee User.rol desde la BD (no del JWT)
  · busca sus eventos (Evento.partnerUserId = user.id)
  · firma un token de 5 min con TICKETING_SSO_SECRET
  · devuelve { url: "{TICKETING_PUBLIC_URL}/doorlist#sso=<token>" }
  ▼
El front navega a esa url
  ▼
Micro: /doorlist lee #sso=, lo canjea en POST /api/auth/sso (un solo uso)
  · valida firma, iss, aud, 5 min, rol permitido
  · emite su propia sesión (4 h) limitada a esos eventIds
  ▼
El publicador ve la lista de sus eventos y descarga CSV/PDF
(email y teléfono del comprador, opcionales al descargar)
```

Por qué así:
- **Sin base ni secreto compartido de sesión.** Cada servicio mantiene su `JWT_SECRET`.
  El único secreto compartido es el del traspaso (`TICKETING_SSO_SECRET`), que solo sirve
  para firmar tokens de 5 minutos.
- **El principal sigue siendo la fuente de verdad** de roles y de qué eventos son de quién.
- **El token va en el fragmento (`#sso=`), no en la query.** El fragmento no viaja al
  servidor, así que no queda en logs del proxy ni en la cabecera `Referer`.

---

## 2. Variables de entorno (principal)

| Variable | Valor | Notas |
|---|---|---|
| `TICKETING_SSO_SECRET` | **mismo valor** que `SSO_SHARED_SECRET` del micro | Distinto de `JWT_SECRET` y de `SERVICE_API_KEY`. Generar: `node -e "console.log(require('crypto').randomBytes(48).toString('base64'))"` |
| `TICKETING_PUBLIC_URL` | URL pública del micro, sin barra final | **Ya existe** (la usa "My Tickets"). Es igual a `APP_URL` del micro. |
| `TICKETING_SSO_ROLES` | `artist,partner,promoter,venue` | Opcional. Roles a los que el principal les firma el token. |

> **Dónde se quita un rol.** El interruptor real está en el micro: `SSO_ALLOWED_ROLES`.
> Quitar un rol ahí corta también las sesiones ya abiertas, sin desplegar el principal.
> `TICKETING_SSO_ROLES` en el principal solo evita firmar tokens que el micro rechazaría;
> conviene mantener ambas listas iguales.

---

## 3. Contrato del token SSO

JWT **HS256** firmado con `TICKETING_SSO_SECRET`. El micro rechaza cualquier otro algoritmo.

| Claim | Valor | Obligatorio |
|---|---|---|
| `iss` | `"silver-glider-principal"` | ✅ |
| `aud` | `"silver-glider-tickets"` | ✅ |
| `sub` | `String(user.id)` | ✅ |
| `jti` | `crypto.randomUUID()` (único por token) | ✅ — el micro lo marca como usado |
| `iat` / `exp` | `expiresIn: '5m'` | ✅ — el micro rechaza tokens con más de 5 min desde `iat` |
| `role` | `user.rol` leído de la BD | ✅ — debe estar en `SSO_ALLOWED_ROLES` del micro |
| `eventIds` | `["11", "27", …]` ids de `Eventos` donde `partnerUserId = user.id` | ✅ — array (puede ser vacío) |
| `email` | `user.email` | opcional (se usa en el registro de descargas) |
| `name` | `user.fullName` | opcional (se muestra en la cabecera del door list) |

El micro **nunca** acepta `role: "admin"` ni `"staff"` por SSO, aunque se agreguen a la lista.

`eventIds` son los ids **del principal** (= `sg_events.external_event_id` en el micro).
Un evento aparece en el door list solo si ya existe en el micro, porque el principal lo
propagó con `PUT /api/events/by-external/:id` o porque ya tuvo una venta (pull-on-import).

---

## 4. Cambios en el principal

### A. Endpoint `POST /api/ticketing/sso` — 🔴 obligatorio

Ruta protegida: `authenticateToken` + `requireRoles(['artist','partner','promoter','venue'])`.

**Reglas:**
1. **Leer el rol desde la BD**, no de `req.user.role`. El JWT del principal no cambia al
   aprobar o quitar un rol hasta el próximo login (ver `API_FRONTEND.md` §3). Sin esto, un
   usuario al que se le quitó el rol seguiría entrando durante 7 h.
2. Rechazar usuarios inactivos (`isActive = false`).
3. Los ids de `Admins` y `Organizadors` pueden coincidir con ids de `Users`.
   `requireRoles` ya deja fuera esos tokens; no relajarlo.

**Ejemplo de servicio** (`services/ticketingSso.service.js`):
```js
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { User, Evento } = require('../schemas');

const SSO_ROLES = (process.env.TICKETING_SSO_ROLES || 'artist,partner,promoter,venue')
  .split(',').map((r) => r.trim()).filter(Boolean);

async function createDoorListSso(userId) {
  const secret = process.env.TICKETING_SSO_SECRET;
  const base = (process.env.TICKETING_PUBLIC_URL || '').replace(/\/$/, '');
  if (!secret || !base) {
    const err = new Error('Door list no configurado'); err.statusCode = 503; throw err;
  }

  const user = await User.findByPk(userId);
  if (!user || user.isActive === false) {
    const err = new Error('Usuario no encontrado'); err.statusCode = 404; throw err;
  }
  if (!SSO_ROLES.includes(user.rol)) {
    const err = new Error('Tu rol no tiene acceso al door list'); err.statusCode = 403; throw err;
  }

  const eventos = await Evento.findAll({ where: { partnerUserId: user.id }, attributes: ['id'] });

  const token = jwt.sign(
    {
      role: user.rol,
      email: user.email,
      name: user.fullName,
      eventIds: eventos.map((e) => String(e.id)),
    },
    secret,
    {
      algorithm: 'HS256',
      issuer: 'silver-glider-principal',
      audience: 'silver-glider-tickets',
      subject: String(user.id),
      jwtid: crypto.randomUUID(),
      expiresIn: '5m',
    }
  );

  return { url: `${base}/doorlist#sso=${encodeURIComponent(token)}`, expiresIn: 300 };
}

module.exports = { createDoorListSso };
```

**Respuesta (con el wrapper estándar `responseHandler`):**
```json
{ "success": true, "message": "Door list access created", "url": "https://tickets…/doorlist#sso=eyJ…", "expiresIn": 300 }
```

| Código | Cuándo |
|---|---|
| `200` | Token emitido |
| `401` | Sin JWT o JWT inválido |
| `403` | Rol no permitido (incluye `client`, `admin`, `organizador`) |
| `404` | Usuario inexistente o inactivo |
| `503` | Falta `TICKETING_SSO_SECRET` o `TICKETING_PUBLIC_URL` |

Rate limit sugerido: reusar `authLimiter`. Cada token es de un solo uso y dura 5 min.

### B. Botón "Door list" en el dashboard del publicador — 🔴 obligatorio (front)

Junto a "Mis eventos" o al dashboard de payouts. Al hacer clic:
```js
const res = await fetch(`${API}/ticketing/sso`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${token}` },
});
const data = await res.json();
if (!data.success) return showError(data.message);
window.location.assign(data.url);   // misma pestaña: evita el bloqueo de pop-ups
```
- Pedir el token **en el momento del clic**: dura 5 min y es de un solo uso. No
  precargarlo ni guardarlo.
- Si se quiere abrir en otra pestaña, abrirla de forma síncrona en el clic
  (`const w = window.open('', '_blank')`) y luego `w.location = data.url`; si no, el
  navegador bloquea el pop-up.
- Si `eventIds` está vacío, el door list muestra "No events available yet".

### C. Propagar eventos al micro — 🟠 verificar

El door list solo lista eventos que ya existen en `sg_events`. Confirmar que el push
existente (`PUT {TICKETING_URL}/api/events/by-external/:id` con `x-api-key`) corre al
**crear** y al **editar** eventos. Si no, un evento sin ventas no aparecerá.

### D. Documentación — 🟡

Agregar el endpoint de §4.A a `API_FRONTEND.md` (sección Usuarios o una nueva
"Ticketing") y la variable `TICKETING_SSO_SECRET` a `BACKEND_OVERVIEW.md` §6.

---

## 5. Qué ve y qué puede hacer el publicador en el micro

| Acción | Publicador | Staff local / admin |
|---|---|---|
| Ver sus eventos en el selector | ✅ solo los de `eventIds` | ✅ todos |
| Ver la lista de puerta (nombre, email, teléfono, nº confirmación, cantidad, tipo, estado) | ✅ | ✅ |
| Descargar CSV o PDF, eligiendo incluir email y/o teléfono | ✅ | ✅ |
| Check-in manual / escaneo QR | ❌ (403) | ✅ |
| Órdenes completas, wallet, panel admin | ❌ (403) | según rol |

Cada descarga queda registrada en `sg_doorlist_exports` del micro (quién, evento,
formato, campos incluidos, cantidad de filas).

---

## 6. Checklist (principal)

- [ ] Generar el secreto y cargarlo como `TICKETING_SSO_SECRET` en Railway (principal) y como `SSO_SHARED_SECRET` en el micro.
- [ ] `services/ticketingSso.service.js` + controller + ruta `POST /api/ticketing/sso`.
- [ ] Rol leído de la BD; usuarios inactivos rechazados.
- [ ] Botón "Door list" en el dashboard del publicador.
- [ ] Verificar el push de eventos al micro al crear/editar (§4.C).
- [ ] Docs: `API_FRONTEND.md`, `BACKEND_OVERVIEW.md`.
- [ ] Prueba E2E: partner con un evento vendido → botón → door list con solo su evento → descarga CSV y PDF.
- [ ] Prueba de revocación: quitar el rol (o sacarlo de `SSO_ALLOWED_ROLES` en el micro) → la sesión abierta recibe 401.
- [ ] Prueba de reuso: abrir dos veces la misma URL `#sso=` → la segunda falla con "SSO token already used".

---

## 7. Registro de avance

| Fecha | Lado | Qué | Estado |
|---|---|---|---|
| 2026-10-23 | Micro | SSO (`POST /api/auth/sso`, `GET /api/auth/me`), acotado por evento, door list y exportación CSV/PDF, vista Door List en Astro, migración `005` | ✅ implementado, pendiente de desplegar |
| — | Principal | §4.A endpoint SSO | ⏳ pendiente |
| — | Principal | §4.B botón en el dashboard | ⏳ pendiente |
| — | Principal | §4.C verificar push de eventos | ⏳ pendiente |
