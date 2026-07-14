const ExamSlot = require('../models/ExamSlot');
const Question = require('../models/Question');
const Submission = require('../models/Submission');
const User = require('../models/User');
const Organization = require('../models/Organization');
const Service = require('../models/Service');
const Batch = require('../models/Batch');
const asyncHandler = require('../utils/asyncHandler');
const AppError = require('../utils/AppError');
const permissions = require('../services/permissionService');
const access = require('../services/examAccessService');
const csvImport = require('../services/csvImportService');
const { withComputedExamStatus } = require('../utils/examStatus');
const assertQuestionEditable = async (slot) => {
  if (await Submission.exists({ examSlot: slot._id })) throw new AppError(409, 'This question cannot be edited because students have already submitted answers.');
  if (new Date() >= slot.startDateTime) throw new AppError(409, 'Questions cannot be changed after the exam starts');
};

const categoryMain = (category) => {
  if (['Nursing Licensing Exam','BSc Nursing Exam','Diploma Nursing Exam','MBBS','Pharmacy','Medical Assistant','Custom Medical Exam'].includes(category)) return 'Medical';
  if (['University Exam','Admission Test','Semester Exam','Department Exam','Final Exam','Custom University Exam'].includes(category)) return 'University';
  if (['School Exam','College Exam','SSC','HSC','Class Test','Model Test','Board Exam','Custom School/College Exam'].includes(category)) return 'School/College';
  return category ? 'Custom' : '';
};
const normalizeCategories = (body) => {
  const value = { ...body };
  if (value.subCategory) value.category = value.subCategory;
  if (!value.subCategory && value.category) value.subCategory = value.category;
  if (!value.mainCategory && value.category) value.mainCategory = categoryMain(value.category);
  return value;
};

const slotForManage = async (id, user) => { const slot = await ExamSlot.findById(id); if (!slot) throw new AppError(404, 'Exam slot not found'); access.assertManage(slot, user); return slot; };
const questionShape = (body, slot) => {
  const value = { examSlot: slot._id, organization: slot.organization, questionNo: Number(body.questionNo), type: body.type, questionText: String(body.questionText).trim(), marks: body.marks, wordLimit: body.wordLimit, answerGuideline: body.answerGuideline, order: body.questionNo ?? body.order };
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
  access.assertTeacherAccepted(req.user);
  await permissions.assertSlotLimit(req.user.organization);
  const start = new Date(req.body.startDateTime); const duration = Number(req.body.durationMinutes);
  if (Number.isNaN(start.getTime())) throw new AppError(400, 'Start date and time must be valid');
  if (!Number.isFinite(duration) || duration <= 0) throw new AppError(400, 'Duration must be a positive number of minutes');
  let service;
  if (req.body.serviceId || req.body.service) {
    service = await Service.findOne({ _id: req.body.serviceId || req.body.service, organization: req.user.organization, isActive: true });
    if (!service) throw new AppError(404, 'Active service not found');
    access.assertAssignedService(req.user, service._id);
  }
  const end = new Date(start.getTime() + duration * 60 * 1000);
  const normalized = normalizeCategories(req.body);
  const slot = await ExamSlot.create({ ...normalized, service: service?._id, startDateTime: start, endDateTime: end, durationMinutes: duration, organization: req.user.organization, createdBy: req.user._id, assignedStudents: [], assignedBatches: [] });
  res.status(201).json({ success: true, message: 'Exam slot created', data: withComputedExamStatus(slot.toObject()) });
});
exports.listManaged = asyncHandler(async (req, res) => {
  access.assertTeacherAccepted(req.user);
  const query = { organization: req.user.organization, ...access.teacherExamQuery(req.user) };
  const slots = await ExamSlot.find(query).populate('assignedBatches', 'name batchCode').populate('service', 'name color icon').sort({ startDateTime: -1 }).lean();
  const now = new Date();
  const data = await Promise.all(slots.map(async (slot) => ({ ...withComputedExamStatus(slot, now), serviceName: slot.service?.name || '', batchNames: (slot.assignedBatches || []).map((x) => x.name), totalQuestions: await Question.countDocuments({ examSlot: slot._id }), assignedStudentsCount: slot.assignedStudents.length, submissionCount: await Submission.countDocuments({ examSlot: slot._id }) })));
  res.json({ success: true, data });
});
exports.accessOptions = asyncHandler(async (req, res) => {
  access.assertTeacherAccepted(req.user);
  if (!req.user.organization) {
    return res.json({
      success: true,
      message: 'Access options fetched successfully',
      data: { batches: [], students: [] },
    });
  }
  const batchQuery = { organization: req.user.organization, isActive: true };
  if (req.user.role === 'teacher') batchQuery._id = { $in: req.user.assignedBatches || [] };
  const batches = await Batch.find(batchQuery)
    .select('name batchCode service students isActive')
    .populate('service', 'name')
    .sort({ name: 1 })
    .lean();
  const studentQuery = { organization: req.user.organization, role: 'student', isActive: true };
  if (req.user.role === 'teacher') studentQuery.batches = { $in: batches.map((batch) => batch._id) };
  const students = await User.find(studentQuery)
    .select('name email batches')
    .sort({ name: 1 })
    .lean();
  res.json({
    success: true,
    message: 'Access options fetched successfully',
    data: {
      batches: batches.map((batch) => ({ ...batch, serviceName: batch.service?.name || '', studentCount: (batch.students || []).length })),
      students,
    },
  });
});
exports.getManaged = asyncHandler(async (req, res) => { const slot = await slotForManage(req.params.id, req.user); const [questions, submissionCount] = await Promise.all([Question.find({ examSlot: slot._id }).sort({ order: 1 }), Submission.countDocuments({ examSlot: slot._id })]); res.json({ success: true, data: { ...withComputedExamStatus(slot.toObject()), questions, submissionCount, totalQuestions: questions.length } }); });
exports.listQuestions = asyncHandler(async (req, res) => { const slot = await slotForManage(req.params.id, req.user); res.json({ success: true, data: await Question.find({ examSlot: slot._id }).select('+answerGuideline').sort({ questionNo: 1 }) }); });
exports.getQuestion = asyncHandler(async (req, res) => { const question = await Question.findById(req.params.questionId).select('+answerGuideline'); if (!question) throw new AppError(404, 'Question not found'); await slotForManage(question.examSlot, req.user); res.json({ success: true, data: question }); });
exports.updateSlot = asyncHandler(async (req, res) => {
  const slot = await slotForManage(req.params.id, req.user);
  if (await Submission.exists({ examSlot: slot._id })) throw new AppError(409, 'This exam has submissions and can no longer be edited');
  const body = normalizeCategories(req.body);
  if (body.accessScope && !['selected_students','selected_batches','whole_organization'].includes(body.accessScope)) throw new AppError(400, 'Invalid access scope');
  if (req.user.role === 'teacher' && body.accessScope === 'whole_organization') throw new AppError(403, 'Teachers can assign exams only to selected students or assigned batches');
  if (body.assignedStudents !== undefined) {
    const studentIds = [...new Set(body.assignedStudents || [])];
    const count = await User.countDocuments({ _id: { $in: studentIds }, role: 'student', organization: slot.organization });
    if (count !== studentIds.length) throw new AppError(403, 'Every assigned student must belong to your organization');
    body.assignedStudents = studentIds;
  }
  if (body.assignedBatches !== undefined) {
    const batchIds = [...new Set(body.assignedBatches || [])];
    const count = await Batch.countDocuments({ _id: { $in: batchIds }, organization: slot.organization, isActive: true });
    if (count !== batchIds.length) throw new AppError(403, 'Every assigned batch must belong to your organization');
    body.assignedBatches = batchIds;
  }
  const allowed = ['title','description','category','mainCategory','subCategory','examType','startDateTime','durationMinutes','isAnytimeExam','instructions','passingMarks','status','resultVisibilityMode','showCorrectAnswers','showQuestionReview','accessScope','assignedStudents','assignedBatches','service'];
  allowed.forEach((key) => { if (body[key] !== undefined) slot[key] = body[key]; });
  if (req.body.serviceId !== undefined) slot.service = req.body.serviceId || undefined;
  if (slot.service && !(await Service.exists({ _id: slot.service, organization: slot.organization, isActive: true }))) throw new AppError(404, 'Active service not found');
  access.assertAssignedService(req.user, slot.service);
  access.assertAssignedBatches(req.user, slot.assignedBatches);
  const start = new Date(slot.startDateTime); const duration = Number(slot.durationMinutes);
  if (Number.isNaN(start.getTime()) || !Number.isFinite(duration) || duration <= 0) throw new AppError(400, 'Start time and positive duration are required');
  slot.endDateTime = new Date(start.getTime() + duration * 60 * 1000);
  await slot.save(); res.json({ success: true, message: 'Exam slot updated successfully', data: withComputedExamStatus(slot.toObject()) });
});
exports.deleteSlot = asyncHandler(async (req, res) => {
  const slot = await slotForManage(req.params.id, req.user);
  if (await Submission.exists({ examSlot: slot._id })) throw new AppError(409, 'This exam has submissions and cannot be deleted');
  await Question.deleteMany({ examSlot: slot._id }); await slot.deleteOne(); res.json({ success: true, message: 'Exam deleted' });
});
exports.addQuestion = asyncHandler(async (req, res) => {
  const slot = await slotForManage(req.params.id, req.user);
  await assertQuestionEditable(slot);
  await permissions.assertQuestionLimit(slot.organization, slot._id, req.body.type);
  const last = await Question.findOne({ examSlot: slot._id }).sort({ questionNo: -1 }).select('questionNo');
  const body = { ...req.body, questionNo: req.body.questionNo ?? ((last?.questionNo || 0) + 1) };
  const question = await Question.create(questionShape(body, slot)); slot.totalMarks += Number(question.marks); await slot.save();
  res.status(201).json({ success: true, message: 'Question added', data: question });
});
exports.updateQuestion = asyncHandler(async (req, res) => {
  const question = await Question.findById(req.params.questionId); if (!question) throw new AppError(404, 'Question not found');
  const slot = await slotForManage(question.examSlot, req.user); await assertQuestionEditable(slot);
  const oldMarks = question.marks; Object.assign(question, questionShape({ ...req.body, questionNo: req.body.questionNo ?? question.questionNo }, slot)); await question.save(); slot.totalMarks += question.marks - oldMarks; await slot.save();
  res.json({ success: true, message: 'Question updated', data: question });
});
exports.deleteQuestion = asyncHandler(async (req, res) => {
  const question = await Question.findById(req.params.questionId); if (!question) throw new AppError(404, 'Question not found');
  const slot = await slotForManage(question.examSlot, req.user); await assertQuestionEditable(slot);
  slot.totalMarks = Math.max(0, slot.totalMarks - question.marks); await slot.save(); await question.deleteOne(); res.json({ success: true, message: 'Question deleted' });
});
exports.assign = asyncHandler(async (req, res) => {
  const slot = await slotForManage(req.params.id, req.user);
  const scope = req.body.accessScope || 'selected_students';
  if (!['selected_students','selected_batches','whole_organization'].includes(scope)) throw new AppError(400, 'Invalid access scope');
  if (req.user.role === 'teacher' && scope === 'whole_organization') throw new AppError(403, 'Teachers can assign exams only to selected students or assigned batches');
  const emails = [...new Set(req.body.emails || [])].map((x) => String(x).toLowerCase());
  const ids = [...new Set(req.body.studentIds || [])];
  const students = await User.find({ role: 'student', organization: slot.organization, $or: [{ email: { $in: emails } }, { _id: { $in: ids } }] });
  if (scope === 'selected_students' && students.length !== new Set([...emails, ...ids]).size) throw new AppError(403, 'Every assigned student must belong to your organization');
  const batchIds = [...new Set(req.body.batchIds || [])];
  const batches = scope === 'selected_batches' ? await Batch.find({ _id: { $in: batchIds }, organization: slot.organization, isActive: true }).select('service') : [];
  if (scope === 'selected_batches' && batches.length !== batchIds.length) throw new AppError(403, 'Every assigned batch must belong to your organization');
  access.assertAssignedBatches(req.user, batchIds);
  slot.accessScope = scope;
  slot.assignedStudents = scope === 'selected_students' ? students.map((x) => x._id) : [];
  slot.assignedBatches = scope === 'selected_batches' ? batchIds : [];
  if (scope === 'selected_batches' && !slot.service) {
    const serviceIds = [...new Set(batches.map((batch) => batch.service).filter(Boolean).map(String))];
    if (serviceIds.length === 1) slot.service = serviceIds[0];
  }
  access.assertAssignedService(req.user, slot.service);
  await slot.save();
  res.json({ success: true, message: 'Exam access updated', data: withComputedExamStatus(slot.toObject()) });
});
exports.removeStudent = asyncHandler(async (req, res) => { const slot = await slotForManage(req.params.id, req.user); slot.assignedStudents.pull(req.body.studentId); await slot.save(); res.json({ success: true, message: 'Student removed' }); });

exports.importQuestions = (kind) => asyncHandler(async (req, res) => {
  const slot = await slotForManage(req.params.id, req.user);
  if (!(await Organization.exists({ _id: slot.organization, isActive: true }))) throw new AppError(403, 'Organization is inactive');
  await assertQuestionEditable(slot);
  if (!req.file) throw new AppError(400, 'Select a CSV file to upload');
  const parsed = csvImport.parseQuestions(req.file.buffer, kind);
  const existing = await Question.find({ examSlot: slot._id, questionNo: { $in: parsed.questions.map((q) => q.questionNo) } }).select('questionNo').lean();
  for (const item of existing) parsed.errors.push({ row: 0, message: `question_no ${item.questionNo} already exists in this exam` });
  if (parsed.errors.length) return res.status(400).json({ success: false, message: 'CSV validation failed', data: { totalRows: parsed.totalRows, importedCount: 0, failedCount: parsed.errors.length, errors: parsed.errors } });
  await permissions.assertQuestionCapacity(slot.organization, slot._id, parsed.questions.length);
  const documents = parsed.questions.map((question) => ({ ...question, examSlot: slot._id, organization: slot.organization }));
  await Question.insertMany(documents, { ordered: true });
  slot.totalMarks += documents.reduce((sum, question) => sum + question.marks, 0); await slot.save();
  res.status(201).json({ success: true, message: 'CSV imported successfully', data: { totalRows: parsed.totalRows, importedCount: documents.length, failedCount: 0, errors: [] } });
});
exports.sampleCsv = (kind) => (_req, res) => { res.type('text/csv').send(csvImport.samples[kind]); };
exports.publishResults = asyncHandler(async (req, res) => {
  const slot = await slotForManage(req.params.id, req.user);
  if (!slot.isAnytimeExam && new Date() < slot.endDateTime) throw new AppError(409, 'Results can be published after the exam ends');
  slot.resultPublished = true; slot.resultPublishedAt = new Date(); await slot.save();
  const filter = { examSlot: slot._id };
  if (slot.isAnytimeExam && req.body.submissionId) filter._id = req.body.submissionId;
  await Submission.updateMany(filter, { $set: { resultPublished: true } });
  res.json({ success: true, message: 'Results published', data: { resultPublished: true, resultPublishedAt: slot.resultPublishedAt } });
});
