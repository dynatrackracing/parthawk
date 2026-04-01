'use strict';

const router = require('express-promise-router')();
const { database } = require('../database/database');
const { generateAlerts } = require('../services/ScoutAlertService');

// Hard age ceilings
const BONE_MAX_DAYS = 90;
const PERCH_MAX_DAYS = 60;

// Get alerts with yard + time filters
router.get('/list', async (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const perPage = 50;
  const yard = req.query.yard || 'all';
  const days = parseInt(req.query.days) || 0; // 0 = all (within hard ceilings)
  const hideClaimed = req.query.hideClaimed === '1';

  const knex = database;

  // Base query with hard age ceilings applied always
  let baseQuery = knex('scout_alerts').where(function() {
    this.where(function() {
      this.where('source', 'bone_pile')
        .andWhere('vehicle_set_date', '>=', knex.raw(`NOW() - INTERVAL '${BONE_MAX_DAYS} days'`));
    }).orWhere(function() {
      this.where('source', 'hunters_perch')
        .andWhere('vehicle_set_date', '>=', knex.raw(`NOW() - INTERVAL '${PERCH_MAX_DAYS} days'`));
    });
  });

  // Time filter (days pill)
  if (days > 0) {
    const effectiveBoneDays = Math.min(days, BONE_MAX_DAYS);
    const effectivePerchDays = Math.min(days, PERCH_MAX_DAYS);
    baseQuery = knex('scout_alerts').where(function() {
      this.where(function() {
        this.where('source', 'bone_pile')
          .andWhere('vehicle_set_date', '>=', knex.raw(`NOW() - INTERVAL '${effectiveBoneDays} days'`));
      }).orWhere(function() {
        this.where('source', 'hunters_perch')
          .andWhere('vehicle_set_date', '>=', knex.raw(`NOW() - INTERVAL '${effectivePerchDays} days'`));
      });
    });
  }

  // Also include alerts with NULL vehicle_set_date (can't filter what we can't date)
  // Actually, re-do: build the where as a function we can reuse
  function applyFilters(q) {
    q = q.where(function() {
      this.where(function() {
        this.where('source', 'bone_pile').andWhere(function() {
          this.where('vehicle_set_date', '>=', knex.raw(`NOW() - INTERVAL '${days > 0 ? Math.min(days, BONE_MAX_DAYS) : BONE_MAX_DAYS} days'`))
            .orWhereNull('vehicle_set_date');
        });
      }).orWhere(function() {
        this.where('source', 'hunters_perch').andWhere(function() {
          this.where('vehicle_set_date', '>=', knex.raw(`NOW() - INTERVAL '${days > 0 ? Math.min(days, PERCH_MAX_DAYS) : PERCH_MAX_DAYS} days'`))
            .orWhereNull('vehicle_set_date');
        });
      }).orWhere(function() {
        // PERCH (The Mark) alerts — no hard age ceiling, always show active marks
        this.where('source', 'PERCH');
      }).orWhere(function() {
        // OVERSTOCK alerts — always show, no date filtering
        this.where('source', 'OVERSTOCK');
      });
    });
    if (yard && yard !== 'all') {
      q = q.andWhere('yard_name', 'ilike', `%${yard}%`);
    }
    if (hideClaimed) {
      q = q.andWhere(function() { this.where('claimed', false).orWhereNull('claimed'); });
    }
    return q;
  }

  // Get paginated alerts
  let alertQuery = knex('scout_alerts');
  alertQuery = applyFilters(alertQuery);
  const alerts = await alertQuery
    .orderByRaw(`CASE WHEN claimed = true THEN 1 ELSE 0 END`)
    .orderByRaw(`
      CASE
        WHEN source = 'PERCH' AND confidence = 'high' THEN 0
        WHEN source = 'PERCH' AND confidence = 'medium' THEN 1
        WHEN source = 'bone_pile' AND confidence = 'high' THEN 2
        WHEN source = 'bone_pile' AND confidence = 'medium' THEN 3
        WHEN source = 'bone_pile' AND confidence = 'low' THEN 4
        WHEN source = 'hunters_perch' AND confidence = 'high' THEN 5
        WHEN source = 'hunters_perch' AND confidence = 'medium' THEN 6
        WHEN source = 'hunters_perch' AND confidence = 'low' THEN 7
        WHEN source = 'OVERSTOCK' THEN 1
        ELSE 8
      END
    `)
    .orderBy('part_value', 'desc')
    .offset((page - 1) * perPage)
    .limit(perPage);

  // Get total count with same filters
  let countQuery = knex('scout_alerts');
  countQuery = applyFilters(countQuery);
  const [{ count }] = await countQuery.count('* as count');
  const total = parseInt(count) || 0;

  // Get last generated timestamp
  const meta = await knex('scout_alerts_meta').where('key', 'last_generated').first();
  const lastGenerated = meta ? meta.value : null;

  // Group by yard
  const byYard = {};
  for (const a of alerts) {
    const y = a.yard_name || 'Unknown';
    if (!byYard[y]) byYard[y] = [];
    byYard[y].push(a);
  }

  // Yard counts with same filters
  let yardCountQuery = knex('scout_alerts');
  yardCountQuery = applyFilters(yardCountQuery);
  const yardCounts = await yardCountQuery
    .select('yard_name').count('* as count').groupBy('yard_name').orderBy('count', 'desc');

  // Source counts with same filters — show unique parts, not raw alert rows
  let srcQuery = knex('scout_alerts');
  srcQuery = applyFilters(srcQuery);
  const sourceCounts = await srcQuery
    .select('source')
    .count('* as count')
    .countDistinct('source_title as unique_parts')
    .groupBy('source');
  const boneCount = parseInt((sourceCounts.find(s => s.source === 'bone_pile') || {}).unique_parts) || 0;
  const perchCount = parseInt((sourceCounts.find(s => s.source === 'hunters_perch') || {}).unique_parts) || 0;
  const markCount = parseInt((sourceCounts.find(s => s.source === 'PERCH') || {}).unique_parts) || 0;
  const overstockCount = parseInt((sourceCounts.find(s => s.source === 'OVERSTOCK') || {}).unique_parts) || 0;

  // Tag perch alerts with recent sales
  let justSoldCount = 0;
  try {
    const recentSales = await knex('YourSale')
      .where('soldDate', '>=', knex.raw("NOW() - INTERVAL '3 days'"))
      .whereNotNull('title').select('title', 'soldDate');
    const saleTitles = recentSales.map(s => ({ lower: (s.title || '').toLowerCase(), soldDate: s.soldDate }));
    for (const yardName in byYard) {
      for (const alert of byYard[yardName]) {
        if (alert.source !== 'hunters_perch') continue;
        const alertWords = (alert.source_title || '').toLowerCase()
          .replace(/\([^)]*\)/g, '').replace(/\b\d+\b/g, '').replace(/[^a-z\s]/g, ' ')
          .split(/\s+/).filter(w => w.length >= 3);
        for (const sale of saleTitles) {
          const matches = alertWords.filter(w => sale.lower.includes(w));
          if (matches.length >= 3) {
            const daysAgo = Math.floor((Date.now() - new Date(sale.soldDate).getTime()) / 86400000);
            alert.justSold = daysAgo <= 0 ? 'today' : daysAgo + 'd ago';
            justSoldCount++;
            break;
          }
        }
      }
    }
  } catch (e) { /* ignore */ }

  res.json({
    success: true,
    alerts: byYard,
    yardCounts: yardCounts.map(y => ({ yard: y.yard_name, count: parseInt(y.count) })),
    boneCount, perchCount, markCount, overstockCount, justSoldCount,
    total, page, totalPages: Math.ceil(total / perPage),
    lastGenerated
  });
});

// Claim / unclaim an alert (GOT ONE)
router.post('/claim', async (req, res) => {
  const { id, claimed } = req.body;
  if (!id) return res.status(400).json({ error: 'ID required' });

  const knex = database;
  const alert = await knex('scout_alerts').where({ id }).first();
  if (!alert) return res.status(404).json({ error: 'Alert not found' });

  // Update scout_alerts
  await knex('scout_alerts').where({ id }).update({
    claimed: !!claimed,
    claimed_by: claimed ? (alert.yard_name || 'unknown') : null,
    claimed_at: claimed ? new Date().toISOString() : null,
  });

  // If PERCH alert, sync with restock_want_list
  if (alert.source === 'hunters_perch') {
    // Find the matching want list item by title
    const wantItem = await knex('restock_want_list')
      .where({ active: true })
      .where('title', alert.source_title)
      .first();
    if (wantItem) {
      await knex('restock_want_list').where({ id: wantItem.id }).update({
        pulled: !!claimed,
        pulled_date: claimed ? new Date().toISOString() : null,
        pulled_from: claimed ? (alert.yard_name || null) : null,
      });
    }
  }

  res.json({ success: true });
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
