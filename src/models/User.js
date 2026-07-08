const mongoose = require('mongoose');
const bcrypt = require('bcrypt');

const schema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, maxlength: 100 },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  password: { type: String, required: true, select: false, minlength: 8 },
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
  isActive: { type: Boolean, default: true },
  tokenVersion: { type: Number, default: 0 },
}, { timestamps: true });
schema.pre('save', async function hash(next) {
  if (this.isModified('password')) this.password = await bcrypt.hash(this.password, 12);
  next();
});
schema.methods.comparePassword = function comparePassword(value) { return bcrypt.compare(value, this.password); };
schema.methods.toSafeJSON = function safe() { const value = this.toObject(); delete value.password; delete value.tokenVersion; return value; };
module.exports = mongoose.model('User', schema);
