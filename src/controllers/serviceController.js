const Service = require('../models/Service');
const Batch = require('../models/Batch');
const ExamSlot = require('../models/ExamSlot');
const Organization = require('../models/Organization');
const User = require('../models/User');
const asyncHandler = require('../utils/asyncHandler');
const AppError = require('../utils/AppError');
const access = require('../services/examAccessService');

const ownerOnly = (user) => {
  if (user.role !== 'organization_owner') throw new AppError(403, 'Only organization owners can manage services');
};

const managed = async (id, user) => {
  const service = await Service.findById(id);
  if (!service) throw new AppError(404, 'Service not found');
  if (!user.organization || String(service.organization) !== String(user.organization)) throw new AppError(403, 'This service belongs to another organization');
  access.assertAssignedService(user, service._id);
  return service;
};

const withStats = async (service) => {
  const raw = service.toObject ? service.toObject() : service;
  const batches = await Batch.find({ service: raw._id }).select('students assignedTeachers').lean();
  const studentIds = new Set();
  batches.forEach((batch) => (batch.students || []).forEach((student) => studentIds.add(String(student))));
  const totalExams = await ExamSlot.countDocuments({ service: raw._id });
  const assignedTeacherIds = new Set();
  batches.forEach((batch) => (batch.assignedTeachers || []).forEach((teacher) => assignedTeacherIds.add(String(teacher))));
  const teachers = await User.find({ role: 'teacher', assignedServices: raw._id, isActive: true }).select('name email').lean();
  teachers.forEach((teacher) => assignedTeacherIds.add(String(teacher._id)));
  return { ...raw, totalBatches: batches.length, totalStudents: studentIds.size, totalExams, assignedTeachersCount: assignedTeacherIds.size, teachers };
};

exports.create = asyncHandler(async (req, res) => {
  ownerOnly(req.user);
  if (!req.user.organization) throw new AppError(400, 'Create or join an organization first');
  const name = String(req.body.name || '').trim();
  if (!name) throw new AppError(400, 'Service name is required');
  const service = await Service.create({
    name,
    description: String(req.body.description || '').trim(),
    icon: req.body.icon || 'school',
    color: req.body.color || '#315A49',
    organization: req.user.organization,
    createdBy: req.user._id,
  });
  await Organization.updateOne({ _id: req.user.organization }, { $addToSet: { services: service._id } });
  res.status(201).json({ success: true, message: 'Service created successfully', data: await withStats(service) });
});

exports.list = asyncHandler(async (req, res) => {
  if (!req.user.organization) return res.json({ success: true, data: [] });
  const query = { organization: req.user.organization };
  if (req.user.role === 'teacher') query._id = { $in: req.user.assignedServices };
  if (String(req.query.status || '').toLowerCase() !== 'all') query.isActive = true;
  const services = await Service.find(query).sort({ isActive: -1, createdAt: -1 });
  res.json({ success: true, data: await Promise.all(services.map(withStats)) });
});

exports.get = asyncHandler(async (req, res) => {
  const service = await managed(req.params.id, req.user);
  const batchQuery = { service: service._id };
  if (req.user.role === 'teacher') batchQuery._id = { $in: req.user.assignedBatches || [] };
  const batches = await Batch.find(batchQuery).populate('students', 'name email').sort({ isActive: -1, createdAt: -1 }).lean();
  const exams = await ExamSlot.find({ service: service._id, ...access.teacherExamQuery(req.user) }).populate('assignedBatches', 'name batchCode').sort({ startDateTime: 1 }).lean();
  const now = new Date();
  const batchStats = new Map(batches.map((batch) => [String(batch._id), { examsCount: 0, upcomingExamsCount: 0 }]));
  exams.forEach((exam) => {
    (exam.assignedBatches || []).forEach((batch) => {
      const value = batchStats.get(String(batch._id || batch));
      if (!value) return;
      value.examsCount += 1;
      if (exam.startDateTime > now && ['draft','published'].includes(exam.status)) value.upcomingExamsCount += 1;
    });
  });
  const stats = await withStats(service);
  if (req.user.role === 'teacher') {
    stats.totalBatches = batches.length;
    stats.totalStudents = new Set(batches.flatMap((batch) => (batch.students || []).map((student) => String(student._id || student)))).size;
    stats.totalExams = exams.length;
  }
  res.json({
    success: true,
    message: 'Service details fetched successfully',
    data: {
      ...stats,
      batches: batches.map((batch) => ({ ...batch, studentCount: batch.students.length, ...(batchStats.get(String(batch._id)) || { examsCount: 0, upcomingExamsCount: 0 }) })),
      exams: exams.map((exam) => ({ ...exam, batchNames: (exam.assignedBatches || []).map((batch) => batch.name) })),
    },
  });
});

exports.update = asyncHandler(async (req, res) => {
  ownerOnly(req.user);
  const service = await managed(req.params.id, req.user);
  ['name', 'description', 'icon', 'color'].forEach((key) => {
    if (req.body[key] !== undefined) service[key] = String(req.body[key]).trim();
  });
  if (req.body.isActive !== undefined) service.isActive = Boolean(req.body.isActive);
  await service.save();
  res.json({ success: true, message: 'Service updated successfully', data: await withStats(service) });
});

exports.remove = asyncHandler(async (req, res) => {
  ownerOnly(req.user);
  const service = await managed(req.params.id, req.user);
  service.isActive = false;
  await service.save();
  res.json({ success: true, message: 'Service deactivated successfully', data: await withStats(service) });
});
