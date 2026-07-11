const Organization = require('../models/Organization');
const User = require('../models/User');
const Service = require('../models/Service');
const Batch = require('../models/Batch');
const ExamSlot = require('../models/ExamSlot');
const Submission = require('../models/Submission');
const Plan = require('../models/Plan');
const PaymentRequest = require('../models/PaymentRequest');
const TeacherJoinRequest = require('../models/TeacherJoinRequest');
const asyncHandler = require('../utils/asyncHandler');
const AppError = require('../utils/AppError');

const userFields = 'name email role avatarUrl phone contactNumber address bio location organization organizationAccessStatus teacherJoinStatus assignedServices assignedBatches batches isActive deletedAt lastLoginAt lastActiveAt createdAt updatedAt';
const organizationFields = 'name email phone contactNumber address category type description logoUrl avatarUrl organizationCode owner plan planSnapshot pendingPlanChange subscriptionStatus subscriptionStartDate subscriptionEndDate subscriptionBillingCycle subscriptionAmount subscriptionPaymentStatus subscriptionAdminNote subscriptionCancelReason subscriptionCancelledAt subscriptionCancelAtPeriodEnd subscriptionRefundMarkedAt subscriptionRefundAmount subscriptionRefundReason subscriptionRefundNote verificationStatus verificationDocumentUrl verificationSubmittedAt verificationRejectionReason isActive createdAt updatedAt';

const escapeRegex = (value) => String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const paging = (query) => {
  const page = Math.max(Number(query.page || 1), 1);
  const limit = Math.min(Math.max(Number(query.limit || 10), 1), 100);
  return { page, limit, skip: (page - 1) * limit };
};

const paged = async (model, query, req, options = {}) => {
  const { page, limit, skip } = paging(req.query);
  const [items, total] = await Promise.all([
    model.find(query)
      .select(options.select || '')
      .populate(options.populate || [])
      .sort(options.sort || { createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    model.countDocuments(query),
  ]);
  return { items, page, limit, total, totalPages: Math.max(Math.ceil(total / limit), 1) };
};

const planSnapshotFor = (plan, billingCycle = 'monthly') => {
  const limits = plan?.limits || {};
  const cycle = billingCycle || plan?.billingType || 'monthly';
  const price = cycle === 'yearly' ? plan?.priceYearly : plan?.priceMonthly;
  return {
    planId: plan?._id,
    name: plan?.name || '',
    code: plan?.code || '',
    billingType: plan?.billingType || cycle,
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

const cleanFeatures = (features) => (Array.isArray(features) ? features : String(features || '').split('\n'))
  .map((feature) => String(feature || '').trim())
  .filter(Boolean);

const normalizePlanBody = (body) => {
  const limits = body.limits || {};
  const numberFrom = (...values) => {
    const value = values.find((item) => item !== undefined && item !== null && item !== '');
    return value === undefined ? undefined : Number(value);
  };
  const normalized = {};
  ['name', 'description', 'billingType'].forEach((key) => {
    if (body[key] !== undefined) normalized[key] = String(body[key]).trim();
  });
  if (body.code !== undefined) normalized.code = String(body.code).trim().toUpperCase();
  const monthly = numberFrom(body.monthlyPrice, body.priceMonthly);
  const yearly = numberFrom(body.yearlyPrice, body.priceYearly);
  if (monthly !== undefined) normalized.priceMonthly = monthly;
  if (yearly !== undefined) normalized.priceYearly = yearly;
  if (body.features !== undefined) normalized.features = cleanFeatures(body.features);
  if (body.isActive !== undefined) normalized.isActive = Boolean(body.isActive);
  if (body.sortOrder !== undefined) normalized.sortOrder = Number(body.sortOrder || 0);
  const nextLimits = {};
  const limitMap = [
    ['teachersLimit', body.teacherLimit, limits.teachersLimit],
    ['studentsLimit', body.studentLimit, limits.studentsLimit],
    ['servicesLimit', body.serviceLimit, limits.servicesLimit],
    ['batchesLimit', body.batchLimit, limits.batchesLimit],
    ['examSlotsPerMonth', body.examLimit, limits.examSlotsPerMonth],
    ['questionsPerExam', body.questionsPerExam, limits.questionsPerExam],
    ['writtenQuestionsPerExam', body.writtenQuestionsPerExam, limits.writtenQuestionsPerExam],
  ];
  limitMap.forEach(([key, ...values]) => {
    const value = numberFrom(...values);
    if (value !== undefined) nextLimits[key] = value;
  });
  ['analyticsEnabled', 'exportEnabled', 'brandingEnabled', 'questionBankEnabled'].forEach((key) => {
    if (body[key] !== undefined) nextLimits[key] = Boolean(body[key]);
    if (limits[key] !== undefined) nextLimits[key] = Boolean(limits[key]);
  });
  if (Object.keys(nextLimits).length) normalized.limits = nextLimits;
  return normalized;
};

const mergePlanLimits = (plan, limits = {}) => ({
  teachersLimit: limits.teachersLimit ?? plan?.limits?.teachersLimit ?? 0,
  studentsLimit: limits.studentsLimit ?? plan?.limits?.studentsLimit ?? 0,
  servicesLimit: limits.servicesLimit ?? plan?.limits?.servicesLimit ?? 0,
  batchesLimit: limits.batchesLimit ?? plan?.limits?.batchesLimit ?? 0,
  examSlotsPerMonth: limits.examSlotsPerMonth ?? plan?.limits?.examSlotsPerMonth ?? 0,
  questionsPerExam: limits.questionsPerExam ?? plan?.limits?.questionsPerExam ?? 0,
  writtenQuestionsPerExam: limits.writtenQuestionsPerExam ?? plan?.limits?.writtenQuestionsPerExam ?? 0,
  analyticsEnabled: limits.analyticsEnabled ?? plan?.limits?.analyticsEnabled ?? false,
  exportEnabled: limits.exportEnabled ?? plan?.limits?.exportEnabled ?? false,
  brandingEnabled: limits.brandingEnabled ?? plan?.limits?.brandingEnabled ?? false,
  questionBankEnabled: limits.questionBankEnabled ?? plan?.limits?.questionBankEnabled ?? false,
});

const ensureNotProtectedSuperAdmin = async (target, currentUserId) => {
  if (!target) throw new AppError(404, 'User not found');
  if (String(target._id) === String(currentUserId)) throw new AppError(400, 'You cannot delete your own admin account');
  if (target.role === 'super_admin') {
    const remaining = await User.countDocuments({ role: 'super_admin', isActive: true, deletedAt: null, _id: { $ne: target._id } });
    if (remaining < 1) throw new AppError(400, 'You cannot delete the last active super admin');
  }
};

const orgSearchQuery = (req) => {
  const query = {};
  if (req.query.search) {
    const regex = new RegExp(escapeRegex(req.query.search), 'i');
    query.$or = [{ name: regex }, { email: regex }, { organizationCode: regex }];
  }
  if (req.query.verificationStatus) query.verificationStatus = req.query.verificationStatus;
  if (req.query.plan) query.plan = req.query.plan;
  if (req.query.status === 'active') query.isActive = true;
  if (req.query.status === 'suspended') query.isActive = false;
  if (req.query.status === 'verified') query.verificationStatus = 'verified';
  if (req.query.status === 'pending') query.verificationStatus = 'pending';
  return query;
};

const userSearchQuery = (req, role) => {
  const query = {};
  const and = [];
  if (role) query.role = role;
  if (req.query.role) query.role = req.query.role;
  if (req.query.organization) query.organization = req.query.organization;
  if (req.query.status === 'active') query.isActive = true;
  if (req.query.status === 'blocked') query.isActive = false;
  if (req.query.status === 'deleted') query.deletedAt = { $ne: null };
  if (req.query.status === 'paused') query.organizationAccessStatus = 'paused';
  if (req.query.status === 'inactive') and.push({ $or: [{ lastActiveAt: { $lte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) } }, { lastActiveAt: null }] });
  if (req.query.inactiveDays) {
    const days = Math.max(Number(req.query.inactiveDays), 1);
    and.push({ $or: [
      { lastActiveAt: { $lte: new Date(Date.now() - days * 24 * 60 * 60 * 1000) } },
      { lastActiveAt: null },
    ] });
  }
  if (req.query.search) {
    const regex = new RegExp(escapeRegex(req.query.search), 'i');
    and.push({ $or: [{ name: regex }, { email: regex }] });
  }
  if (and.length) query.$and = and;
  return query;
};

const withOrganizationCounts = async (items) => {
  const ids = items.map((item) => item._id);
  const [teachers, students, services, batches] = await Promise.all([
    User.aggregate([{ $match: { organization: { $in: ids }, role: 'teacher', isActive: true } }, { $group: { _id: '$organization', count: { $sum: 1 } } }]),
    User.aggregate([{ $match: { organization: { $in: ids }, role: 'student', isActive: true } }, { $group: { _id: '$organization', count: { $sum: 1 } } }]),
    Service.aggregate([{ $match: { organization: { $in: ids }, isActive: true } }, { $group: { _id: '$organization', count: { $sum: 1 } } }]),
    Batch.aggregate([{ $match: { organization: { $in: ids }, isActive: true } }, { $group: { _id: '$organization', count: { $sum: 1 } } }]),
  ]);
  const toMap = (rows) => new Map(rows.map((row) => [String(row._id), row.count]));
  const maps = { teachers: toMap(teachers), students: toMap(students), services: toMap(services), batches: toMap(batches) };
  return items.map((item) => ({
    ...item,
    counts: {
      teachers: maps.teachers.get(String(item._id)) || 0,
      students: maps.students.get(String(item._id)) || 0,
      services: maps.services.get(String(item._id)) || 0,
      batches: maps.batches.get(String(item._id)) || 0,
    },
  }));
};

const submissionSummaryForStudents = async (items) => {
  const ids = items.map((item) => item._id);
  const stats = await Submission.aggregate([
    { $match: { student: { $in: ids } } },
    { $group: { _id: '$student', submissionsCount: { $sum: 1 }, averageScore: { $avg: '$totalScore' }, totalScore: { $sum: '$totalScore' }, percentage: { $avg: '$percentage' } } },
  ]);
  const map = new Map(stats.map((row) => [String(row._id), row]));
  return items.map((item) => ({ ...item, performance: map.get(String(item._id)) || { submissionsCount: 0, averageScore: 0, totalScore: 0, percentage: 0 } }));
};

exports.dashboardSummary = asyncHandler(async (_req, res) => {
  const [
    totalOrganizations,
    totalTeachers,
    totalStudents,
    totalServices,
    totalBatches,
    totalExams,
    totalSubmissions,
    pendingVerificationRequests,
    pendingPaymentRequests,
    activeSubscriptions,
    recentOrganizations,
    recentUsers,
    recentExams,
    recentSubmissions,
  ] = await Promise.all([
    Organization.countDocuments(),
    User.countDocuments({ role: 'teacher' }),
    User.countDocuments({ role: 'student' }),
    Service.countDocuments(),
    Batch.countDocuments(),
    ExamSlot.countDocuments(),
    Submission.countDocuments(),
    Organization.countDocuments({ verificationStatus: 'pending' }),
    PaymentRequest.countDocuments({ status: 'pending' }),
    Organization.countDocuments({ subscriptionStatus: 'active' }),
    Organization.find().select(organizationFields).populate('owner', 'name email avatarUrl').populate('plan', 'name code').sort({ createdAt: -1 }).limit(6).lean(),
    User.find().select(userFields).populate('organization', 'name organizationCode').sort({ createdAt: -1 }).limit(6).lean(),
    ExamSlot.find().populate('organization', 'name').populate('createdBy', 'name email avatarUrl').sort({ createdAt: -1 }).limit(6).lean(),
    Submission.find().populate('student', 'name email avatarUrl').populate('examSlot', 'title').populate('organization', 'name').sort({ submittedAt: -1 }).limit(6).lean(),
  ]);
  res.json({
    success: true,
    data: {
      counts: { totalOrganizations, totalTeachers, totalStudents, totalServices, totalBatches, totalExams, totalSubmissions, pendingVerificationRequests, pendingPaymentRequests, activeSubscriptions },
      recentOrganizations,
      recentUsers,
      recentExams,
      recentSubmissions,
      pendingActions: [
        { label: 'Organization verification', count: pendingVerificationRequests },
        { label: 'Payment requests', count: pendingPaymentRequests },
      ],
    },
  });
});

exports.me = asyncHandler(async (req, res) => {
  res.json({ success: true, data: req.user.toSafeJSON() });
});

exports.updateMe = asyncHandler(async (req, res) => {
  const name = String(req.body.name || '').trim();
  const email = String(req.body.email || '').toLowerCase().trim();
  if (!name) throw new AppError(400, 'Name is required');
  if (!email) throw new AppError(400, 'Email is required');
  const duplicate = await User.findOne({ email, _id: { $ne: req.user._id } }).select('_id');
  if (duplicate) throw new AppError(409, 'Email already registered');
  req.user.name = name;
  req.user.email = email;
  await req.user.save();
  res.json({ success: true, message: 'Profile updated successfully', data: req.user.toSafeJSON() });
});

exports.changeMyPassword = asyncHandler(async (req, res) => {
  const currentPassword = String(req.body.currentPassword || '');
  const newPassword = String(req.body.newPassword || '');
  if (!currentPassword) throw new AppError(400, 'Current password is required');
  if (newPassword.length < 8) throw new AppError(400, 'New password must contain at least 8 characters');
  const user = await User.findById(req.user._id).select('+password');
  if (!user || !(await user.comparePassword(currentPassword))) throw new AppError(400, 'Current password is incorrect');
  user.password = newPassword;
  user.tokenVersion = (user.tokenVersion || 0) + 1;
  await user.save();
  res.json({ success: true, message: 'Password changed successfully' });
});

exports.organizations = asyncHandler(async (req, res) => {
  const data = await paged(Organization, orgSearchQuery(req), req, {
    select: organizationFields,
    populate: [{ path: 'owner', select: 'name email avatarUrl' }, { path: 'plan', select: 'name code priceMonthly priceYearly' }],
  });
  data.items = await withOrganizationCounts(data.items);
  res.json({ success: true, data });
});

exports.organizationDetails = asyncHandler(async (req, res) => {
  const organization = await Organization.findById(req.params.id)
    .select(organizationFields)
    .populate('owner', userFields)
    .populate('plan')
    .lean();
  if (!organization) throw new AppError(404, 'Organization not found');
  const [withCounts] = await withOrganizationCounts([organization]);
  const [teachers, students, services, batches, exams, submissions] = await Promise.all([
    User.find({ organization: req.params.id, role: 'teacher' }).select(userFields).limit(100).lean(),
    User.find({ organization: req.params.id, role: 'student' }).select(userFields).limit(100).lean(),
    Service.find({ organization: req.params.id }).limit(100).lean(),
    Batch.find({ organization: req.params.id }).populate('service', 'name').limit(100).lean(),
    ExamSlot.find({ organization: req.params.id }).populate('createdBy', 'name email avatarUrl').populate('service', 'name').limit(100).lean(),
    Submission.find({ organization: req.params.id }).populate('student', 'name email avatarUrl').populate('examSlot', 'title').limit(100).lean(),
  ]);
  res.json({ success: true, data: { ...withCounts, teachers, students, services, batches, exams, submissions } });
});

exports.updateOrganization = asyncHandler(async (req, res) => {
  const allowed = ['name','email','phone','contactNumber','address','category','type','description','subscriptionStatus','plan','verificationStatus'];
  const body = {};
  allowed.forEach((key) => { if (req.body[key] !== undefined) body[key] = req.body[key]; });
  const item = await Organization.findByIdAndUpdate(req.params.id, body, { new: true, runValidators: true });
  if (!item) throw new AppError(404, 'Organization not found');
  res.json({ success: true, message: 'Organization updated', data: item });
});

exports.setOrganizationActive = (active) => asyncHandler(async (req, res) => {
  const item = await Organization.findByIdAndUpdate(req.params.id, { isActive: active }, { new: true });
  if (!item) throw new AppError(404, 'Organization not found');
  res.json({ success: true, message: active ? 'Organization activated' : 'Organization suspended', data: item });
});

exports.users = asyncHandler(async (req, res) => {
  const data = await paged(User, userSearchQuery(req), req, {
    select: userFields,
    populate: [{ path: 'organization', select: 'name organizationCode' }],
  });
  res.json({ success: true, data });
});

exports.userDetails = asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id).select(userFields).populate('organization', 'name organizationCode').populate('assignedServices', 'name').populate('assignedBatches', 'name batchCode').populate('batches', 'name batchCode').lean();
  if (!user) throw new AppError(404, 'User not found');
  res.json({ success: true, data: user });
});

exports.setUserActive = (active) => asyncHandler(async (req, res) => {
  const update = active ? { isActive: true, deletedAt: null } : { isActive: false };
  const user = await User.findByIdAndUpdate(req.params.id, update, { new: true }).select(userFields);
  if (!user) throw new AppError(404, 'User not found');
  res.json({ success: true, message: active ? 'User unblocked' : 'User blocked', data: user });
});

exports.deleteUserEmail = asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id);
  await ensureNotProtectedSuperAdmin(user, req.user._id);
  if (!user.deletedEmail) user.deletedEmail = user.email;
  user.email = `deleted-${user._id}@deleted.local`;
  await user.save();
  res.json({ success: true, message: 'User email removed', data: user.toSafeJSON() });
});

exports.deleteUser = asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id);
  await ensureNotProtectedSuperAdmin(user, req.user._id);
  if (!user.deletedEmail) user.deletedEmail = user.email;
  user.email = `deleted-${user._id}@deleted.local`;
  user.isActive = false;
  user.deletedAt = new Date();
  user.tokenVersion = (user.tokenVersion || 0) + 1;
  await user.save();
  res.json({ success: true, message: 'User account deleted', data: user.toSafeJSON() });
});

exports.restoreUser = asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id);
  if (!user) throw new AppError(404, 'User not found');
  if (user.deletedEmail) {
    const duplicate = await User.findOne({ email: user.deletedEmail, _id: { $ne: user._id } }).select('_id');
    if (!duplicate) user.email = user.deletedEmail;
  }
  user.deletedAt = null;
  user.isActive = true;
  await user.save();
  res.json({ success: true, message: 'User restored', data: user.toSafeJSON() });
});

exports.teachers = asyncHandler(async (req, res) => {
  const data = await paged(User, userSearchQuery(req, 'teacher'), req, {
    select: userFields,
    populate: [{ path: 'organization', select: 'name organizationCode' }, { path: 'assignedServices', select: 'name' }, { path: 'assignedBatches', select: 'name batchCode' }],
  });
  data.items = data.items.map((item) => ({ ...item, assignedServicesCount: (item.assignedServices || []).length, assignedBatchesCount: (item.assignedBatches || []).length, status: item.organizationAccessStatus || 'active' }));
  res.json({ success: true, data });
});

exports.teacherDetails = asyncHandler(async (req, res) => {
  const teacher = await User.findOne({ _id: req.params.id, role: 'teacher' }).select(userFields).populate('organization', 'name organizationCode').populate('assignedServices', 'name').populate('assignedBatches', 'name batchCode').lean();
  if (!teacher) throw new AppError(404, 'Teacher not found');
  res.json({ success: true, data: teacher });
});

exports.pauseTeacher = asyncHandler(async (req, res) => {
  const teacher = await User.findOneAndUpdate({ _id: req.params.id, role: 'teacher' }, { organizationAccessStatus: 'paused', pausedReason: String(req.body.reason || '').trim(), pausedUntil: req.body.pausedUntil || null }, { new: true });
  if (!teacher) throw new AppError(404, 'Teacher not found');
  res.json({ success: true, message: 'Teacher paused', data: teacher });
});

exports.reactivateTeacher = asyncHandler(async (req, res) => {
  const teacher = await User.findOneAndUpdate({ _id: req.params.id, role: 'teacher' }, { organizationAccessStatus: 'active', pausedReason: '', pausedUntil: null, teacherJoinStatus: 'accepted' }, { new: true });
  if (!teacher) throw new AppError(404, 'Teacher not found');
  res.json({ success: true, message: 'Teacher reactivated', data: teacher });
});

exports.removeTeacher = asyncHandler(async (req, res) => {
  const teacher = await User.findOne({ _id: req.params.id, role: 'teacher' });
  if (!teacher) throw new AppError(404, 'Teacher not found');
  const organizationId = teacher.organization;
  teacher.organization = null;
  teacher.organizationAccessStatus = 'removed';
  teacher.teacherJoinStatus = 'none';
  teacher.assignedServices = [];
  teacher.assignedBatches = [];
  await Promise.all([
    teacher.save(),
    organizationId ? Organization.updateOne({ _id: organizationId }, { $pull: { teachers: teacher._id } }) : Promise.resolve(),
    Batch.updateMany({ assignedTeachers: teacher._id }, { $pull: { assignedTeachers: teacher._id } }),
  ]);
  res.json({ success: true, message: 'Teacher removed', data: teacher });
});

exports.students = asyncHandler(async (req, res) => {
  const data = await paged(User, userSearchQuery(req, 'student'), req, {
    select: userFields,
    populate: [{ path: 'organization', select: 'name organizationCode' }, { path: 'batches', select: 'name batchCode' }],
  });
  data.items = await submissionSummaryForStudents(data.items);
  res.json({ success: true, data });
});

exports.studentDetails = asyncHandler(async (req, res) => {
  const student = await User.findOne({ _id: req.params.id, role: 'student' }).select(userFields).populate('organization', 'name organizationCode').populate('batches', 'name batchCode').lean();
  if (!student) throw new AppError(404, 'Student not found');
  const [withStats] = await submissionSummaryForStudents([student]);
  const submissions = await Submission.find({ student: req.params.id }).populate('examSlot', 'title').populate('organization', 'name').sort({ submittedAt: -1 }).limit(50).lean();
  res.json({ success: true, data: { ...withStats, submissions } });
});

exports.services = asyncHandler(async (req, res) => {
  const query = {};
  if (req.query.organization) query.organization = req.query.organization;
  if (req.query.status === 'active') query.isActive = true;
  if (req.query.status === 'inactive') query.isActive = false;
  if (req.query.search) query.name = new RegExp(escapeRegex(req.query.search), 'i');
  const data = await paged(Service, query, req, { populate: [{ path: 'organization', select: 'name organizationCode' }] });
  const ids = data.items.map((item) => item._id);
  const [batches, exams] = await Promise.all([
    Batch.aggregate([{ $match: { service: { $in: ids } } }, { $group: { _id: '$service', totalBatches: { $sum: 1 }, totalStudents: { $sum: { $size: '$students' } }, totalTeachers: { $sum: { $size: '$assignedTeachers' } } } }]),
    ExamSlot.aggregate([{ $match: { service: { $in: ids } } }, { $group: { _id: '$service', examsCount: { $sum: 1 } } }]),
  ]);
  const batchMap = new Map(batches.map((row) => [String(row._id), row]));
  const examMap = new Map(exams.map((row) => [String(row._id), row.examsCount]));
  data.items = data.items.map((item) => ({ ...item, ...(batchMap.get(String(item._id)) || {}), examsCount: examMap.get(String(item._id)) || 0 }));
  res.json({ success: true, data });
});

exports.serviceDetails = asyncHandler(async (req, res) => {
  const item = await Service.findById(req.params.id).populate('organization', 'name organizationCode').lean();
  if (!item) throw new AppError(404, 'Service not found');
  const [batches, exams] = await Promise.all([
    Batch.find({ service: item._id }).populate('assignedTeachers', 'name email avatarUrl').limit(100).lean(),
    ExamSlot.find({ service: item._id }).populate('createdBy', 'name email avatarUrl').limit(100).lean(),
  ]);
  res.json({ success: true, data: { ...item, batches, exams } });
});

exports.setServiceActive = (active) => asyncHandler(async (req, res) => {
  const item = await Service.findByIdAndUpdate(req.params.id, { isActive: active }, { new: true });
  if (!item) throw new AppError(404, 'Service not found');
  res.json({ success: true, message: active ? 'Service reactivated' : 'Service deactivated', data: item });
});

exports.batches = asyncHandler(async (req, res) => {
  const query = {};
  if (req.query.organization) query.organization = req.query.organization;
  if (req.query.service) query.service = req.query.service;
  if (req.query.status === 'active') query.isActive = true;
  if (req.query.status === 'inactive') query.isActive = false;
  if (req.query.search) {
    const regex = new RegExp(escapeRegex(req.query.search), 'i');
    query.$or = [{ name: regex }, { batchCode: regex }];
  }
  const data = await paged(Batch, query, req, { populate: [{ path: 'organization', select: 'name organizationCode' }, { path: 'service', select: 'name' }] });
  const ids = data.items.map((item) => item._id);
  const examCounts = await ExamSlot.aggregate([{ $match: { assignedBatches: { $in: ids } } }, { $unwind: '$assignedBatches' }, { $match: { assignedBatches: { $in: ids } } }, { $group: { _id: '$assignedBatches', examsCount: { $sum: 1 } } }]);
  const examMap = new Map(examCounts.map((row) => [String(row._id), row.examsCount]));
  data.items = data.items.map((item) => ({ ...item, studentsCount: (item.students || []).length, teachersCount: (item.assignedTeachers || []).length, examsCount: examMap.get(String(item._id)) || 0 }));
  res.json({ success: true, data });
});

exports.batchDetails = asyncHandler(async (req, res) => {
  const item = await Batch.findById(req.params.id).populate('organization', 'name organizationCode').populate('service', 'name').populate('students', 'name email avatarUrl').populate('assignedTeachers', 'name email avatarUrl').lean();
  if (!item) throw new AppError(404, 'Batch not found');
  const exams = await ExamSlot.find({ assignedBatches: item._id }).populate('createdBy', 'name email avatarUrl').lean();
  res.json({ success: true, data: { ...item, exams } });
});

exports.setBatchActive = (active) => asyncHandler(async (req, res) => {
  const item = await Batch.findByIdAndUpdate(req.params.id, { isActive: active }, { new: true });
  if (!item) throw new AppError(404, 'Batch not found');
  res.json({ success: true, message: active ? 'Batch reactivated' : 'Batch deactivated', data: item });
});

exports.exams = asyncHandler(async (req, res) => {
  const query = {};
  if (req.query.organization) query.organization = req.query.organization;
  if (req.query.service) query.service = req.query.service;
  if (req.query.status) query.status = req.query.status;
  if (req.query.examType) query.examType = req.query.examType;
  if (req.query.search) query.title = new RegExp(escapeRegex(req.query.search), 'i');
  const data = await paged(ExamSlot, query, req, { populate: [{ path: 'organization', select: 'name organizationCode' }, { path: 'service', select: 'name' }, { path: 'assignedBatches', select: 'name batchCode' }, { path: 'createdBy', select: 'name email avatarUrl' }] });
  const ids = data.items.map((item) => item._id);
  const counts = await Submission.aggregate([{ $match: { examSlot: { $in: ids } } }, { $group: { _id: '$examSlot', submissionsCount: { $sum: 1 } } }]);
  const map = new Map(counts.map((row) => [String(row._id), row.submissionsCount]));
  data.items = data.items.map((item) => ({ ...item, submissionsCount: map.get(String(item._id)) || 0 }));
  res.json({ success: true, data });
});

exports.examDetails = asyncHandler(async (req, res) => {
  const item = await ExamSlot.findById(req.params.id).populate('organization', 'name organizationCode').populate('service', 'name').populate('assignedBatches', 'name batchCode').populate('createdBy', 'name email avatarUrl').lean();
  if (!item) throw new AppError(404, 'Exam not found');
  const submissions = await Submission.find({ examSlot: item._id }).populate('student', 'name email avatarUrl').limit(100).lean();
  res.json({ success: true, data: { ...item, submissions } });
});

exports.cancelExam = asyncHandler(async (req, res) => {
  const item = await ExamSlot.findByIdAndUpdate(req.params.id, { status: 'cancelled' }, { new: true });
  if (!item) throw new AppError(404, 'Exam not found');
  res.json({ success: true, message: 'Exam cancelled', data: item });
});

exports.submissions = asyncHandler(async (req, res) => {
  const query = {};
  if (req.query.organization) query.organization = req.query.organization;
  if (req.query.exam) query.examSlot = req.query.exam;
  if (req.query.student) query.student = req.query.student;
  if (req.query.status) query.status = req.query.status;
  const data = await paged(Submission, query, req, { populate: [{ path: 'student', select: 'name email avatarUrl' }, { path: 'examSlot', select: 'title status resultPublished' }, { path: 'organization', select: 'name organizationCode' }, { path: 'batch', select: 'name batchCode' }] });
  res.json({ success: true, data });
});

exports.submissionDetails = asyncHandler(async (req, res) => {
  const item = await Submission.findById(req.params.id).populate('student', 'name email avatarUrl').populate('examSlot').populate('organization', 'name organizationCode').populate('batch', 'name batchCode').lean();
  if (!item) throw new AppError(404, 'Submission not found');
  res.json({ success: true, data: item });
});

exports.rankings = asyncHandler(async (req, res) => {
  const match = {};
  if (req.query.organization) match.organization = req.query.organization;
  if (req.query.batch) match.batch = req.query.batch;
  if (req.query.service) match.service = req.query.service;
  const rows = await Submission.aggregate([
    { $match: match },
    { $group: { _id: '$student', submittedExams: { $sum: 1 }, averageScore: { $avg: '$totalScore' }, totalScore: { $sum: '$totalScore' }, percentage: { $avg: '$percentage' }, organization: { $first: '$organization' }, batch: { $first: '$batch' } } },
    { $sort: { percentage: -1, averageScore: -1 } },
    { $limit: 500 },
  ]);
  const users = await User.find({ _id: { $in: rows.map((row) => row._id) } }).select('name email avatarUrl').lean();
  const orgs = await Organization.find({ _id: { $in: rows.map((row) => row.organization).filter(Boolean) } }).select('name').lean();
  const batches = await Batch.find({ _id: { $in: rows.map((row) => row.batch).filter(Boolean) } }).select('name batchCode').lean();
  const userMap = new Map(users.map((item) => [String(item._id), item]));
  const orgMap = new Map(orgs.map((item) => [String(item._id), item]));
  const batchMap = new Map(batches.map((item) => [String(item._id), item]));
  const items = rows.map((row, index) => ({ rank: index + 1, student: userMap.get(String(row._id)), organization: orgMap.get(String(row.organization)), batch: batchMap.get(String(row.batch)), submittedExams: row.submittedExams, averageScore: row.averageScore || 0, totalScore: row.totalScore || 0, percentage: row.percentage || 0 }));
  res.json({ success: true, data: { items, page: 1, limit: items.length, total: items.length, totalPages: 1 } });
});

exports.plans = asyncHandler(async (req, res) => {
  const query = {};
  if (req.query.status === 'active') query.isActive = true;
  if (req.query.status === 'inactive') query.isActive = false;
  if (req.query.status === 'deleted') query.deletedAt = { $ne: null };
  if (req.query.search) {
    const regex = new RegExp(escapeRegex(req.query.search), 'i');
    query.$or = [{ name: regex }, { code: regex }];
  }
  res.json({ success: true, data: await paged(Plan, query, req, { sort: { sortOrder: 1, priceMonthly: 1, createdAt: -1 } }) });
});

exports.planDetails = asyncHandler(async (req, res) => {
  const plan = await Plan.findById(req.params.id).lean();
  if (!plan) throw new AppError(404, 'Plan not found');
  const activeSubscriptions = await Organization.countDocuments({ plan: plan._id, subscriptionStatus: { $in: ['active', 'trialing', 'pending', 'free'] } });
  res.json({ success: true, data: { ...plan, activeSubscriptions } });
});

exports.createPlan = asyncHandler(async (req, res) => {
  const body = normalizePlanBody(req.body);
  body.limits = mergePlanLimits(null, body.limits);
  const plan = await Plan.create(body);
  res.status(201).json({ success: true, message: 'Plan created', data: plan });
});

exports.updatePlan = asyncHandler(async (req, res) => {
  const existing = await Plan.findById(req.params.id);
  if (!existing) throw new AppError(404, 'Plan not found');
  const body = normalizePlanBody(req.body);
  if (body.limits) body.limits = mergePlanLimits(existing, body.limits);
  Object.assign(existing, body);
  const plan = await existing.save();
  if (!plan) throw new AppError(404, 'Plan not found');
  res.json({ success: true, message: 'Plan updated', data: plan });
});

exports.activatePlan = asyncHandler(async (req, res) => {
  const plan = await Plan.findByIdAndUpdate(req.params.id, { isActive: true, deletedAt: null }, { new: true });
  if (!plan) throw new AppError(404, 'Plan not found');
  res.json({ success: true, message: 'Plan activated', data: plan });
});

exports.deactivatePlan = asyncHandler(async (req, res) => {
  const plan = await Plan.findByIdAndUpdate(req.params.id, { isActive: false }, { new: true });
  if (!plan) throw new AppError(404, 'Plan not found');
  res.json({ success: true, message: 'Plan deactivated', data: plan });
});

exports.deletePlan = asyncHandler(async (req, res) => {
  const activeSubscriptions = await Organization.countDocuments({ plan: req.params.id, subscriptionStatus: { $in: ['active', 'trialing', 'pending', 'free'] } });
  const plan = await Plan.findByIdAndUpdate(req.params.id, { isActive: false, deletedAt: new Date() }, { new: true });
  if (!plan) throw new AppError(404, 'Plan not found');
  const message = activeSubscriptions
    ? 'Plan deactivated for new purchases; existing subscriptions keep their current snapshot'
    : 'Plan deleted';
  res.json({ success: true, message, data: plan });
});

exports.subscriptions = asyncHandler(async (req, res) => {
  const query = {};
  if (req.query.status) query.subscriptionStatus = req.query.status;
  if (req.query.organization) query._id = req.query.organization;
  if (req.query.plan) query.plan = req.query.plan;
  if (req.query.search) {
    const regex = new RegExp(escapeRegex(req.query.search), 'i');
    query.$or = [{ name: regex }, { email: regex }, { organizationCode: regex }];
  }
  const data = await paged(Organization, query, req, { select: organizationFields, populate: [{ path: 'plan' }, { path: 'owner', select: 'name email avatarUrl' }] });
  res.json({ success: true, data });
});

exports.subscriptionDetails = asyncHandler(async (req, res) => {
  const organization = await Organization.findById(req.params.id)
    .select(organizationFields)
    .populate('plan')
    .populate('owner', 'name email avatarUrl')
    .populate('pendingPlanChange.plan')
    .lean();
  if (!organization) throw new AppError(404, 'Subscription not found');
  res.json({ success: true, data: organization });
});

exports.updateSubscription = asyncHandler(async (req, res) => {
  const allowed = ['plan','subscriptionStatus','subscriptionStartDate','subscriptionEndDate','subscriptionBillingCycle','subscriptionAmount','subscriptionPaymentStatus','subscriptionAdminNote'];
  const body = {};
  allowed.forEach((key) => { if (req.body[key] !== undefined) body[key] = req.body[key]; });
  if (body.plan) {
    const plan = await Plan.findById(body.plan);
    if (!plan) throw new AppError(404, 'Plan not found');
    body.planSnapshot = planSnapshotFor(plan, body.subscriptionBillingCycle || req.body.billingCycle || 'monthly');
  }
  const item = await Organization.findByIdAndUpdate(req.params.id, body, { new: true, runValidators: true }).populate('plan');
  if (!item) throw new AppError(404, 'Subscription not found');
  res.json({ success: true, message: 'Subscription updated', data: item });
});

exports.changeSubscriptionPlan = asyncHandler(async (req, res) => {
  const plan = await Plan.findOne({ _id: req.body.planId, isActive: true });
  if (!plan) throw new AppError(404, 'Active plan not found');
  const billingCycle = String(req.body.billingCycle || plan.billingType || 'monthly');
  const apply = String(req.body.apply || 'now');
  const update = {};
  if (apply === 'later') {
    update.pendingPlanChange = {
      plan: plan._id,
      billingCycle,
      effectiveAt: req.body.effectiveAt || req.body.subscriptionEndDate || null,
      note: String(req.body.note || '').trim(),
    };
  } else {
    update.plan = plan._id;
    update.planSnapshot = planSnapshotFor(plan, billingCycle);
    update.subscriptionBillingCycle = billingCycle;
    update.subscriptionAmount = update.planSnapshot.price;
    update.subscriptionStatus = req.body.subscriptionStatus || 'active';
    update.subscriptionStartDate = req.body.startDate || new Date();
    if (req.body.endDate) update.subscriptionEndDate = req.body.endDate;
    update.pendingPlanChange = {};
  }
  const item = await Organization.findByIdAndUpdate(req.params.id, update, { new: true, runValidators: true }).populate('plan').populate('owner', 'name email avatarUrl');
  if (!item) throw new AppError(404, 'Subscription not found');
  res.json({ success: true, message: apply === 'later' ? 'Plan change scheduled' : 'Plan changed', data: item });
});

exports.cancelSubscription = asyncHandler(async (req, res) => {
  const cancelAtPeriodEnd = Boolean(req.body.cancelAtPeriodEnd);
  const update = {
    subscriptionCancelReason: String(req.body.reason || '').trim(),
    subscriptionCancelledAt: new Date(),
    subscriptionCancelAtPeriodEnd: cancelAtPeriodEnd,
  };
  if (!cancelAtPeriodEnd) update.subscriptionStatus = 'cancelled';
  if (req.body.refund) {
    update.subscriptionStatus = 'refunded';
    update.subscriptionRefundMarkedAt = new Date();
    update.subscriptionRefundReason = update.subscriptionCancelReason;
  }
  const item = await Organization.findByIdAndUpdate(req.params.id, update, { new: true }).populate('plan').populate('owner', 'name email avatarUrl');
  if (!item) throw new AppError(404, 'Subscription not found');
  res.json({ success: true, message: 'Subscription cancelled', data: item });
});

exports.refundSubscription = asyncHandler(async (req, res) => {
  const item = await Organization.findByIdAndUpdate(req.params.id, {
    subscriptionStatus: 'refunded',
    subscriptionRefundMarkedAt: req.body.refundDate || new Date(),
    subscriptionRefundAmount: Number(req.body.amount || 0),
    subscriptionRefundReason: String(req.body.reason || '').trim(),
    subscriptionRefundNote: String(req.body.note || '').trim(),
    subscriptionPaymentStatus: 'refunded',
  }, { new: true }).populate('plan').populate('owner', 'name email avatarUrl');
  if (!item) throw new AppError(404, 'Subscription not found');
  res.json({ success: true, message: 'Subscription marked refunded', data: item });
});

exports.extendSubscription = asyncHandler(async (req, res) => {
  const organization = await Organization.findById(req.params.id);
  if (!organization) throw new AppError(404, 'Subscription not found');
  if (req.body.endDate) organization.subscriptionEndDate = req.body.endDate;
  else {
    const days = Math.max(Number(req.body.days || 0), 1);
    const base = organization.subscriptionEndDate && organization.subscriptionEndDate > new Date() ? organization.subscriptionEndDate : new Date();
    organization.subscriptionEndDate = new Date(base.getTime() + days * 24 * 60 * 60 * 1000);
  }
  if (req.body.note !== undefined) organization.subscriptionAdminNote = String(req.body.note || '').trim();
  await organization.save();
  await organization.populate('plan');
  await organization.populate('owner', 'name email avatarUrl');
  res.json({ success: true, message: 'Subscription extended', data: organization });
});

exports.activateSubscription = (active) => asyncHandler(async (req, res) => {
  const item = await Organization.findByIdAndUpdate(req.params.id, {
    subscriptionStatus: active ? 'active' : 'cancelled',
    ...(active ? { subscriptionCancelledAt: null, subscriptionCancelReason: '', subscriptionCancelAtPeriodEnd: false } : { subscriptionCancelledAt: new Date() }),
  }, { new: true }).populate('plan').populate('owner', 'name email avatarUrl');
  if (!item) throw new AppError(404, 'Subscription not found');
  res.json({ success: true, message: active ? 'Subscription activated' : 'Subscription deactivated', data: item });
});

exports.addSubscriptionNote = asyncHandler(async (req, res) => {
  const item = await Organization.findByIdAndUpdate(req.params.id, { subscriptionAdminNote: String(req.body.note || '').trim() }, { new: true }).populate('plan').populate('owner', 'name email avatarUrl');
  if (!item) throw new AppError(404, 'Subscription not found');
  res.json({ success: true, message: 'Admin note saved', data: item });
});

exports.paymentRequests = asyncHandler(async (req, res) => {
  const query = {};
  if (req.query.status) query.status = req.query.status;
  if (req.query.organization) query.organization = req.query.organization;
  const data = await paged(PaymentRequest, query, req, { populate: [{ path: 'organization', select: 'name email organizationCode' }, { path: 'plan' }] });
  res.json({ success: true, data });
});

exports.reviewPaymentRequest = (status) => asyncHandler(async (req, res) => {
  const request = await PaymentRequest.findById(req.params.id).populate('plan');
  if (!request) throw new AppError(404, 'Payment request not found');
  request.status = status;
  if (req.body.note !== undefined) request.note = String(req.body.note || '').trim();
  request.reviewedAt = new Date();
  request.reviewedBy = req.user._id;
  await request.save();
  if (status === 'approved') {
    await Organization.findByIdAndUpdate(request.organization, {
      plan: request.plan._id,
      planSnapshot: planSnapshotFor(request.plan, request.plan.billingType || 'monthly'),
      subscriptionStatus: 'active',
      subscriptionStartDate: new Date(),
      subscriptionBillingCycle: request.plan.billingType || 'monthly',
      subscriptionAmount: Number(request.amount || request.plan.priceMonthly || 0),
      subscriptionPaymentStatus: 'approved',
    });
  }
  res.json({ success: true, message: `Payment request ${status}`, data: request });
});

exports.organizationVerifications = asyncHandler(async (req, res) => {
  const query = {};
  if (req.query.status) query.verificationStatus = req.query.status;
  else query.verificationStatus = { $in: ['pending', 'verified', 'rejected'] };
  if (req.query.search) {
    const regex = new RegExp(escapeRegex(req.query.search), 'i');
    query.$or = [{ name: regex }, { email: regex }, { organizationCode: regex }];
  }
  const data = await paged(Organization, query, req, { select: organizationFields, populate: [{ path: 'owner', select: 'name email avatarUrl' }] });
  res.json({ success: true, data });
});

exports.approveVerification = asyncHandler(async (req, res) => {
  const item = await Organization.findByIdAndUpdate(req.params.organizationId, { verificationStatus: 'verified', verificationReviewedAt: new Date(), verificationReviewedBy: req.user._id, verificationRejectionReason: '' }, { new: true });
  if (!item) throw new AppError(404, 'Organization not found');
  res.json({ success: true, message: 'Organization verified', data: item });
});

exports.rejectVerification = asyncHandler(async (req, res) => {
  const item = await Organization.findByIdAndUpdate(req.params.organizationId, { verificationStatus: 'rejected', verificationReviewedAt: new Date(), verificationReviewedBy: req.user._id, verificationRejectionReason: String(req.body.reason || '').trim() }, { new: true });
  if (!item) throw new AppError(404, 'Organization not found');
  res.json({ success: true, message: 'Organization verification rejected', data: item });
});

exports.reports = asyncHandler(async (_req, res) => {
  const [organizations, teachers, students, submissions, payments] = await Promise.all([
    Organization.countDocuments(),
    User.countDocuments({ role: 'teacher' }),
    User.countDocuments({ role: 'student' }),
    Submission.countDocuments(),
    PaymentRequest.aggregate([{ $match: { status: 'approved' } }, { $group: { _id: null, revenue: { $sum: '$amount' } } }]),
  ]);
  const topOrganizations = await Submission.aggregate([
    { $group: { _id: '$organization', submissions: { $sum: 1 }, averageScore: { $avg: '$totalScore' } } },
    { $sort: { submissions: -1 } },
    { $limit: 10 },
  ]);
  const orgs = await Organization.find({ _id: { $in: topOrganizations.map((row) => row._id) } }).select('name organizationCode').lean();
  const orgMap = new Map(orgs.map((item) => [String(item._id), item]));
  res.json({
    success: true,
    data: {
      revenue: payments[0]?.revenue || 0,
      growth: { organizations, teachers, students, submissions },
      topOrganizations: topOrganizations.map((row) => ({ ...row, organization: orgMap.get(String(row._id)) })),
    },
  });
});

exports.teacherJoinRequests = asyncHandler(async (req, res) => {
  const query = {};
  if (req.query.status) query.status = req.query.status;
  if (req.query.organization) query.organization = req.query.organization;
  const data = await paged(TeacherJoinRequest, query, req, { populate: [{ path: 'teacher', select: 'name email avatarUrl' }, { path: 'organization', select: 'name organizationCode' }] });
  res.json({ success: true, data });
});
