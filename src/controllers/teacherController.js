const AccessRequest = require('../models/AccessRequest');
const ExamSlot = require('../models/ExamSlot');
const Submission = require('../models/Submission');
const asyncHandler = require('../utils/asyncHandler');
const AppError = require('../utils/AppError');
const access = require('../services/examAccessService');
const Batch = require('../models/Batch');
const User = require('../models/User');

exports.requests = asyncHandler(async (req, res) => {
  if (req.user.role === 'teacher' && !req.user.organization) return res.json({ success: true, data: [] });
  const slots = await ExamSlot.find({ organization: req.user.organization, ...access.teacherExamQuery(req.user) }).select('_id');
  res.json({ success: true, data: await AccessRequest.find({ examSlot: { $in: slots.map((x) => x._id) }, status: 'pending' }).populate('student', 'name email').populate('examSlot', 'title') });
});
exports.reviewRequest = (status) => asyncHandler(async (req, res) => {
  const request = await AccessRequest.findById(req.params.id); if (!request) throw new AppError(404, 'Access request not found');
  const slot = await ExamSlot.findById(request.examSlot); access.assertManage(slot, req.user);
  request.status = status; request.reviewedBy = req.user._id; request.reviewedAt = new Date(); await request.save();
  if (status === 'accepted') { slot.assignedStudents.addToSet(request.student); await slot.save(); }
  res.json({ success: true, message: `Request ${status}`, data: request });
});
exports.submissions = asyncHandler(async (req, res) => { const slot = await ExamSlot.findById(req.params.id); if (!slot) throw new AppError(404, 'Exam not found'); access.assertManage(slot, req.user); res.json({ success: true, data: await Submission.find({ examSlot: slot._id }).populate('student', 'name email').select('-answers') }); });
exports.submission = asyncHandler(async (req, res) => { const submission = await Submission.findById(req.params.id).populate('student', 'name email').populate('answers.questionId', 'questionText marks type'); if (!submission) throw new AppError(404, 'Submission not found'); const slot = await ExamSlot.findById(submission.examSlot); access.assertManage(slot, req.user); res.json({ success: true, data: submission }); });
exports.reviewWritten = asyncHandler(async (req, res) => {
  const submission = await Submission.findById(req.params.id); if (!submission) throw new AppError(404, 'Submission not found'); const slot = await ExamSlot.findById(submission.examSlot); access.assertManage(slot, req.user);
  const marks = new Map((req.body.marks || []).map((x) => [String(x.questionId), Number(x.awardedMarks)])); let writtenScore = 0;
  submission.answers.forEach((answer) => { if (answer.type === 'WRITTEN' && marks.has(String(answer.questionId))) { const value = marks.get(String(answer.questionId)); if (value < 0) throw new AppError(400, 'Marks cannot be negative'); answer.awardedMarks = value; writtenScore += value; } });
  submission.writtenScore = writtenScore; submission.totalScore = submission.mcqScore + writtenScore; submission.percentage = slot.totalMarks > 0 ? Math.min(100, (submission.totalScore / slot.totalMarks) * 100) : 0; submission.status = 'reviewed'; await submission.save();
  if (req.body.feedback !== undefined) submission.reviewFeedback = String(req.body.feedback).trim();
  await submission.save();
  res.json({ success: true, message: 'Written answers reviewed', data: submission });
});

exports.activity = asyncHandler(async (req, res) => {
  if (req.user.role === 'teacher' && !req.user.organization) return res.json({ success: true, data: [] });
  const slots = await ExamSlot.find({ organization: req.user.organization, ...access.teacherExamQuery(req.user) }).select('_id').lean();
  const ids = slots.map((x) => x._id);
  const [requests, submissions] = await Promise.all([
    AccessRequest.find({ examSlot: { $in: ids } }).populate('student', 'name').populate('examSlot', 'title').sort({ updatedAt: -1 }).limit(25).lean(),
    Submission.find({ examSlot: { $in: ids } }).populate('student', 'name').populate('examSlot', 'title').sort({ submittedAt: -1 }).limit(25).lean(),
  ]);
  const data = [...requests.map((x) => ({ type: `access_request_${x.status}`, title: x.examSlot?.title, person: x.student?.name, at: x.updatedAt })), ...submissions.map((x) => ({ type: x.status === 'reviewed' ? 'written_reviewed' : 'exam_submitted', title: x.examSlot?.title, person: x.student?.name, at: x.submittedAt }))].sort((a, b) => new Date(b.at) - new Date(a.at));
  res.json({ success: true, data });
});

exports.history = asyncHandler(async (req, res) => {
  if (req.user.role === 'teacher' && !req.user.organization) return res.json({ success: true, data: [] });
  const scope = access.teacherExamQuery(req.user);
  const endedOrArchived = { $or: [{ endDateTime: { $lt: new Date() } }, { status: { $in: ['completed','cancelled','archived'] } }] };
  const query = scope.$or ? { organization: req.user.organization, $and: [scope, endedOrArchived] } : { organization: req.user.organization, ...endedOrArchived };
  const slots = await ExamSlot.find(query).sort({ endDateTime: -1 }).lean();
  const data = await Promise.all(slots.map(async (slot) => {
    const submissions = await Submission.find({ examSlot: slot._id }).select('totalScore').lean();
    return { ...slot, assignedStudentsCount: slot.assignedStudents.length, submissionCount: submissions.length, averageScore: submissions.length ? submissions.reduce((sum, x) => sum + Number(x.totalScore || 0), 0) / submissions.length : null };
  }));
  res.json({ success: true, data });
});

exports.dashboardSummary = asyncHandler(async (req, res) => {
  if (req.user.role === 'teacher' && !req.user.organization) return res.json({ success: true, data: { requiresOrganization: true, runningBatchesCount: 0, totalStudents: 0, upcomingExamsCount: 0, todayExams: [], pendingAccessRequestsCount: 0, pendingWrittenReviewsCount: 0, recentSubmissionsCount: 0, resultsWaitingToPublishCount: 0 } });
  const now = new Date();
  const dayStart = new Date(now); dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(dayStart); dayEnd.setDate(dayEnd.getDate() + 1);
  const weekStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const slotBase = { organization: req.user.organization, ...access.teacherExamQuery(req.user) };
  const slots = await ExamSlot.find(slotBase).select('_id').lean();
  const slotIds = slots.map((slot) => slot._id);
  const [runningBatchesCount, totalStudents, upcomingExamsCount, todayExams, pendingAccessRequestsCount, pendingWrittenReviewsCount, recentSubmissionsCount, resultsWaitingToPublishCount] = await Promise.all([
    Batch.countDocuments({ organization: req.user.organization, isActive: true, ...(req.user.role === 'teacher' && { _id: { $in: req.user.assignedBatches } }) }),
    User.countDocuments({ organization: req.user.organization, role: 'student', isActive: true, ...(req.user.role === 'teacher' && { batches: { $in: req.user.assignedBatches } }) }),
    ExamSlot.countDocuments({ ...slotBase, startDateTime: { $gt: now }, status: { $in: ['draft','published'] } }),
    ExamSlot.find({ ...slotBase, startDateTime: { $lt: dayEnd }, endDateTime: { $gt: now }, status: { $in: ['published','ongoing'] } }).populate('assignedBatches', 'name').populate('service', 'name').sort({ startDateTime: 1 }).limit(6).lean(),
    AccessRequest.countDocuments({ examSlot: { $in: slotIds }, status: 'pending' }),
    Submission.countDocuments({ examSlot: { $in: slotIds }, status: 'submitted', 'answers.type': 'WRITTEN' }),
    Submission.countDocuments({ examSlot: { $in: slotIds }, submittedAt: { $gte: weekStart } }),
    ExamSlot.countDocuments({ ...slotBase, endDateTime: { $lt: now }, resultVisibilityMode: 'manual_publish', resultPublished: false }),
  ]);
  res.json({ success: true, data: { runningBatchesCount, totalStudents, upcomingExamsCount, todayExams: todayExams.map((exam) => ({ ...exam, serviceName: exam.service?.name || '', batchNames: (exam.assignedBatches || []).map((batch) => batch.name) })), pendingAccessRequestsCount, pendingWrittenReviewsCount, recentSubmissionsCount, resultsWaitingToPublishCount } });
});
