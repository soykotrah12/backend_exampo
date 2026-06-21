const Plan = require('../models/Plan');
const Organization = require('../models/Organization');
const User = require('../models/User');
const ExamSlot = require('../models/ExamSlot');
const Question = require('../models/Question');
const AppError = require('../utils/AppError');

const freeLimits = { teachersLimit: 1, studentsLimit: 20, examSlotsPerMonth: 3, questionsPerExam: 20, writtenQuestionsPerExam: 5, analyticsEnabled: false, exportEnabled: false, brandingEnabled: false, questionBankEnabled: false };
exports.ensureFreePlan = () => Plan.findOneAndUpdate({ code: 'FREE' }, { $setOnInsert: { name: 'Free', code: 'FREE', priceMonthly: 0, priceYearly: 0, limits: freeLimits } }, { upsert: true, new: true });
exports.getLimits = async (organizationId) => {
  const organization = await Organization.findById(organizationId).populate('plan');
  if (!organization) throw new AppError(404, 'Organization not found');
  const base = organization.plan?.limits?.toObject?.() || freeLimits;
  if (!organization.permissionOverrides?.enabled) return base;
  const overrides = organization.permissionOverrides.toObject();
  return Object.fromEntries(Object.keys(freeLimits).map((key) => [key, overrides[key] ?? base[key]]));
};
const limitError = () => new AppError(403, 'You have reached your current plan limit. Please upgrade your plan.');
exports.assertUserLimit = async (organizationId, role) => {
  const limits = await exports.getLimits(organizationId);
  const key = role === 'teacher' ? 'teachersLimit' : 'studentsLimit';
  const count = await User.countDocuments({ organization: organizationId, role, isActive: true });
  if (count >= limits[key]) throw limitError();
};
exports.assertSlotLimit = async (organizationId) => {
  const limits = await exports.getLimits(organizationId);
  const start = new Date(); start.setUTCDate(1); start.setUTCHours(0, 0, 0, 0);
  if (await ExamSlot.countDocuments({ organization: organizationId, createdAt: { $gte: start } }) >= limits.examSlotsPerMonth) throw limitError();
};
exports.assertQuestionLimit = async (organizationId, examSlotId, type) => {
  const limits = await exports.getLimits(organizationId);
  const total = await Question.countDocuments({ examSlot: examSlotId });
  const written = type === 'WRITTEN' ? await Question.countDocuments({ examSlot: examSlotId, type: 'WRITTEN' }) : 0;
  if (total >= limits.questionsPerExam || (type === 'WRITTEN' && written >= limits.writtenQuestionsPerExam)) throw limitError();
};
