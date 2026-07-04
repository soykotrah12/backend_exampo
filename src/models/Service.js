const mongoose = require('mongoose');

const schema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, maxlength: 120 },
  description: { type: String, default: '', trim: true, maxlength: 500 },
  organization: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  icon: { type: String, default: 'school', trim: true },
  color: { type: String, default: '#315A49', trim: true },
  isActive: { type: Boolean, default: true },
}, { timestamps: true });

schema.index({ organization: 1, name: 1 }, { unique: true });

module.exports = mongoose.model('Service', schema);
