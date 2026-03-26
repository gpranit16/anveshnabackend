// ─── Report Routes ──────────────────────────────────────────────
const express = require('express');
const router  = express.Router();
const multer  = require('multer');
const path    = require('path');
const Report  = require('../models/Report');
const { requireAdminAuth } = require('../middleware/auth');

// Multer setup for image uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, path.join(__dirname, '..', '..', 'uploads'));
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `report_${Date.now()}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 15 * 1024 * 1024 }, // 15MB limit
  fileFilter: (req, file, cb) => {
    const allowed = /jpeg|jpg|png|webp/;
    if (allowed.test(path.extname(file.originalname).toLowerCase())) {
      cb(null, true);
    } else {
      cb(new Error('Only images (jpg, png, webp) allowed'));
    }
  }
});

// Wrapper to handle Multer errors gracefully and return JSON
const uploadMiddleware = (req, res, next) => {
  const uploadSingle = upload.single('image');
  uploadSingle(req, res, (err) => {
    if (err) {
      return res.status(400).json({ error: 'Image upload failed: ' + err.message });
    }
    next();
  });
};

// POST /api/reports — citizen submits a pothole report
router.post('/', uploadMiddleware, async (req, res) => {
  try {
    const { lat, lng, description, severity, userName, userEmail, userUid } = req.body;

    const report = new Report({
      lat: parseFloat(lat),
      lng: parseFloat(lng),
      description,
      severity: severity || 'medium',
      image: req.file ? req.file.filename : '',
      user: {
        name:  userName  || 'Anonymous',
        email: userEmail || '',
        uid:   userUid   || ''
      }
    });

    await report.save();

    // Emit to admin dashboard via Socket.IO
    const io = req.app.get('io');
    if (io) io.emit('newReport', report);

    res.status(201).json(report);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/reports — admin lists all reports
router.get('/', requireAdminAuth, async (req, res) => {
  try {
    const { status, limit = 100 } = req.query;
    const filter = {};
    if (status) filter.status = status;

    const reports = await Report.find(filter)
      .sort({ createdAt: -1 })
      .limit(parseInt(limit));

    res.json(reports);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/reports/:id — update status (approve/reject/resolve)
router.patch('/:id', requireAdminAuth, async (req, res) => {
  try {
    const updates = { status: req.body.status };
    if (req.body.status === 'resolved') {
      updates.resolvedAt = new Date();
    }
    const r = await Report.findByIdAndUpdate(req.params.id, updates, { new: true });
    if (!r) return res.status(404).json({ error: 'Not found' });
    res.json(r);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/reports/:id/resolve — explicit resolve action
router.put('/:id/resolve', requireAdminAuth, async (req, res) => {
  try {
    const report = await Report.findByIdAndUpdate(
      req.params.id,
      { status: 'resolved', resolvedAt: new Date() },
      { new: true }
    );

    if (!report) return res.status(404).json({ error: 'Not found' });
    res.json(report);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/reports/:id/dismiss — explicit dismiss action
router.put('/:id/dismiss', requireAdminAuth, async (req, res) => {
  try {
    const report = await Report.findByIdAndUpdate(
      req.params.id,
      { status: 'rejected' },
      { new: true }
    );

    if (!report) return res.status(404).json({ error: 'Not found' });
    res.json(report);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/reports/:id
router.delete('/:id', requireAdminAuth, async (req, res) => {
  try {
    await Report.findByIdAndDelete(req.params.id);
    res.json({ message: 'Deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
