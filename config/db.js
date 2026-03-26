// ─── MongoDB Connection ─────────────────────────────────────────
const mongoose = require('mongoose');

async function connectDB() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('[DB]   MongoDB Atlas connected ✓');
  } catch (err) {
    console.error('[DB]   MongoDB connection error:', err.message);
    process.exit(1);
  }
}

module.exports = connectDB;
