// ─── Report Model (citizen-submitted reports) ──────────────────
const mongoose = require('mongoose');

const reportSchema = new mongoose.Schema({
  lat:          { type: Number, required: true },
  lng:          { type: Number, required: true },
  description:  { type: String, required: true },
  severity:     { type: String, enum: ['low', 'medium', 'high'], default: 'medium' },
  image:        { type: String, default: '' },            // filename or URL
  user: {
    name:       { type: String, default: 'Anonymous' },
    email:      { type: String, default: '' },
    uid:        { type: String, default: '' }
  },
  status:       { type: String, enum: ['pending', 'approved', 'rejected', 'resolved'], default: 'pending' },
  createdAt:    { type: Date, default: Date.now },
  resolvedAt:   { type: Date, default: null }
});

module.exports = mongoose.model('Report', reportSchema);
