const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const app = express();

// Railway sirve detrás de un proxy inverso que inyecta X-Forwarded-For. Sin esto,
// express-rate-limit ve la IP del proxy y limita a todos los clientes con un solo cupo.
// El valor 1 (no `true`) evita que un cliente falsifique su IP añadiendo la cabecera.
app.set('trust proxy', 1);

// Lista blanca de orígenes (CORS_ORIGINS separados por coma). Vacío = permitir todos.
const allowedOrigins = (process.env.CORS_ORIGINS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
app.use(cors(allowedOrigins.length ? { origin: allowedOrigins } : {}));

app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

app.use('/api/auth', require('./routes/auth'));
app.use('/api/events', require('./routes/events'));
app.use('/api/orders', require('./routes/orders'));
app.use('/api/tickets', require('./routes/tickets'));
app.use('/wallet', require('./routes/wallet'));

// Vistas construidas con Astro (web/, `npm run build`). Si falta el build se sirve la
// vista legacy de src/views para no dejar la puerta sin lista.
const webDist = path.join(__dirname, '../web/dist');
app.use('/_astro', express.static(path.join(webDist, '_astro'), { immutable: true, maxAge: '1y' }));
function sendView(name) {
  const built = path.join(webDist, `${name}.html`);
  return (req, res) => {
    if (fs.existsSync(built)) return res.sendFile(built);
    console.warn(`[views] ⚠ ${built} no existe (¿falta npm run build?); sirviendo src/views/${name}.html`);
    res.sendFile(path.resolve(__dirname, 'views', `${name}.html`));
  };
}

app.get('/checkin', (req, res) => res.sendFile(path.resolve(__dirname, 'views', 'checkin.html')));
app.get('/doorlist', sendView('doorlist'));
app.get('/admin', (req, res) => res.sendFile(path.resolve(__dirname, 'views', 'admin.html')));
app.get('/tickets', (req, res) => res.sendFile(path.resolve(__dirname, 'views', 'tickets.html')));

app.use(require('./middleware/errorHandler'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Silver Glider Tickets running on port ${PORT}`);
  require('./lib/emailRetry').startEmailRetryWorker();
});
