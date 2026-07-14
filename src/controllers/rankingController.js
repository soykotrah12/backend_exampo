const Submission = require('../models/Submission');
const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');
const attempts = require('../services/examAttemptService');

const id = (value) => String(value?._id || value || '');
const ids = (items = []) => items.map(id).filter(Boolean);
const resultVisible = (slot, submission) => attempts.isSubmissionResultPublished(slot, submission);

const assertScope = (user, { serviceId, batchId }) => {
  if (!user.organization) throw new AppError(404, 'Join an organization first');
  if (user.role === 'teacher') {
    if (serviceId && !ids(user.assignedServices).includes(String(serviceId))) throw new AppError(403, 'Teachers can view rankings only for assigned services');
    if (batchId && !ids(user.assignedBatches).includes(String(batchId))) throw new AppError(403, 'Teachers can view rankings only for assigned batches');
  }
  if (user.role === 'student' && batchId && !ids(user.batches).includes(String(batchId))) throw new AppError(403, 'Students can view only joined batch rankings');
};

const teacherCanSee = (user, submission) => {
  if (user.role !== 'teacher') return true;
  const serviceSet = new Set(ids(user.assignedServices));
  const batchSet = new Set(ids(user.assignedBatches));
  if (serviceSet.has(id(submission.service || submission.examSlot?.service))) return true;
  if (batchSet.has(id(submission.batch))) return true;
  return ids(submission.examSlot?.assignedBatches).some((batchId) => batchSet.has(batchId));
};

const studentCanSee = (user, submission, scope) => {
  if (user.role !== 'student') return true;
  if (scope.batchId) return ids(user.batches).includes(String(scope.batchId));
  return String(user.organization) === String(submission.organization);
};

const batchFor = (submission) => {
  if (submission.batch) return submission.batch;
  return (submission.examSlot?.assignedBatches || [])[0];
};

const buildRanking = async (user, scope = {}, options = {}) => {
  assertScope(user, scope);
  const query = { organization: user.organization };
  if (options.from || options.to) {
    query.submittedAt = {};
    if (options.from) query.submittedAt.$gte = new Date(options.from);
    if (options.to) query.submittedAt.$lte = new Date(options.to);
  }
  const submissions = await Submission.find(query)
    .populate('student', 'name email avatarUrl batches')
    .populate('service', 'name')
    .populate('batch', 'name batchCode')
    .populate({ path: 'examSlot', select: 'title totalMarks resultVisibilityMode resultPublished service assignedBatches examType isAnytimeExam', populate: { path: 'assignedBatches', select: 'name batchCode' } })
    .lean();
  const search = String(options.search || '').trim().toLowerCase();
  const grouped = new Map();
  submissions.forEach((submission) => {
    const slot = submission.examSlot;
    if (!resultVisible(slot, submission)) return;
    if (slot?.examType !== 'mcq' && submission.status !== 'reviewed') return;
    if (scope.serviceId && id(submission.service || slot?.service) !== String(scope.serviceId)) return;
    if (scope.batchId && id(submission.batch) !== String(scope.batchId) && !ids(slot?.assignedBatches).includes(String(scope.batchId))) return;
    if (!teacherCanSee(user, submission) || !studentCanSee(user, submission, scope)) return;
    const student = submission.student;
    if (!student) return;
    const name = student.name || 'Student';
    if (search && !`${name} ${student.email || ''}`.toLowerCase().includes(search)) return;
    const key = id(student);
    const batch = batchFor(submission);
    const totalScore = Number(submission.totalScore || 0);
    const percentage = Number(submission.percentage || (slot?.totalMarks ? (totalScore / Number(slot.totalMarks)) * 100 : 0));
    const current = grouped.get(key) || {
      studentId: key,
      name,
      avatar: student.avatarUrl || '',
      organization: id(submission.organization),
      batch: batch?.name || '',
      batchId: id(batch),
      totalSubmittedExams: 0,
      totalScore: 0,
      percentageTotal: 0,
    };
    current.totalSubmittedExams += 1;
    current.totalScore += totalScore;
    current.percentageTotal += Number.isFinite(percentage) ? percentage : 0;
    if (!current.batch && batch?.name) {
      current.batch = batch.name;
      current.batchId = id(batch);
    }
    grouped.set(key, current);
  });
  const items = [...grouped.values()].map((item) => ({
    ...item,
    averageScore: item.totalSubmittedExams ? item.totalScore / item.totalSubmittedExams : 0,
    percentage: item.totalSubmittedExams ? item.percentageTotal / item.totalSubmittedExams : 0,
  })).sort((a, b) => (b.percentage - a.percentage) || (b.averageScore - a.averageScore) || (b.totalScore - a.totalScore));
  items.forEach((item, index) => {
    item.rank = index + 1;
    delete item.percentageTotal;
  });
  return items;
};

const respond = (scope) => asyncHandler(async (req, res) => {
  const page = Math.max(1, Number(req.query.page || 1));
  const limit = Math.min(100, Math.max(1, Number(req.query.limit || 30)));
  const items = await buildRanking(req.user, scope(req), req.query);
  res.json({ success: true, data: { items: items.slice((page - 1) * limit, page * limit), total: items.length, page, limit } });
});

exports.organization = respond((req) => ({ serviceId: req.query.serviceId, batchId: req.query.batchId }));
exports.service = respond((req) => ({ serviceId: req.params.serviceId }));
exports.batch = respond((req) => ({ batchId: req.params.batchId }));
exports.myRanking = asyncHandler(async (req, res) => {
  const items = await buildRanking(req.user, {}, req.query);
  const own = items.find((item) => item.studentId === String(req.user._id)) || null;
  res.json({ success: true, data: { own, top: items.slice(0, 10), total: items.length } });
});

exports.buildRanking = buildRanking;
