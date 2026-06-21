const mongoose = require('mongoose');
const limits = {
  teachersLimit: { type: Number, required: true, min: 0 }, studentsLimit: { type: Number, required: true, min: 0 },
  examSlotsPerMonth: { type: Number, required: true, min: 0 }, questionsPerExam: { type: Number, required: true, min: 0 },
  writtenQuestionsPerExam: { type: Number, required: true, min: 0 }, analyticsEnabled: { type: Boolean, default: false },
  exportEnabled: { type: Boolean, default: false }, brandingEnabled: { type: Boolean, default: false }, questionBankEnabled: { type: Boolean, default: false },
};
module.exports = mongoose.model('Plan', new mongoose.Schema({
  name: { type: String, required: true }, code: { type: String, required: true, unique: true, uppercase: true },
  priceMonthly: { type: Number, default: 0, min: 0 }, priceYearly: { type: Number, default: 0, min: 0 },
  limits, isActive: { type: Boolean, default: true },
}, { timestamps: true }));
