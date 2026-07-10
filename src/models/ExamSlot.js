const mongoose = require('mongoose');
module.exports = mongoose.model('ExamSlot', new mongoose.Schema({
  title: { type: String, required: true, trim: true }, description: { type: String, default: '' }, category: { type: String, required: true },
  mainCategory: { type: String, trim: true, default: '' }, subCategory: { type: String, trim: true, default: '' },
  examType: { type: String, enum: ['mcq','written','both'], required: true }, startDateTime: { type: Date, required: true }, endDateTime: { type: Date, required: true }, durationMinutes: { type: Number, required: true, min: 1 },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }, organization: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
  service: { type: mongoose.Schema.Types.ObjectId, ref: 'Service', index: true },
  accessScope: { type: String, enum: ['selected_students','selected_batches','whole_organization'], default: 'selected_students' },
  assignedStudents: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  assignedBatches: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Batch' }],
  status: { type: String, enum: ['draft','published','ongoing','completed','cancelled','archived'], default: 'draft' },
  instructions: { type: String, default: '' }, totalMarks: { type: Number, default: 0 }, passingMarks: Number,
  resultVisibilityMode: { type: String, enum: ['instant', 'manual_publish'], default: 'manual_publish' },
  resultPublished: { type: Boolean, default: false }, resultPublishedAt: { type: Date, default: null },
  showCorrectAnswers: { type: Boolean, default: false }, showQuestionReview: { type: Boolean, default: false },
}, { timestamps: true }));
