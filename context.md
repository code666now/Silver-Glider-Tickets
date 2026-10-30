# context.md — Historial de cambios de `silver-glider-tickets`

> Registro histórico exigido por `.agents/AGENT.md`: cada cambio indica **qué** se hizo,
> **por qué**, fecha y hora, y quién lo pidió. Las entradas van de la más reciente a la
> más antigua. Antes de empezar una tarea, leer este archivo y las skills de
> `.agents/skills`.
>
> Desarrollador: **gab**

---

## Estado del proyecto (baseline al 2026-10-23)

Microservicio de emisión y validación de entradas, acoplado al backend principal
(marketplace con Stripe Connect). No procesa pagos. Express 5 + `pg` (SQL plano) +
PostgreSQL, desplegado en Railway.

Ya implementado antes de este registro (deducido del código y de `git log`):

| Tema | Estado | Dónde |
|---|---|---|
| `qr_token` al emitir tickets | ✅ | `src/db/ticketsDB.js` |
| CORS con lista blanca | ✅ | `src/index.js` (`CORS_ORIGINS`) |
| Rate limit en `/lookup` y `/resend-tickets` | ✅ | `src/routes/orders.js` |
| Auth S2S por `x-api-key` | ✅ | `src/middleware/serviceAuth.js` |
| Import idempotente por `external_order_id` | ✅ | `ordersController.importOrder`, migración `003` |
| Mapeo de eventos por `external_event_id` + pull-on-import | ✅ | `src/lib/orderImporter.js`, `src/lib/principalClient.js` |
| Anulación por refund `POST /api/orders/:external_order_id/void` | ✅ | `src/routes/orders.js` |
| Reintento de correos fallidos | ✅ | `src/lib/emailRetry.js`, migración `004` |

Las guías `DOCUMENTACION_FUNCIONAL_TICKETING.md` e `INTEGRACION_CON_BACKEND_PRINCIPAL.md`
describen el diseño original y marcan como pendientes varios puntos ya resueltos. La
tabla de arriba es la referencia del estado real.

Deuda conocida (sin resolver):
- `sg_event_staff` sigue sin uso: el staff local ve y valida todos los eventos.
- `/admin` muestra el panel a un staff que ya tenga `sgt_token` guardado. Solo es la
  interfaz: la API responde 403.
- Las vistas legacy de `src/views` guardan el JWT en `localStorage` y arman filas con
  `innerHTML` a partir de datos del comprador (riesgo de XSS). La nueva vista Door List
  ya no lo hace.
- `public/js/checkin.js` está vacío.
- `.env.example` trae un valor con forma de secreto real en `JWT_SECRET`: conviene
  reemplazarlo por un marcador y, si se usó en algún entorno, rotarlo.

---

## 2026-10-23 02:18 — SSO de publicadores, exportación CSV/PDF del door list y vistas con Astro

**Pedido por:** gab.

### Qué se hizo

**1. Acceso de publicadores por SSO desde el backend principal**
- `src/lib/sso.js` (nuevo): verifica el token del principal (HS256, `iss`, `aud`, 5 min,
  `jti`, rol permitido) y emite la sesión local del publicador
  (`kind: 'publisher'`, 4 h por defecto, sin `id` local).
- `src/db/ssoDB.js` (nuevo): marca cada `jti` como usado, de modo que el token es de un
  solo uso.
- `POST /api/auth/sso` (con rate limit) y `GET /api/auth/me` en `src/routes/auth.js`, y
  `ssoExchange` y `me` en `src/controllers/authController.js`.
- `src/middleware/auth.js`:
  - `requireAuth` ahora **rechaza** las sesiones de publicador.
  - Nuevo `requireStaffOrPublisher`, que revalida el rol contra `SSO_ALLOWED_ROLES` en
    cada request.
  - Nuevo `requireEventAccess`: el publicador solo accede a eventos de su `eventIds`; a
    uno ajeno se le responde 404.
- `src/middleware/serviceAuth.js`: `requireServiceOrAdmin` también rechaza sesiones de
  publicador.
- `GET /api/events`: para un publicador devuelve solo sus eventos
  (`getEventsByExternalIds` en `src/db/eventsDB.js`).

**2. Lista de puerta y exportación**
- `GET /api/events/:id/door-list`: una fila por orden activa con el conteo de check-in.
  No incluye `secure_token` ni `qr_token`.
- `GET /api/events/:id/door-list/export?format=csv|pdf&include=email,phone`.
  - Columnas fijas: apellido, nombre, nº de confirmación, cantidad, tipo y check-in.
  - Email y teléfono son opcionales.
  - CSV con BOM UTF-8 y celdas de fórmula neutralizadas (`=`, `+`, `-`, `@`).
  - PDF horizontal con casilla para marcar a mano, paginado con pie de página.
- Archivos nuevos: `src/db/doorListDB.js`, `src/lib/doorListExport.js` y
  `src/controllers/doorListController.js`. Dependencia nueva: `pdfkit@^0.20.2`.
- Cada descarga se registra en `sg_doorlist_exports`.

**3. Vistas con Astro (`web/`)**
- Proyecto Astro 5.18 en `web/` con salida estática: `web/dist/doorlist.html` más
  `web/dist/_astro/*`. Lo sirve Express, sin adaptador ni servicio aparte.
- Contenido:
  - `layouts/OpsLayout.astro`
  - `components/LoginCard.astro` y `components/ExportDialog.astro`
  - `pages/doorlist.astro`
  - `scripts/doorlist.ts`, `lib/session.ts`
  - `styles/global.css`, con los tokens de la identidad oscura existente
- La nueva Door List:
  - Canjea `#sso=` y lo borra de la URL.
  - Guarda la sesión del publicador en `sessionStorage` y la del staff en
    `localStorage`, con la misma clave `sgt_token` de las vistas legacy.
  - Para publicadores oculta el check-in.
  - Renderiza las filas con `textContent`, sin XSS.
  - Agrega búsqueda por teléfono, barra de progreso y el diálogo de descarga
    (CSV/PDF, email y teléfono).
- `src/index.js` sirve `/doorlist` desde `web/dist`. Si falta el build, vuelve a
  `src/views/doorlist.html` y deja un aviso en el log. Las demás vistas (`checkin`,
  `admin`, `tickets`, `wallet`) siguen siendo las legacy.
- `package.json`: scripts `build` (instala y compila `web/`) y `dev:web`.
  `railway.toml`: `buildCommand = "npm run build"`.

**4. Configuración y documentación**
- `.env.example`: `SSO_SHARED_SECRET`, `SSO_ALLOWED_ROLES` y `SSO_SESSION_HOURS`.
- `feat-microservicio.md` (nuevo): qué debe implementar el backend principal y su
  registro de avance.
- `src/migrations/005_publisher_sso_doorlist.sql` (nuevo).

### Por qué
- Los publicadores necesitaban ver y descargar la lista de puerta de sus eventos sin
  tener cuentas duplicadas en el micro. El principal sigue siendo la fuente de verdad de
  roles y de qué eventos son de quién.
- Se eligió el traspaso por token corto en vez de consultar la base del principal o
  compartir `JWT_SECRET`. Así cada servicio conserva su base y su secreto, y el check-in
  en puerta no depende de que el principal esté arriba.
- Los roles permitidos se pueden editar (`SSO_ALLOWED_ROLES`) para poder quitar uno sin
  desplegar código.
- `requireAuth` tenía que rechazar a los publicadores. Comparten `JWT_SECRET` y, sin ese
  corte, una sesión de publicador habría podido escanear y hacer check-in en cualquier
  evento.
- La exportación se registra porque el archivo puede llevar email y teléfono de los
  compradores.
- Astro se adoptó de forma incremental, empezando por la vista que cambiaba en esta
  tarea, para no arriesgar `checkin` (cámara) ni `wallet` (compradores) sin probarlas en
  un navegador.

### Verificación hecha
- `astro check` y `astro build`: 0 errores.
- Pruebas aisladas, sin servidor ni base de datos:
  - Verificación SSO: acepta el token válido. Rechaza `aud` incorrecto, rol `client`, rol
    `admin` aunque esté en la lista, `alg: none`, token vencido y token con más de 5 min
    desde `iat`.
  - CSV: BOM y neutralización de fórmulas.
  - PDF: 2 páginas con 46 filas y 1 página sin filas.
- `node --check` en todos los archivos del servidor modificados.
- **No se arrancó el servicio** (indicación de gab: producción está en Railway).
  `/api/auth/sso`, `/door-list` y `/door-list/export` están sin probar de punta a punta.

### Despliegue (orden obligatorio)
1. **Antes del push**, aplicar la migración `005` en la base de Railway:
   `npm run migrate` con `DATABASE_URL` de producción, o pegar
   `src/migrations/005_publisher_sso_doorlist.sql` en la consola de Postgres. Es
   aditiva e idempotente (`CREATE TABLE/INDEX IF NOT EXISTS`). Sin ella:
   - `POST /api/auth/sso` falla, porque no existe `sg_sso_used_tokens`.
   - La descarga falla, porque no existe `sg_doorlist_exports`.
   `npm run migrate` re-aplica también `001`–`004`. Se verificó que son idempotentes
   (`IF NOT EXISTS`, y el `UPDATE` de `002` solo toca filas con `qr_token IS NULL`).
2. Variables en Railway (micro): `SSO_SHARED_SECRET`,
   `SSO_ALLOWED_ROLES=artist,partner,promoter,venue` y, opcional, `SSO_SESSION_HOURS`.
3. Push. Railway corre `npm run build` (Astro) y luego `node src/index.js`.
4. Backend principal: implementar `feat-microservicio.md` §4.

### Pendiente
- Backend principal: endpoint `POST /api/ticketing/sso` y botón (ver `feat-microservicio.md`).
- Migrar a Astro `checkin`, `admin`, `tickets` y `wallet`.
- Acotar el staff local por evento con `sg_event_staff`.
- `.agents/skills/temp-astro-agents` es un clon de git con su propio `.git`. Al hacer
  `git add` quedaría como submódulo vacío. Conviene quitar su `.git` o agregarlo como
  submódulo a propósito.
