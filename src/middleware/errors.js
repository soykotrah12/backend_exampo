const AppError = require('../utils/AppError');

exports.notFound = (req, _res, next) => next(new AppError(404, `Route ${req.method} ${req.path} not found`));
exports.errorHandler = (error, _req, res, _next) => {
  let status = error.statusCode || 500;
  let message = error.message || 'Internal server error';
  if (error.name === 'ValidationError') { status = 400; message = Object.values(error.errors).map((e) => e.message).join(', '); }
  if (error.name === 'CastError') { status = 400; message = 'Invalid resource identifier'; }
  if (error.code === 11000) { status = 409; message = 'A record with that value already exists'; }
  res.status(status).json({ success: false, message, ...(error.details && { details: error.details }) });
};
