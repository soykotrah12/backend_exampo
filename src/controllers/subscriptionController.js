const Organization = require('../models/Organization');
const Plan = require('../models/Plan');
const PaymentRequest = require('../models/PaymentRequest');
const asyncHandler = require('../utils/asyncHandler');
const AppError = require('../utils/AppError');
const permissions = require('../services/permissionService');

const serializePlan = (plan) => {
  if (!plan) return null;
  const item = plan.toObject ? plan.toObject() : plan;
  const limits = item.limits || {};
  return {
    ...item,
    monthlyPrice: Number(item.priceMonthly || 0),
    yearlyPrice: Number(item.priceYearly || 0),
    teacherLimit: limits.teachersLimit ?? null,
    studentLimit: limits.studentsLimit ?? null,
    serviceLimit: limits.servicesLimit ?? null,
    batchLimit: limits.batchesLimit ?? null,
    examLimit: limits.examSlotsPerMonth ?? null,
  };
};

const amountFor = (plan, billingType) => {
  if (billingType === 'yearly') return Number(plan.priceYearly || 0);
  if (billingType === 'free') return 0;
  return Number(plan.priceMonthly || 0);
};

const ownerOrganization = async (user) => {
  if (!user.organization) throw new AppError(404, 'Organization not found');
  const organization = await Organization.findById(user.organization).populate('plan');
  if (!organization) throw new AppError(404, 'Organization not found');
  if (user.role !== 'organization_owner' || String(organization.owner) !== String(user._id)) throw new AppError(403, 'Only organization owners can manage subscriptions');
  return organization;
};

exports.plans = asyncHandler(async (_req, res) => {
  await permissions.ensureFreePlan();
  const plans = await Plan.find({ isActive: true, deletedAt: null }).sort({ sortOrder: 1, priceMonthly: 1 }).lean();
  res.json({ success: true, data: plans.map(serializePlan) });
});

exports.current = asyncHandler(async (req, res) => {
  const organization = await Organization.findById(req.user.organization).populate('plan');
  if (!organization) throw new AppError(404, 'Organization not found');
  const limits = await permissions.getLimits(req.user.organization);
  const usedTeachersCount = organization.teachers.length;
  const pendingUpgradeRequest = await PaymentRequest.findOne({
    organization: organization._id,
    status: 'pending',
  }).sort({ createdAt: -1 }).populate('plan').lean();
  res.json({
    success: true,
    data: {
      _id: organization._id,
      organization: organization._id,
      plan: serializePlan(organization.plan),
      planSnapshot: organization.planSnapshot,
      status: organization.subscriptionStatus,
      subscriptionStatus: organization.subscriptionStatus,
      startedAt: organization.subscriptionStartDate,
      endsAt: organization.subscriptionEndDate,
      subscriptionStartDate: organization.subscriptionStartDate,
      subscriptionEndDate: organization.subscriptionEndDate,
      subscriptionBillingCycle: organization.subscriptionBillingCycle,
      subscriptionAmount: organization.subscriptionAmount,
      pendingPlanChange: organization.pendingPlanChange,
      pendingUpgradeRequest: pendingUpgradeRequest ? {
        _id: pendingUpgradeRequest._id,
        planId: pendingUpgradeRequest.plan?._id || pendingUpgradeRequest.plan,
        plan: serializePlan(pendingUpgradeRequest.plan),
        billingType: pendingUpgradeRequest.billingCycle,
        amount: pendingUpgradeRequest.amount,
        status: pendingUpgradeRequest.status,
        createdAt: pendingUpgradeRequest.createdAt,
      } : null,
      limits,
      teacherLimit: limits.teachersLimit,
      studentLimit: limits.studentsLimit,
      usedTeachersCount,
      upgradeAvailable: req.user.role === 'organization_owner',
    },
  });
});

exports.upgradeRequest = asyncHandler(async (req, res) => {
  const organization = await ownerOrganization(req.user);
  const billingType = String(req.body.billingType || req.body.billingCycle || 'monthly').toLowerCase();
  const plan = await Plan.findOne({ _id: req.body.planId, isActive: true });
  if (!plan) throw new AppError(404, 'Plan not found');
  const existing = await PaymentRequest.findOne({
    organization: organization._id,
    status: 'pending',
  }).sort({ createdAt: -1 });
  if (existing) {
    return res.json({
      success: true,
      message: 'Your plan request is already pending admin approval.',
      data: existing,
    });
  }
  const request = await PaymentRequest.create({
    organization: organization._id,
    plan: plan._id,
    amount: amountFor(plan, billingType || plan.billingType),
    billingCycle: billingType || plan.billingType,
  });
  res.status(201).json({ success: true, message: 'Plan request submitted successfully', data: request });
});
