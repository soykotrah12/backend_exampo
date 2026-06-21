const mongoose = require('mongoose');
const statement = new mongoose.Schema({ label: { type: String, enum: ['A','B','C','D','E'] }, text: { type: String, required: true }, correctAnswer: { type: Boolean, required: true } }, { _id: false });
const option = new mongoose.Schema({ label: { type: String, enum: ['A','B','C','D'] }, text: { type: String, required: true }, isCorrect: { type: Boolean, required: true } }, { _id: false });
module.exports = mongoose.model('Question', new mongoose.Schema({
  examSlot: { type: mongoose.Schema.Types.ObjectId, ref: 'ExamSlot', required: true, index: true }, organization: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', required: true },
  type: { type: String, enum: ['TRUE_FALSE_GROUP','SINGLE_BEST_ANSWER','WRITTEN'], required: true }, questionText: { type: String, required: true, trim: true },
  statements: [statement], options: [option], marks: { type: Number, required: true, min: 0 }, wordLimit: { type: Number, min: 1 }, answerGuideline: { type: String, select: false }, order: { type: Number, default: 0 },
}, { timestamps: true }));
