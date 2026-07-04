const Plan = require('../models/Plan');
const Organization = require('../models/Organization');
const User = require('../models/User');
const ExamSlot = require('../models/ExamSlot');
const Question = require('../models/Question');
const AppError = require('../utils/AppError');

const freeLimits = { teachersLimit: 2, studentsLimit: 20, examSlotsPerMonth: 3, questionsPerExam: 20, writtenQuestionsPerExam: 5, analyticsEnabled: false, exportEnabled: false, brandingEnabled: false, questionBankEnabled: false };
exports.ensureFreePlan = () => Plan.findOneAndUpdate({ code: 'FREE' }, { $setOnInsert: { name: 'Free', code: 'FREE', priceMonthly: 0, priceYearly: 0, limits: freeLimits } }, { upsert: true, new: true });
exports.getLimits = async (organizationId) => {
  const organization = await Organization.findById(organizationId).populate('plan');
  if (!organization) throw new AppError(404, 'Organization not found');
  const base = organization.plan?.limits?.toObject?.() || freeLimits;
  if (!organization.permissionOverrides?.enabled) return base;
  const overrides = organization.permissionOverrides.toObject();
  return Object.fromEntries(Object.keys(freeLimits).map((key) => [key, overrides[key] ?? base[key]]));
};
const limitError = (message = 'You have reached your current plan limit. Please upgrade your plan.') => new AppError(403, message);
exports.assertUserLimit = async (organizationId, role) => {
  if (!organizationId) throw new AppError(400, 'Create or join an organization first');
  if (role !== 'teacher') return true;
  const limits = await exports.getLimits(organizationId);
  const organization = await Organization.findById(organizationId).select('teachers');
  if (!organization) throw new AppError(404, 'Organization not found');
  const used = organization.teachers.length || await User.countDocuments({ organization: organizationId, role: 'teacher', isActive: true });
  if (used >= limits.teachersLimit) throw limitError('Free plan allows up to 2 teachers. Please upgrade your plan to add more teachers.');
  return true;
};
exports.assertSlotLimit = async (organizationId) => {
  return Boolean(organizationId);
};
exports.assertQuestionLimit = async (organizationId, examSlotId, type) => {
  return Boolean(organizationId && examSlotId && type);
};
exports.assertQuestionCapacity = async (organizationId, examSlotId, incomingCount, incomingWritten = 0) => {
  return Boolean(organizationId && examSlotId && incomingCount >= 0 && incomingWritten >= 0);
};
