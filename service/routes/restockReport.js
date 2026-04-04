'use strict';

const router = require('express-promise-router')();
const { database } = require('../database/database');

/**
 * THE QUARRY — Restock Intelligence
 *
 * Data source: YourSale (own sales) cross-referenced against YourListing (active stock).
 * Groups by Clean Pipe columns: partNumberBase, extractedMake, extractedModel.
 * Shows parts sold in last N days that are currently out of stock.
 * Sorted by revenue impact (times_sold x avg_price DESC).
 *
 * No Item table dependency. No title scanning. Clean Pipe only.
 */

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

      // === SCORING: price is king ===
      let score = 0;
      // Price (dominant factor, max 35)
      score += avgPrice >= 500 ? 35 : avgPrice >= 300 ? 28 : avgPrice >= 200 ? 22 : avgPrice >= 150 ? 15 : avgPrice >= 100 ? 10 : 5;
      // Stock urgency (max 30)
      score += stock === 0 ? 30 : stock === 1 ? 20 : (timesSold > stock ? 10 : 0);
      // Demand volume (max 20)
      score += timesSold >= 4 ? 20 : timesSold >= 3 ? 15 : timesSold >= 2 ? 10 : 5;
      // Recency (max 15)
      const daysSince = lastSold ? Math.floor((Date.now() - new Date(lastSold).getTime()) / 86400000) : 99;
      score += daysSince <= 3 ? 15 : daysSince <= 7 ? 12 : daysSince <= 14 ? 8 : 4;
      score = Math.min(100, score);

      // Floor rules: high-value parts always surface
      if (avgPrice >= 500 && timesSold >= 1 && stock <= 1) score = Math.max(score, 85);
      if (avgPrice >= 300 && timesSold >= 1 && stock <= 1) score = Math.max(score, 75);
      if (avgPrice >= 200 && timesSold >= 2 && stock === 0) score = Math.max(score, 75);

      const action = stock === 0 ? 'RESTOCK NOW' : stock === 1 ? 'LOW STOCK' : (timesSold > stock ? 'SELLING FAST' : 'MONITOR');

      items.push({
        score, action, make, model, partType,
        basePn: pn, variantPns: [], yearRange,
        sold7d: timesSold, activeStock: stock, avgPrice,
        revenue: Math.round(totalRevenue),
        daysSinceSold: daysSince, sampleTitle,
        marketPrice, lastSold,
      });
    }

    // Filter: out of stock, low stock, high-value, or selling faster than stocked
    const filtered = items.filter(i => i.activeStock <= 1 || i.sold7d > i.activeStock || i.avgPrice >= 300);
    filtered.sort((a, b) => b.score - a.score || b.revenue - a.revenue);
    const top = filtered.slice(0, 100);

    // Tier assignment
    const tiers = { green: [], yellow: [], orange: [] };
    for (const item of top) {
      if (item.score >= 75) { item.tier = 'green'; tiers.green.push(item); }
      else if (item.score >= 60) { item.tier = 'yellow'; tiers.yellow.push(item); }
      else { item.tier = 'orange'; tiers.orange.push(item); }
    }

    res.json({
      success: true, generatedAt: new Date().toISOString(), days,
      period: days === 1 ? 'Last 24 hours' : `Last ${days} days`,
      tiers,
      summary: {
        green: tiers.green.length, yellow: tiers.yellow.length, orange: tiers.orange.length,
        total: top.length, salesAnalyzed, activeListings: activeListingCount,
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message, stack: err.stack });
  }
});

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

module.exports = router;
