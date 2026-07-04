const ExamSlot = require('../models/ExamSlot');
const Question = require('../models/Question');
const AccessRequest = require('../models/AccessRequest');
const Submission = require('../models/Submission');
const asyncHandler = require('../utils/asyncHandler');
const AppError = require('../utils/AppError');
const access = require('../services/examAccessService');
const scoring = require('../services/scoringService');
const resultVisible = (slot) => slot.resultVisibilityMode === 'instant' || slot.resultPublished === true;
const studentQuestion = (question) => ({ _id: question._id, questionNo: question.questionNo, type: question.type, questionText: question.questionText, statements: question.statements?.map((item) => ({ label: item.label, text: item.text })), options: question.options?.map((item) => ({ label: item.label, text: item.text })), marks: question.marks, wordLimit: question.wordLimit });

exports.listSlots = asyncHandler(async (req, res) => {
  if (!req.user.organization) return res.json({ success: true, data: [] });
  const slots = await ExamSlot.find({ organization: req.user.organization, status: { $in: ['published','ongoing','completed'] } }).populate('createdBy', 'name').populate('assignedBatches', 'name batchCode').populate('service', 'name color icon').lean();
  const requests = await AccessRequest.find({ student: req.user._id }).lean(); const submissions = await Submission.find({ student: req.user._id }).select('examSlot submittedAt').lean();
  const requestBySlot = new Map(requests.map((x) => [String(x.examSlot), x.status])); const submissionBySlot = new Map(submissions.map((x) => [String(x.examSlot), x]));
  const serverTime = new Date().toISOString();
  const data = await Promise.all(slots.map(async (slot) => { const submission = submissionBySlot.get(String(slot._id)); const allowed = await access.hasAccess(slot, req.user._id); return { ...slot, serviceName: slot.service?.name || '', teacherName: slot.createdBy?.name || '', batchNames: (slot.assignedBatches || []).map((x) => x.name), serverTime, submissionId: submission?._id, resultAvailable: Boolean(submission && resultVisible(slot)), accessStatus: submission ? 'Submitted' : allowed ? 'Assigned' : requestBySlot.get(String(slot._id)) === 'pending' ? 'Requested' : 'Locked' }; }));
  res.json({ success: true, data });
});
exports.requestAccess = asyncHandler(async (req, res) => {
  const slot = await ExamSlot.findById(req.params.id); if (!slot || !['published','ongoing'].includes(slot.status)) throw new AppError(404, 'Published exam not found');
  if (!req.user.organization || String(req.user.organization) !== String(slot.organization)) throw new AppError(403, 'Please join the organization first using organization code.');
  if (await access.hasAccess(slot, req.user._id)) throw new AppError(409, 'You already have access');
  const request = await AccessRequest.findOneAndUpdate({ examSlot: slot._id, student: req.user._id }, { $set: { status: 'pending', organization: slot.organization }, $unset: { reviewedBy: 1, reviewedAt: 1 } }, { upsert: true, new: true });
  res.status(201).json({ success: true, message: 'Access requested', data: request });
});
exports.getExam = asyncHandler(async (req, res) => {
  const slot = await ExamSlot.findById(req.params.id); if (!slot) throw new AppError(404, 'Exam not found');
  if (!(await access.hasAccess(slot, req.user._id))) throw new AppError(403, 'You do not have access to this exam');
  if (await Submission.exists({ examSlot: slot._id, student: req.user._id })) throw new AppError(409, 'This exam has already been submitted');
  const now = new Date(); if (now < slot.startDateTime || now > slot.endDateTime || !['published','ongoing'].includes(slot.status)) throw new AppError(403, 'The exam is not active');
  const questions = await Question.find({ examSlot: slot._id }).sort({ questionNo: 1 }).lean();
  res.json({ success: true, data: { ...slot.toObject(), questions: questions.map(studentQuestion), serverTime: now.toISOString() } });
});
exports.submit = asyncHandler(async (req, res) => {
  const slot = await ExamSlot.findById(req.params.id); if (!slot) throw new AppError(404, 'Exam not found');
  if (!(await access.hasAccess(slot, req.user._id))) throw new AppError(403, 'You do not have access to this exam');
  if (await Submission.exists({ examSlot: slot._id, student: req.user._id })) throw new AppError(409, 'This exam has already been submitted');
  const now = new Date(); const graceEnd = new Date(slot.endDateTime.getTime() + 60 * 1000);
  if (now < slot.startDateTime || now > graceEnd) throw new AppError(403, 'The exam submission window is closed');
  const questions = await Question.find({ examSlot: slot._id }).select('+answerGuideline'); const result = scoring.validateAndScore(questions, req.body.answers || []);
  const batch = (slot.assignedBatches || []).find((id) => (req.user.batches || []).some((batchId) => String(batchId) === String(id))) || null;
  const percentage = slot.totalMarks > 0 ? Math.min(100, (result.mcqScore / slot.totalMarks) * 100) : 0;
  const submission = await Submission.create({ examSlot: slot._id, student: req.user._id, organization: slot.organization, service: slot.service || null, batch, answers: result.answers, mcqScore: result.mcqScore, totalScore: result.mcqScore, percentage, resultPublished: resultVisible(slot), autoSubmitted: Boolean(req.body.autoSubmitted) });
  res.status(201).json({ success: true, message: 'Exam submitted successfully', data: { id: submission._id, submittedAt: submission.submittedAt, resultAvailable: resultVisible(slot), ...(resultVisible(slot) && { mcqScore: submission.mcqScore }) } });
});

exports.results = asyncHandler(async (req, res) => {
  const submissions = await Submission.find({ student: req.user._id }).populate('examSlot', 'title category startDateTime endDateTime resultVisibilityMode resultPublished resultPublishedAt showCorrectAnswers showQuestionReview').sort({ submittedAt: -1 }).lean();
  const data = submissions.map((submission) => {
    const visible = resultVisible(submission.examSlot);
    return { _id: submission._id, examSlot: { _id: submission.examSlot._id, title: submission.examSlot.title, category: submission.examSlot.category, startDateTime: submission.examSlot.startDateTime, endDateTime: submission.examSlot.endDateTime }, submittedAt: submission.submittedAt, autoSubmitted: submission.autoSubmitted, resultAvailable: visible, status: visible ? (submission.status === 'reviewed' ? 'result_published' : 'pending_review') : 'submitted', ...(visible && { mcqScore: submission.mcqScore, writtenScore: submission.writtenScore, totalScore: submission.totalScore }) };
  });
  res.json({ success: true, data });
});

exports.resultDetail = asyncHandler(async (req, res) => {
  const submission = await Submission.findOne({ _id: req.params.submissionId, student: req.user._id }).lean();
  if (!submission) throw new AppError(404, 'Result not found');
  const slot = await ExamSlot.findById(submission.examSlot).lean();
  if (!resultVisible(slot)) throw new AppError(403, 'Your result will be visible after the teacher publishes it');
  const response = { _id: submission._id, examSlot: { _id: slot._id, title: slot.title, startDateTime: slot.startDateTime, endDateTime: slot.endDateTime }, submittedAt: submission.submittedAt, autoSubmitted: submission.autoSubmitted, mcqScore: submission.mcqScore, writtenScore: submission.writtenScore, totalScore: submission.totalScore, reviewFeedback: submission.reviewFeedback, status: submission.status === 'reviewed' ? 'result_published' : 'pending_review', showCorrectAnswers: slot.showCorrectAnswers, showQuestionReview: slot.showQuestionReview };
  if (slot.showQuestionReview || slot.showCorrectAnswers) {
    const questions = await Question.find({ examSlot: slot._id }).sort({ questionNo: 1 }).lean(); const answerByQuestion = new Map(submission.answers.map((answer) => [String(answer.questionId), answer]));
    response.review = questions.map((question) => { const answer = answerByQuestion.get(String(question._id)); const item = { ...studentQuestion(question), answer: answer ? { type: answer.type, answers: answer.answers, selectedOption: answer.selectedOption, writtenAnswer: answer.writtenAnswer, awardedMarks: answer.awardedMarks } : null }; if (slot.showCorrectAnswers) { if (question.type === 'TRUE_FALSE_GROUP') item.correctAnswers = Object.fromEntries(question.statements.map((x) => [x.label, x.correctAnswer])); if (question.type === 'SINGLE_BEST_ANSWER') item.correctOption = question.options.find((x) => x.isCorrect)?.label; } return item; });
  }
  res.json({ success: true, data: response });
});

exports.activity = asyncHandler(async (req, res) => {
  const [requests, submissions, upcoming] = await Promise.all([
    AccessRequest.find({ student: req.user._id }).populate('examSlot', 'title').sort({ updatedAt: -1 }).limit(20).lean(),
    Submission.find({ student: req.user._id }).populate('examSlot', 'title resultPublished').sort({ submittedAt: -1 }).limit(20).lean(),
    req.user.organization ? ExamSlot.find({ organization: req.user.organization, startDateTime: { $gt: new Date() }, status: 'published' }).sort({ startDateTime: 1 }).limit(5).lean() : [],
  ]);
  const data = [
    ...requests.map((x) => ({ type: `access_request_${x.status}`, title: x.examSlot?.title || 'Exam', at: x.updatedAt })),
    ...submissions.map((x) => ({ type: x.examSlot?.resultPublished ? 'result_published' : 'exam_submitted', title: x.examSlot?.title || 'Exam', at: x.submittedAt })),
    ...upcoming.map((x) => ({ type: 'upcoming_exam', title: x.title, at: x.startDateTime })),
  ].sort((a, b) => new Date(b.at) - new Date(a.at));
  res.json({ success: true, data });
});
