'use strict';

const router = require('express-promise-router')();
const { database } = require('../database/database');
const { generateAlerts } = require('../services/ScoutAlertService');

// Get all alerts (paginated, grouped by yard)
router.get('/list', async (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const perPage = 50;

  const alerts = await database('scout_alerts')
    .orderByRaw("CASE confidence WHEN 'high' THEN 0 WHEN 'medium' THEN 1 WHEN 'low' THEN 2 END")
    .orderBy('part_value', 'desc')
    .offset((page - 1) * perPage)
    .limit(perPage);

  const [{ count }] = await database('scout_alerts').count('* as count');
  const total = parseInt(count) || 0;

  // Get last generated timestamp
  const meta = await database('scout_alerts_meta').where('key', 'last_generated').first();
  const lastGenerated = meta ? meta.value : null;

  // Group by yard
  const byYard = {};
  for (const a of alerts) {
    const yard = a.yard_name || 'Unknown';
    if (!byYard[yard]) byYard[yard] = [];
    byYard[yard].push(a);
  }

  // Get yard counts for all alerts (not just this page)
  const yardCounts = await database('scout_alerts')
    .select('yard_name')
    .count('* as count')
    .groupBy('yard_name')
    .orderBy('count', 'desc');

  res.json({
    success: true,
    alerts: byYard,
    yardCounts: yardCounts.map(y => ({ yard: y.yard_name, count: parseInt(y.count) })),
    total,
    page,
    totalPages: Math.ceil(total / perPage),
    lastGenerated
  });
});

// Manual refresh
router.post('/refresh', async (req, res) => {
  try {
    const result = await generateAlerts();
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
