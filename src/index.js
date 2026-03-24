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

app.get('/checkin', (req, res) => res.sendFile(path.resolve(__dirname, 'views', 'checkin.html')));
app.get('/doorlist', (req, res) => res.sendFile(path.resolve(__dirname, 'views', 'doorlist.html')));
app.get('/admin', (req, res) => res.sendFile(path.resolve(__dirname, 'views', 'admin.html')));

app.use(require('./middleware/errorHandler'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Silver Glider Tickets running on port ${PORT}`));
