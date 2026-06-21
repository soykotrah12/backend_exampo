const mongoose = require('mongoose');
const override = { enabled: { type: Boolean, default: false }, teachersLimit: Number, studentsLimit: Number, examSlotsPerMonth: Number, questionsPerExam: Number, writtenQuestionsPerExam: Number, analyticsEnabled: Boolean, exportEnabled: Boolean, brandingEnabled: Boolean, questionBankEnabled: Boolean };
module.exports = mongoose.model('Organization', new mongoose.Schema({
  name: { type: String, required: true, trim: true }, owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  plan: { type: mongoose.Schema.Types.ObjectId, ref: 'Plan', required: true }, subscriptionStatus: { type: String, enum: ['free', 'active', 'expired', 'cancelled'], default: 'free' },
  subscriptionStartDate: Date, subscriptionEndDate: Date, permissionOverrides: override, isActive: { type: Boolean, default: true },
}, { timestamps: true }));
