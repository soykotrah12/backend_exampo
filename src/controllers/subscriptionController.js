const Organization = require('../models/Organization');
const Plan = require('../models/Plan');
const PaymentRequest = require('../models/PaymentRequest');
const asyncHandler = require('../utils/asyncHandler');
const AppError = require('../utils/AppError');
const permissions = require('../services/permissionService');

const ownerOrganization = async (user) => {
  if (!user.organization) throw new AppError(404, 'Organization not found');
  const organization = await Organization.findById(user.organization).populate('plan');
  if (!organization) throw new AppError(404, 'Organization not found');
  if (user.role !== 'organization_owner' || String(organization.owner) !== String(user._id)) throw new AppError(403, 'Only organization owners can manage subscriptions');
  return organization;
};

exports.plans = asyncHandler(async (_req, res) => {
  await permissions.ensureFreePlan();
  const plans = await Plan.find({ isActive: true }).sort({ priceMonthly: 1 }).lean();
  res.json({ success: true, data: plans });
});

exports.current = asyncHandler(async (req, res) => {
  const organization = await Organization.findById(req.user.organization).populate('plan');
  if (!organization) throw new AppError(404, 'Organization not found');
  const limits = await permissions.getLimits(req.user.organization);
  const usedTeachersCount = organization.teachers.length;
  res.json({
    success: true,
    data: {
      plan: organization.plan,
      subscriptionStatus: organization.subscriptionStatus,
      limits,
      teacherLimit: limits.teachersLimit,
      usedTeachersCount,
      upgradeAvailable: req.user.role === 'organization_owner',
    },
  });
});

exports.upgradeRequest = asyncHandler(async (req, res) => {
  const organization = await ownerOrganization(req.user);
  const plan = await Plan.findOne({ _id: req.body.planId, isActive: true });
  if (!plan) throw new AppError(404, 'Plan not found');
  const request = await PaymentRequest.create({ organization: organization._id, plan: plan._id, amount: plan.priceMonthly });
  res.status(201).json({ success: true, message: 'Upgrade request submitted', data: request });
});
