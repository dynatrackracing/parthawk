'use strict';

const router = require('express-promise-router')();
const { database } = require('../database/database');
const { log } = require('../lib/logger');

/**
 * THE QUARRY — Restock Intelligence
 *
 * Data source: YourSale (own sales) cross-referenced against YourListing (active stock).
 * Velocity ratio: sold_count / in_stock over N days.
 * CRITICAL (ratio>=4 or 0 stock+sold 3x+$100+): auto-add to want list
 * LOW (ratio>=2 or 0 stock): auto-add to want list
 * WATCH (ratio>=1): show on page, manual add
 * FINE (ratio<1): filtered out
 *
 * No Item table dependency. No title scanning. Clean Pipe only.
 */

function getUrgency(soldCount, inStock, avgPrice, totalRevenue) {
  // Zero stock + high value = always CRITICAL
  if (inStock === 0 && avgPrice >= 200 && soldCount >= 1) return 'CRITICAL';
  if (inStock === 0 && totalRevenue >= 500) return 'CRITICAL';
  if (inStock === 0 && soldCount >= 3 && avgPrice >= 100) return 'CRITICAL';
  if (inStock === 0 && soldCount >= 2) return 'CRITICAL';
  if (inStock === 0) return 'LOW';
  var ratio = soldCount / inStock;
  if (ratio >= 4) return 'CRITICAL';
  if (ratio >= 2) return 'LOW';
  if (ratio >= 1) return 'WATCH';
  return null;
}

router.get('/report', async (req, res) => {
  try {
    const days = Math.min(Math.max(parseInt(req.query.days || req.query.period) || 30, 1), 365);

    // ── 1. Sales grouped by Clean Pipe columns ──
    const salesResult = await database.raw(`
      SELECT
        ys."partNumberBase",
        ys."partType",
        ys."extractedMake",
        ys."extractedModel",
        COUNT(*)::int                            AS times_sold,
        ROUND(AVG(ys."salePrice"::numeric), 2)   AS avg_price,
        ROUND(SUM(ys."salePrice"::numeric), 2)   AS total_revenue,
        MAX(ys."soldDate")                        AS last_sold,
        MIN(ys.title)                             AS sample_title
      FROM "YourSale" ys
      WHERE ys."soldDate" >= NOW() - INTERVAL '1 day' * ?
        AND ys."partNumberBase" IS NOT NULL
        AND ys."partNumberBase" != ''
        AND ys."salePrice"::numeric >= 50
      GROUP BY ys."partNumberBase", ys."partType", ys."extractedMake", ys."extractedModel"
      ORDER BY SUM(ys."salePrice"::numeric) DESC
    `, [days]);
    const salesGroups = salesResult.rows || [];

    // ── 2. Active stock grouped by Clean Pipe columns ──
    const stockResult = await database.raw(`
      SELECT
        yl."partNumberBase",
        yl."extractedMake",
        yl."extractedModel",
        SUM(COALESCE(yl."quantityAvailable"::int, 1))::int AS stock
      FROM "YourListing" yl
      WHERE yl."listingStatus" = 'Active'
        AND yl."partNumberBase" IS NOT NULL
        AND yl."partNumberBase" != ''
      GROUP BY yl."partNumberBase", yl."extractedMake", yl."extractedModel"
    `);

    // Stock lookup: exact key (pn|make|model) + fallback by pn only
    const stockExact = {};
    const stockByPn = {};
    for (const row of (stockResult.rows || [])) {
      const key = `${row.partNumberBase}|${row.extractedMake || ''}|${row.extractedModel || ''}`;
      stockExact[key] = parseInt(row.stock) || 0;
      stockByPn[row.partNumberBase] = (stockByPn[row.partNumberBase] || 0) + (parseInt(row.stock) || 0);
    }

    // ── 3. Market prices from market_demand_cache ──
    const marketRows = await database('market_demand_cache')
      .whereNotNull('part_number_base')
      .select('part_number_base', 'ebay_avg_price', 'ebay_sold_90d', 'ebay_active_listings')
      .catch(() => []);
    const marketMap = {};
    for (const m of marketRows) marketMap[m.part_number_base] = m;

    // ── 4. Total sales analyzed ──
    const countResult = await database.raw(`
      SELECT COUNT(*)::int AS cnt FROM "YourSale"
      WHERE "soldDate" >= NOW() - INTERVAL '1 day' * ?
        AND "salePrice"::numeric >= 50
    `, [days]);
    const salesAnalyzed = (countResult.rows[0] || {}).cnt || 0;

    // ── 5. Active listing count ──
    let activeListingCount = 0;
    try {
      const lc = await database('YourListing').where('listingStatus', 'Active').count('* as cnt').first();
      activeListingCount = parseInt(lc?.cnt || 0);
    } catch (e) { /* ignore */ }

    // ── 6. Build scored items ──
    const items = [];
    for (const g of salesGroups) {
      const pn = g.partNumberBase;
      const make = g.extractedMake || '?';
      const model = g.extractedModel || '';
      const partType = g.partType || '';
      const sampleTitle = g.sample_title || '';

      // Stock: exact match (pn + make + model) first, then pn-only fallback
      const exactKey = `${pn}|${make}|${model}`;
      const stock = stockExact[exactKey] != null ? stockExact[exactKey] : (stockByPn[pn] || 0);

      const timesSold = parseInt(g.times_sold) || 0;
      const avgPrice = parseFloat(g.avg_price) || 0;
      const totalRevenue = parseFloat(g.total_revenue) || 0;
      const lastSold = g.last_sold;

      // Market enrichment
      const market = marketMap[pn];
      const marketPrice = market ? parseFloat(market.ebay_avg_price) || null : null;

      // Year range from sample title
      const years = sampleTitle.match(/\b((?:19|20)\d{2})\b/g);
      let yearRange = null;
      if (years) {
        const s = [...new Set(years.map(Number))].sort();
        yearRange = s[0] === s[s.length - 1] ? String(s[0]) : s[0] + '-' + s[s.length - 1];
      }

      // Velocity ratio
      const velocityRatio = stock === 0 ? 999 : Math.round((timesSold / stock) * 100) / 100;
      const urgency = getUrgency(timesSold, stock, avgPrice, totalRevenue);

      // === SCORING: price is king ===
      let score = 0;
      score += avgPrice >= 500 ? 35 : avgPrice >= 300 ? 28 : avgPrice >= 200 ? 22 : avgPrice >= 150 ? 15 : avgPrice >= 100 ? 10 : 5;
      score += stock === 0 ? 30 : stock === 1 ? 20 : (timesSold > stock ? 10 : 0);
      score += timesSold >= 4 ? 20 : timesSold >= 3 ? 15 : timesSold >= 2 ? 10 : 5;
      const daysSince = lastSold ? Math.floor((Date.now() - new Date(lastSold).getTime()) / 86400000) : 99;
      score += daysSince <= 3 ? 15 : daysSince <= 7 ? 12 : daysSince <= 14 ? 8 : 4;
      score = Math.min(100, score);
      if (avgPrice >= 500 && timesSold >= 1 && stock <= 1) score = Math.max(score, 85);
      if (avgPrice >= 300 && timesSold >= 1 && stock <= 1) score = Math.max(score, 75);
      if (avgPrice >= 200 && timesSold >= 2 && stock === 0) score = Math.max(score, 75);

      // Filter out parts where velocity is FINE
      if (!urgency) continue;

      items.push({
        score, urgency, make, model, partType,
        basePn: pn, variantPns: [], yearRange,
        timesSold, inStock: stock, velocityRatio, avgPrice,
        revenue: Math.round(totalRevenue),
        daysSinceSold: daysSince, sampleTitle,
        marketPrice, lastSold,
      });
    }

    // ── 7. Split into tiers and sort each independently ──
    const tierItems = { CRITICAL: [], LOW: [], WATCH: [] };
    for (const item of items) {
      if (tierItems[item.urgency]) tierItems[item.urgency].push(item);
    }

    // Sort within each tier using timeframe-aware tiebreaker
    const tierSorter = days <= 7
      ? (a, b) => b.timesSold - a.timesSold || b.avgPrice - a.avgPrice
      : days <= 30
        ? (a, b) => b.revenue - a.revenue || b.velocityRatio - a.velocityRatio
        : (a, b) => b.velocityRatio - a.velocityRatio || b.revenue - a.revenue;

    for (const tier of Object.values(tierItems)) tier.sort(tierSorter);

    // Full tier counts (before cap — for summary tiles)
    const fullCritical = tierItems.CRITICAL.length;
    const fullLow = tierItems.LOW.length;
    const fullWatch = tierItems.WATCH.length;
    const totalCount = items.length;

    // Cap each tier at 100 rows independently
    const perTierCap = 100;
    const tiers = {
      critical: tierItems.CRITICAL.slice(0, perTierCap),
      low: tierItems.LOW.slice(0, perTierCap),
      watch: tierItems.WATCH.slice(0, perTierCap),
    };

    // ── 8. FOUND count — Cache entries (claimed from Attack List) within the period ──
    let foundCount = 0;
    let foundMap = {};
    try {
      const foundRows = await database('the_cache')
        .where('status', '!=', 'deleted')
        .where('claimed_at', '>=', database.raw("NOW() - INTERVAL '1 day' * ?", [days]))
        .select('part_number', 'yard_name', 'claimed_at', 'vehicle_year', 'vehicle_make', 'vehicle_model');
      for (const f of foundRows) {
        if (f.part_number) {
          foundMap[f.part_number.toUpperCase()] = {
            yard: f.yard_name,
            date: f.claimed_at,
            vehicle: [f.vehicle_year, f.vehicle_make, f.vehicle_model].filter(Boolean).join(' '),
          };
        }
      }
      foundCount = foundRows.length;
    } catch (e) { /* the_cache may not exist */ }

    res.json({
      success: true, generatedAt: new Date().toISOString(), days,
      period: days === 1 ? 'Last 24 hours' : `Last ${days} days`,
      tiers,
      total: totalCount, page: 1, pageSize: perTierCap, totalPages: 1,
      foundCount,
      foundMap,
      summary: {
        critical: fullCritical, low: fullLow, watch: fullWatch,
        total: totalCount, salesAnalyzed, activeListings: activeListingCount,
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message, stack: err.stack });
  }
});

/**
 * POST /restock/quarry-sync
 * Auto-sync CRITICAL and LOW velocity parts → restock_want_list.
 * Removes quarry_auto entries that have been restocked (velocity dropped below LOW).
 */
router.post('/quarry-sync', async (req, res) => {
  try {
    const result = await quarrySync();
    res.json({ success: true, ...result });
  } catch (err) {
    log.error({ err: err.message }, 'quarry-sync failed');
    res.status(500).json({ success: false, error: err.message });
  }
});

async function quarrySync() {
  const days = 90;

  // Run velocity query
  const salesResult = await database.raw(`
    SELECT ys."partNumberBase", ys."partType", ys."extractedMake", ys."extractedModel",
      COUNT(*)::int AS times_sold,
      ROUND(AVG(ys."salePrice"::numeric), 2) AS avg_price,
      MAX(ys."soldDate") AS last_sold,
      MIN(ys.title) AS sample_title
    FROM "YourSale" ys
    WHERE ys."soldDate" >= NOW() - INTERVAL '1 day' * ?
      AND ys."partNumberBase" IS NOT NULL AND ys."partNumberBase" != ''
      AND ys."salePrice"::numeric >= 50
    GROUP BY ys."partNumberBase", ys."partType", ys."extractedMake", ys."extractedModel"
  `, [days]);

  const stockResult = await database.raw(`
    SELECT yl."partNumberBase", yl."extractedMake", yl."extractedModel",
      SUM(COALESCE(yl."quantityAvailable"::int, 1))::int AS stock
    FROM "YourListing" yl
    WHERE yl."listingStatus" = 'Active'
      AND yl."partNumberBase" IS NOT NULL AND yl."partNumberBase" != ''
    GROUP BY yl."partNumberBase", yl."extractedMake", yl."extractedModel"
  `);

  const stockByPn = {};
  for (const row of (stockResult.rows || [])) {
    const key = `${row.partNumberBase}|${row.extractedMake || ''}|${row.extractedModel || ''}`;
    stockByPn[key] = parseInt(row.stock) || 0;
  }

  let criticalCount = 0, lowCount = 0, watchCount = 0, autoAdded = 0;

  for (const g of (salesResult.rows || [])) {
    const pn = g.partNumberBase;
    const make = g.extractedMake || '';
    const model = g.extractedModel || '';
    const timesSold = parseInt(g.times_sold) || 0;
    const avgPrice = parseFloat(g.avg_price) || 0;
    const key = `${pn}|${make}|${model}`;
    const stock = stockByPn[key] || 0;

    const totalRevenue = timesSold * avgPrice;
    const urgency = getUrgency(timesSold, stock, avgPrice, totalRevenue);
    if (!urgency) continue;

    if (urgency === 'CRITICAL') criticalCount++;
    else if (urgency === 'LOW') lowCount++;
    else if (urgency === 'WATCH') watchCount++;

    // Auto-add CRITICAL and LOW to want list
    if (urgency === 'CRITICAL' || urgency === 'LOW') {
      // Build a title that parseTitle() in ScoutAlertService can match to yard vehicles
      const sampleTitle = g.sample_title || '';
      const titleForWantList = sampleTitle || [make, model, g.partType, pn].filter(Boolean).join(' ');

      try {
        // Check if already exists (by title prefix match — same dedup as ScoutAlertService)
        const existing = await database('restock_want_list')
          .whereRaw('LOWER(LEFT(title, 40)) = LOWER(LEFT(?, 40))', [titleForWantList])
          .first();

        if (!existing) {
          await database('restock_want_list').insert({
            title: titleForWantList,
            active: true,
            auto_generated: true,
            notes: `[quarry_auto] ${urgency} — sold ${timesSold}x / ${stock} stock @ $${avgPrice} avg`,
            created_at: new Date(),
          });
          autoAdded++;
        }
      } catch (e) { /* duplicate or constraint — skip */ }
    }
  }

  // Cleanup: remove quarry_auto entries where velocity dropped below LOW (restocked)
  let cleaned = 0;
  try {
    const autoEntries = await database('restock_want_list')
      .where('auto_generated', true)
      .where('active', true)
      .whereRaw("notes LIKE '[quarry_auto]%'")
      .select('id', 'title');

    for (const entry of autoEntries) {
      // Check if the part is now adequately stocked by checking current velocity
      // Simple heuristic: if the title's first 40 chars no longer match any CRITICAL/LOW urgency item, deactivate
      const titlePrefix = (entry.title || '').substring(0, 40).toLowerCase();
      const stillNeeded = (salesResult.rows || []).some(function(g) {
        const sTitle = (g.sample_title || '').substring(0, 40).toLowerCase();
        if (sTitle !== titlePrefix) return false;
        const key = `${g.partNumberBase}|${g.extractedMake || ''}|${g.extractedModel || ''}`;
        const stock = stockByPn[key] || 0;
        const urg = getUrgency(parseInt(g.times_sold) || 0, stock, parseFloat(g.avg_price) || 0);
        return urg === 'CRITICAL' || urg === 'LOW';
      });

      if (!stillNeeded) {
        await database('restock_want_list').where('id', entry.id).update({ active: false });
        cleaned++;
      }
    }
  } catch (e) { /* table issue — non-fatal */ }

  log.info({ criticalCount, lowCount, watchCount, autoAdded, cleaned }, 'quarry-sync complete');
  return { critical: criticalCount, low: lowCount, watch: watchCount, autoAdded, cleaned };
}

/**
 * GET /restock/found-items
 * Returns claimed scout alerts (GOT ONE) so THE QUARRY can show "FOUND" banners.
 */
router.get('/found-items', async (req, res) => {
  try {
    const found = await database('scout_alerts')
      .where('source', 'bone_pile')
      .where('claimed', true)
      .select('source_title', 'yard_name', 'claimed_at', 'vehicle_year', 'vehicle_make', 'vehicle_model');

    const foundMap = {};
    for (const f of found) {
      const key = (f.source_title || '').substring(0, 40).toLowerCase();
      if (!foundMap[key]) {
        foundMap[key] = {
          yard: f.yard_name,
          date: f.claimed_at,
          vehicle: [f.vehicle_year, f.vehicle_make, f.vehicle_model].filter(Boolean).join(' '),
        };
      }
    }

    res.json({ success: true, found: foundMap, count: found.length });
  } catch (err) {
    res.json({ success: true, found: {}, count: 0 });
  }
});

router.quarrySync = quarrySync;
module.exports = router;
