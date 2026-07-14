const Batch = require('../models/Batch');
const Organization = require('../models/Organization');
const ExamSlot = require('../models/ExamSlot');
const Question = require('../models/Question');
const Submission = require('../models/Submission');
const Service = require('../models/Service');
const asyncHandler = require('../utils/asyncHandler');
const AppError = require('../utils/AppError');
const { generateCode } = require('../utils/codeGenerator');
const access = require('../services/examAccessService');
const { withComputedExamStatus } = require('../utils/examStatus');

const ownerOnly = (user) => {
  if (user.role !== 'organization_owner') throw new AppError(403, 'Only organization owners can manage batches');
};

const managed = async (id, user) => {
  const batch = await Batch.findById(id);
  if (!batch) throw new AppError(404, 'Batch not found');
  if (!user.organization || String(batch.organization) !== String(user.organization)) throw new AppError(403, 'This batch belongs to another organization');
  access.assertAssignedBatches(user, [batch._id]);
  return batch;
};

exports.create = asyncHandler(async (req, res) => {
  ownerOnly(req.user);
  if (!req.user.organization) throw new AppError(400, 'Create or join an organization first');
  const name = String(req.body.name || '').trim();
  if (!name) throw new AppError(400, 'Batch name is required');
  let service;
  if (req.body.serviceId || req.body.service) {
    service = await Service.findOne({ _id: req.body.serviceId || req.body.service, organization: req.user.organization, isActive: true });
    if (!service) throw new AppError(404, 'Active service not found');
  }
  const batch = await Batch.create({ name, service: service?._id, batchCode: generateCode('BAT'), organization: req.user.organization, createdBy: req.user._id });
  await batch.populate('service', 'name color icon');
  res.status(201).json({ success: true, message: 'Batch created successfully', data: batch });
});

exports.list = asyncHandler(async (req, res) => {
  if (!req.user.organization) return res.json({ success: true, data: [] });
  const query = { organization: req.user.organization, ...(req.user.role === 'student' && { students: req.user._id, isActive: true }) };
  if (req.user.role === 'teacher') query._id = { $in: req.user.assignedBatches };
  const status = String(req.query.status || '').toLowerCase();
  if (status === 'running' || status === 'active') query.isActive = true;
  if (status === 'inactive') query.isActive = false;
  const batches = await Batch.find(query).populate('students', 'name email').populate('service', 'name color icon').sort({ isActive: -1, createdAt: -1 }).lean();
  const now = new Date();
  const data = await Promise.all(batches.map(async (batch) => {
    const examQuery = { organization: req.user.organization, assignedBatches: batch._id, ...access.teacherExamQuery(req.user) };
    const [examsCount, upcomingExamsCount] = await Promise.all([
      ExamSlot.countDocuments(examQuery),
      ExamSlot.countDocuments({ ...examQuery, startDateTime: { $gt: now }, status: { $nin: ['draft','cancelled','archived'] } }),
    ]);
    return { ...batch, serviceName: batch.service?.name || '', studentCount: batch.students.length, examsCount, upcomingExamsCount };
  }));
  res.json({ success: true, data });
});

exports.get = asyncHandler(async (req, res) => {
  const batch = await managed(req.params.id, req.user);
  await batch.populate('organization', 'name organizationCode');
  await batch.populate('service', 'name color icon');
  const value = batch.toObject();
  res.json({ success: true, message: 'Batch fetched successfully', data: { ...value, serviceName: value.service?.name || '', studentCount: batch.students.length } });
});
exports.update = asyncHandler(async (req, res) => {
  ownerOnly(req.user);
  const batch = await managed(req.params.id, req.user);
  if (req.body.name !== undefined) batch.name = String(req.body.name).trim();
  if (req.body.serviceId !== undefined || req.body.service !== undefined) {
    const serviceId = req.body.serviceId || req.body.service;
    if (!serviceId) batch.service = undefined;
    else {
      const service = await Service.findOne({ _id: serviceId, organization: req.user.organization, isActive: true });
      if (!service) throw new AppError(404, 'Active service not found');
      batch.service = service._id;
    }
  }
  if (req.body.isActive !== undefined) batch.isActive = Boolean(req.body.isActive);
  await batch.save();
  res.json({ success: true, message: 'Batch updated successfully', data: batch });
});
exports.remove = asyncHandler(async (req, res) => {
  ownerOnly(req.user);
  const batch = await managed(req.params.id, req.user);
  batch.isActive = false;
  await batch.save();
  res.json({ success: true, message: 'Batch deactivated successfully', data: batch });
});
exports.deactivate = asyncHandler(async (req, res) => {
  ownerOnly(req.user);
  const batch = await managed(req.params.id, req.user);
  batch.isActive = false;
  await batch.save();
  res.json({ success: true, message: 'Batch deactivated successfully', data: batch });
});

exports.examSlots = asyncHandler(async (req, res) => {
  const batch = await managed(req.params.id, req.user);
  const query = { organization: batch.organization, assignedBatches: batch._id, ...access.teacherExamQuery(req.user) };
  const status = String(req.query.status || 'all').toLowerCase();
  if (status === 'draft' || status === 'published') query.status = status;
  const now = new Date();
  if (status === 'upcoming') query.startDateTime = { $gt: now };
  if (status === 'ongoing') { query.startDateTime = { $lte: now }; query.endDateTime = { $gte: now }; }
  if (status === 'completed') query.endDateTime = { $lt: now };
  if (req.query.search) query.$or = [
    { title: { $regex: String(req.query.search), $options: 'i' } },
    { category: { $regex: String(req.query.search), $options: 'i' } },
  ];
  const slots = await ExamSlot.find(query)
    .select('title category mainCategory subCategory examType startDateTime endDateTime durationMinutes isAnytimeExam status assignedStudents assignedBatches service resultVisibilityMode resultPublished showCorrectAnswers showQuestionReview')
    .populate('assignedBatches', 'name batchCode')
    .populate('service', 'name color icon')
    .sort({ startDateTime: 1 })
    .lean();
  const data = await Promise.all(slots.map(async (slot) => {
    const [totalQuestions, submissionCount] = await Promise.all([
      Question.countDocuments({ examSlot: slot._id }),
      Submission.countDocuments({ examSlot: slot._id }),
    ]);
    return {
      ...withComputedExamStatus(slot, now),
      serviceName: slot.service?.name || '',
      batchNames: (slot.assignedBatches || []).map((item) => item.name),
      totalQuestions,
      assignedStudentsCount: (slot.assignedStudents || []).length,
      submissionCount,
    };
  }));
  res.json({ success: true, message: 'Exam slots fetched successfully', data });
});

exports.joinByCode = asyncHandler(async (req, res) => {
  const code = String(req.body.batchCode || '').trim().toUpperCase();
  if (!code) throw new AppError(400, 'Batch code is required');
  const batch = await Batch.findOne({ batchCode: code, isActive: true });
  if (!batch) throw new AppError(404, 'Active batch not found for this code');
  if (req.user.organization && String(req.user.organization) !== String(batch.organization)) throw new AppError(409, 'This batch belongs to another organization');
  const organization = await Organization.findOne({ _id: batch.organization, isActive: true });
  if (!organization) throw new AppError(404, 'The batch organization is inactive');
  req.user.organization = organization._id;
  req.user.joinedOrganizations.addToSet(organization._id);
  req.user.batches.addToSet(batch._id);
  batch.students.addToSet(req.user._id);
  organization.students.addToSet(req.user._id);
  await Promise.all([req.user.save(), batch.save(), organization.save()]);
  res.json({ success: true, message: 'Batch joined successfully', data: batch });
});

exports.leave = asyncHandler(async (req, res) => {
  const batch = await Batch.findOne({ _id: req.params.id, students: req.user._id });
  if (!batch) throw new AppError(404, 'You have not joined this batch');
  req.user.batches.pull(batch._id);
  batch.students.pull(req.user._id);
  await Promise.all([req.user.save(), batch.save()]);
  res.json({
    success: true,
    message: 'Left batch successfully',
    data: { batchId: batch._id },
  });
});
