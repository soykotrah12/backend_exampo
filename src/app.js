const express = require('express');
const cors = require('cors');
const routes = require('./routes');
const { errorHandler, notFound } = require('./middleware/errors');

const app = express();
app.disable('x-powered-by');
const allowedOrigins = process.env.CORS_ORIGIN?.split(',').map((value) => value.trim()).filter(Boolean);
app.use(cors(allowedOrigins?.length ? { origin: allowedOrigins, credentials: true } : { origin: true, credentials: true }));
app.use(express.json({ limit: '1mb' }));
app.get('/health', (_req, res) => res.json({ success: true, data: { status: 'ok' } }));
app.use('/api', routes);
app.use(notFound);
app.use(errorHandler);

module.exports = app;
