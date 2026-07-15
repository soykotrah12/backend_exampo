const User = require('../models/User');
const Organization = require('../models/Organization');
const Service = require('../models/Service');
const Batch = require('../models/Batch');
const ExamSlot = require('../models/ExamSlot');
const AccessRequest = require('../models/AccessRequest');
const TeacherJoinRequest = require('../models/TeacherJoinRequest');
const AppError = require('../utils/AppError');

const RESTORE_WINDOW_DAYS = Number(process.env.ACCOUNT_RESTORE_DAYS || 30);
const SUPPORT_DELETE_MESSAGE = 'This organization account cannot be deleted automatically. Please contact support.';

const restoreWindowMs = () => RESTORE_WINDOW_DAYS * 24 * 60 * 60 * 1000;

const restoreExpiresAtFor = (deletedAt = new Date()) =>
  new Date(new Date(deletedAt).getTime() + restoreWindowMs());

const daysRemainingFor = (expiresAt) => {
  if (!expiresAt) return 0;
  const remaining = new Date(expiresAt).getTime() - Date.now();
  return Math.max(Math.ceil(remaining / (24 * 60 * 60 * 1000)), 0);
};

const canRestoreDeletedUser = (user) =>
  Boolean(user?.isDeleted === true && user.deleteRestoreExpiresAt && new Date(user.deleteRestoreExpiresAt).getTime() > Date.now());

const deletedAccountData = (user, extra = {}) => ({
  canRestore: canRestoreDeletedUser(user),
  email: user.email,
  deleteRestoreExpiresAt: user.deleteRestoreExpiresAt,
  daysRemaining: daysRemainingFor(user.deleteRestoreExpiresAt),
  ...extra,
});

const organizationDeleteBlockers = async (user) => {
  if (user.role !== 'organization_owner' || !user.organization) return [];
  const organization = await Organization.findOne({ _id: user.organization, owner: user._id });
  if (!organization) return [];
  const [members, services, batches, exams] = await Promise.all([
    User.countDocuments({
      _id: { $ne: user._id },
      organization: organization._id,
      role: { $in: ['teacher', 'student'] },
      isActive: true,
      isDeleted: { $ne: true },
    }),
    Service.countDocuments({ organization: organization._id, isActive: true }),
    Batch.countDocuments({ organization: organization._id, isActive: true }),
    ExamSlot.countDocuments({
      organization: organization._id,
      status: { $nin: ['cancelled', 'archived'] },
    }),
  ]);
  const blockers = [];
  if (members > 0) blockers.push('active teachers or students');
  if (services > 0) blockers.push('active services');
  if (batches > 0) blockers.push('active batches');
  if (exams > 0) blockers.push('active exams');
  return blockers;
};

const assertCanDeleteAccount = async (user) => {
  if (user.role !== 'organization_owner') return;
  const blockers = await organizationDeleteBlockers(user);
  if (blockers.length) throw new AppError(409, SUPPORT_DELETE_MESSAGE, { blockers });
};

const setOwnedOrganizationActive = async (user, isActive) => {
  if (user.role !== 'organization_owner' || !user.organization) return;
  await Organization.updateOne(
    { _id: user.organization, owner: user._id },
    { isActive: Boolean(isActive) },
  );
};

const softDeleteAccount = async (user) => {
  await assertCanDeleteAccount(user);
  const deletedAt = new Date();
  user.isDeleted = true;
  user.isActive = false;
  user.deletedAt = deletedAt;
  user.deleteRestoreExpiresAt = restoreExpiresAtFor(deletedAt);
  user.accountStatus = 'deleted';
  user.deleteAccountOtpHash = '';
  user.deleteAccountOtpExpiresAt = null;
  user.deleteAccountOtpAttempts = 0;
  user.deleteAccountOtpRequestedAt = null;
  user.restoreAccountOtpHash = '';
  user.restoreAccountOtpExpiresAt = null;
  user.restoreAccountOtpAttempts = 0;
  user.lastRestoreOtpSentAt = null;
  user.tokenVersion = Number(user.tokenVersion || 0) + 1;
  await Promise.all([user.save(), setOwnedOrganizationActive(user, false)]);
};

const restoreAccount = async (user) => {
  user.isDeleted = false;
  user.isActive = true;
  user.deletedAt = null;
  user.deleteRestoreExpiresAt = null;
  user.accountStatus = 'active';
  user.deleteAccountOtpHash = '';
  user.deleteAccountOtpExpiresAt = null;
  user.deleteAccountOtpAttempts = 0;
  user.deleteAccountOtpRequestedAt = null;
  user.restoreAccountOtpHash = '';
  user.restoreAccountOtpExpiresAt = null;
  user.restoreAccountOtpAttempts = 0;
  user.lastRestoreOtpSentAt = null;
  user.tokenVersion = Number(user.tokenVersion || 0) + 1;
  await Promise.all([user.save(), setOwnedOrganizationActive(user, true)]);
};

const permanentlyDeleteSoftDeletedAccount = async (user) => {
  if (!user || user.isDeleted !== true) throw new AppError(400, 'Deleted account not found');
  await assertCanDeleteAccount(user);
  const organizationId = user.organization;
  await Promise.all([
    Organization.updateMany({}, { $pull: { teachers: user._id, students: user._id } }),
    Batch.updateMany({}, { $pull: { students: user._id, assignedTeachers: user._id } }),
    ExamSlot.updateMany({}, { $pull: { assignedStudents: user._id } }),
    AccessRequest.deleteMany({ student: user._id }),
    TeacherJoinRequest.deleteMany({ teacher: user._id }),
  ]);
  if (user.role === 'organization_owner' && organizationId) {
    await Organization.deleteOne({ _id: organizationId, owner: user._id });
  }
  await User.deleteOne({ _id: user._id, isDeleted: true });
};

module.exports = {
  RESTORE_WINDOW_DAYS,
  SUPPORT_DELETE_MESSAGE,
  canRestoreDeletedUser,
  daysRemainingFor,
  deletedAccountData,
  assertCanDeleteAccount,
  softDeleteAccount,
  restoreAccount,
  permanentlyDeleteSoftDeletedAccount,
};
