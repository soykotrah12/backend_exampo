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

exports.requireActiveTeacherAccess = asyncHandler(async (req, _res, next) => {
  if (req.user.role !== 'teacher') return next();
  if (!req.user.organization || req.user.organizationAccessStatus === 'removed') {
    throw new AppError(403, 'You do not currently belong to an active organization.');
  }
  if (req.user.organizationAccessStatus === 'paused') {
    const pausedUntil = req.user.pausedUntil ? new Date(req.user.pausedUntil) : null;
    if (pausedUntil && pausedUntil <= new Date()) {
      req.user.organizationAccessStatus = 'active';
      req.user.pausedUntil = null;
      req.user.pausedReason = '';
      await req.user.save();
      return next();
    }
    throw new AppError(403, 'Your organization access is paused. Please contact your organization admin.');
  }
  next();
});
