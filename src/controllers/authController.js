const bcrypt = require('bcrypt');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Organization = require('../models/Organization');
const asyncHandler = require('../utils/asyncHandler');
const AppError = require('../utils/AppError');
const permissions = require('../services/permissionService');
const { generateCode } = require('../utils/codeGenerator');
const { safeAvatarUrl, withSafeAvatarUrl } = require('../utils/avatarUrl');
const {
  EmailConfigurationError,
  sendPasswordResetOtpEmail,
  sendSignupOtpEmail,
} = require('../services/emailService');
const {
  FirebaseAdminConfigurationError,
  verifyFirebaseIdToken,
} = require('../services/firebaseAdminService');

const OTP_LENGTH = Math.min(Math.max(Number(process.env.AUTH_OTP_LENGTH || 6), 4), 8);
const OTP_EXPIRES_MINUTES = Number(process.env.AUTH_OTP_EXPIRES_MINUTES || 10);
const OTP_RESEND_COOLDOWN_SECONDS = Number(process.env.AUTH_OTP_RESEND_COOLDOWN_SECONDS || 60);
const OTP_MAX_ATTEMPTS = Number(process.env.AUTH_OTP_MAX_ATTEMPTS || 5);
const RESET_TOKEN_EXPIRES_MINUTES = Number(process.env.PASSWORD_RESET_TOKEN_EXPIRES_MINUTES || 15);

const normalizeEmail = (email) => String(email || '').toLowerCase().trim();
const addMinutes = (minutes) => new Date(Date.now() + minutes * 60 * 1000);
const tokenSecret = () => process.env.JWT_SECRET || 'development-only-secret';
const refreshTokenSecret = () => process.env.JWT_REFRESH_SECRET || tokenSecret();

const tokenFor = (user, type = 'access') => jwt.sign(
  { sub: user._id.toString(), role: user.role, type },
  type === 'refresh' ? refreshTokenSecret() : tokenSecret(),
  { expiresIn: type === 'refresh' ? (process.env.JWT_REFRESH_EXPIRES_IN || '30d') : (process.env.JWT_EXPIRES_IN || '7d') },
);

const authPayload = (user) => {
  const accessToken = tokenFor(user);
  const refreshToken = tokenFor(user, 'refresh');
  return {
    token: accessToken,
    accessToken,
    refreshToken,
    user: withSafeAvatarUrl(user),
  };
};

const createOtp = () => {
  const min = 10 ** (OTP_LENGTH - 1);
  const max = 10 ** OTP_LENGTH;
  return crypto.randomInt(min, max).toString();
};

const hashResetToken = (token) => crypto.createHash('sha256').update(token).digest('hex');

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

const cooldownRemaining = (date) => {
  if (!date) return 0;
  const elapsedSeconds = Math.floor((Date.now() - new Date(date).getTime()) / 1000);
  return Math.max(OTP_RESEND_COOLDOWN_SECONDS - elapsedSeconds, 0);
};

const throwIfCoolingDown = (date) => {
  const remaining = cooldownRemaining(date);
  if (remaining > 0) {
    throw new AppError(429, `Please wait ${remaining} seconds before requesting another OTP.`);
  }
};

const emailErrorToAppError = (error) => {
  if (error instanceof EmailConfigurationError || error.name === 'EmailConfigurationError') {
    return new AppError(503, error.message || 'Email service is not configured');
  }
  return new AppError(502, 'Unable to send email. Please try again later.');
};

const sendEmailVerificationOtp = async (user) => {
  throwIfCoolingDown(user.lastOtpSentAt);
  const otp = createOtp();
  user.isEmailVerified = false;
  user.emailVerificationStartedAt = user.emailVerificationStartedAt || new Date();
  user.emailOtpHash = await bcrypt.hash(otp, 12);
  user.emailOtpExpiresAt = addMinutes(OTP_EXPIRES_MINUTES);
  user.emailOtpAttempts = 0;
  user.lastOtpSentAt = new Date();
  await user.save();
  try {
    await sendSignupOtpEmail({
      to: user.email,
      otp,
      expiresInMinutes: OTP_EXPIRES_MINUTES,
    });
  } catch (error) {
    user.lastOtpSentAt = null;
    await user.save().catch(() => {});
    throw emailErrorToAppError(error);
  }
};

const sendPasswordResetOtp = async (user) => {
  throwIfCoolingDown(user.passwordResetLastOtpSentAt);
  const otp = createOtp();
  user.passwordResetOtpHash = await bcrypt.hash(otp, 12);
  user.passwordResetOtpExpiresAt = addMinutes(OTP_EXPIRES_MINUTES);
  user.passwordResetOtpAttempts = 0;
  user.passwordResetLastOtpSentAt = new Date();
  user.passwordResetTokenHash = '';
  user.passwordResetTokenExpiresAt = null;
  await user.save();
  try {
    await sendPasswordResetOtpEmail({
      to: user.email,
      otp,
      expiresInMinutes: OTP_EXPIRES_MINUTES,
    });
  } catch (error) {
    user.passwordResetLastOtpSentAt = null;
    await user.save().catch(() => {});
    throw emailErrorToAppError(error);
  }
};

const assertValidOtpState = (hash, expiresAt, attempts) => {
  if (!hash || !expiresAt || new Date(expiresAt).getTime() <= Date.now()) {
    throw new AppError(400, 'OTP expired. Please request a new OTP.');
  }
  if (Number(attempts || 0) >= OTP_MAX_ATTEMPTS) {
    throw new AppError(429, 'Too many invalid attempts. Please request a new OTP.');
  }
};

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

const firebaseErrorToAppError = (error) => {
  if (error instanceof FirebaseAdminConfigurationError || error.name === 'FirebaseAdminConfigurationError') {
    return new AppError(500, 'Firebase admin is not configured');
  }
  return new AppError(401, 'Invalid Firebase token');
};

const firebaseProfileName = (decoded) => {
  const name = String(decoded.name || '').trim();
  if (name) return name;
  const email = normalizeEmail(decoded.email);
  return email ? email.split('@')[0] : 'Google User';
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
  const loginEmail = normalizeEmail(role === 'organization_owner' ? (organizationEmail || email) : email);
  if (!loginEmail) throw new AppError(400, 'Email is required');

  const existing = await User.findOne({ email: loginEmail });
  if (existing) {
    if (requiresEmailVerification(existing)) {
      await sendEmailVerificationOtp(existing);
      return res.status(200).json({
        success: true,
        message: 'OTP sent to your email. Please verify your account.',
        data: { email: existing.email, requiresOtpVerification: true },
      });
    }
    throw new AppError(409, 'Email already registered');
  }

  let user;
  if (role === 'organization_owner') {
    const plan = await permissions.ensureFreePlan();
    const orgName = String(organizationName || name || '').trim();
    if (!orgName) throw new AppError(400, 'Organization name is required');
    const orgPhone = String(organizationPhone || contactNumber || phone || '').trim();
    const orgAddress = String(organizationAddress || address || '').trim();
    const orgCategory = String(organizationCategory || category || organizationType || type || '').trim();
    try {
      user = await User.create({
        name: orgName,
        email: loginEmail,
        password,
        role,
        phone: orgPhone,
        contactNumber: orgPhone,
        address: orgAddress,
        isEmailVerified: false,
        emailVerificationStartedAt: new Date(),
      });
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
  } else {
    user = await User.create({
      name,
      email: loginEmail,
      password,
      role,
      isEmailVerified: false,
      emailVerificationStartedAt: new Date(),
    });
  }

  await sendEmailVerificationOtp(user);
  res.status(201).json({
    success: true,
    message: 'OTP sent to your email. Please verify your account.',
    data: { email: user.email, requiresOtpVerification: true },
  });
});

exports.verifyOtp = asyncHandler(async (req, res) => {
  const email = normalizeEmail(req.body.email);
  const otp = String(req.body.otp || '').trim();
  if (!email) throw new AppError(400, 'Email is required');
  if (!new RegExp(`^\\d{${OTP_LENGTH}}$`).test(otp)) throw new AppError(400, 'Invalid OTP');
  const user = await User.findOne({ email }).select('+emailOtpHash');
  if (!user) throw new AppError(404, 'Account not found');
  if (user.isEmailVerified === true) {
    return res.json({ success: true, message: 'Account already verified. Please sign in.', data: { email: user.email } });
  }
  assertValidOtpState(user.emailOtpHash, user.emailOtpExpiresAt, user.emailOtpAttempts);
  const matches = await bcrypt.compare(otp, user.emailOtpHash);
  if (!matches) {
    user.emailOtpAttempts = Number(user.emailOtpAttempts || 0) + 1;
    await user.save();
    throw new AppError(400, 'Invalid OTP');
  }
  user.isEmailVerified = true;
  user.emailVerificationStartedAt = null;
  user.emailOtpHash = '';
  user.emailOtpExpiresAt = null;
  user.emailOtpAttempts = 0;
  user.lastOtpSentAt = null;
  user.lastLoginAt = new Date();
  user.lastActiveAt = user.lastLoginAt;
  await user.save();
  res.json({
    success: true,
    message: 'Email verified successfully',
    data: authPayload(user),
  });
});

exports.resendOtp = asyncHandler(async (req, res) => {
  const email = normalizeEmail(req.body.email);
  if (!email) throw new AppError(400, 'Email is required');
  const user = await User.findOne({ email });
  if (!user) throw new AppError(404, 'Account not found');
  if (user.isEmailVerified === true || !requiresEmailVerification(user)) {
    return res.json({
      success: true,
      message: 'Account already verified. Please sign in.',
      data: { email: user.email, requiresOtpVerification: false },
    });
  }
  await sendEmailVerificationOtp(user);
  res.json({
    success: true,
    message: 'OTP sent to your email. Please verify your account.',
    data: { email: user.email, requiresOtpVerification: true },
  });
});

exports.login = asyncHandler(async (req, res) => {
  const email = normalizeEmail(req.body.email);
  const user = await User.findOne({ email }).select('+password');
  if (!user || !(await user.comparePassword(req.body.password || ''))) throw new AppError(401, 'Invalid email or password');
  if (requiresEmailVerification(user)) {
    return res.status(403).json({
      success: false,
      message: 'Please verify your email before signing in.',
      data: { requiresOtpVerification: true, email: user.email },
    });
  }
  markLegacyEmailVerified(user);
  user.lastLoginAt = new Date();
  user.lastActiveAt = user.lastLoginAt;
  await user.save();
  res.json({ success: true, message: 'Logged in', data: authPayload(user) });
});

exports.firebaseLogin = asyncHandler(async (req, res) => {
  const idToken = String(req.body.idToken || '').trim();
  const provider = String(req.body.provider || '').toLowerCase().trim();
  const requestedRole = String(req.body.role || '').trim();

  if (!idToken) throw new AppError(400, 'Firebase ID token is required');
  if (provider !== 'google') throw new AppError(400, 'Only Google sign-in is supported');

  let decoded;
  try {
    decoded = await verifyFirebaseIdToken(idToken);
  } catch (error) {
    throw firebaseErrorToAppError(error);
  }

  const firebaseUid = String(decoded.uid || '').trim();
  const email = normalizeEmail(decoded.email);
  const emailVerified = decoded.email_verified === true || decoded.emailVerified === true;
  const picture = safeAvatarUrl(decoded.picture);
  if (!firebaseUid) throw new AppError(401, 'Invalid Firebase token');
  if (!email) throw new AppError(400, 'Google account email is required');
  if (!emailVerified) throw new AppError(403, 'Google account email must be verified');

  let user = await User.findOne({
    $or: [{ firebaseUid }, { email }],
  });

  if (user) {
    if (!user.firebaseUid) user.firebaseUid = firebaseUid;
    user.isEmailVerified = true;
    user.emailVerificationStartedAt = null;
    user.emailOtpHash = '';
    user.emailOtpExpiresAt = null;
    user.emailOtpAttempts = 0;
    user.lastOtpSentAt = null;
    if (!user.avatarUrl && picture) user.avatarUrl = picture;
    user.lastLoginAt = new Date();
    user.lastActiveAt = user.lastLoginAt;
    await user.save();
    return res.json({
      success: true,
      message: 'Google sign-in successful',
      data: authPayload(user),
    });
  }

  if (!['organization_owner', 'teacher', 'student'].includes(requestedRole)) {
    return res.status(400).json({
      success: false,
      message: 'Role is required',
      data: { requiresRoleSelection: true },
    });
  }

  const userPayload = {
    name: firebaseProfileName(decoded),
    email,
    role: requestedRole,
    firebaseUid,
    authProvider: 'google',
    isEmailVerified: true,
    avatarUrl: picture || '',
  };

  if (requestedRole === 'organization_owner') {
    const plan = await permissions.ensureFreePlan();
    const orgName = String(req.body.organizationName || decoded.name || userPayload.name).trim();
    const orgPhone = String(req.body.organizationPhone || req.body.contactNumber || req.body.phone || '').trim();
    const orgAddress = String(req.body.organizationAddress || req.body.address || '').trim();
    const orgCategory = String(req.body.organizationCategory || req.body.category || req.body.organizationType || req.body.type || 'Other').trim();
    try {
      user = await User.create({
        ...userPayload,
        name: orgName,
        phone: orgPhone,
        contactNumber: orgPhone,
        address: orgAddress,
      });
      const organization = await Organization.create({
        name: orgName,
        email,
        phone: orgPhone,
        contactNumber: orgPhone,
        address: orgAddress,
        category: orgCategory,
        type: orgCategory,
        description: String(req.body.description || '').trim(),
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
  } else {
    user = await User.create(userPayload);
  }

  user.lastLoginAt = new Date();
  user.lastActiveAt = user.lastLoginAt;
  await user.save();
  res.status(201).json({
    success: true,
    message: 'Google sign-in successful',
    data: authPayload(user),
  });
});

exports.forgotPassword = asyncHandler(async (req, res) => {
  const email = normalizeEmail(req.body.email);
  if (!email) throw new AppError(400, 'Email is required');
  const user = await User.findOne({ email });
  if (user) await sendPasswordResetOtp(user);
  res.json({ success: true, message: 'Password reset OTP sent to your email.' });
});

exports.verifyResetOtp = asyncHandler(async (req, res) => {
  const email = normalizeEmail(req.body.email);
  const otp = String(req.body.otp || '').trim();
  if (!email) throw new AppError(400, 'Email is required');
  if (!new RegExp(`^\\d{${OTP_LENGTH}}$`).test(otp)) throw new AppError(400, 'Invalid OTP');
  const user = await User.findOne({ email }).select('+passwordResetOtpHash');
  if (!user) throw new AppError(400, 'Invalid OTP');
  assertValidOtpState(user.passwordResetOtpHash, user.passwordResetOtpExpiresAt, user.passwordResetOtpAttempts);
  const matches = await bcrypt.compare(otp, user.passwordResetOtpHash);
  if (!matches) {
    user.passwordResetOtpAttempts = Number(user.passwordResetOtpAttempts || 0) + 1;
    await user.save();
    throw new AppError(400, 'Invalid OTP');
  }
  const resetToken = crypto.randomBytes(32).toString('hex');
  user.passwordResetOtpHash = '';
  user.passwordResetOtpExpiresAt = null;
  user.passwordResetOtpAttempts = 0;
  user.passwordResetTokenHash = hashResetToken(resetToken);
  user.passwordResetTokenExpiresAt = addMinutes(RESET_TOKEN_EXPIRES_MINUTES);
  await user.save();
  res.json({
    success: true,
    message: 'OTP verified',
    data: { resetToken },
  });
});

exports.resetPassword = asyncHandler(async (req, res) => {
  const resetToken = String(req.body.resetToken || '').trim();
  const newPassword = String(req.body.newPassword || req.body.password || '');
  if (!resetToken) throw new AppError(400, 'Password reset token is required');
  if (newPassword.length < 8) throw new AppError(400, 'Password must contain at least 8 characters');
  const user = await User.findOne({ passwordResetTokenHash: hashResetToken(resetToken) }).select('+passwordResetTokenHash');
  if (!user || !user.passwordResetTokenHash || !user.passwordResetTokenExpiresAt || new Date(user.passwordResetTokenExpiresAt).getTime() <= Date.now()) {
    throw new AppError(400, 'Password reset token is invalid or expired');
  }
  user.password = newPassword;
  user.passwordResetOtpHash = '';
  user.passwordResetOtpExpiresAt = null;
  user.passwordResetOtpAttempts = 0;
  user.passwordResetLastOtpSentAt = null;
  user.passwordResetTokenHash = '';
  user.passwordResetTokenExpiresAt = null;
  user.tokenVersion = Number(user.tokenVersion || 0) + 1;
  await user.save();
  res.json({ success: true, message: 'Password reset successfully' });
});

exports.me = asyncHandler(async (req, res) => {
  const data = withSafeAvatarUrl(req.user);
  res.json({ success: true, data });
});

exports.logout = (_req, res) => res.json({ success: true, message: 'Logged out' });

exports.requiresEmailVerification = requiresEmailVerification;
exports.markLegacyEmailVerified = markLegacyEmailVerified;
