const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Organization = require('../models/Organization');
const asyncHandler = require('../utils/asyncHandler');
const AppError = require('../utils/AppError');
const permissions = require('../services/permissionService');
const { generateCode } = require('../utils/codeGenerator');
const { withSafeAvatarUrl } = require('../utils/avatarUrl');

const tokenFor = (user) => jwt.sign({ sub: user._id.toString(), role: user.role }, process.env.JWT_SECRET || 'development-only-secret', { expiresIn: process.env.JWT_EXPIRES_IN || '7d' });
const authPayload = (user) => ({ token: tokenFor(user), user: withSafeAvatarUrl(user) });
const planSnapshotFor = (plan, billingCycle = 'monthly') => {
  const limits = plan?.limits || {};
  const price = billingCycle === 'yearly' ? plan.priceYearly : plan.priceMonthly;
  return {
    planId: plan?._id,
    name: plan?.name || '',
    code: plan?.code || '',
    billingType: plan?.billingType || (plan?.priceMonthly ? 'monthly' : 'free'),
    price: Number(price || 0),
    monthlyPrice: Number(plan?.priceMonthly || 0),
    yearlyPrice: Number(plan?.priceYearly || 0),
    teacherLimit: Number(limits.teachersLimit || 0),
    studentLimit: Number(limits.studentsLimit || 0),
    serviceLimit: Number(limits.servicesLimit || 0),
    batchLimit: Number(limits.batchesLimit || 0),
    examLimit: Number(limits.examSlotsPerMonth || 0),
    features: plan?.features || [],
    capturedAt: new Date(),
  };
};
exports.register = asyncHandler(async (req, res) => {
  const {
    name,
    email,
    password,
    role,
    organizationName,
    organizationEmail,
    organizationPhone,
    phone,
    contactNumber,
    organizationAddress,
    address,
    organizationCategory,
    category,
    organizationType,
    type,
    description,
  } = req.body;
  if (!['organization_owner','teacher','student'].includes(role)) throw new AppError(400, 'Invalid registration role');
  if (String(password || '').length < 8) throw new AppError(400, 'Password must contain at least 8 characters');
  const loginEmail = String(role === 'organization_owner' ? (organizationEmail || email) : email).toLowerCase().trim();
  if (await User.exists({ email: loginEmail })) throw new AppError(409, 'Email already registered');
  let user;
  if (role === 'organization_owner') {
    const plan = await permissions.ensureFreePlan();
    const orgName = String(organizationName || name || '').trim();
    if (!orgName) throw new AppError(400, 'Organization name is required');
    if (!loginEmail) throw new AppError(400, 'Organization email is required');
    const orgPhone = String(organizationPhone || contactNumber || phone || '').trim();
    const orgAddress = String(organizationAddress || address || '').trim();
    const orgCategory = String(organizationCategory || category || organizationType || type || '').trim();
    try {
      user = await User.create({ name: orgName, email: loginEmail, password, role, phone: orgPhone, contactNumber: orgPhone, address: orgAddress });
      const organization = await Organization.create({
        name: orgName,
        email: loginEmail,
        phone: orgPhone,
        contactNumber: orgPhone,
        address: orgAddress,
        category: orgCategory,
        type: orgCategory,
        description: String(description || '').trim(),
        organizationCode: generateCode('ORG'),
        owner: user._id,
        plan: plan._id,
        planSnapshot: planSnapshotFor(plan, 'free'),
        subscriptionStatus: 'free',
        subscriptionStartDate: new Date(),
        verificationStatus: 'unverified',
      });
      user.organization = organization._id;
      await user.save();
    } catch (error) {
      if (user?._id) await User.deleteOne({ _id: user._id });
      throw error;
    }
  } else user = await User.create({ name, email: loginEmail, password, role });
  res.status(201).json({ success: true, message: 'Account created', data: authPayload(user) });
});
exports.login = asyncHandler(async (req, res) => {
  const user = await User.findOne({ email: String(req.body.email || '').toLowerCase() }).select('+password');
  if (!user || !(await user.comparePassword(req.body.password || ''))) throw new AppError(401, 'Invalid email or password');
  user.lastLoginAt = new Date();
  user.lastActiveAt = user.lastLoginAt;
  await user.save();
  res.json({ success: true, message: 'Logged in', data: authPayload(user) });
});
exports.me = asyncHandler(async (req, res) => {
  const data = withSafeAvatarUrl(req.user);
  res.json({ success: true, data });
});
exports.logout = (_req, res) => res.json({ success: true, message: 'Logged out' });
