require('dotenv').config();
const express   = require('express');
const cors      = require('cors');
const helmet    = require('helmet');
const morgan    = require('morgan');

const app = express();
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: process.env.ALLOWED_ORIGINS?.split(',') || '*' }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(morgan('dev'));
app.use('/static', express.static('public'));

app.use('/api/auth',       require('./routes/auth'));
app.use('/api/merchants',  require('./routes/merchants'));
app.use('/api/users',      require('./routes/users'));
app.use('/api/scan',       require('./routes/scan'));
app.use('/api/passes',     require('./routes/passes'));
app.use('/api/admin',      require('./routes/admin'));
app.use('/v1',             require('./routes/appleWallet'));

app.get('/health', (_, res) => res.json({ ok: true, ts: new Date() }));

app.use((err, req, res, _n) => {
  console.error(err.stack);
  res.status(err.status || 500).json({ error: err.message });
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`🚀 NuqaTi → http://localhost:${PORT}`));
module.exports = app;
