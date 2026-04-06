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
async function countStockedForEntry(knex, title, entryPartNumber, entryMake, entryModel) {
  const { normalizePartNumber } = require('../lib/partNumberUtils');

  // TIER 1: partNumberBase column match (Clean Pipe — accurate, no title ILIKE)
  // Use entry's stored part_number if available, otherwise extract from title
  let lookupPN = entryPartNumber ? normalizePartNumber(entryPartNumber) : null;
  if (!lookupPN) {
    const partNumbers = extractPartNumbers(title);
    const realPNs = partNumbers.filter(pn => pn.base && pn.base.length >= 8); // require 8+ chars to avoid model names
    if (realPNs.length > 0) lookupPN = realPNs[0].base;
  }

  if (lookupPN) {
    let q = knex('YourListing').where('listingStatus', 'Active')
      .where('partNumberBase', lookupPN);
    // Scope by make/model if available
    if (entryMake) q = q.whereRaw('LOWER("extractedMake") = ?', [entryMake.toLowerCase()]);
    if (entryModel) q = q.whereRaw('LOWER("extractedModel") = ?', [entryModel.toLowerCase()]);

    const listings = await q.select('title', knex.raw('COALESCE("quantityAvailable"::int, 1) as qty')).limit(20);
    if (listings.length > 0) {
      const totalStock = listings.reduce((sum, l) => sum + (parseInt(l.qty) || 1), 0);
      return {
        stock: totalStock,
        listingCount: listings.length,
        matchedTitles: listings.map(l => l.title),
        method: 'PART_NUMBER',
        debug: `PN: ${lookupPN} (${listings.length} listing${listings.length !== 1 ? 's' : ''}, ${totalStock} in stock)`
      };
    }
  }

  // TIER 2: Make + Model + part phrase (vehicle-specific, Clean Pipe columns)
  await loadModelsFromDB();
  const parsed = parseTitle(title);
  const make = entryMake || (parsed ? parsed.make : null);
  const model = entryModel || (parsed && parsed.models.length > 0 ? parsed.models[0] : null);

  if (make && model && parsed && parsed.partPhrase) {
    let q = knex('YourListing').where('listingStatus', 'Active');
    q = q.whereRaw('LOWER("extractedMake") = ?', [make.toLowerCase()]);
    q = q.where(function() {
      this.whereRaw('LOWER("extractedModel") = ?', [model.toLowerCase()])
        .orWhere('title', 'ilike', `%${model}%`);
    });
    q = q.andWhere('title', 'ilike', `%${parsed.partPhrase}%`);
    const allListings = await q.select('title', knex.raw('COALESCE("quantityAvailable"::int, 1) as qty')).limit(50);
    const filtered = parsed.yearStart && parsed.yearEnd
      ? allListings.filter(l => {
          const ly = extractYearsFromListingTitle(l.title);
          if (!ly) return true;
          return ly.start <= parsed.yearEnd && ly.end >= parsed.yearStart;
        })
      : allListings;
    const totalStock = filtered.reduce((sum, l) => sum + (parseInt(l.qty) || 1), 0);
    return {
      stock: totalStock,
      listingCount: filtered.length,
      matchedTitles: filtered.slice(0, 10).map(l => l.title),
      method: 'VEHICLE_MATCH',
      debug: `${make} ${model} "${parsed.partPhrase}" (${filtered.length} listing${filtered.length !== 1 ? 's' : ''}, ${totalStock} in stock)`
    };
  }

  // TIER 3: Make + keyword fallback
  if (make && parsed && parsed.partPhrase) {
    let q = knex('YourListing').where('listingStatus', 'Active');
    q = q.whereRaw('LOWER("extractedMake") = ?', [make.toLowerCase()]);
    q = q.andWhere('title', 'ilike', `%${parsed.partPhrase}%`);
    const allListings = await q.select('title', knex.raw('COALESCE("quantityAvailable"::int, 1) as qty')).limit(50);
    const totalStock = allListings.reduce((sum, l) => sum + (parseInt(l.qty) || 1), 0);
    return {
      stock: totalStock,
      listingCount: allListings.length,
      matchedTitles: allListings.slice(0, 10).map(l => l.title),
      method: 'KEYWORD',
      debug: `${make} "${parsed.partPhrase}" (${allListings.length} listing${allListings.length !== 1 ? 's' : ''}, ${totalStock} in stock, keyword)`
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
  const listings = await countStockedForEntry(database, item.title, item.part_number, item.make, item.model);
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
    const listings = await countStockedForEntry(knex, item.title, item.part_number, item.make, item.model);
    const sales = await matchPartToSales(item.title);

    results.push({
      id: item.id,
      title: item.title,
      notes: item.notes,
      pulled: item.pulled || false,
      pulled_date: item.pulled_date,
      pulled_from: item.pulled_from || null,
      stock: listings.stock,
      listingCount: listings.listingCount || listings.stock,
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
  const { title, partNumber, description, make, model, notes } = req.body;
  // Support both old (title-only) and new (PN+description) modes
  let finalTitle = title;
  if (!finalTitle && (partNumber || description)) {
    const parts = [make, model, description, partNumber].filter(Boolean);
    finalTitle = parts.join(' ');
  }
  if (!finalTitle || !finalTitle.trim()) return res.status(400).json({ error: 'Title or description required' });

  const entry = { title: finalTitle.trim(), notes: notes || null, active: true };
  if (partNumber) entry.part_number = partNumber.trim().toUpperCase();
  if (make) entry.make = make.trim();
  if (model) entry.model = model.trim();

  const [item] = await database('restock_want_list')
    .insert(entry)
    .returning('*');

  res.json({ success: true, item });
});

// Update want list entry by title match (used by scout-alerts inline edit)
router.patch('/by-title', async (req, res) => {
  const { oldTitle, title, notes } = req.body;
  if (!oldTitle) return res.status(400).json({ error: 'oldTitle required' });

  const entry = await database('restock_want_list').where({ title: oldTitle, active: true }).first();
  if (!entry) return res.status(404).json({ error: 'Want list entry not found' });

  const patch = {};
  if (title !== undefined && title.trim()) patch.title = title.trim();
  if (notes !== undefined) patch.notes = notes || null;

  if (Object.keys(patch).length === 0) return res.json({ success: true, item: entry });

  await database('restock_want_list').where({ id: entry.id }).update(patch);

  // Also update source_title on scout_alerts that reference the old title
  if (patch.title) {
    await database('scout_alerts')
      .where('source', 'hunters_perch')
      .where('source_title', oldTitle)
      .update({ source_title: patch.title });
  }

  const updated = await database('restock_want_list').where({ id: entry.id }).first();
  res.json({ success: true, item: updated });
});

// Update want list entry by ID (partial update)
router.patch('/:id', async (req, res) => {
  const { id } = req.params;
  const entry = await database('restock_want_list').where({ id }).first();
  if (!entry) return res.status(404).json({ error: 'Not found' });

  const patch = {};
  if (req.body.title !== undefined && req.body.title.trim()) patch.title = req.body.title.trim();
  if (req.body.notes !== undefined) patch.notes = req.body.notes || null;

  if (Object.keys(patch).length === 0) return res.json({ success: true, item: entry });

  await database('restock_want_list').where({ id }).update(patch);
  const updated = await database('restock_want_list').where({ id }).first();
  res.json({ success: true, item: updated });
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
// OVERSTOCK WATCH — group-based inventory monitoring
// ══════════════════════════════════════════════════════════════

// Detect common part types from title
function detectPartType(title) {
  if (!title) return null;
  const t = title.toUpperCase();
  const types = [
    [/\bECM\b|\bECU\b|ENGINE\s*CONTROL\s*MODULE/, 'ECM'],
    [/\bBCM\b|BODY\s*CONTROL\s*MODULE/, 'BCM'],
    [/\bTCM\b|TRANS(MISSION)?\s*CONTROL\s*MODULE/, 'TCM'],
    [/\bABS\b.*\b(PUMP|MODULE)\b/, 'ABS'],
    [/\bPCM\b|POWERTRAIN\s*CONTROL/, 'PCM'],
    [/\bHEADLIGHT\b|\bHEADLAMP\b/, 'HEADLIGHT'],
    [/\bTAILLIGHT\b|\bTAIL\s*LIGHT\b|\bTAILLAMP\b/, 'TAILLIGHT'],
    [/\bMIRROR\b/, 'MIRROR'],
    [/\bDOOR\b.*\bHANDLE\b/, 'DOOR HANDLE'],
    [/\bALTERNATOR\b/, 'ALTERNATOR'],
    [/\bSTARTER\b/, 'STARTER'],
    [/\bRADIATOR\b/, 'RADIATOR'],
    [/\bCOMPRESSOR\b|\bA\/?C\b/, 'AC COMPRESSOR'],
    [/\bSPINDLE\b|\bKNUCKLE\b/, 'SPINDLE'],
    [/\bCALIPER\b/, 'CALIPER'],
    [/\bSTRUT\b|\bSHOCK\b/, 'STRUT'],
    [/\bFUSE\s*BOX\b/, 'FUSE BOX'],
    [/\bINSTRUMENT\s*CLUSTER\b|\bSPEEDOMETER\b|\bGAUGE\s*CLUSTER\b/, 'CLUSTER'],
  ];
  for (const [re, label] of types) {
    if (re.test(t)) return label;
  }
  return null;
}

/**
 * GET /restock-want-list/overstock/scan-duplicates
 * Find duplicate listings: same partNumberBase + make + model listed more than once.
 */
router.get('/overstock/scan-duplicates', async (req, res) => {
  try {
    // Scope to overstock watch list items only — find duplicates WITHIN the curated list
    const dupes = await database.raw(`
      SELECT ogi.part_number_base as "partNumberBase",
        og.name as group_name,
        COUNT(*) as cnt,
        array_agg(DISTINCT og.name) as group_names,
        array_agg(ogi.ebay_item_id) as item_ids,
        array_agg(ogi.title) as titles,
        array_agg(ogi.current_price::text) as prices
      FROM overstock_group_item ogi
      JOIN overstock_group og ON og.id = ogi.group_id
      WHERE ogi.part_number_base IS NOT NULL AND ogi.part_number_base != ''
        AND ogi.is_active = true
      GROUP BY ogi.part_number_base
      HAVING COUNT(*) > 1
      ORDER BY COUNT(*) DESC
      LIMIT 50
    `);
    res.json({ success: true, duplicates: dupes.rows, total: dupes.rows.length });
  } catch (err) {
    // If overstock tables don't have part_number_base, fall back to title grouping
    try {
      const dupes2 = await database.raw(`
        SELECT ogi.title, COUNT(*) as cnt,
          array_agg(DISTINCT og.name) as group_names,
          array_agg(ogi.ebay_item_id) as item_ids
        FROM overstock_group_item ogi
        JOIN overstock_group og ON og.id = ogi.group_id
        WHERE ogi.is_active = true
        GROUP BY ogi.title
        HAVING COUNT(*) > 1
        ORDER BY COUNT(*) DESC
        LIMIT 50
      `);
      res.json({ success: true, duplicates: dupes2.rows, total: dupes2.rows.length });
    } catch (err2) {
      res.status(500).json({ success: false, error: err2.message });
    }
  }
});

/**
 * GET /restock-want-list/overstock/scan-high-qty
 * Find recently listed items with quantity > 1.
 */
router.get('/overstock/scan-high-qty', async (req, res) => {
  try {
    const items = await database('YourListing')
      .where('listingStatus', 'Active')
      .where('quantityAvailable', '>', 1)
      .whereRaw("\"startTime\" >= NOW() - INTERVAL '30 days'")
      .select('ebayItemId', 'title', 'partNumberBase', 'extractedMake', 'extractedModel', 'quantityAvailable', 'currentPrice', 'startTime')
      .orderBy('quantityAvailable', 'desc')
      .orderBy('currentPrice', 'desc')
      .limit(50);
    res.json({ success: true, items, total: items.length });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/overstock', async (req, res) => {
  try {
    const groups = await database('overstock_group')
      .orderByRaw(`
        CASE status
          WHEN 'triggered' THEN 0
          WHEN 'watching' THEN 1
          WHEN 'acknowledged' THEN 2
          ELSE 3
        END
      `)
      .orderByRaw(`
        CASE status
          WHEN 'triggered' THEN EXTRACT(EPOCH FROM triggered_at)
          WHEN 'watching' THEN EXTRACT(EPOCH FROM created_at)
          WHEN 'acknowledged' THEN EXTRACT(EPOCH FROM acknowledged_at)
          ELSE 0
        END DESC
      `);

    // Eager load items + compute live stock for each group
    const results = [];
    for (const group of groups) {
      const items = await database('overstock_group_item')
        .where('group_id', group.id)
        .orderBy('is_active', 'desc')
        .orderBy('added_at', 'asc');

      // Compute live stock
      let liveStock = 0;
      try {
        if (group.group_type === 'single' && items.length > 0) {
          const listing = await database('YourListing')
            .where('ebayItemId', items[0].ebay_item_id)
            .first();
          if (listing && !/ended|inactive/i.test(listing.listingStatus || '')) {
            liveStock = parseInt(listing.quantityAvailable) || 1;
          }
        } else {
          for (const item of items) {
            if (item.is_active) {
              const listing = await database('YourListing')
                .where('ebayItemId', item.ebay_item_id)
                .first();
              if (listing && !/ended|inactive/i.test(listing.listingStatus || '')) {
                liveStock++;
              }
            }
          }
        }
      } catch (e) {
        liveStock = group.current_stock || 0;
      }

      results.push({
        ...group,
        live_stock: liveStock,
        items: items,
      });
    }

    res.json(results);
  } catch (err) {
    res.status(500).json({ error: 'Failed to load overstock groups: ' + err.message });
  }
});

router.post('/overstock/add', async (req, res) => {
  const { ebayItemIds, restockTarget = 1, name, notes } = req.body;
  if (!ebayItemIds || !Array.isArray(ebayItemIds) || ebayItemIds.length === 0) {
    return res.status(400).json({ error: 'At least one eBay item ID required.' });
  }

  const target = parseInt(restockTarget);
  if (isNaN(target) || target < 0) return res.status(400).json({ error: 'Restock target cannot be negative.' });

  // Look up each item
  const validItems = [];
  const errors = [];
  for (const rawId of ebayItemIds) {
    const id = String(rawId).trim();
    if (!id) continue;
    const listing = await database('YourListing').where('ebayItemId', id).first();
    if (!listing) {
      errors.push(`Item ${id} not found in inventory`);
    } else {
      // Check not already tracked
      const existing = await database('overstock_group_item').where('ebay_item_id', id).first();
      if (existing) {
        errors.push(`Item ${id} is already tracked in another group`);
      } else {
        validItems.push({
          ebayItemId: id,
          title: listing.title || id,
          currentPrice: parseFloat(listing.currentPrice) || null,
          quantity: parseInt(listing.quantityAvailable) || 1,
          listingStatus: listing.listingStatus,
        });
      }
    }
  }

  if (validItems.length === 0) {
    return res.status(400).json({ error: 'No valid items found.', errors });
  }

  let groupType, initialStock;
  if (validItems.length === 1) {
    // Single item — must have quantity 2+
    if (validItems[0].quantity < 2) {
      return res.status(400).json({
        error: 'Single item has quantity 1 — nothing to track. Paste multiple item numbers for group tracking, or use an item with quantity 2+.',
        errors
      });
    }
    groupType = 'single';
    initialStock = validItems[0].quantity;
  } else {
    // Multi group — need at least 2 valid items
    if (validItems.length < 2) {
      return res.status(400).json({
        error: 'Need at least 2 listings to create a group. For single items, the item must have quantity 2+.',
        errors
      });
    }
    groupType = 'multi';
    initialStock = validItems.length;
  }

  if (target >= initialStock) {
    return res.status(400).json({ error: `Restock target (${target}) must be below current stock (${initialStock}).` });
  }

  const groupName = (name && name.trim()) ? name.trim().substring(0, 256) : validItems[0].title.substring(0, 80);
  const partType = detectPartType(validItems[0].title);

  const [group] = await database('overstock_group').insert({
    name: groupName,
    part_type: partType,
    restock_target: target,
    current_stock: initialStock,
    initial_stock: initialStock,
    group_type: groupType,
    status: 'watching',
    notes: notes || null,
    created_at: new Date(),
    updated_at: new Date(),
  }).returning('*');

  // Insert items
  const itemRows = [];
  for (const vi of validItems) {
    const [row] = await database('overstock_group_item').insert({
      group_id: group.id,
      ebay_item_id: vi.ebayItemId,
      title: vi.title,
      current_price: vi.currentPrice,
      is_active: true,
      added_at: new Date(),
    }).returning('*');
    itemRows.push(row);
  }

  res.json({ ...group, items: itemRows, errors: errors.length > 0 ? errors : undefined });
});

router.post('/overstock/add-items', async (req, res) => {
  const { groupId, ebayItemIds } = req.body;
  if (!groupId) return res.status(400).json({ error: 'groupId required.' });
  if (!ebayItemIds || !Array.isArray(ebayItemIds) || ebayItemIds.length === 0) {
    return res.status(400).json({ error: 'At least one eBay item ID required.' });
  }

  const group = await database('overstock_group').where('id', groupId).first();
  if (!group) return res.status(404).json({ error: 'Group not found.' });

  const errors = [];
  const added = [];
  for (const rawId of ebayItemIds) {
    const id = String(rawId).trim();
    if (!id) continue;
    const listing = await database('YourListing').where('ebayItemId', id).first();
    if (!listing) { errors.push(`Item ${id} not found in inventory`); continue; }
    const existing = await database('overstock_group_item')
      .where('group_id', groupId).where('ebay_item_id', id).first();
    if (existing) { errors.push(`Item ${id} already in this group`); continue; }

    const [row] = await database('overstock_group_item').insert({
      group_id: groupId,
      ebay_item_id: id,
      title: listing.title || id,
      current_price: parseFloat(listing.currentPrice) || null,
      is_active: true,
      added_at: new Date(),
    }).returning('*');
    added.push(row);
  }

  // Update initial_stock if it grew
  if (added.length > 0) {
    const totalItems = await database('overstock_group_item').where('group_id', groupId).count('* as count').first();
    const newCount = parseInt(totalItems.count) || 0;
    const update = { updated_at: new Date() };
    if (newCount > group.initial_stock) update.initial_stock = newCount;
    update.current_stock = newCount; // refresh
    await database('overstock_group').where('id', groupId).update(update);
  }

  const updated = await database('overstock_group').where('id', groupId).first();
  const items = await database('overstock_group_item').where('group_id', groupId);
  res.json({ ...updated, items, added: added.length, errors: errors.length > 0 ? errors : undefined });
});

router.post('/overstock/acknowledge', async (req, res) => {
  const { id } = req.body;
  if (!id) return res.status(400).json({ error: 'ID required.' });

  const [row] = await database('overstock_group').where({ id }).update({
    status: 'acknowledged',
    acknowledged_at: new Date(),
    updated_at: new Date(),
  }).returning('*');

  res.json(row);
});

router.post('/overstock/rewatch', async (req, res) => {
  const { id, restockTarget } = req.body;
  if (!id) return res.status(400).json({ error: 'ID required.' });

  const group = await database('overstock_group').where({ id }).first();
  if (!group) return res.status(404).json({ error: 'Not found.' });

  // Recompute live stock
  const items = await database('overstock_group_item').where('group_id', id);
  let liveStock = 0;
  if (group.group_type === 'single' && items.length > 0) {
    const listing = await database('YourListing').where('ebayItemId', items[0].ebay_item_id).first();
    if (listing && !/ended|inactive/i.test(listing.listingStatus || '')) {
      liveStock = parseInt(listing.quantityAvailable) || 1;
    }
  } else {
    for (const item of items) {
      const listing = await database('YourListing').where('ebayItemId', item.ebay_item_id).first();
      if (listing && !/ended|inactive/i.test(listing.listingStatus || '')) liveStock++;
    }
  }

  if (liveStock < 2) return res.status(400).json({ error: `Stock is only at ${liveStock}. Need 2+ to re-watch.` });

  const update = {
    status: 'watching',
    current_stock: liveStock,
    triggered_at: null,
    acknowledged_at: null,
    updated_at: new Date(),
  };

  if (restockTarget !== undefined && restockTarget !== null) {
    const t = parseInt(restockTarget);
    if (!isNaN(t) && t >= 0 && t < liveStock) update.restock_target = t;
  }

  const [row] = await database('overstock_group').where({ id }).update(update).returning('*');
  res.json(row);
});

router.post('/overstock/delete', async (req, res) => {
  const { id } = req.body;
  if (!id) return res.status(400).json({ error: 'ID required.' });

  const group = await database('overstock_group').where({ id }).first();
  if (group) {
    await database('scout_alerts')
      .where('source', 'OVERSTOCK')
      .where('source_title', group.name)
      .del();
  }
  // CASCADE handles overstock_group_item deletion
  await database('overstock_group').where({ id }).del();
  res.json({ success: true });
});

router.post('/overstock/update-target', async (req, res) => {
  const { id, restockTarget } = req.body;
  if (!id) return res.status(400).json({ error: 'ID required.' });
  const target = parseInt(restockTarget);
  if (isNaN(target) || target < 0) return res.status(400).json({ error: 'Restock target must be >= 0.' });

  const group = await database('overstock_group').where({ id }).first();
  if (!group) return res.status(404).json({ error: 'Group not found.' });

  if (target >= group.current_stock && group.current_stock > 0) {
    return res.status(400).json({ error: `Restock target (${target}) must be below current stock (${group.current_stock}).` });
  }

  const update = { restock_target: target, updated_at: new Date() };

  // Handle state changes: if current_stock <= new target and was watching, trigger
  if (group.status === 'watching' && group.current_stock <= target) {
    update.status = 'triggered';
    update.triggered_at = new Date();
  }
  // If was triggered and new target is below current stock, reset to watching
  if (group.status === 'triggered' && group.current_stock > target) {
    update.status = 'watching';
    update.triggered_at = null;
  }

  const [row] = await database('overstock_group').where({ id }).update(update).returning('*');
  res.json(row);
});

router.post('/overstock/check-now', async (req, res) => {
  const OverstockCheckService = require('../services/OverstockCheckService');
  const service = new OverstockCheckService();
  const result = await service.checkAll();
  res.json(result);
});

router.get('/overstock/suggestions', async (req, res) => {
  // Find YourListing items with quantity >= 2 that aren't already tracked
  const tracked = await database('overstock_group_item').select('ebay_item_id');
  const trackedIds = tracked.map(t => t.ebay_item_id);

  let q = database('YourListing')
    .where('listingStatus', 'Active')
    .where('quantityAvailable', '>=', 2)
    .select('ebayItemId', 'title', 'quantityAvailable', 'currentPrice')
    .orderBy('quantityAvailable', 'desc')
    .limit(50);

  if (trackedIds.length > 0) {
    q = q.whereNotIn('ebayItemId', trackedIds);
  }

  const suggestions = await q;
  res.json(suggestions.map(s => ({
    ebayItemId: s.ebayItemId,
    title: s.title,
    quantity: parseInt(s.quantityAvailable) || 1,
    currentPrice: parseFloat(s.currentPrice) || null,
  })));
});

module.exports = router;
