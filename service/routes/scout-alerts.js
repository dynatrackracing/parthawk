'use strict';

const router = require('express-promise-router')();
const { database } = require('../database/database');
const { generateAlerts } = require('../services/ScoutAlertService');
const { detectPartType, extractPartNumbers } = require('../utils/partIntelligence');

const HARD_PART_TYPES = new Set(['ECM','PCM','ECU','BCM','TCM','TIPM','ABS','AIRBAG MODULE','SRS MODULE']);
const SOURCE_PRIORITY = { PERCH: 4, bone_pile: 3, hunters_perch: 2, restock: 2, OVERSTOCK: 1 };

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
        // PERCH (The Mark) alerts — respect date pill, no hard ceiling when "All"
        this.where('source', 'PERCH').andWhere(function() {
          if (days > 0) {
            this.where('vehicle_set_date', '>=', knex.raw(`NOW() - INTERVAL '${days} days'`))
              .orWhereNull('vehicle_set_date');
          }
        });
      }).orWhere(function() {
        // OVERSTOCK alerts — respect date pill, no hard ceiling when "All"
        this.where('source', 'OVERSTOCK').andWhere(function() {
          if (days > 0) {
            this.where('vehicle_set_date', '>=', knex.raw(`NOW() - INTERVAL '${days} days'`))
              .orWhereNull('vehicle_set_date');
          }
        });
      }).orWhere(function() {
        // RESTOCK alerts — restocking flags, use bone_pile age ceiling
        this.where('source', 'restock').andWhere(function() {
          this.where('vehicle_set_date', '>=', knex.raw(`NOW() - INTERVAL '${days > 0 ? Math.min(days, BONE_MAX_DAYS) : BONE_MAX_DAYS} days'`))
            .orWhereNull('vehicle_set_date');
        });
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

  // Load ALL filtered alerts (pagination at vehicle level, not row level)
  let alertQuery = knex('scout_alerts');
  alertQuery = applyFilters(alertQuery);
  const allAlerts = await alertQuery;

  const meta = await knex('scout_alerts_meta').where('key', 'last_generated').first();
  const lastGenerated = meta ? meta.value : null;

  // --- Build yard lookup for vehicle resolution ---
  const yardRows = await knex('yard').select('id', 'name');
  const yardIdByName = {};
  for (const y of yardRows) yardIdByName[y.name.toLowerCase()] = y.id;

  // --- Group alerts by vehicle composite key ---
  const vehicleGroups = {};
  for (const a of allAlerts) {
    const vKey = [a.vehicle_year, a.vehicle_make, a.vehicle_model, a.yard_name].join('|');
    if (!vehicleGroups[vKey]) vehicleGroups[vKey] = { alerts: [], key: vKey };
    vehicleGroups[vKey].alerts.push(a);
  }

  // --- Resolve yard_vehicle attributes per group ---
  const vehicleAttrMap = {};
  for (const vKey of Object.keys(vehicleGroups)) {
    const [yr, mk, md, yn] = vKey.split('|');
    const yardId = yardIdByName[(yn || '').toLowerCase()];
    if (!yardId) continue;
    try {
      const v = await knex('yard_vehicle')
        .where({ yard_id: yardId, active: true })
        .whereRaw("year::text = ?", [yr])
        .whereRaw("UPPER(make) = UPPER(?)", [mk])
        .whereRaw("UPPER(model) = UPPER(?)", [md])
        .select('id', 'decoded_engine', 'decoded_transmission', 'decoded_drivetrain', 'trim_tier', 'row_number', 'color', 'date_added')
        .orderBy('date_added', 'desc')
        .first();
      if (v) vehicleAttrMap[vKey] = v;
    } catch (e) { /* skip */ }
  }

  // --- Extract partType + partNumberBase from each alert title ---
  for (const a of allAlerts) {
    a._partType = detectPartType(a.source_title) || 'OTHER';
    const pns = extractPartNumbers(a.source_title);
    a._pnBase = (pns[0] && pns[0].base) ? pns[0].base.toUpperCase() : null;
  }

  // --- Batch soldLifetime lookup from SoldItem ---
  const allPNBases = new Set();
  const allPartTypes = new Set();
  for (const a of allAlerts) {
    if (a._pnBase) allPNBases.add(a._pnBase);
    allPartTypes.add(a._partType);
  }
  const soldByPN = {};
  const soldByType = {};
  try {
    if (allPNBases.size > 0) {
      const pnArr = Array.from(allPNBases);
      for (let i = 0; i < pnArr.length; i += 200) {
        const batch = pnArr.slice(i, i + 200);
        const rows = await knex('SoldItem').whereIn('partNumberBase', batch).select('partNumberBase').count('* as c').groupBy('partNumberBase');
        for (const r of rows) soldByPN[r.partNumberBase.toUpperCase()] = parseInt(r.c);
      }
    }
    for (const pt of allPartTypes) {
      const r = await knex('SoldItem').where('partType', pt).count('* as c').first();
      soldByType[pt] = parseInt(r?.c || 0);
    }
  } catch (e) { /* SoldItem may not have these columns */ }

  // --- Build vehicle entries with hard/soft dedup ---
  const vehicles = [];
  for (const [vKey, group] of Object.entries(vehicleGroups)) {
    const [yr, mk, md, yn] = vKey.split('|');
    const attr = vehicleAttrMap[vKey] || {};
    const alerts = group.alerts;

    // Group alerts by partType
    const byType = {};
    for (const a of alerts) {
      if (!byType[a._partType]) byType[a._partType] = [];
      byType[a._partType].push(a);
    }

    const parts = [];
    for (const [partType, typeAlerts] of Object.entries(byType)) {
      const isHard = HARD_PART_TYPES.has(partType);
      const dedupGroups = {};

      for (const a of typeAlerts) {
        const dedupKey = isHard ? (a._pnBase || partType + '_nopn') : partType;
        if (!dedupGroups[dedupKey]) dedupGroups[dedupKey] = { alerts: [], pnCounts: {} };
        dedupGroups[dedupKey].alerts.push(a);
        if (a._pnBase) dedupGroups[dedupKey].pnCounts[a._pnBase] = (dedupGroups[dedupKey].pnCounts[a._pnBase] || 0) + 1;
      }

      const rows = [];
      for (const [dedupKey, dg] of Object.entries(dedupGroups)) {
        const prices = dg.alerts.map(a => parseFloat(a.part_value) || 0).filter(p => p > 0);
        const topScore = Math.max(...dg.alerts.map(a => a.match_score || 0));
        const topSource = dg.alerts.reduce((best, a) => {
          const p = SOURCE_PRIORITY[a.source] || 0;
          return p > (SOURCE_PRIORITY[best] || 0) ? a.source : best;
        }, dg.alerts[0].source);

        const pnBreakdown = isHard ? [] : Object.entries(dg.pnCounts).map(([pn, c]) => ({ pn, count: c })).sort((a, b) => b.count - a.count);
        const lifetime = isHard && dedupKey !== partType + '_nopn'
          ? (soldByPN[dedupKey] || 0)
          : (soldByType[partType] || 0);

        rows.push({
          dedupKey,
          partNumberBreakdown: pnBreakdown,
          soldHere: dg.alerts.length,
          soldLifetime: lifetime,
          priceMin: prices.length > 0 ? Math.min(...prices) : null,
          priceMax: prices.length > 0 ? Math.max(...prices) : null,
          topScore,
          topSource,
          alertIds: dg.alerts.map(a => a.id),
          claimed: dg.alerts.some(a => a.claimed),
        });
      }

      rows.sort((a, b) => b.topScore - a.topScore || b.soldHere - a.soldHere);
      parts.push({ partType, isHardType: isHard, rows });
    }

    // Headline = highest priority source + highest score across all alerts
    const headlineSource = alerts.reduce((best, a) => {
      const p = SOURCE_PRIORITY[a.source] || 0;
      return p > (SOURCE_PRIORITY[best] || 0) ? a.source : best;
    }, alerts[0].source);
    const headlineScore = Math.max(...alerts.map(a => a.match_score || 0));

    // Days since set
    const setDate = attr.date_added || null;
    let daysSinceSet = null;
    if (setDate) {
      const sd = new Date(setDate);
      daysSinceSet = Math.max(0, Math.floor((Date.now() - sd.getTime()) / 86400000));
    }

    vehicles.push({
      vehicleKey: vKey,
      yard_name: yn,
      year: yr, make: mk, model: md,
      color: attr.color || alerts[0]?.vehicle_color || null,
      row: attr.row_number || alerts[0]?.row || null,
      decoded_engine: attr.decoded_engine || null,
      decoded_transmission: attr.decoded_transmission || null,
      decoded_drivetrain: attr.decoded_drivetrain || null,
      trim_tier: attr.trim_tier || null,
      set_date: setDate,
      days_since_set: daysSinceSet,
      headline_source: headlineSource,
      headline_score: headlineScore,
      alert_count: alerts.length,
      parts,
    });
  }

  // Sort vehicles: headline_score DESC, alert_count DESC
  vehicles.sort((a, b) => b.headline_score - a.headline_score || b.alert_count - a.alert_count);

  // Paginate at vehicle level
  const totalVehicles = vehicles.length;
  const pagedVehicles = vehicles.slice((page - 1) * perPage, page * perPage);

  // Group paged vehicles by yard for response
  const byYard = {};
  for (const v of pagedVehicles) {
    const y = v.yard_name || 'Unknown';
    if (!byYard[y]) byYard[y] = [];
    byYard[y].push(v);
  }

  // Source counts (from all alerts, not just paged)
  const srcCounts = {};
  for (const a of allAlerts) { srcCounts[a.source] = (srcCounts[a.source] || 0) + 1; }

  res.json({
    success: true,
    vehicles: byYard,
    yardCounts: Object.entries(byYard).map(([yard, vs]) => ({ yard, count: vs.length })),
    boneCount: srcCounts['bone_pile'] || 0,
    perchCount: srcCounts['hunters_perch'] || 0,
    markCount: srcCounts['PERCH'] || 0,
    overstockCount: srcCounts['OVERSTOCK'] || 0,
    restockCount: srcCounts['restock'] || 0,
    total: totalVehicles, page, totalPages: Math.ceil(totalVehicles / perPage),
    lastGenerated,
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
