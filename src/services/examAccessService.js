const AccessRequest = require('../models/AccessRequest');
const AppError = require('../utils/AppError');
const User = require('../models/User');

const ids = (items = []) => items.map((item) => String(item._id || item));
const intersects = (left = [], right = []) => {
  const rightSet = new Set(ids(right));
  return ids(left).some((item) => rightSet.has(item));
};

exports.teacherExamQuery = (user) => {
  if (user.role !== 'teacher') return {};
  const serviceIds = ids(user.assignedServices);
  const batchIds = ids(user.assignedBatches);
  const or = [{ createdBy: user._id }];
  if (serviceIds.length) or.push({ service: { $in: serviceIds } });
  if (batchIds.length) or.push({ assignedBatches: { $in: batchIds } });
  return { $or: or };
};

exports.assertTeacherAccepted = (user) => {
  if (user.role === 'teacher' && !user.organization) throw new AppError(403, 'Join an organization and wait for owner approval first');
};

exports.assertAssignedService = (user, serviceId) => {
  if (user.role !== 'teacher' || !serviceId) return;
  if (!ids(user.assignedServices).includes(String(serviceId))) throw new AppError(403, 'Teachers can only access assigned services');
};

exports.assertAssignedBatches = (user, batchIds = []) => {
  if (user.role !== 'teacher') return;
  const values = ids(batchIds);
  if (!values.length) return;
  const assigned = new Set(ids(user.assignedBatches));
  if (values.some((id) => !assigned.has(id))) throw new AppError(403, 'Teachers can only access assigned batches');
};

exports.hasAccess = async (slot, userId) => {
  if (slot.assignedStudents.some((id) => String(id._id || id) === String(userId))) return true;
  const user = await User.findById(userId).select('organization batches').lean();
  if (!user || String(user.organization || '') !== String(slot.organization)) return false;
  if (slot.accessScope === 'whole_organization') return true;
  if (slot.accessScope === 'selected_batches' && slot.assignedBatches.some((id) => (user.batches || []).some((batchId) => String(batchId) === String(id._id || id)))) return true;
  return Boolean(await AccessRequest.exists({ examSlot: slot._id, student: userId, status: 'accepted' }));
};
exports.assertManage = (slot, user) => {
  if (!user.organization || slot.organization.toString() !== user.organization.toString()) throw new AppError(403, 'This exam belongs to another organization');
  if (user.role === 'teacher') {
    const createdByTeacher = slot.createdBy.toString() === user._id.toString();
    const assignedService = slot.service && ids(user.assignedServices).includes(String(slot.service));
    const assignedBatch = intersects(slot.assignedBatches, user.assignedBatches);
    if (!createdByTeacher && !assignedService && !assignedBatch) throw new AppError(403, 'Teachers can only access assigned exams');
  }
};
