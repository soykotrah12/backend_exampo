const mongoose = require('mongoose');
const bcrypt = require('bcrypt');

const schema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, maxlength: 100 },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  password: {
    type: String,
    required() { return (this.authProvider || 'local') === 'local'; },
    select: false,
    minlength: 8,
  },
  firebaseUid: { type: String, unique: true, sparse: true, trim: true },
  authProvider: { type: String, enum: ['local', 'google', 'facebook'], default: 'local' },
  role: { type: String, enum: ['organization_owner', 'teacher', 'student', 'super_admin'], required: true },
  organization: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', default: null },
  joinedOrganizations: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Organization' }],
  batches: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Batch' }],
  teacherJoinStatus: { type: String, enum: ['none', 'pending', 'accepted', 'rejected'], default: 'none' },
  organizationAccessStatus: { type: String, enum: ['active', 'paused', 'removed'], default: 'active' },
  pausedUntil: { type: Date, default: null },
  pausedReason: { type: String, default: '', maxlength: 500 },
  removedAt: { type: Date, default: null },
  assignedServices: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Service' }],
  assignedBatches: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Batch' }],
  phone: { type: String, default: '', trim: true, maxlength: 50 },
  contactNumber: { type: String, default: '', trim: true, maxlength: 50 },
  address: { type: String, default: '', trim: true, maxlength: 250 },
  bio: { type: String, default: '', maxlength: 500 },
  location: { type: String, default: '', maxlength: 150 },
  avatarUrl: { type: String, default: '' },
  invitedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  isEmailVerified: { type: Boolean, default: false },
  emailVerificationStartedAt: { type: Date, default: null },
  emailOtpHash: { type: String, default: '', select: false },
  emailOtpExpiresAt: { type: Date, default: null },
  emailOtpAttempts: { type: Number, default: 0 },
  lastOtpSentAt: { type: Date, default: null },
  passwordResetOtpHash: { type: String, default: '', select: false },
  passwordResetOtpExpiresAt: { type: Date, default: null },
  passwordResetOtpAttempts: { type: Number, default: 0 },
  passwordResetLastOtpSentAt: { type: Date, default: null },
  passwordResetTokenHash: { type: String, default: '', select: false },
  passwordResetTokenExpiresAt: { type: Date, default: null },
  isActive: { type: Boolean, default: true },
  isDeleted: { type: Boolean, default: false, index: true },
  deletedAt: { type: Date, default: null },
  deleteRestoreExpiresAt: { type: Date, default: null },
  accountStatus: { type: String, enum: ['active', 'deleted'], default: 'active', index: true },
  deleteAccountOtpHash: { type: String, default: '', select: false },
  deleteAccountOtpExpiresAt: { type: Date, default: null },
  deleteAccountOtpAttempts: { type: Number, default: 0 },
  deleteAccountOtpRequestedAt: { type: Date, default: null },
  restoreAccountOtpHash: { type: String, default: '', select: false },
  restoreAccountOtpExpiresAt: { type: Date, default: null },
  restoreAccountOtpAttempts: { type: Number, default: 0 },
  lastRestoreOtpSentAt: { type: Date, default: null },
  deletedEmail: { type: String, default: '', trim: true },
  lastLoginAt: { type: Date, default: null },
  lastActiveAt: { type: Date, default: null },
  tokenVersion: { type: Number, default: 0 },
}, { timestamps: true });
schema.pre('save', async function hash(next) {
  if (this.isModified('password') && this.password) this.password = await bcrypt.hash(this.password, 12);
  next();
});
schema.methods.comparePassword = function comparePassword(value) {
  if (!this.password) return false;
  return bcrypt.compare(value, this.password);
};
schema.methods.toSafeJSON = function safe() {
  const value = this.toObject();
  delete value.password;
  delete value.tokenVersion;
  delete value.firebaseUid;
  delete value.emailOtpHash;
  delete value.emailOtpExpiresAt;
  delete value.emailOtpAttempts;
  delete value.lastOtpSentAt;
  delete value.passwordResetOtpHash;
  delete value.passwordResetOtpExpiresAt;
  delete value.passwordResetOtpAttempts;
  delete value.passwordResetLastOtpSentAt;
  delete value.passwordResetTokenHash;
  delete value.passwordResetTokenExpiresAt;
  delete value.deleteAccountOtpHash;
  delete value.deleteAccountOtpExpiresAt;
  delete value.deleteAccountOtpAttempts;
  delete value.deleteAccountOtpRequestedAt;
  delete value.restoreAccountOtpHash;
  delete value.restoreAccountOtpExpiresAt;
  delete value.restoreAccountOtpAttempts;
  delete value.lastRestoreOtpSentAt;
  return value;
};
module.exports = mongoose.model('User', schema);
