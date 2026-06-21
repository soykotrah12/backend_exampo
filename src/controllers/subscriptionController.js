const Organization = require('../models/Organization');
const asyncHandler = require('../utils/asyncHandler');
const permissions = require('../services/permissionService');
exports.current = asyncHandler(async (req, res) => { const organization = await Organization.findById(req.user.organization).populate('plan'); const limits = await permissions.getLimits(req.user.organization); res.json({ success: true, data: { plan: organization.plan, subscriptionStatus: organization.subscriptionStatus, limits } }); });
