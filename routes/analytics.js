// ─── Analytics Routes ───────────────────────────────────────────
const express  = require('express');
const router   = express.Router();
const Pothole  = require('../models/Pothole');
const Report   = require('../models/Report');

// GET /api/analytics/summary
router.get('/summary', async (req, res) => {
  try {
    const [totalPotholes, pending, resolved, falsePositive, totalReports, pendingReports] =
      await Promise.all([
        Pothole.countDocuments(),
        Pothole.countDocuments({ status: 'pending' }),
        Pothole.countDocuments({ status: 'resolved' }),
        Pothole.countDocuments({ status: 'false_positive' }),
        Report.countDocuments(),
        Report.countDocuments({ status: 'pending' })
      ]);

    // Average severity score
    const avgResult = await Pothole.aggregate([
      { $group: { _id: null, avgScore: { $avg: '$score' } } }
    ]);
    const avgScore = avgResult.length > 0 ? avgResult[0].avgScore : 0;

    res.json({
      totalPotholes,
      pending,
      resolved,
      falsePositive,
      totalReports,
      pendingReports,
      avgScore: parseFloat(avgScore.toFixed(3))
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/analytics/timeline — potholes grouped by date (last 30 days)
router.get('/timeline', async (req, res) => {
  try {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const data = await Pothole.aggregate([
      { $match: { createdAt: { $gte: thirtyDaysAgo } } },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
          count: { $sum: 1 }
        }
      },
      { $sort: { _id: 1 } }
    ]);

    res.json(data.map(d => ({ date: d._id, count: d.count })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/analytics/severity — severity distribution
router.get('/severity', async (req, res) => {
  try {
    const data = await Pothole.aggregate([
      { $group: { _id: '$severity', count: { $sum: 1 } } }
    ]);
    const result = { low: 0, medium: 0, high: 0 };
    data.forEach(d => { result[d._id] = d.count; });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
