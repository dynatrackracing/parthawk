'use strict';

const router = require('express-promise-router')();
const { database } = require('../database/database');
const { matchPartToSales, matchPartToYardVehicles, parseTitle, loadModelsFromDB } = require('../utils/partMatcher');
const { extractPartNumbers, parseYearRange: piParseYearRange } = require('../utils/partIntelligence');

/**
 * Count stocked items for a HUNTERS PERCH entry.
 * TIER 1: Part number match (from architect's partNumberExtractor)
 * TIER 2: Year + Model + Part phrase (vehicle-specific)
 * TIER 3: Keyword fallback (flagged as unreliable)
 */
async function countStockedForEntry(knex, title) {
  // TIER 1: Part number match
  const partNumbers = extractPartNumbers(title);
  const realPNs = partNumbers.filter(pn => pn.normalized.length >= 6);

  if (realPNs.length > 0) {
    let q = knex('YourListing').where('listingStatus', 'Active');
    q = q.where(function() {
      for (const pn of realPNs) {
        this.orWhere('title', 'ilike', `%${pn.normalized}%`);
        if (pn.base !== pn.normalized) this.orWhere('title', 'ilike', `%${pn.base}%`);
        // Also match with original formatting (dashes etc)
        const rawUp = pn.raw.toUpperCase();
        if (rawUp !== pn.normalized) this.orWhere('title', 'ilike', `%${rawUp}%`);
      }
    });
    const listings = await q.select('title').limit(20);
    return {
      stock: listings.length,
      matchedTitles: listings.map(l => l.title),
      method: 'PART_NUMBER',
      debug: `PN: ${realPNs[0].raw} (${listings.length} found)`
    };
  }

  // TIER 2: Year + Model + Part phrase (vehicle-specific via Auto table)
  await loadModelsFromDB();
  const parsed = parseTitle(title);
  if (parsed && parsed.models.length > 0 && parsed.partPhrase) {
    let q = knex('YourListing').where('listingStatus', 'Active');
    q = q.where(function() {
      for (const model of parsed.models) this.orWhere('title', 'ilike', `%${model}%`);
    });
    q = q.andWhere('title', 'ilike', `%${parsed.partPhrase}%`);
    const allListings = await q.select('title').limit(50);
    // Year filter
    const filtered = parsed.yearStart && parsed.yearEnd
      ? allListings.filter(l => {
          const ly = extractYearsFromListingTitle(l.title);
          if (!ly) return true;
          return ly.start <= parsed.yearEnd && ly.end >= parsed.yearStart;
        })
      : allListings;
    const yearLabel = parsed.yearStart ? (parsed.yearStart === parsed.yearEnd ? String(parsed.yearStart) : parsed.yearStart + '-' + parsed.yearEnd) : null;
    const debug = [yearLabel, parsed.models.join('/'), '"' + parsed.partPhrase + '"'].filter(Boolean).join(' + ');
    return {
      stock: filtered.length,
      matchedTitles: filtered.slice(0, 10).map(l => l.title),
      method: 'VEHICLE_MATCH',
      debug: `${debug} (${filtered.length} found)`
    };
  }

  // TIER 3: Keyword fallback — flag as unreliable
  if (parsed && parsed.make && parsed.partPhrase) {
    let q = knex('YourListing').where('listingStatus', 'Active');
    q = q.andWhere('title', 'ilike', `%${parsed.make}%`);
    q = q.andWhere('title', 'ilike', `%${parsed.partPhrase}%`);
    const allListings = await q.select('title').limit(50);
    const filtered = parsed.yearStart && parsed.yearEnd
      ? allListings.filter(l => {
          const ly = extractYearsFromListingTitle(l.title);
          if (!ly) return true;
          return ly.start <= parsed.yearEnd && ly.end >= parsed.yearStart;
        })
      : allListings;
    return {
      stock: filtered.length,
      matchedTitles: filtered.slice(0, 10).map(l => l.title),
      method: 'KEYWORD',
      debug: `${parsed.make} + "${parsed.partPhrase}" (${filtered.length} found, keyword)`
    };
  }

  return { stock: 0, matchedTitles: [], method: 'NO_MATCH', debug: 'Could not extract part number or vehicle' };
}

function extractYearsFromListingTitle(title) {
  const range = title.match(/\b(19|20)(\d{2})\s*[-–]\s*(19|20)?(\d{2})\b/);
  if (range) {
    const start = parseInt(range[1] + range[2]);
    const end = range[3] ? parseInt(range[3] + range[4]) : parseInt(range[1] + range[4]);
    return { start, end };
  }
  const single = title.match(/\b((?:19|20)\d{2})\b/);
  if (single) { const y = parseInt(single[1]); return { start: y, end: y }; }
  return null;
}

// Diagnostic endpoint
router.get('/debug/:id', async (req, res) => {
  const item = await database('restock_want_list').where({ id: req.params.id }).first();
  if (!item) return res.status(404).json({ error: 'Not found' });

  const pns = extractPartNumbers(item.title);
  const listings = await countStockedForEntry(database, item.title);
  const sales = await matchPartToSales(item.title);
  const parsed = parseTitle(item.title);

  res.json({ wantTitle: item.title, extractedPNs: pns, parsed, listings, sales });
});

// Get active want list items with stock counts and sale data
// ?manual_only=true to exclude auto-generated entries
router.get('/items', async (req, res) => {
  await loadModelsFromDB();
  let q = database('restock_want_list').where({ active: true }).orderBy('created_at', 'asc');
  if (req.query.manual_only === 'true') {
    q = q.where(function() { this.where('auto_generated', false).orWhereNull('auto_generated'); });
  }
  const items = await q;

  const knex = database;
  const results = [];
  for (const item of items) {
    const listings = await countStockedForEntry(knex, item.title);
    const sales = await matchPartToSales(item.title);

    results.push({
      id: item.id,
      title: item.title,
      notes: item.notes,
      pulled: item.pulled || false,
      pulled_date: item.pulled_date,
      pulled_from: item.pulled_from || null,
      stock: listings.stock,
      avgPrice: sales.avgPrice,
      lastSold: sales.lastSold,
      matchedTitles: listings.matchedTitles,
      matchMethod: listings.method,
      confidence: listings.method === 'PART_NUMBER' ? 'high' : listings.method === 'VEHICLE_MATCH' ? 'medium' : listings.method === 'KEYWORD' ? 'low' : 'none',
      matchDebug: listings.debug,
      created_at: item.created_at
    });
  }

  // Sort: OUT OF STOCK (0, not pulled) > PULLED > LOW (1-2) > STOCKED (3+)
  results.sort((a, b) => {
    const rank = (item) => {
      if (item.stock === 0 && !item.pulled) return 0;
      if (item.pulled) return 1;
      if (item.stock <= 2) return 2;
      return 3;
    };
    const ra = rank(a), rb = rank(b);
    if (ra !== rb) return ra - rb;
    return a.stock - b.stock;
  });

  res.json({ success: true, items: results, total: results.length });
});

// "Just Sold" — perch items that sold in the last 3 days
// Uses shared parseTitle for strict model+part matching (no loose keyword overlap)
router.get('/just-sold', async (req, res) => {
  const wantList = await database('restock_want_list').where({ active: true });
  const recentSales = await database('YourSale')
    .where('soldDate', '>=', database.raw("NOW() - INTERVAL '3 days'"))
    .whereNotNull('title')
    .select('title', 'salePrice', 'soldDate')
    .orderBy('soldDate', 'desc');

  // Pre-parse each want list item (with numeric model fix for Mazda 6, BMW 3, etc.)
  const parsedWantList = wantList.map(item => {
    const parsed = parseTitle(item.title);
    if (parsed && parsed.models.length === 0) {
      // Handle numeric model names: "Mazda 6", "BMW 3", "Audi 4"
      const numMatch = item.title.match(/\b(mazda|bmw|audi|saab)\s*(\d{1,2})\b/i);
      if (numMatch) parsed.models.push(numMatch[1].toLowerCase() + ' ' + numMatch[2]);
      // Handle combined form: "Mazda6", "Mazda3"
      const combined = item.title.match(/\b(mazda|bmw)(\d{1,2})\b/i);
      if (combined && parsed.models.length === 0) parsed.models.push(combined[1].toLowerCase() + ' ' + combined[2]);
    }
    return { title: item.title, parsed, yearRange: piParseYearRange(item.title) };
  }).filter(w => w.parsed);

  // Group sales by want list item — strict matching: model + part phrase + year overlap
  const grouped = new Map();
  for (const sale of recentSales) {
    const saleLower = (sale.title || '').toLowerCase();
    // Normalize for numeric models: "Mazda6" → "Mazda 6", "BMW328i" → "BMW 328i"
    const saleNorm = saleLower.replace(/([a-z])(\d)/gi, '$1 $2');

    for (const want of parsedWantList) {
      const p = want.parsed;

      // Must match at least one model (or make if no model)
      let vehicleMatch = false;
      if (p.models.length > 0) {
        vehicleMatch = p.models.some(m => {
          const mLower = m.toLowerCase();
          return saleLower.includes(mLower) || saleNorm.includes(mLower);
        });
      } else if (p.make) {
        vehicleMatch = saleLower.includes(p.make.toLowerCase());
      }
      if (!vehicleMatch) continue;

      // Must match part phrase or at least 2 part words
      let partMatch = false;
      if (p.partPhrase) {
        partMatch = saleLower.includes(p.partPhrase);
      } else if (p.partWords.length >= 2) {
        const wordHits = p.partWords.filter(w => saleLower.includes(w));
        partMatch = wordHits.length >= 2;
      }
      if (!partMatch) continue;

      // Year range filtering: sale's year range must overlap want list's year range
      const saleYearRange = piParseYearRange(sale.title);
      if (saleYearRange && want.yearRange) {
        const overlaps = saleYearRange.start <= want.yearRange.end && saleYearRange.end >= want.yearRange.start;
        if (!overlaps) continue; // Wrong year range — skip
      }

      const daysAgo = Math.floor((Date.now() - new Date(sale.soldDate).getTime()) / 86400000);
      if (!grouped.has(want.title)) {
        grouped.set(want.title, { wantTitle: want.title, sales: [], matchedSaleTitles: [] });
      }
      const g = grouped.get(want.title);
      g.sales.push({
        price: Math.round(parseFloat(sale.salePrice) || 0),
        soldAgo: daysAgo <= 0 ? 'today' : daysAgo + 'd ago',
      });
      if (g.matchedSaleTitles.length < 5) g.matchedSaleTitles.push(sale.title);
      break; // one want match per sale
    }
  }

  // Fetch yard matches once per grouped item
  const results = [];
  for (const [, group] of grouped) {
    const yardVehicles = await matchPartToYardVehicles(group.wantTitle);
    results.push({
      wantTitle: group.wantTitle,
      sales: group.sales,
      matchedSaleTitles: group.matchedSaleTitles,
      yardMatches: yardVehicles.slice(0, 5).map(v => ({
        desc: [v.year, v.make, v.model].filter(Boolean).join(' '),
        yard: v.yard, row: v.row
      }))
    });
  }

  res.json({ success: true, items: results });
});

// Toggle pulled status — syncs with scout_alerts
router.post('/pull', async (req, res) => {
  const { id, pulled } = req.body;
  if (!id) return res.status(400).json({ error: 'ID required' });

  const item = await database('restock_want_list').where({ id }).first();
  await database('restock_want_list').where({ id }).update({
    pulled: !!pulled,
    pulled_date: pulled ? new Date().toISOString() : null,
    pulled_from: pulled ? null : null, // no yard context when pulled from PERCH page
  });

  // Sync: mark matching scout_alerts as claimed/unclaimed
  if (item) {
    await database('scout_alerts')
      .where('source', 'hunters_perch')
      .where('source_title', item.title)
      .update({
        claimed: !!pulled,
        claimed_at: pulled ? new Date().toISOString() : null,
      });
  }

  res.json({ success: true });
});

// Find matching vehicles in yards
router.post('/find-in-yard', async (req, res) => {
  const { title } = req.body;
  if (!title) return res.status(400).json({ error: 'Title required' });

  const vehicles = await matchPartToYardVehicles(title);
  res.json({ success: true, vehicles });
});

// Add a new part
router.post('/add', async (req, res) => {
  const { title, notes } = req.body;
  if (!title || !title.trim()) return res.status(400).json({ error: 'Title required' });

  const [item] = await database('restock_want_list')
    .insert({ title: title.trim(), notes: notes || null, active: true })
    .returning('*');

  res.json({ success: true, item });
});

// Delete (soft) a part
router.post('/delete', async (req, res) => {
  const { id } = req.body;
  if (!id) return res.status(400).json({ error: 'ID required' });

  await database('restock_want_list').where({ id }).update({ active: false });
  res.json({ success: true });
});

// ══════════════════════════════════════════════════════════════
// WATCHLIST — curated manual list for SCOUR STREAM pullers
// ══════════════════════════════════════════════════════════════

// Ensure table exists
async function ensureWatchlistTable() {
  try { await database.raw('SELECT 1 FROM restock_watchlist LIMIT 0'); }
  catch (e) {
    await database.raw(`
      CREATE TABLE IF NOT EXISTS restock_watchlist (
        id SERIAL PRIMARY KEY, part_number_base VARCHAR(50) NOT NULL UNIQUE,
        part_description TEXT, target_stock INTEGER DEFAULT 1,
        priority VARCHAR(20) DEFAULT 'normal', notes TEXT,
        added_at TIMESTAMP DEFAULT NOW(), active BOOLEAN DEFAULT TRUE
      )
    `);
  }
}

/**
 * GET /restock-want-list/watchlist
 * Returns curated watchlist with live stock counts + market data.
 */
router.get('/watchlist', async (req, res) => {
  await ensureWatchlistTable();
  const items = await database('restock_watchlist').where('active', true).orderBy('priority', 'desc').orderBy('added_at', 'asc');

  const results = [];
  for (const item of items) {
    const pn = item.part_number_base;

    // Stock count: YourListing ONLY
    let stock = 0;
    try {
      const listings = await database('YourListing')
        .where('listingStatus', 'Active')
        .where(function() {
          this.where('title', 'ilike', `%${pn}%`).orWhere('sku', 'ilike', `%${pn}%`);
        })
        .select(database.raw('SUM(COALESCE("quantityAvailable"::int, 1)) as qty'));
      stock = parseInt(listings[0]?.qty) || 0;
    } catch (e) {}

    // Last sold from YourSale
    let lastSold = null, lastSoldPrice = null;
    try {
      const sale = await database('YourSale')
        .where('title', 'ilike', `%${pn}%`)
        .orderBy('soldDate', 'desc').first();
      if (sale) { lastSold = sale.soldDate; lastSoldPrice = parseFloat(sale.salePrice) || null; }
    } catch (e) {}

    // Market data from cache
    let marketMedian = null, marketSold = null, marketVelocity = null;
    try {
      const cached = await database('market_demand_cache')
        .where('part_number_base', pn)
        .where('ebay_avg_price', '>', 0).first();
      if (cached) {
        marketMedian = parseFloat(cached.ebay_avg_price) || null;
        marketSold = parseInt(cached.ebay_sold_90d) || null;
        marketVelocity = cached.market_velocity || null;
      }
    } catch (e) {}

    // Days since last in stock
    let daysSinceStocked = null;
    try {
      const lastListing = await database('YourSale')
        .where('title', 'ilike', `%${pn}%`)
        .orderBy('soldDate', 'desc').first();
      if (lastListing) {
        daysSinceStocked = Math.floor((Date.now() - new Date(lastListing.soldDate).getTime()) / 86400000);
      }
    } catch (e) {}

    results.push({
      id: item.id,
      partNumberBase: item.part_number_base,
      description: item.part_description,
      targetStock: item.target_stock,
      priority: item.priority,
      notes: item.notes,
      stock,
      lastSold,
      lastSoldPrice,
      marketMedian,
      marketSold,
      marketVelocity,
      daysSinceStocked,
      needsRestock: stock < (item.target_stock || 1),
    });
  }

  // Sort: out of stock + high market demand first
  results.sort((a, b) => {
    if (a.needsRestock !== b.needsRestock) return a.needsRestock ? -1 : 1;
    const prioRank = { high: 0, normal: 1, low: 2 };
    if ((prioRank[a.priority] || 1) !== (prioRank[b.priority] || 1)) return (prioRank[a.priority] || 1) - (prioRank[b.priority] || 1);
    return (b.marketMedian || 0) - (a.marketMedian || 0);
  });

  res.json({ success: true, items: results, total: results.length });
});

// POST /restock-want-list/watchlist/add
router.post('/watchlist/add', async (req, res) => {
  await ensureWatchlistTable();
  const { partNumberBase, description, targetStock, priority, notes } = req.body;
  if (!partNumberBase) return res.status(400).json({ error: 'partNumberBase required' });
  try {
    await database('restock_watchlist').insert({
      part_number_base: partNumberBase.trim().toUpperCase(),
      part_description: description || null,
      target_stock: targetStock || 1,
      priority: priority || 'normal',
      notes: notes || null,
    });
    res.json({ success: true });
  } catch (e) {
    if (e.message.includes('unique')) return res.json({ success: true, message: 'Already on watchlist' });
    res.status(500).json({ error: e.message });
  }
});

// POST /restock-want-list/watchlist/remove
router.post('/watchlist/remove', async (req, res) => {
  const { id } = req.body;
  if (!id) return res.status(400).json({ error: 'id required' });
  await database('restock_watchlist').where({ id }).update({ active: false });
  res.json({ success: true });
});

// POST /restock-want-list/watchlist/update
router.post('/watchlist/update', async (req, res) => {
  const { id, targetStock, priority, notes } = req.body;
  if (!id) return res.status(400).json({ error: 'id required' });
  const update = {};
  if (targetStock !== undefined) update.target_stock = targetStock;
  if (priority) update.priority = priority;
  if (notes !== undefined) update.notes = notes;
  await database('restock_watchlist').where({ id }).update(update);
  res.json({ success: true });
});

// ══════════════════════════════════════════════════════════════
// OVERSTOCK WATCH — track high-quantity items for restock alerts
// ══════════════════════════════════════════════════════════════

router.get('/overstock', async (req, res) => {
  const items = await database('overstock_watch')
    .leftJoin('YourListing', 'YourListing.ebayItemId', 'overstock_watch.ebay_item_id')
    .select(
      'overstock_watch.*',
      'YourListing.quantityAvailable as live_quantity',
      'YourListing.listingStatus as live_status'
    )
    .orderByRaw(`
      CASE overstock_watch.status
        WHEN 'triggered' THEN 0
        WHEN 'watching' THEN 1
        WHEN 'acknowledged' THEN 2
        ELSE 3
      END
    `)
    .orderByRaw(`
      CASE overstock_watch.status
        WHEN 'triggered' THEN EXTRACT(EPOCH FROM overstock_watch.triggered_at)
        WHEN 'watching' THEN EXTRACT(EPOCH FROM overstock_watch.created_at)
        WHEN 'acknowledged' THEN EXTRACT(EPOCH FROM overstock_watch.acknowledged_at)
        ELSE 0
      END DESC
    `);

  res.json(items);
});

router.post('/overstock/add', async (req, res) => {
  const { ebayItemId, restockTarget = 1, notes } = req.body;
  if (!ebayItemId) return res.status(400).json({ error: 'eBay item ID required.' });

  const listing = await database('YourListing').where('ebayItemId', ebayItemId).first();
  if (!listing) return res.status(400).json({ error: 'Listing not found in your inventory.' });

  const qty = parseInt(listing.quantityAvailable) || 0;
  if (qty < 3) return res.status(400).json({ error: `This listing only has ${qty} in stock. Overstock tracking requires 3+.` });

  const target = parseInt(restockTarget);
  if (isNaN(target) || target < 0) return res.status(400).json({ error: 'Restock target cannot be negative.' });
  if (target >= qty) return res.status(400).json({ error: `Restock target must be below current stock (${qty}).` });

  const existing = await database('overstock_watch').where('ebay_item_id', ebayItemId).first();
  if (existing) return res.status(400).json({ error: 'Already tracking this item.' });

  const [row] = await database('overstock_watch').insert({
    ebay_item_id: ebayItemId,
    title: listing.title || ebayItemId,
    part_number_base: null,
    current_quantity: qty,
    initial_quantity: qty,
    restock_target: target,
    status: 'watching',
    notes: notes || null,
    created_at: new Date(),
    updated_at: new Date(),
  }).returning('*');

  res.json(row);
});

router.post('/overstock/acknowledge', async (req, res) => {
  const { id } = req.body;
  if (!id) return res.status(400).json({ error: 'ID required.' });

  const [row] = await database('overstock_watch').where({ id }).update({
    status: 'acknowledged',
    acknowledged_at: new Date(),
    updated_at: new Date(),
  }).returning('*');

  res.json(row);
});

router.post('/overstock/rewatch', async (req, res) => {
  const { id, restockTarget } = req.body;
  if (!id) return res.status(400).json({ error: 'ID required.' });

  const item = await database('overstock_watch').where({ id }).first();
  if (!item) return res.status(404).json({ error: 'Not found.' });

  const listing = await database('YourListing').where('ebayItemId', item.ebay_item_id).first();
  const qty = listing ? (parseInt(listing.quantityAvailable) || 0) : 0;
  if (qty < 3) return res.status(400).json({ error: `Stock is only at ${qty}. Need 3+ to re-watch.` });

  const update = {
    status: 'watching',
    current_quantity: qty,
    triggered_at: null,
    acknowledged_at: null,
    updated_at: new Date(),
  };

  if (restockTarget !== undefined && restockTarget !== null) {
    const target = parseInt(restockTarget);
    if (!isNaN(target) && target >= 0 && target < qty) {
      update.restock_target = target;
    }
  }

  const [row] = await database('overstock_watch').where({ id }).update(update).returning('*');
  res.json(row);
});

router.post('/overstock/delete', async (req, res) => {
  const { id } = req.body;
  if (!id) return res.status(400).json({ error: 'ID required.' });

  const item = await database('overstock_watch').where({ id }).first();
  if (item) {
    await database('scout_alerts')
      .where('source', 'OVERSTOCK')
      .where('source_title', 'like', `%${item.ebay_item_id}%`)
      .del();
  }
  await database('overstock_watch').where({ id }).del();
  res.json({ success: true });
});

router.post('/overstock/check-now', async (req, res) => {
  const OverstockCheckService = require('../services/OverstockCheckService');
  const service = new OverstockCheckService();
  const result = await service.checkAll();
  res.json(result);
});

module.exports = router;
