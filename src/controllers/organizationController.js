const Organization = require('../models/Organization');
const User = require('../models/User');
const Service = require('../models/Service');
const Batch = require('../models/Batch');
const ExamSlot = require('../models/ExamSlot');
const Submission = require('../models/Submission');
const AccessRequest = require('../models/AccessRequest');
const TeacherJoinRequest = require('../models/TeacherJoinRequest');
const fs = require('fs/promises');
const path = require('path');
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

const teacherForOrganization = async (teacherId, organizationId) => {
  const teacher = await User.findOne({
    _id: teacherId,
    organization: organizationId,
    role: 'teacher',
  });
  if (!teacher) throw new AppError(404, 'Teacher not found in this organization');
  return teacher;
};

const publicProfileFields = 'name email role avatarUrl phone contactNumber address bio location createdAt';
const publicTeacherFields = `${publicProfileFields} teacherJoinStatus organizationAccessStatus pausedUntil pausedReason removedAt assignedServices assignedBatches`;

const safeUser = (user = {}) => {
  const value = user.toObject ? user.toObject() : user;
  delete value.password;
  delete value.tokenVersion;
  return value;
};

const planData = (organization, limits, usedTeachersCount) => ({
  plan: organization.plan || null,
  subscriptionStatus: organization.subscriptionStatus || 'free',
  limits,
  teacherLimit: limits.teachersLimit,
  studentLimit: limits.studentsLimit,
  usedTeachersCount,
  upgradeAvailable: true,
});

const submissionStatsForStudent = async (studentId, organizationId) => {
  const submissions = await Submission.find({
    student: studentId,
    organization: organizationId,
    resultPublished: true,
  })
    .populate('examSlot', 'title totalMarks resultVisibilityMode resultPublished')
    .select('totalScore percentage submittedAt status examSlot')
    .sort({ submittedAt: -1 })
    .lean();
  const totalScore = submissions.reduce((sum, item) => sum + Number(item.totalScore || 0), 0);
  const percentageTotal = submissions.reduce((sum, item) => sum + Number(item.percentage || 0), 0);
  return {
    submittedExamsCount: submissions.length,
    totalScore,
    averageScore: submissions.length ? totalScore / submissions.length : 0,
    percentage: submissions.length ? percentageTotal / submissions.length : 0,
    recentResults: submissions.slice(0, 8).map((item) => ({
      _id: item._id,
      examTitle: item.examSlot?.title || 'Exam',
      totalScore: item.totalScore || 0,
      percentage: item.percentage || 0,
      submittedAt: item.submittedAt,
      status: item.status,
    })),
  };
};

exports.me = asyncHandler(async (req, res) => {
  const organization = await Organization.findById(req.user.organization)
    .populate('owner', publicProfileFields)
    .populate('plan')
    .populate({ path: 'teachers', select: publicTeacherFields, match: { isActive: true, isDeleted: { $ne: true } } })
    .populate({ path: 'students', select: publicProfileFields, match: { isActive: true, isDeleted: { $ne: true } } })
    .populate('services', 'name isActive');
  if (!organization) throw new AppError(404, 'You have not joined an organization');
  await ensureCode(organization);
  const [limits, servicesCount, batchesCount, teachersCount, studentsCount] = await Promise.all([
    permissions.getLimits(organization._id),
    Service.countDocuments({ organization: organization._id, isActive: true }),
    Batch.countDocuments({ organization: organization._id, isActive: true }),
    User.countDocuments({ organization: organization._id, role: 'teacher', isActive: true }),
    User.countDocuments({ organization: organization._id, role: 'student', isActive: true }),
  ]);
  const data = organization.toObject();
  data.owner = safeUser(data.owner);
  data.email = data.email || data.owner?.email || '';
  data.phone = data.phone || data.contactNumber || '';
  data.contactNumber = data.contactNumber || data.phone || '';
  data.category = data.category || data.type || '';
  data.type = data.type || data.category || '';
  data.logoUrl = data.logoUrl || data.avatarUrl || '';
  if (req.user.role !== 'organization_owner') {
    delete data.organizationCode;
  }
  data.counts = {
    teachers: teachersCount,
    students: studentsCount,
    services: servicesCount,
    batches: batchesCount,
  };
  data.totalTeachers = teachersCount;
  data.totalStudents = studentsCount;
  data.totalServices = servicesCount;
  data.totalBatches = batchesCount;
  data.subscription = planData(organization, limits, teachersCount);
  res.json({ success: true, message: 'Organization profile fetched successfully', data });
});

exports.updateMe = asyncHandler(async (req, res) => {
  const organization = await currentOrganization(req.user);
  ownerOnly(req.user, organization);
  const textFields = ['name','email','phone','contactNumber','address','category','type','description','logoUrl','avatarUrl'];
  textFields.forEach((key) => {
    if (req.body[key] !== undefined) organization[key] = String(req.body[key]).trim();
  });
  organization.phone = organization.phone || organization.contactNumber || '';
  organization.contactNumber = organization.contactNumber || organization.phone || '';
  organization.category = organization.category || organization.type || '';
  organization.type = organization.type || organization.category || '';
  organization.logoUrl = organization.logoUrl || organization.avatarUrl || '';
  organization.avatarUrl = organization.avatarUrl || organization.logoUrl || '';
  if (req.body.email !== undefined) {
    const nextEmail = String(req.body.email || '').toLowerCase().trim();
    if (!nextEmail) throw new AppError(400, 'Organization email is required');
    const duplicate = await User.exists({ _id: { $ne: req.user._id }, email: nextEmail });
    if (duplicate) throw new AppError(409, 'Email already registered');
    organization.email = nextEmail;
    req.user.email = nextEmail;
  }
  if (req.body.name !== undefined) req.user.name = organization.name;
  req.user.phone = organization.phone;
  req.user.contactNumber = organization.contactNumber;
  req.user.address = organization.address;
  await Promise.all([organization.save(), req.user.save()]);
  res.json({ success: true, message: 'Organization updated successfully', data: organization });
});

exports.uploadLogo = asyncHandler(async (req, res) => {
  const organization = await currentOrganization(req.user);
  ownerOnly(req.user, organization);
  if (!Buffer.isBuffer(req.body) || req.body.length === 0) throw new AppError(400, 'Select an image to upload');
  const contentType = String(req.headers['content-type'] || '').toLowerCase();
  const ext = contentType.includes('png') ? 'png' : contentType.includes('webp') ? 'webp' : contentType.includes('jpeg') || contentType.includes('jpg') ? 'jpg' : '';
  if (!ext) throw new AppError(400, 'Only JPEG, PNG, and WEBP organization logos are accepted');
  const dir = path.join(__dirname, '..', '..', 'uploads', 'organization-logos');
  await fs.mkdir(dir, { recursive: true });
  const fileName = `${organization._id}-${Date.now()}.${ext}`;
  await fs.writeFile(path.join(dir, fileName), req.body);
  organization.logoUrl = `${req.protocol}://${req.get('host')}/uploads/organization-logos/${fileName}`;
  organization.avatarUrl = organization.logoUrl;
  await organization.save();
  res.json({ success: true, message: 'Organization logo updated successfully', data: organization });
});

exports.submitVerification = asyncHandler(async (req, res) => {
  const organization = await currentOrganization(req.user);
  ownerOnly(req.user, organization);
  if (organization.verificationStatus === 'pending') throw new AppError(409, 'Verification request is already pending');
  if (organization.verificationStatus === 'verified') throw new AppError(409, 'Organization is already verified');
  const uploadedFile = req.file;
  const buffer = uploadedFile?.buffer || req.body;
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) throw new AppError(400, 'Select a PDF document to upload');
  const contentType = String(uploadedFile?.mimetype || req.headers['content-type'] || '').toLowerCase();
  const fileNameHeader = String(uploadedFile?.originalname || req.headers['x-file-name'] || '').toLowerCase();
  const looksLikePdf = buffer.subarray(0, 4).toString() === '%PDF';
  if (!contentType.includes('pdf') && !fileNameHeader.endsWith('.pdf')) throw new AppError(400, 'Only PDF files are allowed');
  if (!looksLikePdf) throw new AppError(400, 'The selected file does not look like a valid PDF');
  const dir = path.join(__dirname, '..', '..', 'uploads', 'organization-verifications');
  await fs.mkdir(dir, { recursive: true });
  const fileName = `${organization._id}-${Date.now()}.pdf`;
  await fs.writeFile(path.join(dir, fileName), buffer);
  organization.verificationStatus = 'pending';
  organization.verificationDocumentUrl = `${req.protocol}://${req.get('host')}/uploads/organization-verifications/${fileName}`;
  organization.verificationSubmittedAt = new Date();
  organization.verificationReviewedAt = undefined;
  organization.verificationReviewedBy = null;
  organization.verificationRejectionReason = '';
  await organization.save();
  res.json({
    success: true,
    message: 'Organization verification submitted successfully',
    data: {
      verificationStatus: organization.verificationStatus,
      documentUrl: organization.verificationDocumentUrl,
      ...organization.toObject(),
    },
  });
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

exports.leave = asyncHandler(async (req, res) => {
  if (!req.user.organization) throw new AppError(409, 'You have not joined an organization');
  const organizationId = req.user.organization;
  const joinedBatchIds = await Batch.find({
    organization: organizationId,
    $or: [
      { students: req.user._id },
      { _id: { $in: req.user.batches || [] } },
    ],
  }).distinct('_id');
  req.user.organization = null;
  req.user.batches = (req.user.batches || []).filter((id) => !joinedBatchIds.some((batchId) => String(batchId) === String(id)));
  req.user.joinedOrganizations = (req.user.joinedOrganizations || []).filter((id) => String(id) !== String(organizationId));
  await Promise.all([
    req.user.save(),
    Organization.updateOne({ _id: organizationId }, { $pull: { students: req.user._id } }),
    Batch.updateMany({ organization: organizationId }, { $pull: { students: req.user._id } }),
    ExamSlot.updateMany({ organization: organizationId }, { $pull: { assignedStudents: req.user._id } }),
    AccessRequest.deleteMany({ organization: organizationId, student: req.user._id }),
  ]);
  res.json({
    success: true,
    message: 'Left organization successfully',
    data: { organizationId, removedBatchIds: joinedBatchIds },
  });
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
      .select(publicTeacherFields)
      .populate('assignedServices', 'name')
      .populate('assignedBatches', 'name batchCode')
      .sort({ name: 1 })
      .lean(),
    TeacherJoinRequest.find({ organization: organization._id, status: 'pending' })
      .populate('teacher', publicProfileFields)
      .sort({ requestedAt: -1 })
      .lean(),
  ]);
  const normalizedTeachers = teachers.map((teacher) => ({
    ...teacher,
    status: teacher.organizationAccessStatus || 'active',
    assignedServicesCount: (teacher.assignedServices || []).length,
    assignedBatchesCount: (teacher.assignedBatches || []).length,
    joinedAt: teacher.createdAt,
  }));
  res.json({ success: true, message: 'Teachers fetched successfully', data: { teachers: normalizedTeachers, pendingRequests } });
});

exports.teacherDetails = asyncHandler(async (req, res) => {
  const organization = await currentOrganization(req.user);
  ownerOnly(req.user, organization);
  const teacher = await User.findOne({
    _id: req.params.teacherId,
    organization: organization._id,
    role: 'teacher',
  })
    .select(publicTeacherFields)
    .populate('assignedServices', 'name')
    .populate('assignedBatches', 'name batchCode')
    .lean();
  if (!teacher) throw new AppError(404, 'Teacher not found in this organization');
  const createdExamIds = await ExamSlot.find({ organization: organization._id, createdBy: teacher._id }).distinct('_id');
  const reviewedSubmissionsCount = createdExamIds.length
    ? await Submission.countDocuments({ examSlot: { $in: createdExamIds }, status: 'reviewed' })
    : 0;
  res.json({
    success: true,
    message: 'Teacher details fetched successfully',
    data: {
      ...teacher,
      status: teacher.organizationAccessStatus || 'active',
      assignedServicesCount: (teacher.assignedServices || []).length,
      assignedBatchesCount: (teacher.assignedBatches || []).length,
      joinedAt: teacher.createdAt,
      createdExamsCount: createdExamIds.length,
      reviewedSubmissionsCount,
    },
  });
});

exports.students = asyncHandler(async (req, res) => {
  if (!req.user.organization) return res.json({ success: true, data: [] });
  const query = { organization: req.user.organization, role: 'student', isActive: true };
  if (req.user.role === 'teacher') query.batches = { $in: req.user.assignedBatches };
  const students = await User.find(query)
    .select(`${publicProfileFields} batches`)
    .populate({ path: 'batches', select: 'name batchCode service', populate: { path: 'service', select: 'name' } })
    .lean();
  const data = await Promise.all(students.map(async (student) => {
    const stats = await submissionStatsForStudent(student._id, req.user.organization);
    const joinedServices = [...new Map((student.batches || [])
      .map((batch) => batch.service)
      .filter(Boolean)
      .map((service) => [String(service._id || service), service])).values()];
    const { recentResults, ...summary } = stats;
    return { ...student, joinedBatches: student.batches || [], joinedServices, ...summary };
  }));
  data.sort((a, b) => (b.percentage - a.percentage) || (b.averageScore - a.averageScore));
  data.forEach((student, index) => { student.rank = student.submittedExamsCount ? index + 1 : null; });
  res.json({ success: true, message: 'Students fetched successfully', data });
});

exports.studentDetails = asyncHandler(async (req, res) => {
  if (!req.user.organization) throw new AppError(404, 'Join an organization first');
  const query = {
    _id: req.params.studentId,
    organization: req.user.organization,
    role: 'student',
    isActive: true,
  };
  if (req.user.role === 'teacher') query.batches = { $in: req.user.assignedBatches };
  const student = await User.findOne(query)
    .select(`${publicProfileFields} batches`)
    .populate({ path: 'batches', select: 'name batchCode service', populate: { path: 'service', select: 'name' } })
    .lean();
  if (!student) throw new AppError(404, 'Student not found in this organization');
  const stats = await submissionStatsForStudent(student._id, req.user.organization);
  const joinedServices = [...new Map((student.batches || [])
    .map((batch) => batch.service)
    .filter(Boolean)
    .map((service) => [String(service._id || service), service])).values()];
  const rankedStudents = await User.find({ organization: req.user.organization, role: 'student', isActive: true }).select('_id').lean();
  const ranking = await Promise.all(rankedStudents.map(async (item) => {
    const itemStats = await submissionStatsForStudent(item._id, req.user.organization);
    return { id: String(item._id), ...itemStats };
  }));
  ranking.sort((a, b) => (b.percentage - a.percentage) || (b.averageScore - a.averageScore));
  const rankIndex = ranking.findIndex((item) => item.id === String(student._id));
  res.json({
    success: true,
    message: 'Student details fetched successfully',
    data: {
      ...student,
      joinedBatches: student.batches || [],
      joinedServices,
      ...stats,
      rank: rankIndex >= 0 && stats.submittedExamsCount ? rankIndex + 1 : null,
    },
  });
});

exports.assignTeacher = asyncHandler(async (req, res) => {
  const organization = await currentOrganization(req.user);
  ownerOnly(req.user, organization);
  const teacher = await teacherForOrganization(req.params.teacherId, organization._id);
  if (!teacher.isActive) throw new AppError(404, 'Teacher account is inactive');
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
  const populated = await User.findById(teacher._id).select(publicTeacherFields).populate('assignedServices', 'name').populate('assignedBatches', 'name batchCode');
  res.json({ success: true, message: 'Teacher assignment updated successfully', data: populated });
});

exports.pauseTeacher = asyncHandler(async (req, res) => {
  const organization = await currentOrganization(req.user);
  ownerOnly(req.user, organization);
  const teacher = await teacherForOrganization(req.params.teacherId, organization._id);
  const pausedUntil = req.body.pausedUntil ? new Date(req.body.pausedUntil) : null;
  if (pausedUntil && Number.isNaN(pausedUntil.getTime())) throw new AppError(400, 'Pause end date must be valid');
  teacher.organizationAccessStatus = 'paused';
  teacher.pausedUntil = pausedUntil;
  teacher.pausedReason = String(req.body.reason || '').trim();
  teacher.removedAt = null;
  await teacher.save();
  const populated = await User.findById(teacher._id).select(publicTeacherFields).populate('assignedServices', 'name').populate('assignedBatches', 'name batchCode');
  res.json({ success: true, message: 'Teacher paused successfully', data: populated });
});

exports.reactivateTeacher = asyncHandler(async (req, res) => {
  const organization = await currentOrganization(req.user);
  ownerOnly(req.user, organization);
  const teacher = await teacherForOrganization(req.params.teacherId, organization._id);
  teacher.organizationAccessStatus = 'active';
  teacher.pausedUntil = null;
  teacher.pausedReason = '';
  teacher.removedAt = null;
  teacher.teacherJoinStatus = 'accepted';
  await teacher.save();
  const populated = await User.findById(teacher._id).select(publicTeacherFields).populate('assignedServices', 'name').populate('assignedBatches', 'name batchCode');
  res.json({ success: true, message: 'Teacher reactivated successfully', data: populated });
});

exports.removeTeacher = asyncHandler(async (req, res) => {
  const organization = await currentOrganization(req.user);
  ownerOnly(req.user, organization);
  const teacher = await teacherForOrganization(req.params.teacherId, organization._id);
  teacher.organization = null;
  teacher.organizationAccessStatus = 'removed';
  teacher.teacherJoinStatus = 'none';
  teacher.assignedServices = [];
  teacher.assignedBatches = [];
  teacher.pausedUntil = null;
  teacher.pausedReason = '';
  teacher.removedAt = new Date();
  await Promise.all([
    teacher.save(),
    Organization.updateOne({ _id: organization._id }, { $pull: { teachers: teacher._id } }),
    Batch.updateMany({ organization: organization._id }, { $pull: { assignedTeachers: teacher._id } }),
  ]);
  res.json({ success: true, message: 'Teacher removed from organization successfully', data: { teacherId: teacher._id, removedAt: teacher.removedAt } });
});
