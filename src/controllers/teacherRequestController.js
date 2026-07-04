const Organization = require('../models/Organization');
const User = require('../models/User');
const TeacherJoinRequest = require('../models/TeacherJoinRequest');
const asyncHandler = require('../utils/asyncHandler');
const AppError = require('../utils/AppError');
const permissions = require('../services/permissionService');

const ownedOrganization = async (user, organizationId = user.organization) => {
  const organization = await Organization.findById(organizationId);
  if (!organization) throw new AppError(404, 'Organization not found');
  if (user.role !== 'organization_owner' || String(organization.owner) !== String(user._id)) throw new AppError(403, 'Only the organization owner can review teacher requests');
  return organization;
};

exports.joinOrganization = asyncHandler(async (req, res) => {
  if (req.user.role !== 'teacher') throw new AppError(403, 'Only teachers can request to join an organization');
  const code = String(req.body.organizationCode || '').trim().toUpperCase();
  if (!code) throw new AppError(400, 'Organization code is required');
  const organization = await Organization.findOne({ organizationCode: code });
  if (!organization || !organization.isActive) throw new AppError(404, 'Active organization not found for this code');
  if (req.user.organization && String(req.user.organization) === String(organization._id)) throw new AppError(409, 'You are already accepted in this organization');
  if (req.user.organization && String(req.user.organization) !== String(organization._id)) throw new AppError(409, 'You already belong to another organization');
  if (await TeacherJoinRequest.exists({ teacher: req.user._id, organization: organization._id, status: 'pending' })) throw new AppError(409, 'You already have a pending request for this organization');
  const request = await TeacherJoinRequest.create({
    teacher: req.user._id,
    organization: organization._id,
    message: String(req.body.message || '').trim(),
  });
  req.user.teacherJoinStatus = 'pending';
  await req.user.save();
  await request.populate('organization', 'name organizationCode');
  res.status(201).json({ success: true, message: 'Join request sent', data: request });
});

exports.organizationRequests = asyncHandler(async (req, res) => {
  const organization = await ownedOrganization(req.user);
  const status = String(req.query.status || 'pending').toLowerCase();
  const query = { organization: organization._id };
  if (['pending', 'accepted', 'rejected'].includes(status)) query.status = status;
  const requests = await TeacherJoinRequest.find(query)
    .populate('teacher', 'name email teacherJoinStatus')
    .populate('respondedBy', 'name email')
    .sort({ requestedAt: -1 })
    .lean();
  res.json({ success: true, data: requests });
});

exports.review = (status) => asyncHandler(async (req, res) => {
  const request = await TeacherJoinRequest.findById(req.params.id);
  if (!request) throw new AppError(404, 'Teacher join request not found');
  const organization = await ownedOrganization(req.user, request.organization);
  if (request.status !== 'pending') throw new AppError(409, `Request is already ${request.status}`);
  const teacher = await User.findOne({ _id: request.teacher, role: 'teacher', isActive: true });
  if (!teacher) throw new AppError(404, 'Teacher account not found');
  if (status === 'accepted') {
    if (teacher.organization && String(teacher.organization) !== String(organization._id)) throw new AppError(409, 'Teacher already belongs to another organization');
    await permissions.assertUserLimit(organization._id, 'teacher');
    teacher.organization = organization._id;
    teacher.joinedOrganizations.addToSet(organization._id);
    teacher.teacherJoinStatus = 'accepted';
    organization.teachers.addToSet(teacher._id);
    await Promise.all([teacher.save(), organization.save()]);
  } else {
    if (!teacher.organization) teacher.teacherJoinStatus = 'rejected';
    await teacher.save();
  }
  request.status = status;
  request.respondedBy = req.user._id;
  request.respondedAt = new Date();
  await request.save();
  await request.populate('teacher', 'name email teacherJoinStatus');
  res.json({ success: true, message: `Teacher request ${status}`, data: request });
});
