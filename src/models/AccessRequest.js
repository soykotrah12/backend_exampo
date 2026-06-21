const mongoose = require('mongoose');
const schema = new mongoose.Schema({ examSlot: { type: mongoose.Schema.Types.ObjectId, ref: 'ExamSlot', required: true }, student: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }, organization: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', required: true }, status: { type: String, enum: ['pending','accepted','rejected'], default: 'pending' }, reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, reviewedAt: Date }, { timestamps: true });
schema.index({ examSlot: 1, student: 1 }, { unique: true });
module.exports = mongoose.model('AccessRequest', schema);
