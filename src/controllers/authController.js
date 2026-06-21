const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Organization = require('../models/Organization');
const asyncHandler = require('../utils/asyncHandler');
const AppError = require('../utils/AppError');
const permissions = require('../services/permissionService');

const tokenFor = (user) => jwt.sign({ sub: user._id.toString(), role: user.role }, process.env.JWT_SECRET || 'development-only-secret', { expiresIn: process.env.JWT_EXPIRES_IN || '7d' });
const authPayload = (user) => ({ token: tokenFor(user), user: user.toSafeJSON() });
exports.register = asyncHandler(async (req, res) => {
  const { name, email, password, role, organizationName } = req.body;
  if (!['organization_owner','teacher','student'].includes(role)) throw new AppError(400, 'Invalid registration role');
  if (String(password || '').length < 8) throw new AppError(400, 'Password must contain at least 8 characters');
  if (await User.exists({ email: String(email).toLowerCase() })) throw new AppError(409, 'Email already registered');
  if (role === 'teacher') throw new AppError(403, 'Teachers must be invited by an organization owner');
  let user;
  if (role === 'organization_owner') {
    const plan = await permissions.ensureFreePlan();
    try {
      user = await User.create({ name, email, password, role });
      const organization = await Organization.create({ name: organizationName || `${name}'s Organization`, owner: user._id, plan: plan._id, subscriptionStatus: 'free', subscriptionStartDate: new Date() });
      user.organization = organization._id;
      await user.save();
    } catch (error) {
      if (user?._id) await User.deleteOne({ _id: user._id });
      throw error;
    }
  } else user = await User.create({ name, email, password, role });
  res.status(201).json({ success: true, message: 'Account created', data: authPayload(user) });
});
exports.login = asyncHandler(async (req, res) => {
  const user = await User.findOne({ email: String(req.body.email || '').toLowerCase() }).select('+password');
  if (!user || !(await user.comparePassword(req.body.password || ''))) throw new AppError(401, 'Invalid email or password');
  res.json({ success: true, message: 'Logged in', data: authPayload(user) });
});
exports.me = asyncHandler(async (req, res) => res.json({ success: true, data: req.user.toSafeJSON() }));
exports.logout = (_req, res) => res.json({ success: true, message: 'Logged out' });
