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
  EmailAuthenticationError,
  EmailConfigurationError,
  EmailDeliveryError,
  EmailRecipientError,
  sendPasswordResetOtpEmail,
  sendRestoreAccountOtpEmail,
  sendSignupOtpEmail,
} = require('../services/emailService');
const {
  FirebaseAdminConfigurationError,
  verifyFirebaseIdToken,
} = require('../services/firebaseAdminService');
const {
  canRestoreDeletedUser,
  deletedAccountData,
  permanentlyDeleteSoftDeletedAccount,
  restoreAccount,
} = require('../services/accountLifecycleService');

const OTP_LENGTH = Math.min(Math.max(Number(process.env.AUTH_OTP_LENGTH || 6), 4), 8);
const OTP_EXPIRES_MINUTES = Number(process.env.AUTH_OTP_EXPIRES_MINUTES || 10);
const OTP_RESEND_COOLDOWN_SECONDS = Number(process.env.AUTH_OTP_RESEND_COOLDOWN_SECONDS || 60);
const OTP_MAX_ATTEMPTS = Number(process.env.AUTH_OTP_MAX_ATTEMPTS || 5);
const RESET_TOKEN_EXPIRES_MINUTES = Number(process.env.PASSWORD_RESET_TOKEN_EXPIRES_MINUTES || 15);
const INVALID_EMAIL_MESSAGE = 'Please enter a valid email address';
const INCORRECT_EMAIL_MESSAGE = 'Incorrect email address';
const REPLACE_DELETED_ACCOUNT_MESSAGE = 'Old deleted account removed. OTP sent to your email to create a new account.';

const normalizeEmail = (email) => String(email || '').toLowerCase().trim();
const isDuplicateEmailError = (error) => {
  if (error?.code !== 11000) return false;
  const keyPattern = error.keyPattern || {};
  const keyValue = error.keyValue || {};
  const message = String(error.message || '').toLowerCase();
  return Object.prototype.hasOwnProperty.call(keyPattern, 'email') ||
    Object.prototype.hasOwnProperty.call(keyValue, 'email') ||
    message.includes('email');
};
const isValidEmailFormat = (email) => {
  const value = normalizeEmail(email);
  if (!value || value.length > 254 || value.includes('..')) return false;
  const [localPart, domain] = value.split('@');
  if (!localPart || !domain || value.split('@').length !== 2) return false;
  if (localPart.length > 64 || domain.length > 253 || !domain.includes('.')) return false;
  if (!/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+$/i.test(localPart)) return false;
  if (!/^[a-z0-9.-]+$/i.test(domain)) return false;
  return domain.split('.').every((label) =>
    label.length > 0 &&
    label.length <= 63 &&
    !label.startsWith('-') &&
    !label.endsWith('-')
  );
};
const assertValidEmail = (email) => {
  if (!normalizeEmail(email)) throw new AppError(400, 'Email is required');
  if (!isValidEmailFormat(email)) throw new AppError(400, INVALID_EMAIL_MESSAGE);
};
const addMinutes = (minutes) => new Date(Date.now() + minutes * 60 * 1000);
const tokenSecret = () => process.env.JWT_SECRET || 'development-only-secret';
const refreshTokenSecret = () => process.env.JWT_REFRESH_SECRET || tokenSecret();

const tokenFor = (user, type = 'access') => jwt.sign(
  { sub: user._id.toString(), role: user.role, type, tokenVersion: Number(user.tokenVersion || 0) },
  type === 'refresh' ? refreshTokenSecret() : tokenSecret(),
  { expiresIn: type === 'refresh' ? (process.env.JWT_REFRESH_EXPIRES_IN || '30d') : (process.env.JWT_EXPIRES_IN || '7d') },
);

const authPayload = (user) => {
  const accessToken = tokenFor(user);
  const refreshToken = tokenFor(user, 'refresh');
  const safeUser = withSafeAvatarUrl(user);
  safeUser.hasPassword = Boolean(user.password);
  return {
    token: accessToken,
    accessToken,
    refreshToken,
    user: safeUser,
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
  if (error instanceof EmailConfigurationError || error?.name === 'EmailConfigurationError') {
    return new AppError(500, 'Email service is not configured');
  }
  if (error instanceof EmailAuthenticationError || error?.name === 'EmailAuthenticationError') {
    return new AppError(500, 'Email service authentication failed');
  }
  if (error instanceof EmailRecipientError || error?.name === 'EmailRecipientError') {
    return new AppError(400, INCORRECT_EMAIL_MESSAGE);
  }
  if (error instanceof EmailDeliveryError || error?.name === 'EmailDeliveryError') {
    return new AppError(502, 'Unable to send OTP. Please try again.');
  }
  return new AppError(502, 'Unable to send OTP. Please try again.');
};

const sendEmailVerificationOtp = async (user, { ignoreCooldown = false } = {}) => {
  if (!ignoreCooldown) throwIfCoolingDown(user.lastOtpSentAt);
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

const sendRestoreAccountOtp = async (user) => {
  throwIfCoolingDown(user.lastRestoreOtpSentAt);
  const otp = createOtp();
  user.restoreAccountOtpHash = await bcrypt.hash(otp, 12);
  user.restoreAccountOtpExpiresAt = addMinutes(OTP_EXPIRES_MINUTES);
  user.restoreAccountOtpAttempts = 0;
  user.lastRestoreOtpSentAt = new Date();
  await user.save();
  try {
    await sendRestoreAccountOtpEmail({
      to: user.email,
      otp,
      expiresInMinutes: OTP_EXPIRES_MINUTES,
    });
  } catch (error) {
    user.lastRestoreOtpSentAt = null;
    await user.save().catch(() => {});
    throw emailErrorToAppError(error);
  }
};

const cleanupNewUnverifiedSignup = async ({ user, organization }) => {
  if (!user?._id || user.isEmailVerified === true) return;
  const cleanupTasks = [User.deleteOne({ _id: user._id, isEmailVerified: false }).catch(() => {})];
  if (organization?._id) cleanupTasks.push(Organization.deleteOne({ _id: organization._id }).catch(() => {}));
  await Promise.all(cleanupTasks);
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

const googleIdentityFromRequest = async (req) => {
  const idToken = String(req.body.idToken || '').trim();
  const provider = String(req.body.provider || '').toLowerCase().trim();

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

  return { decoded, firebaseUid, email, picture };
};

const assertValidGoogleRole = (role, res) => {
  if (['organization_owner', 'teacher', 'student'].includes(role)) return true;
  res.status(400).json({
    success: false,
    message: 'Role is required',
    data: { requiresRoleSelection: true },
  });
  return false;
};

const createGoogleUser = async ({ req, decoded, firebaseUid, email, picture, role }) => {
  const userPayload = {
    name: firebaseProfileName(decoded),
    email,
    role,
    firebaseUid,
    authProvider: 'google',
    isEmailVerified: true,
    avatarUrl: picture || '',
  };

  let user;
  if (role === 'organization_owner') {
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
  return user;
};

const handleRegister = async (req, res, { successMessage, successStatus = 201 } = {}) => {
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
  assertValidEmail(loginEmail);

  const existing = await User.findOne({ email: loginEmail });
  if (existing) {
    if (existing.isDeleted === true) {
      if (canRestoreDeletedUser(existing)) {
        return res.status(409).json({
          success: false,
          message: 'A deleted account already exists with this email.',
          data: deletedAccountData(existing, {
            deletedAccountConflict: true,
            canPermanentDeleteOldAccount: true,
          }),
        });
      }
      await permanentlyDeleteSoftDeletedAccount(existing);
    } else if (requiresEmailVerification(existing)) {
      await sendEmailVerificationOtp(existing, { ignoreCooldown: true });
      return res.status(200).json({
        success: true,
        message: 'OTP sent to your email. Please verify your account.',
        data: { email: existing.email, requiresOtpVerification: true },
      });
    } else {
      throw new AppError(409, 'Account already exists. Please sign in.');
    }
  }

  let user;
  let organization;
  let createdForSignup = false;
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
      createdForSignup = true;
      organization = await Organization.create({
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
      await cleanupNewUnverifiedSignup({ user, organization });
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
    createdForSignup = true;
  }

  try {
    await sendEmailVerificationOtp(user);
  } catch (error) {
    if (createdForSignup) await cleanupNewUnverifiedSignup({ user, organization });
    throw error;
  }
  res.status(successStatus).json({
    success: true,
    message: successMessage || 'OTP sent to your email. Please verify your account.',
    data: { email: user.email, requiresOtpVerification: true },
  });
};

exports.register = asyncHandler(handleRegister);

exports.replaceDeletedAccountAndRegister = asyncHandler(async (req, res) => {
  const role = req.body.role;
  if (!['organization_owner','teacher','student'].includes(role)) throw new AppError(400, 'Invalid registration role');
  const email = normalizeEmail(role === 'organization_owner' ? (req.body.organizationEmail || req.body.email) : req.body.email);
  assertValidEmail(email);
  const existing = await User.findOne({ email });
  if (!existing || existing.isDeleted !== true) throw new AppError(404, 'Deleted account not found');
  if (!canRestoreDeletedUser(existing)) throw new AppError(410, 'This account can no longer be restored.');
  await permanentlyDeleteSoftDeletedAccount(existing);
  try {
    return await handleRegister(req, res, {
      successMessage: REPLACE_DELETED_ACCOUNT_MESSAGE,
    });
  } catch (error) {
    if (!isDuplicateEmailError(error)) throw error;

    const conflictingUser = await User.findOne({ email });
    if (conflictingUser?.isDeleted === true) {
      await permanentlyDeleteSoftDeletedAccount(conflictingUser);
      return handleRegister(req, res, {
        successMessage: REPLACE_DELETED_ACCOUNT_MESSAGE,
      });
    }

    if (conflictingUser && requiresEmailVerification(conflictingUser)) {
      await sendEmailVerificationOtp(conflictingUser, { ignoreCooldown: true });
      return res.status(200).json({
        success: true,
        message: REPLACE_DELETED_ACCOUNT_MESSAGE,
        data: { email: conflictingUser.email, requiresOtpVerification: true },
      });
    }

    throw new AppError(409, 'Account already exists. Please sign in.');
  }
});

exports.verifyOtp = asyncHandler(async (req, res) => {
  const email = normalizeEmail(req.body.email);
  const otp = String(req.body.otp || '').trim();
  assertValidEmail(email);
  if (!new RegExp(`^\\d{${OTP_LENGTH}}$`).test(otp)) throw new AppError(400, 'Invalid OTP');
  const user = await User.findOne({ email }).select('+emailOtpHash +password');
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
  assertValidEmail(email);
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
  if (user.isDeleted === true) {
    if (canRestoreDeletedUser(user)) {
      return res.status(403).json({
        success: false,
        message: 'This account was deleted. You can restore it within 30 days.',
        data: deletedAccountData(user),
      });
    }
    return res.status(403).json({
      success: false,
      message: 'This account can no longer be restored.',
    });
  }
  if (!user.isActive) throw new AppError(401, 'User account is unavailable');
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
  const requestedRole = String(req.body.role || '').trim();
  const identity = await googleIdentityFromRequest(req);
  const { decoded, firebaseUid, email, picture } = identity;

  let user = await User.findOne({
    $or: [{ firebaseUid }, { email }],
  }).select('+password');

  if (user) {
    if (user.isDeleted === true) {
      if (canRestoreDeletedUser(user)) {
        return res.status(403).json({
          success: false,
          message: 'A deleted account already exists with this Google email.',
          data: deletedAccountData(user, {
            deletedAccountConflict: true,
            canPermanentDeleteOldAccount: true,
            provider: 'google',
          }),
        });
      }
      await permanentlyDeleteSoftDeletedAccount(user);
      user = null;
    }
    if (user) {
      if (!user.isActive) throw new AppError(401, 'User account is unavailable');
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
  }

  if (!assertValidGoogleRole(requestedRole, res)) return;
  user = await createGoogleUser({
    req,
    decoded,
    firebaseUid,
    email,
    picture,
    role: requestedRole,
  });
  res.status(201).json({
    success: true,
    message: 'Google sign-in successful',
    data: authPayload(user),
  });
});

exports.replaceDeletedAccountAndFirebaseLogin = asyncHandler(async (req, res) => {
  const requestedRole = String(req.body.role || '').trim();
  const identity = await googleIdentityFromRequest(req);
  const { decoded, firebaseUid, email, picture } = identity;

  const existing = await User.findOne({ email });
  if (!existing || existing.isDeleted !== true) throw new AppError(404, 'Deleted account not found');
  if (!canRestoreDeletedUser(existing)) throw new AppError(410, 'This account can no longer be restored.');
  if (!assertValidGoogleRole(requestedRole, res)) return;

  await permanentlyDeleteSoftDeletedAccount(existing);
  const user = await createGoogleUser({
    req,
    decoded,
    firebaseUid,
    email,
    picture,
    role: requestedRole,
  });

  res.status(201).json({
    success: true,
    message: 'Old deleted account removed. New Google account created successfully.',
    data: authPayload(user),
  });
});

exports.requestRestoreAccount = asyncHandler(async (req, res) => {
  const email = normalizeEmail(req.body.email);
  assertValidEmail(email);
  const user = await User.findOne({ email });
  if (!user || user.isDeleted !== true) throw new AppError(404, 'Deleted account not found');
  if (!canRestoreDeletedUser(user)) throw new AppError(410, 'This account can no longer be restored.');
  await sendRestoreAccountOtp(user);
  res.json({
    success: true,
    message: 'Restore OTP sent to your email.',
    data: { email: user.email },
  });
});

exports.confirmRestoreAccount = asyncHandler(async (req, res) => {
  const email = normalizeEmail(req.body.email);
  const otp = String(req.body.otp || '').trim();
  assertValidEmail(email);
  if (!new RegExp(`^\\d{${OTP_LENGTH}}$`).test(otp)) throw new AppError(400, 'Invalid OTP');
  const user = await User.findOne({ email }).select('+restoreAccountOtpHash +password');
  if (!user || user.isDeleted !== true) throw new AppError(400, 'Invalid OTP');
  if (!canRestoreDeletedUser(user)) throw new AppError(410, 'This account can no longer be restored.');
  assertValidOtpState(user.restoreAccountOtpHash, user.restoreAccountOtpExpiresAt, user.restoreAccountOtpAttempts);
  const matches = await bcrypt.compare(otp, user.restoreAccountOtpHash);
  if (!matches) {
    user.restoreAccountOtpAttempts = Number(user.restoreAccountOtpAttempts || 0) + 1;
    await user.save();
    throw new AppError(400, 'Invalid OTP');
  }
  await restoreAccount(user);
  res.json({
    success: true,
    message: 'Account restored successfully.',
    data: authPayload(user),
  });
});

exports.forgotPassword = asyncHandler(async (req, res) => {
  const email = normalizeEmail(req.body.email);
  assertValidEmail(email);
  const user = await User.findOne({ email });
  if (user) await sendPasswordResetOtp(user);
  res.json({ success: true, message: 'Password reset OTP sent to your email.' });
});

exports.verifyResetOtp = asyncHandler(async (req, res) => {
  const email = normalizeEmail(req.body.email);
  const otp = String(req.body.otp || '').trim();
  assertValidEmail(email);
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
  const user = await User.findById(req.user._id).select('+password');
  const data = withSafeAvatarUrl(user || req.user);
  data.hasPassword = Boolean(user?.password);
  res.json({ success: true, data });
});

exports.logout = (_req, res) => res.json({ success: true, message: 'Logged out' });

exports.isValidEmailFormat = isValidEmailFormat;
exports.requiresEmailVerification = requiresEmailVerification;
exports.markLegacyEmailVerified = markLegacyEmailVerified;
