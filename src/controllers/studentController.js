const ExamSlot = require('../models/ExamSlot');
const Question = require('../models/Question');
const AccessRequest = require('../models/AccessRequest');
const Submission = require('../models/Submission');
const Batch = require('../models/Batch');
const asyncHandler = require('../utils/asyncHandler');
const AppError = require('../utils/AppError');
const access = require('../services/examAccessService');
const scoring = require('../services/scoringService');
const { withComputedExamStatus, getComputedExamStatus } = require('../utils/examStatus');
const resultVisible = (slot) => slot.resultVisibilityMode === 'instant' || slot.resultPublished === true;
const studentQuestion = (question) => ({ _id: question._id, questionNo: question.questionNo, type: question.type, questionText: question.questionText, statements: question.statements?.map((item) => ({ label: item.label, text: item.text })), options: question.options?.map((item) => ({ label: item.label, text: item.text })), marks: question.marks, wordLimit: question.wordLimit });

const numberOrZero = (value) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
};

const roundMarks = (value) => Number(numberOrZero(value).toFixed(6));

const boolAnswer = (value) => {
  if (typeof value === 'boolean') return value;
  if (value === null || value === undefined) return null;
  const text = String(value).trim().toLowerCase();
  if (['true', 't', 'yes', '1'].includes(text)) return true;
  if (['false', 'f', 'no', '0'].includes(text)) return false;
  return null;
};

const answerValue = (answers, label) => {
  if (!answers) return null;
  if (typeof answers.get === 'function') return boolAnswer(answers.get(label));
  return boolAnswer(answers[label]);
};

const answerCount = (answers) => {
  if (!answers) return 0;
  if (typeof answers.size === 'number') return answers.size;
  return Object.keys(answers).length;
};

const plainAnswers = (answers) => {
  if (!answers) return undefined;
  if (typeof answers.entries === 'function') return Object.fromEntries(answers.entries());
  return { ...answers };
};

const isSkippedAnswer = (question, answer) => {
  if (!answer) return true;
  if (question.type === 'TRUE_FALSE_GROUP') return answerCount(answer.answers) === 0;
  if (question.type === 'SINGLE_BEST_ANSWER') return !answer.selectedOption;
  if (question.type === 'WRITTEN') return !String(answer.writtenAnswer || '').trim();
  return false;
};

const statusFor = (question, answer, earnedMarks, totalMarks, pendingWritten) => {
  if (isSkippedAnswer(question, answer)) return 'skipped';
  if (question.type === 'WRITTEN') return pendingWritten ? 'pending_review' : 'reviewed';
  if (earnedMarks <= 0) return 'wrong';
  return earnedMarks >= totalMarks ? 'correct' : 'partial';
};

const statementBreakdown = (question, answer, canShowCorrectAnswers) => {
  const statements = Array.isArray(question.statements) ? question.statements : [];
  const perStatementMarks = statements.length ? numberOrZero(question.marks) / statements.length : 0;
  return statements.map((statement) => {
    const studentAnswer = answerValue(answer?.answers, statement.label);
    const hasStudentAnswer = studentAnswer !== null;
    const correct = canShowCorrectAnswers ? boolAnswer(statement.correctAnswer) : null;
    const hasCorrectAnswer = correct !== null;
    const isCorrect = hasStudentAnswer && hasCorrectAnswer ? studentAnswer === correct : null;
    return {
      label: statement.label,
      text: statement.text,
      studentAnswer,
      correctAnswer: correct,
      isCorrect,
      earnedMarks: isCorrect ? roundMarks(perStatementMarks) : 0,
      totalMarks: roundMarks(perStatementMarks),
    };
  });
};

const optionBreakdown = (question, answer, canShowCorrectAnswers) => {
  const options = Array.isArray(question.options) ? question.options : [];
  const selected = answer?.selectedOption || null;
  return options.map((option) => {
    const isSelected = selected === option.label;
    const isCorrect = canShowCorrectAnswers ? Boolean(option.isCorrect) : null;
    return {
      label: option.label,
      text: option.text,
      isSelected,
      isCorrect,
      isCorrectOption: isCorrect,
      isWrongSelection: Boolean(canShowCorrectAnswers && isSelected && !option.isCorrect),
      isWrongSelected: Boolean(canShowCorrectAnswers && isSelected && !option.isCorrect),
    };
  });
};

exports.listSlots = asyncHandler(async (req, res) => {
  if (!req.user.organization) return res.json({ success: true, data: [] });
  const slots = await ExamSlot.find({ organization: req.user.organization, status: { $in: ['published','ongoing','completed'] } }).populate('createdBy', 'name').populate('assignedBatches', 'name batchCode').populate('service', 'name color icon').lean();
  const requests = await AccessRequest.find({ student: req.user._id }).lean(); const submissions = await Submission.find({ student: req.user._id }).select('examSlot submittedAt').lean();
  const requestBySlot = new Map(requests.map((x) => [String(x.examSlot), x.status])); const submissionBySlot = new Map(submissions.map((x) => [String(x.examSlot), x]));
  const now = new Date();
  const serverTime = now.toISOString();
  const data = await Promise.all(slots.map(async (slot) => {
    const submission = submissionBySlot.get(String(slot._id));
    const allowed = await access.hasAccess(slot, req.user._id);
    const temporalStatus = now < new Date(slot.startDateTime) ? 'Upcoming' : now > new Date(slot.endDateTime) ? 'Ended' : 'Ongoing';
    return {
      ...withComputedExamStatus(slot, now),
      serviceName: slot.service?.name || '',
      teacherName: slot.createdBy?.name || '',
      batchNames: (slot.assignedBatches || []).map((x) => x.name),
      serverTime,
      temporalStatus,
      submitted: Boolean(submission),
      submissionId: submission?._id,
      resultAvailable: Boolean(submission && resultVisible(slot)),
      accessStatus: submission ? 'Submitted' : allowed ? 'Assigned' : requestBySlot.get(String(slot._id)) === 'pending' ? 'Requested' : 'Locked',
    };
  }));
  res.json({ success: true, data });
});
exports.requestAccess = asyncHandler(async (req, res) => {
  const slot = await ExamSlot.findById(req.params.id); if (!slot || !['upcoming','ongoing'].includes(getComputedExamStatus(slot))) throw new AppError(404, 'Published exam not found');
  if (!req.user.organization || String(req.user.organization) !== String(slot.organization)) throw new AppError(403, 'Please join the organization first using organization code.');
  if (await access.hasAccess(slot, req.user._id)) throw new AppError(409, 'You already have access');
  const request = await AccessRequest.findOneAndUpdate({ examSlot: slot._id, student: req.user._id }, { $set: { status: 'pending', organization: slot.organization }, $unset: { reviewedBy: 1, reviewedAt: 1 } }, { upsert: true, new: true });
  res.status(201).json({ success: true, message: 'Access requested', data: request });
});
exports.getExam = asyncHandler(async (req, res) => {
  const slot = await ExamSlot.findById(req.params.id); if (!slot) throw new AppError(404, 'Exam not found');
  if (!(await access.hasAccess(slot, req.user._id))) throw new AppError(403, 'You do not have access to this exam');
  if (await Submission.exists({ examSlot: slot._id, student: req.user._id })) throw new AppError(409, 'This exam has already been submitted');
  const now = new Date(); if (getComputedExamStatus(slot, now) !== 'ongoing') throw new AppError(403, 'The exam is not active');
  const questions = await Question.find({ examSlot: slot._id }).sort({ questionNo: 1 }).lean();
  res.json({ success: true, data: { ...withComputedExamStatus(slot.toObject(), now), questions: questions.map(studentQuestion), serverTime: now.toISOString() } });
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
  const submissions = await Submission.find({ student: req.user._id })
    .populate('examSlot', 'title category startDateTime endDateTime totalMarks resultVisibilityMode resultPublished resultPublishedAt showCorrectAnswers showQuestionReview')
    .populate('service', 'name')
    .populate('batch', 'name batchCode')
    .sort({ submittedAt: -1 })
    .lean();
  const data = submissions.map((submission) => {
    if (!submission.examSlot) return null;
    const visible = resultVisible(submission.examSlot);
    return { _id: submission._id, examSlot: { _id: submission.examSlot._id, title: submission.examSlot.title, category: submission.examSlot.category, startDateTime: submission.examSlot.startDateTime, endDateTime: submission.examSlot.endDateTime }, service: submission.service, batch: submission.batch, submittedAt: submission.submittedAt, autoSubmitted: submission.autoSubmitted, resultAvailable: visible, status: visible ? (submission.status === 'reviewed' ? 'result_published' : 'pending_review') : 'submitted', totalMarks: submission.examSlot.totalMarks || 0, ...(visible && { mcqScore: submission.mcqScore, writtenScore: submission.writtenScore, totalScore: submission.totalScore, percentage: submission.percentage }) };
  }).filter(Boolean);
  res.json({ success: true, data });
});

exports.resultDetail = asyncHandler(async (req, res) => {
  const submission = await Submission.findOne({ _id: req.params.submissionId, student: req.user._id }).lean();
  if (!submission) throw new AppError(404, 'Result not found');
  const slot = await ExamSlot.findById(submission.examSlot).populate('service', 'name').populate('assignedBatches', 'name batchCode').lean();
  if (!slot) throw new AppError(404, 'The exam for this result no longer exists');
  if (!resultVisible(slot)) throw new AppError(403, 'Your result will be visible after the teacher publishes it');
  const questions = await Question.find({ examSlot: slot._id }).select('+answerGuideline').sort({ questionNo: 1 }).lean();
  const answerByQuestion = new Map(submission.answers.map((answer) => [String(answer.questionId), answer]));
  const canShowCorrectAnswers = resultVisible(slot);
  const canShowQuestionReview = resultVisible(slot) && slot.showQuestionReview === true;
  const questionBreakdown = questions.map((question) => {
    const answer = answerByQuestion.get(String(question._id));
    const earnedMarks = roundMarks(answer?.earnedMarks ?? answer?.awardedMarks ?? 0);
    const totalMarks = roundMarks(answer?.totalMarks ?? question.marks ?? 0);
    const pendingWritten = question.type === 'WRITTEN' && submission.status !== 'reviewed';
    const status = statusFor(question, answer, earnedMarks, totalMarks, pendingWritten);
    const isSkipped = status === 'skipped';
    const submittedAnswers = plainAnswers(answer?.answers);
    const item = {
      questionId: question._id,
      questionNo: question.questionNo,
      type: question.type,
      questionType: question.type,
      earnedMarks,
      totalMarks,
      marks: totalMarks,
      status,
      isCorrect: status === 'correct',
      isSkipped,
      notAnswered: isSkipped,
      options: question.type === 'SINGLE_BEST_ANSWER' ? optionBreakdown(question, answer, canShowCorrectAnswers) : [],
      statements: question.type === 'TRUE_FALSE_GROUP' ? statementBreakdown(question, answer, canShowCorrectAnswers) : [],
      studentAnswer: answer ? { answers: submittedAnswers, selectedOption: answer.selectedOption, writtenAnswer: answer.writtenAnswer } : null,
      correctAnswer: null,
      correctAnswers: null,
      explanation: canShowCorrectAnswers ? question.answerGuideline || '' : '',
      ...(question.type === 'TRUE_FALSE_GROUP' && { correctCount: answer?.correctCount || 0, totalStatements: answer?.totalStatements ?? (question.statements || []).length }),
    };
    if (canShowQuestionReview) {
      item.questionText = question.questionText;
      item.answer = answer ? { answers: submittedAnswers, selectedOption: answer.selectedOption, writtenAnswer: answer.writtenAnswer } : null;
    }
    if (canShowCorrectAnswers) {
      if (question.type === 'TRUE_FALSE_GROUP') {
        item.correctAnswers = Object.fromEntries((question.statements || []).map((x) => [x.label, x.correctAnswer]));
      }
      if (question.type === 'SINGLE_BEST_ANSWER') {
        item.correctOption = (question.options || []).find((x) => x.isCorrect)?.label;
        item.correctAnswer = item.correctOption || null;
      }
    }
    return item;
  });
  const rank = 1 + await Submission.countDocuments({ examSlot: slot._id, totalScore: { $gt: submission.totalScore }, $or: [{ resultPublished: true }, { status: 'reviewed' }] });
  const response = { _id: submission._id, examSlot: { _id: slot._id, title: slot.title, category: slot.category, startDateTime: slot.startDateTime, endDateTime: slot.endDateTime }, service: slot.service, batch: submission.batch ? await Batch.findById(submission.batch).select('name batchCode').lean() : null, submittedAt: submission.submittedAt, autoSubmitted: submission.autoSubmitted, mcqScore: submission.mcqScore, writtenScore: submission.writtenScore, totalScore: submission.totalScore, totalMarks: slot.totalMarks || questions.reduce((sum, question) => sum + Number(question.marks || 0), 0), percentage: submission.percentage, rank, reviewFeedback: submission.reviewFeedback, status: submission.status === 'reviewed' ? 'result_published' : 'pending_review', resultPublished: resultVisible(slot), showCorrectAnswers: canShowCorrectAnswers, showQuestionReview: canShowQuestionReview, questionBreakdown };
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
