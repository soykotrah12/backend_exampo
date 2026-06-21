const AppError = require('../utils/AppError');
exports.requireFields = (...fields) => (req, _res, next) => {
  const missing = fields.filter((field) => req.body[field] === undefined || req.body[field] === '');
  if (missing.length) return next(new AppError(400, `Required fields: ${missing.join(', ')}`));
  next();
};
