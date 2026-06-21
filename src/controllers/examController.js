const ExamSlot = require('../models/ExamSlot');
const Question = require('../models/Question');
const Submission = require('../models/Submission');
const User = require('../models/User');
const asyncHandler = require('../utils/asyncHandler');
const AppError = require('../utils/AppError');
const permissions = require('../services/permissionService');
const access = require('../services/examAccessService');

const slotForManage = async (id, user) => { const slot = await ExamSlot.findById(id); if (!slot) throw new AppError(404, 'Exam slot not found'); access.assertManage(slot, user); return slot; };
const questionShape = (body, slot) => {
  const value = { examSlot: slot._id, organization: slot.organization, type: body.type, questionText: body.questionText, marks: body.marks, wordLimit: body.wordLimit, answerGuideline: body.answerGuideline, order: body.order };
  if (body.type === 'TRUE_FALSE_GROUP') {
    if (!Array.isArray(body.statements) || body.statements.length !== 5 || body.statements.some((x, i) => x.label !== 'ABCDE'[i] || typeof x.correctAnswer !== 'boolean')) throw new AppError(400, 'True/false questions require ordered A-E statements and answers');
    value.statements = body.statements;
  } else if (body.type === 'SINGLE_BEST_ANSWER') {
    if (!Array.isArray(body.options) || body.options.length !== 4 || body.options.filter((x) => x.isCorrect).length !== 1 || body.options.some((x, i) => x.label !== 'ABCD'[i])) throw new AppError(400, 'Single best answer requires ordered A-D options and exactly one correct answer');
    value.options = body.options;
  } else if (body.type !== 'WRITTEN') throw new AppError(400, 'Invalid question type');
  return value;
};
exports.createSlot = asyncHandler(async (req, res) => {
  await permissions.assertSlotLimit(req.user.organization);
  const start = new Date(req.body.startDateTime); const end = new Date(req.body.endDateTime);
  if (!(start < end)) throw new AppError(400, 'End time must be after start time');
  const slot = await ExamSlot.create({ ...req.body, startDateTime: start, endDateTime: end, organization: req.user.organization, createdBy: req.user._id, assignedStudents: [] });
  res.status(201).json({ success: true, message: 'Exam slot created', data: slot });
});
exports.listManaged = asyncHandler(async (req, res) => {
  const query = { organization: req.user.organization }; if (req.user.role === 'teacher') query.createdBy = req.user._id;
  res.json({ success: true, data: await ExamSlot.find(query).sort({ startDateTime: -1 }) });
});
exports.getManaged = asyncHandler(async (req, res) => { const slot = await slotForManage(req.params.id, req.user); const questions = await Question.find({ examSlot: slot._id }).sort({ order: 1 }); res.json({ success: true, data: { ...slot.toObject(), questions } }); });
exports.updateSlot = asyncHandler(async (req, res) => {
  const slot = await slotForManage(req.params.id, req.user);
  if (await Submission.exists({ examSlot: slot._id })) throw new AppError(409, 'This exam has submissions and can no longer be edited');
  const allowed = ['title','description','category','examType','startDateTime','endDateTime','durationMinutes','instructions','passingMarks','resultVisible','status'];
  allowed.forEach((key) => { if (req.body[key] !== undefined) slot[key] = req.body[key]; });
  if (!(new Date(slot.startDateTime) < new Date(slot.endDateTime))) throw new AppError(400, 'End time must be after start time');
  await slot.save(); res.json({ success: true, message: 'Exam updated', data: slot });
});
exports.deleteSlot = asyncHandler(async (req, res) => {
  const slot = await slotForManage(req.params.id, req.user);
  if (await Submission.exists({ examSlot: slot._id })) throw new AppError(409, 'This exam has submissions and cannot be deleted');
  await Question.deleteMany({ examSlot: slot._id }); await slot.deleteOne(); res.json({ success: true, message: 'Exam deleted' });
});
exports.addQuestion = asyncHandler(async (req, res) => {
  const slot = await slotForManage(req.params.id, req.user);
  if (await Submission.exists({ examSlot: slot._id })) throw new AppError(409, 'Questions cannot be edited after submissions exist');
  await permissions.assertQuestionLimit(slot.organization, slot._id, req.body.type);
  const question = await Question.create(questionShape(req.body, slot)); slot.totalMarks += Number(question.marks); await slot.save();
  res.status(201).json({ success: true, message: 'Question added', data: question });
});
exports.updateQuestion = asyncHandler(async (req, res) => {
  const question = await Question.findById(req.params.questionId); if (!question) throw new AppError(404, 'Question not found');
  const slot = await slotForManage(question.examSlot, req.user); if (await Submission.exists({ examSlot: slot._id })) throw new AppError(409, 'Questions cannot be edited after submissions exist');
  const oldMarks = question.marks; Object.assign(question, questionShape(req.body, slot)); await question.save(); slot.totalMarks += question.marks - oldMarks; await slot.save();
  res.json({ success: true, message: 'Question updated', data: question });
});
exports.deleteQuestion = asyncHandler(async (req, res) => {
  const question = await Question.findById(req.params.questionId); if (!question) throw new AppError(404, 'Question not found');
  const slot = await slotForManage(question.examSlot, req.user); if (await Submission.exists({ examSlot: slot._id })) throw new AppError(409, 'Questions cannot be edited after submissions exist');
  slot.totalMarks = Math.max(0, slot.totalMarks - question.marks); await slot.save(); await question.deleteOne(); res.json({ success: true, message: 'Question deleted' });
});
exports.assign = asyncHandler(async (req, res) => {
  const slot = await slotForManage(req.params.id, req.user); const emails = [...new Set(req.body.emails || [])].map((x) => String(x).toLowerCase());
  const students = await User.find({ email: { $in: emails }, role: 'student' }); if (students.length !== emails.length) throw new AppError(404, 'One or more student emails were not found');
  slot.assignedStudents = [...new Set([...slot.assignedStudents.map(String), ...students.map((x) => String(x._id))])]; await slot.save();
  res.json({ success: true, message: 'Students assigned', data: slot.assignedStudents });
});
exports.removeStudent = asyncHandler(async (req, res) => { const slot = await slotForManage(req.params.id, req.user); slot.assignedStudents.pull(req.body.studentId); await slot.save(); res.json({ success: true, message: 'Student removed' }); });
