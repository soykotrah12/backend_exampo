const jwt = require('jsonwebtoken');
const User = require('../models/User');
const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');

exports.auth = asyncHandler(async (req, _res, next) => {
  const [scheme, token] = (req.headers.authorization || '').split(' ');
  if (scheme !== 'Bearer' || !token) throw new AppError(401, 'Authentication required');
  let payload;
  try { payload = jwt.verify(token, process.env.JWT_SECRET || 'development-only-secret'); }
  catch (_) { throw new AppError(401, 'Invalid or expired token'); }
  const user = await User.findById(payload.sub);
  if (!user || !user.isActive) throw new AppError(401, 'User account is unavailable');
  req.user = user;
  next();
});

exports.allowRoles = (...roles) => (req, _res, next) => {
  if (!roles.includes(req.user.role)) return next(new AppError(403, 'You do not have permission to perform this action'));
  next();
};
