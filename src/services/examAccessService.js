const AccessRequest = require('../models/AccessRequest');
const AppError = require('../utils/AppError');
exports.hasAccess = async (slot, userId) => slot.assignedStudents.some((id) => id.toString() === userId.toString()) || Boolean(await AccessRequest.exists({ examSlot: slot._id, student: userId, status: 'accepted' }));
exports.assertManage = (slot, user) => {
  if (!user.organization || slot.organization.toString() !== user.organization.toString()) throw new AppError(403, 'This exam belongs to another organization');
  if (user.role === 'teacher' && slot.createdBy.toString() !== user._id.toString()) throw new AppError(403, 'Teachers can only manage their own exams');
};
