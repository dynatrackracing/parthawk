'use strict';

const Router = require('express-promise-router');
const router = Router();
const { database } = require('../database/database');
const { parse } = require('csv-parse/sync');

/**
 * GET /api/parts/lookup?partNumber=56044691AA
 * Returns fitment data for a part number from the PartHawk database.
 * Used by the listing tool to pre-fill fitment without the lister needing to know it.
 */
router.get('/lookup', async (req, res) => {
  const { partNumber } = req.query;

  if (!partNumber) {
    return res.status(400).json({ error: 'partNumber query parameter required' });
  }

  // Normalize: strip known suffix patterns (AA, AB, AC, etc.)
  const base = partNumber.replace(/[A-Z]{2}$/, '').replace(/\d{2}$/, '').trim();

  try {
    // Look up by exact part number first (from SKU/custom label in sold history)
    let results = await database('YourSale')
      .where('sku', partNumber)
      .orWhere('sku', 'like', `${base}%`)
      .select('title', 'sku', 'ebayItemId')
      .limit(10);

    // Also check Item table if it exists
    let itemResults = [];
    const itemTableExists = await database.schema.hasTable('Item');
    if (itemTableExists) {
      itemResults = await database('Item')
        .where('partNumber', partNumber)
        .orWhere('partNumber', 'like', `${base}%`)
        .select('partNumber', 'description', 'notes')
        .limit(10);
    }

    // Parse fitment from titles
    const fitments = parseFitmentsFromTitles(results.map(r => r.title));

    return res.json({
      partNumber,
      partNumberBase: base,
      fitments,
      salesHistory: results.length,
      items: itemResults,
      source: results.length > 0 ? 'sales_history' : 'not_found',
    });

  } catch (err) {
    console.error('Parts lookup error:', err);
    return res.status(500).json({ error: 'Lookup failed', detail: err.message });
  }
});

/**
 * PATCH /api/parts/:id/fitment
 * Write-back endpoint - lister confirms or corrects fitment, updates database.
 */
router.patch('/:id/fitment', async (req, res) => {
  const { id } = req.params;
  const { fitment, doesNotFit, programmingNote, confirmedBy } = req.body;

  try {
    const itemTableExists = await database.schema.hasTable('Item');
    if (!itemTableExists) {
      return res.status(404).json({ error: 'Item table not available' });
    }

    await database('Item').where('id', id).update({
      fitment: fitment || null,
      doesNotFit: doesNotFit || null,
      programmingNote: programmingNote || null,
      updatedAt: new Date(),
    });

    return res.json({ success: true, id });
  } catch (err) {
    console.error('Fitment write-back error:', err);
    return res.status(500).json({ error: 'Write-back failed', detail: err.message });
  }
});

/**
 * GET /api/parts/lookup/programmed?partNumber=xxx
 * Programmed listing price protection:
 * - Excludes programmed/flashed/VIN-specific listings from comp pool for unprogrammed units
 * - Programmed listings floor at 20-30% above unprogrammed market rate
 * - Programmed comps only compare against other programmed listings
 */
router.get('/lookup/programmed', async (req, res) => {
  const { partNumber } = req.query;
  if (!partNumber) return res.status(400).json({ error: 'partNumber required' });

  const { normalizePartNumber } = require('../lib/partNumberUtils');
  const base = normalizePartNumber(partNumber);

  try {
    // Get market data for this part
    let marketData = null;
    try {
      marketData = await database('market_demand_cache')
        .where('part_number_base', base).first();
    } catch (e) { /* ignore */ }

    // Get our listings for this part
    const ourListings = await database('YourListing')
      .where('listingStatus', 'Active')
      .where(function() {
        this.where('sku', partNumber).orWhere('sku', 'like', `${base}%`);
      })
      .select('*');

    // Separate programmed vs unprogrammed
    const PROGRAMMED_KEYWORDS = ['PROGRAMMED', 'FLASHED', 'VIN-SPECIFIC', 'CODED TO', 'PLUG AND PLAY'];
    const isProgrammed = (title) => {
      const t = (title || '').toUpperCase();
      return PROGRAMMED_KEYWORDS.some(kw => t.includes(kw));
    };

    const programmedListings = ourListings.filter(l => isProgrammed(l.title));
    const unprogrammedListings = ourListings.filter(l => !isProgrammed(l.title));

    // Get sold comps
    const soldComps = await database('YourSale')
      .where(function() {
        this.where('sku', partNumber).orWhere('sku', 'like', `${base}%`);
      })
      .orderBy('soldDate', 'desc')
      .limit(20)
      .select('title', 'salePrice', 'soldDate');

    const programmedComps = soldComps.filter(s => isProgrammed(s.title));
    const unprogrammedComps = soldComps.filter(s => !isProgrammed(s.title));

    const unprogrammedAvg = unprogrammedComps.length > 0
      ? unprogrammedComps.reduce((sum, s) => sum + (parseFloat(s.salePrice) || 0), 0) / unprogrammedComps.length
      : (marketData ? parseFloat(marketData.ebay_avg_price) : null);

    const programmedAvg = programmedComps.length > 0
      ? programmedComps.reduce((sum, s) => sum + (parseFloat(s.salePrice) || 0), 0) / programmedComps.length
      : null;

    // Programmed floor: 20-30% above unprogrammed market rate
    const programmedFloor = unprogrammedAvg ? Math.round(unprogrammedAvg * 1.25 * 100) / 100 : null;

    return res.json({
      partNumber, base,
      unprogrammedAvg: unprogrammedAvg ? Math.round(unprogrammedAvg * 100) / 100 : null,
      programmedAvg: programmedAvg ? Math.round(programmedAvg * 100) / 100 : null,
      programmedFloor,
      programmedListingCount: programmedListings.length,
      unprogrammedListingCount: unprogrammedListings.length,
      programmedCompCount: programmedComps.length,
      unprogrammedCompCount: unprogrammedComps.length,
      guidance: programmedFloor
        ? `Programmed listings should be priced at or above $${programmedFloor.toFixed(2)} (25% above unprogrammed market rate of $${unprogrammedAvg.toFixed(2)})`
        : 'Insufficient comp data for programmed pricing guidance',
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/import/csv
 * Import eBay orders CSV directly via API.
 * Body: multipart with 'file' and 'store' fields.
 * Or JSON with { csvData: '<csv string>', store: 'dynatrack' }
 */
router.post('/import/csv', async (req, res) => {
  const { csvData, store } = req.body;

  if (!csvData || !store) {
    return res.status(400).json({ error: 'csvData and store required' });
  }

  const content = csvData.replace(/^\uFEFF/, ''); // strip BOM
  const lines = content.split('\n');

  let headerIndex = 0;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes('Sales Record Number')) {
      headerIndex = i;
      break;
    }
  }

  const csvContent = lines.slice(headerIndex).join('\n');

  let records;
  try {
    records = parse(csvContent, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
      relax_column_count: true,
    });
  } catch (err) {
    return res.status(400).json({ error: 'CSV parse failed', detail: err.message });
  }

  let imported = 0;
  let skipped = 0;
  let errors = 0;

  for (const row of records) {
    const orderId = row['Order Number'];
    if (!orderId || orderId.trim() === '') continue;

    try {
      const existing = await database('YourSale').where('ebayOrderId', orderId).first();
      if (existing) { skipped++; continue; }

      const salePrice = parsePrice(row['Sold For']);
      const soldDate = parseDate(row['Sale Date']);
      const shippedDate = parseDate(row['Shipped On Date']);

      await database('YourSale').insert({
        ebayOrderId: orderId,
        ebayItemId: row['Item Number'] || null,
        title: row['Item Title'] || null,
        sku: row['Custom Label'] || null,
        quantity: parseInt(row['Quantity']) || 1,
        salePrice,
        soldDate,
        buyerUsername: row['Buyer Username'] || null,
        shippedDate,
        store: store || 'dynatrack',
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      imported++;
    } catch (err) {
      errors++;
    }
  }

  return res.json({
    success: true,
    store,
    imported,
    skipped,
    errors,
    total: records.length,
  });
});

// Helper: parse year/make/model from eBay listing titles
function parseFitmentsFromTitles(titles) {
  const fitments = new Set();
  const yearMakeModelPattern = /(\d{4})[-–\s]+(\d{4})?\s*([A-Z][a-z]+(?:\s[A-Z][a-z]+)?)\s+([A-Z][a-z0-9]+(?:\s[A-Z][a-z0-9]+)?)/g;

  for (const title of titles) {
    if (!title) continue;
    const matches = title.matchAll(yearMakeModelPattern);
    for (const match of matches) {
      fitments.add(match[0].trim());
    }
  }

  return [...fitments].slice(0, 10);
}

function parsePrice(str) {
  if (!str) return null;
  return parseFloat(str.replace(/[$,]/g, '')) || null;
}

function parseDate(str) {
  if (!str || str.trim() === '') return null;
  const d = new Date(str);
  return isNaN(d.getTime()) ? null : d;
}

module.exports = router;
