const express = require('express');
const cors = require('cors');
const path = require('path');
const routes = require('./routes');
const { errorHandler, notFound } = require('./middleware/errors');

const app = express();
app.disable('x-powered-by');
const allowedOrigins = process.env.CORS_ORIGIN?.split(',').map((value) => value.trim()).filter(Boolean);
app.use(cors(allowedOrigins?.length ? { origin: allowedOrigins, credentials: true } : { origin: true, credentials: true }));
app.use(express.json({ limit: '1mb' }));
app.use('/uploads', express.static(path.join(__dirname, '..', 'uploads')));
app.get('/health', (_req, res) => res.json({ success: true, data: { status: 'ok' } }));
app.use('/api', routes);
app.get("/", (req, res) => {
  return res.status(200).json({
    success: true,
    message: "Backend server is running successfully",
  });
});
app.use(notFound);
app.use(errorHandler);

module.exports = app;
