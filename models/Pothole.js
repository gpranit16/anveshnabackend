// ─── Pothole Model (from ESP32 ML detections) ──────────────────
const mongoose = require('mongoose');

const potholeSchema = new mongoose.Schema({
  firebaseKey: { type: String, unique: true, sparse: true },
  lat:         { type: Number, required: true },
  lng:         { type: Number, required: true },
  label:       { type: String, enum: ['large_pothole', 'small_pothole', 'plane_road'], required: true },
  score:       { type: Number, required: true },
  speed:       { type: Number, default: 0 },
  severity:    { type: String, enum: ['low', 'medium', 'high'], default: 'medium' },
  status:      { type: String, enum: ['pending', 'in_progress', 'resolved', 'false_positive'], default: 'pending' },
  source:      { type: String, enum: ['esp32', 'manual'], default: 'esp32' },
  createdAt:   { type: Date, default: Date.now }
});

// Auto-set severity from label
potholeSchema.pre('save', function (next) {
  if (this.label === 'large_pothole') this.severity = 'high';
  else if (this.label === 'small_pothole') this.severity = 'medium';
  else this.severity = 'low';
  next();
});

module.exports = mongoose.model('Pothole', potholeSchema);
