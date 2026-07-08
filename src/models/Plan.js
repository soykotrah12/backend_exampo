const mongoose = require('mongoose');
const limits = {
  teachersLimit: { type: Number, required: true, min: 0 }, studentsLimit: { type: Number, required: true, min: 0 },
  servicesLimit: { type: Number, default: 0, min: 0 }, batchesLimit: { type: Number, default: 0, min: 0 },
  examSlotsPerMonth: { type: Number, required: true, min: 0 }, questionsPerExam: { type: Number, required: true, min: 0 },
  writtenQuestionsPerExam: { type: Number, required: true, min: 0 }, analyticsEnabled: { type: Boolean, default: false },
  exportEnabled: { type: Boolean, default: false }, brandingEnabled: { type: Boolean, default: false }, questionBankEnabled: { type: Boolean, default: false },
};
module.exports = mongoose.model('Plan', new mongoose.Schema({
  name: { type: String, required: true, trim: true }, code: { type: String, required: true, unique: true, uppercase: true, trim: true },
  description: { type: String, default: '', trim: true, maxlength: 1000 },
  billingType: { type: String, enum: ['free', 'monthly', 'yearly', 'custom'], default: 'monthly' },
  priceMonthly: { type: Number, default: 0, min: 0 }, priceYearly: { type: Number, default: 0, min: 0 },
  features: [{ type: String, trim: true }],
  sortOrder: { type: Number, default: 0 },
  deletedAt: { type: Date, default: null },
  limits, isActive: { type: Boolean, default: true },
}, { timestamps: true }));
