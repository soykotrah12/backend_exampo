const mongoose = require('mongoose');
module.exports = mongoose.model('PaymentRequest', new mongoose.Schema({
  organization: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', required: true },
  plan: { type: mongoose.Schema.Types.ObjectId, ref: 'Plan', required: true },
  status: { type: String, enum: ['pending','approved','rejected'], default: 'pending' },
  amount: { type: Number, min: 0 },
  billingCycle: { type: String, default: '', trim: true },
  paymentMethod: { type: String, default: '', trim: true },
  transactionId: { type: String, default: '', trim: true },
  documentUrl: { type: String, default: '' },
  note: { type: String, default: '', trim: true },
  reviewedAt: Date,
  reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
}, { timestamps: true }));
