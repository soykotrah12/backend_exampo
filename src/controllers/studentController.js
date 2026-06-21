const ExamSlot = require('../models/ExamSlot');
const Question = require('../models/Question');
const AccessRequest = require('../models/AccessRequest');
const Submission = require('../models/Submission');
const asyncHandler = require('../utils/asyncHandler');
const AppError = require('../utils/AppError');
const access = require('../services/examAccessService');
const scoring = require('../services/scoringService');

exports.listSlots = asyncHandler(async (req, res) => {
  const slots = await ExamSlot.find({ status: { $in: ['published','ongoing','completed'] } }).lean();
  const requests = await AccessRequest.find({ student: req.user._id }).lean(); const submissions = await Submission.find({ student: req.user._id }).select('examSlot').lean();
  const requestBySlot = new Map(requests.map((x) => [String(x.examSlot), x.status])); const completed = new Set(submissions.map((x) => String(x.examSlot)));
  res.json({ success: true, data: slots.map((slot) => ({ ...slot, accessStatus: completed.has(String(slot._id)) ? 'Completed' : slot.assignedStudents.some((x) => String(x) === String(req.user._id)) || requestBySlot.get(String(slot._id)) === 'accepted' ? 'Assigned' : requestBySlot.get(String(slot._id)) === 'pending' ? 'Requested' : 'Locked' })) });
});
exports.requestAccess = asyncHandler(async (req, res) => {
  const slot = await ExamSlot.findById(req.params.id); if (!slot || !['published','ongoing'].includes(slot.status)) throw new AppError(404, 'Published exam not found');
  if (await access.hasAccess(slot, req.user._id)) throw new AppError(409, 'You already have access');
  const request = await AccessRequest.findOneAndUpdate({ examSlot: slot._id, student: req.user._id }, { $set: { status: 'pending', organization: slot.organization }, $unset: { reviewedBy: 1, reviewedAt: 1 } }, { upsert: true, new: true });
  res.status(201).json({ success: true, message: 'Access requested', data: request });
});
exports.getExam = asyncHandler(async (req, res) => {
  const slot = await ExamSlot.findById(req.params.id); if (!slot) throw new AppError(404, 'Exam not found');
  if (!(await access.hasAccess(slot, req.user._id))) throw new AppError(403, 'You do not have access to this exam');
  if (await Submission.exists({ examSlot: slot._id, student: req.user._id })) throw new AppError(409, 'This exam has already been submitted');
  const now = new Date(); if (now < slot.startDateTime || now > slot.endDateTime || !['published','ongoing'].includes(slot.status)) throw new AppError(403, 'The exam is not active');
  const questions = await Question.find({ examSlot: slot._id }).select('-statements.correctAnswer -options.isCorrect -answerGuideline').sort({ order: 1 }).lean();
  res.json({ success: true, data: { ...slot.toObject(), questions, serverTime: now.toISOString() } });
});
exports.submit = asyncHandler(async (req, res) => {
  const slot = await ExamSlot.findById(req.params.id); if (!slot) throw new AppError(404, 'Exam not found');
  if (!(await access.hasAccess(slot, req.user._id))) throw new AppError(403, 'You do not have access to this exam');
  if (await Submission.exists({ examSlot: slot._id, student: req.user._id })) throw new AppError(409, 'This exam has already been submitted');
  const now = new Date(); const graceEnd = new Date(slot.endDateTime.getTime() + 60 * 1000);
  if (now < slot.startDateTime || now > graceEnd) throw new AppError(403, 'The exam submission window is closed');
  const questions = await Question.find({ examSlot: slot._id }).select('+answerGuideline'); const result = scoring.validateAndScore(questions, req.body.answers || []);
  const submission = await Submission.create({ examSlot: slot._id, student: req.user._id, organization: slot.organization, answers: result.answers, mcqScore: result.mcqScore, totalScore: result.mcqScore, autoSubmitted: Boolean(req.body.autoSubmitted) });
  res.status(201).json({ success: true, message: 'Exam submitted successfully', data: { id: submission._id, submittedAt: submission.submittedAt, ...(slot.resultVisible && { mcqScore: submission.mcqScore }) } });
});
