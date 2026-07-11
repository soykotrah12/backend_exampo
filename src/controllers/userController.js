const User = require('../models/User');
const asyncHandler = require('../utils/asyncHandler');
const AppError = require('../utils/AppError');
const permissions = require('../services/permissionService');
const avatarStorage = require('../services/avatarStorageService');

exports.updateMe = asyncHandler(async (req, res) => {
  const allowed = ['name','bio','location','avatarUrl','phone','contactNumber','address'];
  allowed.forEach((key) => { if (req.body[key] !== undefined) req.user[key] = String(req.body[key]).trim(); });
  await req.user.save(); res.json({ success: true, message: 'Profile updated', data: req.user.toSafeJSON() });
});

exports.uploadAvatar = asyncHandler(async (req, res) => {
  const uploadedFile = req.file;
  const buffer = uploadedFile?.buffer || req.body;
  const contentType = String(uploadedFile?.mimetype || req.headers['content-type'] || '').toLowerCase();

  if (!Buffer.isBuffer(buffer) || buffer.length === 0) throw new AppError(400, 'Select an image to upload');
  if (!contentType.startsWith('image/')) throw new AppError(400, 'Only image files are accepted');

  const previousAvatarUrl = req.user.avatarUrl;
  const { avatarUrl } = await avatarStorage.uploadAvatarBuffer({
    userId: req.user._id.toString(),
    buffer,
    contentType,
    originalName: uploadedFile?.originalname,
  });

  req.user.avatarUrl = avatarUrl;
  await req.user.save();
  await avatarStorage.deleteAvatarIfOwned(previousAvatarUrl);

  const user = req.user.toSafeJSON();
  res.json({
    success: true,
    message: 'Avatar uploaded successfully',
    data: {
      ...user,
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
  if (!user) user = await User.create({ name: req.body.name || req.body.email.split('@')[0], email: req.body.email, password: req.body.temporaryPassword || `Temp-${Date.now()}`, role, organization: req.user.organization, invitedBy: req.user._id });
  else { user.organization = req.user.organization; user.role = role; user.invitedBy = req.user._id; await user.save(); }
  const Organization = require('../models/Organization');
  await Organization.updateOne({ _id: req.user.organization }, { $addToSet: { [role === 'teacher' ? 'teachers' : 'students']: user._id } });
  res.status(201).json({ success: true, message: `${role} added`, data: user.toSafeJSON() });
});
