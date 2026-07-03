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
