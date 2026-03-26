// ═══════════════════════════════════════════════════════════════
//  POTHOLE DETECTOR — Backend Server
//  Express + MongoDB + Socket.IO + Firebase Sync
// ═══════════════════════════════════════════════════════════════
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const express  = require('express');
const cors     = require('cors');
const http     = require('http');
const { Server } = require('socket.io');
const fs       = require('fs');
const jwt      = require('jsonwebtoken');

const connectDB     = require('./config/db');
const potholeRoutes = require('./routes/potholes');
const reportRoutes  = require('./routes/reports');
const analyticsRoutes = require('./routes/analytics');
const { startSync, getLatestSensorData, fetchLatestSensorDataFromFirebase, setBrowserFallbackLocation } = require('./services/firebaseSync');

const PORT = process.env.PORT || 3000;

// ── Create Express + HTTP + Socket.IO ───────────────────────────
const app    = express();
const server = http.createServer(app);
const io     = new Server(server, { cors: { origin: '*' } });

// Store io reference for routes
app.set('io', io);

// ── Middleware ───────────────────────────────────────────────────
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ── Ensure uploads directory exists ─────────────────────────────
const uploadsDir = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// ── Serve static frontend files ─────────────────────────────────
app.use(express.static(path.join(__dirname, '..')));
app.use('/uploads', express.static(uploadsDir));

// ── API Routes ──────────────────────────────────────────────────
app.use('/api/potholes',  potholeRoutes);
app.use('/api/reports',   reportRoutes);
app.use('/api/analytics', analyticsRoutes);

// Alias endpoint required by external integrations
app.post('/api/report', (req, res, next) => {
  req.url = '/';
  reportRoutes(req, res, next);
});

// ── Admin login endpoint ────────────────────────────────────────
app.post('/api/admin/login', (req, res) => {
  const { email, password } = req.body;
  if (email === process.env.ADMIN_EMAIL && password === process.env.ADMIN_PASSWORD) {
    const token = jwt.sign(
      { role: 'admin', email },
      process.env.JWT_SECRET || 'dev_jwt_secret',
      { expiresIn: process.env.JWT_EXPIRES_IN || '12h' }
    );
    res.json({ success: true, token, expiresIn: process.env.JWT_EXPIRES_IN || '12h' });
  } else {
    res.status(401).json({ success: false, error: 'Invalid credentials' });
  }
});

// Live Firebase data endpoint required by spec
app.get('/api/live-data', async (req, res) => {
  try {
    const latestCached = getLatestSensorData();
    if (latestCached) {
      return res.json({ source: 'cache', latest: latestCached });
    }

    const latestFresh = await fetchLatestSensorDataFromFirebase();
    return res.json({ source: 'firebase', latest: latestFresh });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to fetch live data', detail: err.message });
  }
});

// ── Config endpoint (safe subset for frontend) ─────────────────
app.get('/api/config', (req, res) => {
  res.json({
    googleMapsApiKey: process.env.GOOGLE_MAPS_API_KEY,
    firebaseDbUrl:    process.env.FIREBASE_DB_URL
  });
});

// ── Health endpoint (for deployment checks) ─────────────────────
app.get('/health', (req, res) => {
  res.json({ ok: true, service: 'anveshna-backend' });
});

// ── Socket.IO connections ───────────────────────────────────────
io.on('connection', (socket) => {
  console.log(`[WS]   Client connected: ${socket.id}`);

  // Send latest sensor data immediately
  const latest = getLatestSensorData();
  if (latest) socket.emit('sensorData', latest);

  socket.on('browserLocation', (payload) => {
    if (!payload) return;
    setBrowserFallbackLocation(payload);
  });

  socket.on('disconnect', () => {
    console.log(`[WS]   Client disconnected: ${socket.id}`);
  });
});

// ── Start ───────────────────────────────────────────────────────
async function start() {
  await connectDB();

  // Start Firebase → MongoDB sync
  startSync(io);

  server.listen(PORT, () => {
    console.log(`\n═══════════════════════════════════════════`);
    console.log(`  POTHOLE DETECTOR SERVER`);
    console.log(`  http://localhost:${PORT}`);
    console.log(`  http://localhost:${PORT}/admin.html`);
    console.log(`  http://localhost:${PORT}/report.html`);
    console.log(`═══════════════════════════════════════════\n`);
  });
}

start().catch(err => {
  console.error('[FATAL]', err);
  process.exit(1);
});
