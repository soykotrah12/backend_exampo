const AccessRequest = require('../models/AccessRequest');
const ExamSlot = require('../models/ExamSlot');
const Submission = require('../models/Submission');
const asyncHandler = require('../utils/asyncHandler');
const AppError = require('../utils/AppError');
const access = require('../services/examAccessService');

exports.requests = asyncHandler(async (req, res) => {
  const slots = await ExamSlot.find({ organization: req.user.organization, ...(req.user.role === 'teacher' && { createdBy: req.user._id }) }).select('_id');
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
  submission.writtenScore = writtenScore; submission.totalScore = submission.mcqScore + writtenScore; submission.status = 'reviewed'; await submission.save();
  res.json({ success: true, message: 'Written answers reviewed', data: submission });
});
