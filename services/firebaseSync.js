// ─── Firebase → MongoDB Sync Service ────────────────────────────
// Polls Firebase RTDB, syncs new potholes to MongoDB, emits Socket.IO events
const axios   = require('axios');
const Pothole = require('../models/Pothole');

const FB_BASE  = process.env.FIREBASE_DB_URL;
const FB_AUTH   = process.env.FIREBASE_SECRET;

let lastSensorData = null;
let lastAutoLoggedAt = 0;
let lastAutoSignature = '';
let lastValidLatLng = { lat: 0, lng: 0 };
let browserFallbackLocation = { lat: 0, lng: 0, ts: 0 };

function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function toModelLabel(label, score = 0) {
  const raw = String(label || '').toLowerCase();
  if (raw === 'large_pothole') return 'large_pothole';
  if (raw === 'small_pothole') return 'small_pothole';
  if (raw === 'plane_road' || raw === 'normal') return 'plane_road';
  if (raw === 'pothole') return score >= 0.85 ? 'large_pothole' : 'small_pothole';
  return score >= 0.7 ? 'small_pothole' : 'plane_road';
}

function normalizeFirebaseLabel(rawLabel) {
  const v = String(rawLabel || '').trim().toLowerCase();
  if (v === 'pothole') return 'POTHOLE';
  if (v === 'normal') return 'NORMAL';
  if (v === 'large_pothole' || v === 'small_pothole') return 'POTHOLE';
  if (v === 'plane_road') return 'NORMAL';
  return '';
}

function normalizeLatestPayload(raw) {
  if (!raw || typeof raw !== 'object') return null;

  const score = toNumber(raw.score ?? raw.pothole_score, 0);
  const latitude = toNumber(raw.latitude ?? raw.lat, 0);
  const longitude = toNumber(raw.longitude ?? raw.lng, 0);

  if (latitude !== 0 && longitude !== 0) {
    lastValidLatLng = { lat: latitude, lng: longitude };
  }

  const normalizedLabel = normalizeFirebaseLabel(raw.label ?? raw.pothole_label);
  const hasExplicitLabel = normalizedLabel === 'POTHOLE' || normalizedLabel === 'NORMAL';

  const modelLabel = toModelLabel(raw.pothole_label ?? raw.label, score);
  const isPothole = hasExplicitLabel ? (normalizedLabel === 'POTHOLE') : (score > 0.7);

  const largeProb = raw.large_pothole != null ? toNumber(raw.large_pothole) : (modelLabel === 'large_pothole' ? score : 0);
  const smallProb = raw.small_pothole != null ? toNumber(raw.small_pothole) : (modelLabel === 'small_pothole' ? score : 0);
  const planeProb = raw.plane_road != null ? toNumber(raw.plane_road) : (modelLabel === 'plane_road' ? Math.max(0, 1 - score) : 0);

  return {
    ...raw,
    label: hasExplicitLabel ? normalizedLabel : (isPothole ? 'POTHOLE' : 'NORMAL'),
    score,
    latitude,
    longitude,
    pothole_label: hasExplicitLabel ? (normalizedLabel === 'POTHOLE' ? 'pothole' : 'normal') : modelLabel,
    pothole_score: score,
    large_pothole: largeProb,
    small_pothole: smallProb,
    plane_road: planeProb,
    gps_valid: raw.gps_valid != null ? !!raw.gps_valid : (latitude !== 0 && longitude !== 0),
    buffer_ready: raw.buffer_ready != null ? !!raw.buffer_ready : true,
    speed_kmh: toNumber(raw.speed_kmh ?? raw.speed, 0)
  };
}

function setBrowserFallbackLocation(payload = {}) {
  const lat = toNumber(payload.lat, 0);
  const lng = toNumber(payload.lng, 0);
  if (lat === 0 || lng === 0) return;

  browserFallbackLocation = {
    lat,
    lng,
    ts: Date.now()
  };
}

function pickBestCoordinates(rawLat, rawLng) {
  const lat = toNumber(rawLat, 0);
  const lng = toNumber(rawLng, 0);
  if (lat !== 0 && lng !== 0) return { lat, lng };

  if (lastValidLatLng.lat !== 0 && lastValidLatLng.lng !== 0) {
    return { lat: lastValidLatLng.lat, lng: lastValidLatLng.lng };
  }

  const isRecentBrowserLocation = (Date.now() - browserFallbackLocation.ts) < 10 * 60 * 1000;
  if (isRecentBrowserLocation && browserFallbackLocation.lat !== 0 && browserFallbackLocation.lng !== 0) {
    return { lat: browserFallbackLocation.lat, lng: browserFallbackLocation.lng };
  }

  return { lat: 0, lng: 0 };
}

function buildAutoSignature(d) {
  const ax = toNumber(d.ax, 0);
  const ay = toNumber(d.ay, 0);
  const az = toNumber(d.az, 0);
  return [
    d.pothole_label,
    d.pothole_score?.toFixed?.(3) || String(d.pothole_score || 0),
    Math.round(ax / 32),
    Math.round(ay / 32),
    Math.round(az / 32)
  ].join('|');
}

async function autoLogFromLatest(data, io) {
  const score = toNumber(data.pothole_score ?? data.score, 0);
  const explicit = normalizeFirebaseLabel(data.label);
  const hasExplicit = explicit === 'POTHOLE' || explicit === 'NORMAL';
  const isPothole = hasExplicit ? (explicit === 'POTHOLE') : (score > 0.7);
  const label = hasExplicit
    ? (explicit === 'POTHOLE' ? (score >= 0.85 ? 'large_pothole' : 'small_pothole') : 'plane_road')
    : toModelLabel(data.pothole_label ?? data.label, score);
  if (!isPothole) return;

  const now = Date.now();
  const signature = buildAutoSignature(data);

  // Cooldown + signature dedupe to avoid spamming Mongo every sensor tick
  if (now - lastAutoLoggedAt < 7000 && signature === lastAutoSignature) {
    return;
  }

  const { lat, lng } = pickBestCoordinates(data.latitude, data.longitude);

  const pothole = new Pothole({
    lat,
    lng,
    label,
    score,
    speed: toNumber(data.speed_kmh ?? data.speed, 0),
    source: 'esp32'
  });

  await pothole.save();
  lastAutoLoggedAt = now;
  lastAutoSignature = signature;

  if (io) io.emit('newPothole', pothole);
}

// ── Sync /potholes → MongoDB ────────────────────────────────────
let knownFirebaseKeys = new Set();

async function syncPotholes(io) {
  try {
    const url = `${FB_BASE}/potholes.json?auth=${FB_AUTH}`;
    const res = await axios.get(url, { timeout: 8000 });
    const data = res.data;
    if (!data) return;

    for (const [key, val] of Object.entries(data)) {
      if (knownFirebaseKeys.has(key)) continue;
      knownFirebaseKeys.add(key);

      // Check if already in MongoDB
      const exists = await Pothole.findOne({ firebaseKey: key });
      if (exists) continue;

      const coords = pickBestCoordinates(val.lat ?? val.latitude, val.lng ?? val.longitude);
      const lat = coords.lat;
      const lng = coords.lng;
      const score = toNumber(val.score ?? val.pothole_score, 0);
      const normalizedLabel = toModelLabel(val.label ?? val.pothole_label, score);

      const pothole = new Pothole({
        firebaseKey: key,
        lat,
        lng,
        label: normalizedLabel,
        score,
        speed: toNumber(val.speed ?? val.speed_kmh, 0),
        source: 'esp32'
      });

      await pothole.save();
      console.log(`[SYNC] New pothole: ${val.label} (${val.score}) → MongoDB`);

      // Emit to connected clients
      if (io) io.emit('newPothole', pothole);
    }
  } catch (err) {
    if (err.code !== 'ECONNABORTED') {
      console.error('[SYNC ERR] Pothole sync:', err.message);
    }
  }
}

// ── Poll /sensor_data/latest → emit to dashboard ───────────────
async function pollLatest(io) {
  try {
    const url = `${FB_BASE}/sensor_data/latest.json?auth=${FB_AUTH}`;
    const res = await axios.get(url, { timeout: 5000 });
    const data = normalizeLatestPayload(res.data);
    if (!data) return;

    lastSensorData = data;

    await autoLogFromLatest(data, io);

    // Emit real-time sensor data to all connected clients
    if (io) io.emit('sensorData', data);
  } catch (err) {
    if (err.code !== 'ECONNABORTED') {
      console.error('[SYNC ERR] Sensor poll:', err.message);
    }
  }
}

async function fetchLatestSensorDataFromFirebase() {
  const url = `${FB_BASE}/sensor_data/latest.json?auth=${FB_AUTH}`;
  const res = await axios.get(url, { timeout: 5000 });
  return normalizeLatestPayload(res.data);
}

// ── Start sync loops ────────────────────────────────────────────
function startSync(io) {
  console.log('[SYNC] Firebase sync started');

  // Poll sensor data every 600ms
  setInterval(() => pollLatest(io), 600);

  // Sync potholes every 5 seconds
  setInterval(() => syncPotholes(io), 5000);

  // Initial sync
  syncPotholes(io);
  pollLatest(io);
}

function getLatestSensorData() {
  return lastSensorData;
}

module.exports = { startSync, getLatestSensorData, fetchLatestSensorDataFromFirebase, setBrowserFallbackLocation };
