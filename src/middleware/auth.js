const jwt = require('jsonwebtoken');
const User = require('../models/User');
const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');

const requiresEmailVerification = (user) => Boolean(
  user &&
  user.isEmailVerified === false &&
  user.emailVerificationStartedAt,
);

const markLegacyEmailVerified = (user) => {
  if (!user || user.isEmailVerified === true || user.emailVerificationStartedAt) return false;
  user.isEmailVerified = true;
  return true;
};

exports.auth = asyncHandler(async (req, _res, next) => {
  const [scheme, token] = (req.headers.authorization || '').split(' ');
  if (scheme !== 'Bearer' || !token) throw new AppError(401, 'Authentication required');
  let payload;
  try { payload = jwt.verify(token, process.env.JWT_SECRET || 'development-only-secret'); }
  catch (_) { throw new AppError(401, 'Invalid or expired token'); }
  if (payload.type && payload.type !== 'access') throw new AppError(401, 'Invalid or expired token');
  const user = await User.findById(payload.sub);
  if (!user || !user.isActive) throw new AppError(401, 'User account is unavailable');
  if (requiresEmailVerification(user)) throw new AppError(403, 'Please verify your email before continuing.');
  const shouldSaveLegacyVerification = markLegacyEmailVerified(user);
  if (!user.lastActiveAt || Date.now() - new Date(user.lastActiveAt).getTime() > 15 * 60 * 1000) {
    user.lastActiveAt = new Date();
    user.save().catch(() => {});
  } else if (shouldSaveLegacyVerification) {
    user.save().catch(() => {});
  }
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
