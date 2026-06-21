const mongoose = require('mongoose');
module.exports = mongoose.model('ExamSlot', new mongoose.Schema({
  title: { type: String, required: true, trim: true }, description: { type: String, default: '' }, category: { type: String, required: true },
  examType: { type: String, enum: ['mcq','written','both'], required: true }, startDateTime: { type: Date, required: true }, endDateTime: { type: Date, required: true }, durationMinutes: { type: Number, required: true, min: 1 },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }, organization: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
  assignedStudents: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }], status: { type: String, enum: ['draft','published','ongoing','completed','cancelled'], default: 'draft' },
  instructions: { type: String, default: '' }, totalMarks: { type: Number, default: 0 }, passingMarks: Number, resultVisible: { type: Boolean, default: false },
}, { timestamps: true }));
