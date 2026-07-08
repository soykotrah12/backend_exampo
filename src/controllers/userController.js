const User = require('../models/User');
const fs = require('fs/promises');
const path = require('path');
const asyncHandler = require('../utils/asyncHandler');
const AppError = require('../utils/AppError');
const permissions = require('../services/permissionService');

exports.updateMe = asyncHandler(async (req, res) => {
  const allowed = ['name','bio','location','avatarUrl','phone','contactNumber','address'];
  allowed.forEach((key) => { if (req.body[key] !== undefined) req.user[key] = String(req.body[key]).trim(); });
  await req.user.save(); res.json({ success: true, message: 'Profile updated', data: req.user.toSafeJSON() });
});

exports.uploadAvatar = asyncHandler(async (req, res) => {
  if (!Buffer.isBuffer(req.body) || req.body.length === 0) throw new AppError(400, 'Select an image to upload');
  const contentType = String(req.headers['content-type'] || '').toLowerCase();
  const ext = contentType.includes('png') ? 'png' : contentType.includes('webp') ? 'webp' : contentType.includes('jpeg') || contentType.includes('jpg') ? 'jpg' : '';
  if (!ext) throw new AppError(400, 'Only JPEG, PNG, and WEBP profile images are accepted');
  const dir = path.join(__dirname, '..', '..', 'uploads', 'avatars');
  await fs.mkdir(dir, { recursive: true });
  const fileName = `${req.user._id}-${Date.now()}.${ext}`;
  await fs.writeFile(path.join(dir, fileName), req.body);
  req.user.avatarUrl = `${req.protocol}://${req.get('host')}/uploads/avatars/${fileName}`;
  await req.user.save();
  res.json({ success: true, message: 'Profile photo updated', data: req.user.toSafeJSON() });
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
