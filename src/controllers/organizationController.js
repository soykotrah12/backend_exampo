const Organization = require('../models/Organization');
const User = require('../models/User');
const Service = require('../models/Service');
const Batch = require('../models/Batch');
const ExamSlot = require('../models/ExamSlot');
const Submission = require('../models/Submission');
const TeacherJoinRequest = require('../models/TeacherJoinRequest');
const asyncHandler = require('../utils/asyncHandler');
const AppError = require('../utils/AppError');
const permissions = require('../services/permissionService');
const { generateCode } = require('../utils/codeGenerator');

const ownerOnly = (user, organization) => {
  if (user.role !== 'organization_owner' || String(organization.owner) !== String(user._id)) throw new AppError(403, 'Only the organization owner can perform this action');
};

const ensureCode = async (organization) => {
  if (!organization.organizationCode) {
    organization.organizationCode = generateCode('ORG');
    organization.codeCreatedAt = new Date();
    await organization.save();
  }
  return organization;
};

const currentOrganization = async (user) => {
  if (!user.organization) throw new AppError(404, 'You have not joined an organization');
  const organization = await Organization.findById(user.organization);
  if (!organization) throw new AppError(404, 'Organization not found');
  await ensureCode(organization);
  return organization;
};

exports.me = asyncHandler(async (req, res) => {
  const organization = await Organization.findById(req.user.organization)
    .populate('owner', 'name email')
    .populate('teachers', 'name email teacherJoinStatus assignedServices assignedBatches')
    .populate('students', 'name email');
  if (!organization) throw new AppError(404, 'You have not joined an organization');
  await ensureCode(organization);
  res.json({ success: true, data: organization });
});

exports.updateMe = asyncHandler(async (req, res) => {
  const organization = await currentOrganization(req.user);
  ownerOnly(req.user, organization);
  if (req.body.name !== undefined) organization.name = String(req.body.name).trim();
  await organization.save();
  res.json({ success: true, message: 'Organization updated', data: organization });
});

exports.joinByCode = asyncHandler(async (req, res) => {
  const code = String(req.body.organizationCode || '').trim().toUpperCase();
  if (!code) throw new AppError(400, 'Organization code is required');
  const organization = await Organization.findOne({ organizationCode: code, isActive: true });
  if (!organization) throw new AppError(404, 'Active organization not found for this code');
  if (req.user.organization && String(req.user.organization) !== String(organization._id)) throw new AppError(409, 'You already belong to another organization');
  req.user.organization = organization._id;
  req.user.joinedOrganizations.addToSet(organization._id);
  organization.students.addToSet(req.user._id);
  await Promise.all([req.user.save(), organization.save()]);
  res.json({ success: true, message: 'Organization joined successfully', data: organization });
});

exports.dashboardSummary = asyncHandler(async (req, res) => {
  const organization = await currentOrganization(req.user);
  ownerOnly(req.user, organization);
  const [planLimits, servicesCount, batches, examsCount, recentSubmissions, teachersCount, studentsCount] = await Promise.all([
    permissions.getLimits(organization._id),
    Service.countDocuments({ organization: organization._id, isActive: true }),
    Batch.find({ organization: organization._id }).select('name students isActive').lean(),
    ExamSlot.countDocuments({ organization: organization._id }),
    Submission.find({ organization: organization._id }).populate('student', 'name').populate('examSlot', 'title resultPublished resultVisibilityMode').sort({ submittedAt: -1 }).limit(6).lean(),
    User.countDocuments({ organization: organization._id, role: 'teacher', isActive: true }),
    User.countDocuments({ organization: organization._id, role: 'student', isActive: true }),
  ]);
  const activeBatches = batches.filter((batch) => batch.isActive !== false);
  res.json({
    success: true,
    data: {
      organizationName: organization.name,
      organizationCode: organization.organizationCode,
      plan: organization.plan,
      subscriptionStatus: organization.subscriptionStatus,
      teacherLimit: planLimits.teachersLimit,
      totalTeachers: teachersCount,
      totalStudents: studentsCount,
      totalServices: servicesCount,
      totalBatches: activeBatches.length,
      batchStudentCounts: batches.map((batch) => ({ _id: batch._id, name: batch.name, studentCount: batch.students.length, isActive: batch.isActive })),
      recentSubmissions: recentSubmissions.map((submission) => ({
        _id: submission._id,
        studentName: submission.student?.name || 'Student',
        examTitle: submission.examSlot?.title || 'Exam',
        totalScore: submission.totalScore,
        percentage: submission.percentage,
        submittedAt: submission.submittedAt,
      })),
    },
  });
});

exports.teachers = asyncHandler(async (req, res) => {
  const organization = await currentOrganization(req.user);
  ownerOnly(req.user, organization);
  const [teachers, pendingRequests] = await Promise.all([
    User.find({ organization: organization._id, role: 'teacher', isActive: true })
      .select('name email teacherJoinStatus assignedServices assignedBatches')
      .populate('assignedServices', 'name')
      .populate('assignedBatches', 'name batchCode')
      .sort({ name: 1 })
      .lean(),
    TeacherJoinRequest.find({ organization: organization._id, status: 'pending' })
      .populate('teacher', 'name email')
      .sort({ requestedAt: -1 })
      .lean(),
  ]);
  res.json({ success: true, data: { teachers, pendingRequests } });
});

exports.students = asyncHandler(async (req, res) => {
  if (!req.user.organization) return res.json({ success: true, data: [] });
  const query = { organization: req.user.organization, role: 'student', isActive: true };
  if (req.user.role === 'teacher') query.batches = { $in: req.user.assignedBatches };
  const students = await User.find(query).select('name email batches').populate('batches', 'name batchCode service').lean();
  const data = await Promise.all(students.map(async (student) => {
    const submissions = await Submission.find({ student: student._id, organization: req.user.organization, resultPublished: true }).select('totalScore percentage').lean();
    const totalScore = submissions.reduce((sum, item) => sum + Number(item.totalScore || 0), 0);
    const averageScore = submissions.length ? totalScore / submissions.length : 0;
    return { ...student, submittedExamsCount: submissions.length, totalScore, averageScore, percentage: submissions.length ? submissions.reduce((sum, item) => sum + Number(item.percentage || 0), 0) / submissions.length : 0 };
  }));
  res.json({ success: true, data });
});

exports.assignTeacher = asyncHandler(async (req, res) => {
  const organization = await currentOrganization(req.user);
  ownerOnly(req.user, organization);
  const teacher = await User.findOne({ _id: req.params.teacherId, organization: organization._id, role: 'teacher', isActive: true });
  if (!teacher) throw new AppError(404, 'Teacher not found in this organization');
  const serviceIds = [...new Set(req.body.serviceIds || [])];
  const batchIds = [...new Set(req.body.batchIds || [])];
  const [services, batches] = await Promise.all([
    Service.find({ _id: { $in: serviceIds }, organization: organization._id, isActive: true }).select('_id').lean(),
    Batch.find({ _id: { $in: batchIds }, organization: organization._id, isActive: true }).select('_id service').lean(),
  ]);
  if (services.length !== serviceIds.length) throw new AppError(403, 'Every assigned service must belong to your organization');
  if (batches.length !== batchIds.length) throw new AppError(403, 'Every assigned batch must belong to your organization');
  const serviceSet = new Set(serviceIds.map(String));
  const invalidBatch = batches.find((batch) => batch.service && serviceSet.size && !serviceSet.has(String(batch.service)));
  if (invalidBatch) throw new AppError(400, 'Assigned batches must belong to the selected services');
  teacher.assignedServices = services.map((service) => service._id);
  teacher.assignedBatches = batches.map((batch) => batch._id);
  teacher.teacherJoinStatus = 'accepted';
  await teacher.save();
  await Batch.updateMany({ organization: organization._id }, { $pull: { assignedTeachers: teacher._id } });
  if (batches.length) await Batch.updateMany({ _id: { $in: batches.map((batch) => batch._id) } }, { $addToSet: { assignedTeachers: teacher._id } });
  const populated = await User.findById(teacher._id).select('name email teacherJoinStatus assignedServices assignedBatches').populate('assignedServices', 'name').populate('assignedBatches', 'name batchCode');
  res.json({ success: true, message: 'Teacher assignment updated', data: populated });
});

exports.removeTeacher = asyncHandler(async (req, res) => {
  const organization = await currentOrganization(req.user);
  ownerOnly(req.user, organization);
  const teacher = await User.findOne({ _id: req.params.teacherId, organization: organization._id, role: 'teacher' });
  if (!teacher) throw new AppError(404, 'Teacher not found in this organization');
  teacher.organization = null;
  teacher.teacherJoinStatus = 'none';
  teacher.assignedServices = [];
  teacher.assignedBatches = [];
  await Promise.all([
    teacher.save(),
    Organization.updateOne({ _id: organization._id }, { $pull: { teachers: teacher._id } }),
    Batch.updateMany({ organization: organization._id }, { $pull: { assignedTeachers: teacher._id } }),
  ]);
  res.json({ success: true, message: 'Teacher removed from organization' });
});
