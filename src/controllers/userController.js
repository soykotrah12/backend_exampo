const bcrypt = require('bcrypt');
const crypto = require('crypto');
const User = require('../models/User');
const asyncHandler = require('../utils/asyncHandler');
const AppError = require('../utils/AppError');
const permissions = require('../services/permissionService');
const avatarStorage = require('../services/avatarStorageService');
const { safeAvatarUrl, withSafeAvatarUrl } = require('../utils/avatarUrl');
const {
  EmailAuthenticationError,
  EmailConfigurationError,
  EmailDeliveryError,
  EmailRecipientError,
  sendDeleteAccountOtpEmail,
} = require('../services/emailService');
const {
  assertCanDeleteAccount,
  softDeleteAccount,
} = require('../services/accountLifecycleService');

const DELETE_OTP_LENGTH = 6;
const DELETE_OTP_EXPIRES_MINUTES = 10;
const DELETE_OTP_MAX_ATTEMPTS = 5;
const DELETE_OTP_RESEND_COOLDOWN_SECONDS = Number(process.env.AUTH_OTP_RESEND_COOLDOWN_SECONDS || 60);

const addMinutes = (minutes) => new Date(Date.now() + minutes * 60 * 1000);

const createOtp = () => crypto.randomInt(100000, 1000000).toString();

const cooldownRemaining = (date) => {
  if (!date) return 0;
  const elapsedSeconds = Math.floor((Date.now() - new Date(date).getTime()) / 1000);
  return Math.max(DELETE_OTP_RESEND_COOLDOWN_SECONDS - elapsedSeconds, 0);
};

const throwIfCoolingDown = (date) => {
  const remaining = cooldownRemaining(date);
  if (remaining > 0) throw new AppError(429, `Please wait ${remaining} seconds before requesting another OTP.`);
};

const emailErrorToAppError = (error) => {
  if (error instanceof EmailConfigurationError || error?.name === 'EmailConfigurationError') {
    return new AppError(500, 'Email service is not configured');
  }
  if (error instanceof EmailAuthenticationError || error?.name === 'EmailAuthenticationError') {
    return new AppError(500, 'Email service authentication failed');
  }
  if (error instanceof EmailRecipientError || error?.name === 'EmailRecipientError') {
    return new AppError(400, 'Incorrect email address');
  }
  if (error instanceof EmailDeliveryError || error?.name === 'EmailDeliveryError') {
    return new AppError(502, 'Unable to send OTP. Please try again.');
  }
  return new AppError(502, 'Unable to send OTP. Please try again.');
};

const assertValidDeleteOtpState = (user) => {
  if (!user.deleteAccountOtpHash || !user.deleteAccountOtpExpiresAt || new Date(user.deleteAccountOtpExpiresAt).getTime() <= Date.now()) {
    throw new AppError(400, 'OTP expired. Please request a new OTP.');
  }
  if (Number(user.deleteAccountOtpAttempts || 0) >= DELETE_OTP_MAX_ATTEMPTS) {
    throw new AppError(429, 'Too many invalid attempts. Please request a new OTP.');
  }
};

exports.requestDeleteAccountOtp = asyncHandler(async (req, res) => {
  await assertCanDeleteAccount(req.user);
  throwIfCoolingDown(req.user.deleteAccountOtpRequestedAt);
  const otp = createOtp();
  req.user.deleteAccountOtpHash = await bcrypt.hash(otp, 12);
  req.user.deleteAccountOtpExpiresAt = addMinutes(DELETE_OTP_EXPIRES_MINUTES);
  req.user.deleteAccountOtpAttempts = 0;
  req.user.deleteAccountOtpRequestedAt = new Date();
  await req.user.save();
  try {
    await sendDeleteAccountOtpEmail({
      to: req.user.email,
      otp,
      expiresInMinutes: DELETE_OTP_EXPIRES_MINUTES,
    });
  } catch (error) {
    req.user.deleteAccountOtpHash = '';
    req.user.deleteAccountOtpExpiresAt = null;
    req.user.deleteAccountOtpAttempts = 0;
    req.user.deleteAccountOtpRequestedAt = null;
    await req.user.save().catch(() => {});
    throw emailErrorToAppError(error);
  }
  res.json({
    success: true,
    message: 'OTP sent to your email for account deletion.',
  });
});

exports.confirmDeleteAccount = asyncHandler(async (req, res) => {
  const otp = String(req.body.otp || '').trim();
  if (!new RegExp(`^\\d{${DELETE_OTP_LENGTH}}$`).test(otp)) throw new AppError(400, 'Invalid OTP');
  const user = await User.findById(req.user._id).select('+deleteAccountOtpHash');
  if (!user || user.isDeleted === true || !user.isActive) throw new AppError(401, 'User account is unavailable');
  assertValidDeleteOtpState(user);
  const matches = await bcrypt.compare(otp, user.deleteAccountOtpHash);
  if (!matches) {
    user.deleteAccountOtpAttempts = Number(user.deleteAccountOtpAttempts || 0) + 1;
    await user.save();
    throw new AppError(400, 'Invalid OTP');
  }
  await softDeleteAccount(user);
  res.json({
    success: true,
    message: 'Account deleted successfully. You can restore it within 30 days using the same email.',
  });
});

exports.updateMe = asyncHandler(async (req, res) => {
  const allowed = ['name','bio','location','avatarUrl','phone','contactNumber','address'];
  allowed.forEach((key) => {
    if (req.body[key] === undefined) return;
    req.user[key] = key === 'avatarUrl'
      ? (safeAvatarUrl(req.body[key]) || '')
      : String(req.body[key]).trim();
  });
  await req.user.save(); res.json({ success: true, message: 'Profile updated', data: withSafeAvatarUrl(req.user) });
});

exports.uploadAvatar = asyncHandler(async (req, res) => {
  const uploadedFile = req.file;
  const buffer = uploadedFile?.buffer || req.body;
  const contentType = String(uploadedFile?.mimetype || req.headers['content-type'] || '').toLowerCase();

  console.info('[avatar] request received', {
    fileReceived: Boolean(uploadedFile),
    mimetype: uploadedFile?.mimetype || req.headers['content-type'] || '',
    size: uploadedFile?.size || (Buffer.isBuffer(buffer) ? buffer.length : 0),
  });

  if (!Buffer.isBuffer(buffer) || buffer.length === 0) throw new AppError(400, 'Select an image to upload');
  if (!contentType.startsWith('image/')) throw new AppError(400, 'Only image files are accepted');

  const previousAvatarUrl = req.user.avatarUrl;
  console.log('[avatar] old avatar check', avatarStorage.avatarUrlInfo(previousAvatarUrl));
  let avatarUrl;
  try {
    if (uploadedFile) {
      ({ avatarUrl } = await avatarStorage.uploadAvatarFile({
        userId: req.user._id.toString(),
        file: uploadedFile,
      }));
    } else {
      ({ avatarUrl } = await avatarStorage.uploadAvatarBuffer({
        userId: req.user._id.toString(),
        buffer,
        contentType,
        originalName: req.headers['x-file-name'],
      }));
    }
    console.info('[avatar] upload success', { userId: req.user._id.toString() });
  } catch (error) {
    console.error('[avatar] upload failure', {
      userId: req.user._id.toString(),
      message: error.message,
      code: error.code,
      statusCode: error.statusCode,
    });
    throw error;
  }

  req.user.avatarUrl = avatarUrl;
  await req.user.save();
  await avatarStorage.deleteAvatarIfOwned(previousAvatarUrl);

  const user = withSafeAvatarUrl(req.user);
  res.json({
    success: true,
    message: 'Avatar uploaded successfully',
    data: {
      avatarUrl: user.avatarUrl,
      user,
    },
  });
});

exports.invite = asyncHandler(async (req, res) => {
  const role = req.body.role;
  if (!['teacher','student'].includes(role)) throw new AppError(400, 'Only teachers or students can be added');
  await permissions.assertUserLimit(req.user.organization, role);
  let user = await User.findOne({ email: String(req.body.email || '').toLowerCase() });
  if (user && user.organization && user.organization.toString() !== req.user.organization.toString()) throw new AppError(409, 'User belongs to another organization');
  if (!user) user = await User.create({ name: req.body.name || req.body.email.split('@')[0], email: req.body.email, password: req.body.temporaryPassword || `Temp-${Date.now()}`, role, organization: req.user.organization, invitedBy: req.user._id, isEmailVerified: true });
  else { user.organization = req.user.organization; user.role = role; user.invitedBy = req.user._id; await user.save(); }
  const Organization = require('../models/Organization');
  await Organization.updateOne({ _id: req.user.organization }, { $addToSet: { [role === 'teacher' ? 'teachers' : 'students']: user._id } });
  res.status(201).json({ success: true, message: `${role} added`, data: user.toSafeJSON() });
});
