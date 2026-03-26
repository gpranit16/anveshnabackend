// ─── Pothole Routes ─────────────────────────────────────────────
const express = require('express');
const router  = express.Router();
const Pothole = require('../models/Pothole');
const { requireAdminAuth } = require('../middleware/auth');

// GET /api/potholes — list all (with optional filters)
router.get('/', async (req, res) => {
  try {
    const { severity, status, limit = 200 } = req.query;
    const filter = {};
    if (severity) filter.severity = severity;
    if (status)   filter.status   = status;

    const potholes = await Pothole.find(filter)
      .sort({ createdAt: -1 })
      .limit(parseInt(limit));

    res.json(potholes);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/potholes/:id
router.get('/:id', async (req, res) => {
  try {
    const p = await Pothole.findById(req.params.id);
    if (!p) return res.status(404).json({ error: 'Not found' });
    res.json(p);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/potholes/:id — update status
router.patch('/:id', requireAdminAuth, async (req, res) => {
  try {
    const { status } = req.body;
    const p = await Pothole.findByIdAndUpdate(
      req.params.id,
      { status },
      { new: true }
    );
    if (!p) return res.status(404).json({ error: 'Not found' });
    res.json(p);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/potholes/:id
router.delete('/:id', requireAdminAuth, async (req, res) => {
  try {
    await Pothole.findByIdAndDelete(req.params.id);
    res.json({ message: 'Deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/potholes — clear all pothole records
router.delete('/', requireAdminAuth, async (req, res) => {
  try {
    const result = await Pothole.deleteMany({});
    res.json({ message: 'All pothole records cleared', deletedCount: result.deletedCount || 0 });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
