const express = require('express');
const path = require('path');
require('dotenv').config();

const app = express();

app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

app.use('/api/auth', require('./routes/auth'));
app.use('/api/events', require('./routes/events'));
app.use('/api/orders', require('./routes/orders'));
app.use('/api/tickets', require('./routes/tickets'));
app.use('/wallet', require('./routes/wallet'));
app.use('/activations', require('./routes/activations'));

app.get('/activations-login', (req, res) => res.sendFile(path.resolve(__dirname, 'views', 'activations-login.html')));
app.get('/checkin', (req, res) => res.sendFile(path.resolve(__dirname, 'views', 'checkin.html')));
app.get('/doorlist', (req, res) => res.sendFile(path.resolve(__dirname, 'views', 'doorlist.html')));
app.get('/admin', (req, res) => res.sendFile(path.resolve(__dirname, 'views', 'admin.html')));
app.get('/tickets', (req, res) => res.sendFile(path.resolve(__dirname, 'views', 'tickets.html')));

app.get('/unsubscribe', async (req, res) => {
  const pool = require('./config/db');
  const { email } = req.query;
  if (!email) return res.status(400).send('Missing email');
  try {
    await pool.query('UPDATE sg_activation_optins SET unsubscribed=TRUE WHERE email=$1', [email]).catch(() => {});
    await pool.query('ALTER TABLE sg_activation_optins ADD COLUMN IF NOT EXISTS unsubscribed BOOLEAN DEFAULT FALSE').catch(() => {});
    await pool.query('UPDATE sg_activation_optins SET unsubscribed=TRUE WHERE email=$1', [email]);
    res.send(`<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>Unsubscribed</title></head><body style="background:#0a0a0a;color:#f0f0f0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;text-align:center;padding:24px"><div><p style="font-size:11px;letter-spacing:.15em;color:#444;text-transform:uppercase;margin-bottom:24px">⬡ Silver Glider</p><h1 style="font-size:24px;font-weight:700;margin-bottom:12px">You're unsubscribed.</h1><p style="color:#666;font-size:15px">You won't receive any more emails from us.</p></div></body></html>`);
  } catch (err) {
    res.status(500).send('Something went wrong. Please try again.');
  }
});

app.get('/health', async (req, res) => {
  const pool = require('./config/db');
  try {
    await pool.query('SELECT 1');
    const sha = require('fs').readFileSync(path.join(__dirname, '../.git-sha'), 'utf8').trim();
    res.json({ status: 'ok', sha });
  } catch (err) {
    res.status(500).json({ status: 'error', error: err.message });
  }
});

app.use(require('./middleware/errorHandler'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Silver Glider Tickets running on port ${PORT}`));
