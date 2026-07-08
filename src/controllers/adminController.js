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

const userFields = 'name email role avatarUrl phone contactNumber address bio location organization organizationAccessStatus teacherJoinStatus assignedServices assignedBatches batches isActive createdAt updatedAt';
const organizationFields = 'name email phone contactNumber address category type description logoUrl avatarUrl organizationCode owner plan subscriptionStatus verificationStatus verificationDocumentUrl verificationSubmittedAt verificationRejectionReason isActive createdAt updatedAt';

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
  if (role) query.role = role;
  if (req.query.role) query.role = req.query.role;
  if (req.query.organization) query.organization = req.query.organization;
  if (req.query.status === 'active') query.isActive = true;
  if (req.query.status === 'blocked') query.isActive = false;
  if (req.query.status === 'paused') query.organizationAccessStatus = 'paused';
  if (req.query.search) {
    const regex = new RegExp(escapeRegex(req.query.search), 'i');
    query.$or = [{ name: regex }, { email: regex }];
  }
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
    Organization.find().select(organizationFields).populate('owner', 'name email').populate('plan', 'name code').sort({ createdAt: -1 }).limit(6).lean(),
    User.find().select(userFields).populate('organization', 'name organizationCode').sort({ createdAt: -1 }).limit(6).lean(),
    ExamSlot.find().populate('organization', 'name').populate('createdBy', 'name email').sort({ createdAt: -1 }).limit(6).lean(),
    Submission.find().populate('student', 'name email').populate('examSlot', 'title').populate('organization', 'name').sort({ submittedAt: -1 }).limit(6).lean(),
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
    ExamSlot.find({ organization: req.params.id }).populate('createdBy', 'name email').populate('service', 'name').limit(100).lean(),
    Submission.find({ organization: req.params.id }).populate('student', 'name email').populate('examSlot', 'title').limit(100).lean(),
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
  const user = await User.findByIdAndUpdate(req.params.id, { isActive: active }, { new: true }).select(userFields);
  if (!user) throw new AppError(404, 'User not found');
  res.json({ success: true, message: active ? 'User unblocked' : 'User blocked', data: user });
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
    Batch.find({ service: item._id }).populate('assignedTeachers', 'name email').limit(100).lean(),
    ExamSlot.find({ service: item._id }).populate('createdBy', 'name email').limit(100).lean(),
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
  const exams = await ExamSlot.find({ assignedBatches: item._id }).populate('createdBy', 'name email').lean();
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
  const data = await paged(ExamSlot, query, req, { populate: [{ path: 'organization', select: 'name organizationCode' }, { path: 'service', select: 'name' }, { path: 'assignedBatches', select: 'name batchCode' }, { path: 'createdBy', select: 'name email' }] });
  const ids = data.items.map((item) => item._id);
  const counts = await Submission.aggregate([{ $match: { examSlot: { $in: ids } } }, { $group: { _id: '$examSlot', submissionsCount: { $sum: 1 } } }]);
  const map = new Map(counts.map((row) => [String(row._id), row.submissionsCount]));
  data.items = data.items.map((item) => ({ ...item, submissionsCount: map.get(String(item._id)) || 0 }));
  res.json({ success: true, data });
});

exports.examDetails = asyncHandler(async (req, res) => {
  const item = await ExamSlot.findById(req.params.id).populate('organization', 'name organizationCode').populate('service', 'name').populate('assignedBatches', 'name batchCode').populate('createdBy', 'name email').lean();
  if (!item) throw new AppError(404, 'Exam not found');
  const submissions = await Submission.find({ examSlot: item._id }).populate('student', 'name email').limit(100).lean();
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
  if (req.query.search) query.name = new RegExp(escapeRegex(req.query.search), 'i');
  res.json({ success: true, data: await paged(Plan, query, req) });
});

exports.createPlan = asyncHandler(async (req, res) => {
  const plan = await Plan.create(req.body);
  res.status(201).json({ success: true, message: 'Plan created', data: plan });
});

exports.updatePlan = asyncHandler(async (req, res) => {
  const plan = await Plan.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
  if (!plan) throw new AppError(404, 'Plan not found');
  res.json({ success: true, message: 'Plan updated', data: plan });
});

exports.deactivatePlan = asyncHandler(async (req, res) => {
  const plan = await Plan.findByIdAndUpdate(req.params.id, { isActive: false }, { new: true });
  if (!plan) throw new AppError(404, 'Plan not found');
  res.json({ success: true, message: 'Plan deactivated', data: plan });
});

exports.subscriptions = asyncHandler(async (req, res) => {
  const query = {};
  if (req.query.status) query.subscriptionStatus = req.query.status;
  if (req.query.organization) query._id = req.query.organization;
  const data = await paged(Organization, query, req, { select: organizationFields, populate: [{ path: 'plan' }, { path: 'owner', select: 'name email' }] });
  res.json({ success: true, data });
});

exports.updateSubscription = asyncHandler(async (req, res) => {
  const allowed = ['plan','subscriptionStatus','subscriptionStartDate','subscriptionEndDate'];
  const body = {};
  allowed.forEach((key) => { if (req.body[key] !== undefined) body[key] = req.body[key]; });
  const item = await Organization.findByIdAndUpdate(req.params.id, body, { new: true, runValidators: true }).populate('plan');
  if (!item) throw new AppError(404, 'Subscription not found');
  res.json({ success: true, message: 'Subscription updated', data: item });
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
    await Organization.findByIdAndUpdate(request.organization, { plan: request.plan._id, subscriptionStatus: 'active', subscriptionStartDate: new Date() });
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
  const data = await paged(Organization, query, req, { select: organizationFields, populate: [{ path: 'owner', select: 'name email' }] });
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
