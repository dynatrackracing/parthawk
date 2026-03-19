'use strict';

/**
 * partsLookup.js — GET /api/parts-lookup/lookup & PATCH /api/parts-lookup/:partNumber/fitment
 *
 * Listing tool calls GET /api/parts-lookup/lookup?pn=56044691AA
 * → Returns fitment, pricing, inventory from Item/YourListing/YourSale/fitment_data
 *
 * After listing confirmed: PATCH /api/parts-lookup/:partNumber/fitment
 * → Writes confirmed fitment back — database gets smarter with every listing
 */

const router = require('express-promise-router')();
const { database } = require('../database/database');
const { normalizePartNumber } = require('../lib/partNumberUtils');

function parseTitle(title) {
  if (!title) return {};
  const result = {};
  const years = title.match(/\b(19\d{2}|20[0-3]\d)\b/g);
  if (years) {
    const sorted = [...new Set(years.map(Number))].sort();
    result.yearStart = sorted[0];
    result.yearEnd = sorted[sorted.length - 1];
  }
  const eng = title.match(/\b(\d\.\d)L\b/i);
  if (eng) result.engine = eng[0];
  const t = title.toUpperCase();
  if (t.includes('4WD') || t.includes('4X4')) result.drivetrain = '4WD';
  else if (t.includes('AWD')) result.drivetrain = 'AWD';
  else if (t.includes('2WD')) result.drivetrain = '2WD';
  if (/\bA\/?T\b/.test(t) || t.includes('AUTOMATIC')) result.transmission = 'AT';
  else if (/\bM\/?T\b/.test(t) || t.includes('MANUAL')) result.transmission = 'MT';
  result.isProgrammed = /programmed|plug.{0,3}play/i.test(title);
  return result;
}

function detectCategory(title) {
  const t = (title || '').toLowerCase();
  if (/\b(ecu|ecm|pcm|engine control|engine computer)\b/.test(t)) return 'ECM';
  if (/\b(bcm|body control)\b/.test(t)) return 'BCM';
  if (/\b(tcm|tcu|transmission control)\b/.test(t)) return 'TCM';
  if (/\b(tipm|fuse box|junction|integrated power|ipdm|relay box)\b/.test(t)) return 'TIPM';
  if (/\b(abs|anti.?lock|brake pump)\b/.test(t)) return 'ABS';
  if (/\b(cluster|speedometer|gauge|instrument)\b/.test(t)) return 'CLUSTER';
  if (/\b(amplifier|bose|harman)\b/.test(t)) return 'AMPLIFIER';
  if (/\b(radio|stereo|infotainment|head unit)\b/.test(t)) return 'RADIO';
  if (/\b(throttle body)\b/.test(t)) return 'THROTTLE';
  return 'OTHER';
}

/**
 * GET /api/parts-lookup/lookup?pn=56044691AA
 */
router.get('/lookup', async (req, res) => {
  const { pn } = req.query;
  if (!pn) return res.status(400).json({ error: 'Part number required. Use ?pn=XXXXX' });

  const partNum = pn.trim();
  const basePn = normalizePartNumber(partNum);

  try {
    // 1. Item table (competitor/reference)
    const items = await database('Item')
      .where('manufacturerPartNumber', partNum)
      .orWhere('manufacturerPartNumber', basePn)
      .orWhere('manufacturerPartNumber', 'like', basePn + '%')
      .select('title', 'price', 'categoryTitle', 'seller', 'manufacturerPartNumber')
      .limit(50);

    // 2. YourListing (active inventory)
    const listings = await database('YourListing')
      .where('title', 'ilike', `%${partNum}%`)
      .orWhere('title', 'ilike', `%${basePn}%`)
      .orWhere('sku', partNum)
      .orWhere('sku', basePn)
      .select('title', 'currentPrice', 'sku', 'quantityAvailable')
      .limit(20);

    // 3. YourSale (sold history)
    const sales = await database('YourSale')
      .where('title', 'ilike', `%${partNum}%`)
      .orWhere('title', 'ilike', `%${basePn}%`)
      .orWhere('sku', partNum)
      .orWhere('sku', basePn)
      .select('title', 'salePrice', 'soldDate')
      .orderBy('soldDate', 'desc')
      .limit(30);

    // 4. fitment_data (if exists)
    let fitmentData = null;
    try {
      const fd = await database('fitment_data')
        .where('part_number', partNum)
        .orWhere('part_number_base', basePn)
        .first();
      if (fd) fitmentData = fd;
    } catch (e) { /* table may not exist */ }

    // Aggregate
    const allTitles = [...items.map(r => r.title), ...listings.map(r => r.title), ...sales.map(r => r.title)];
    const engines = new Set();
    const drivetrains = new Set();
    const transmissions = new Set();
    let yearStart = null, yearEnd = null;
    let category = null;

    for (const title of allTitles) {
      const p = parseTitle(title);
      if (p.engine) engines.add(p.engine);
      if (p.drivetrain) drivetrains.add(p.drivetrain);
      if (p.transmission) transmissions.add(p.transmission);
      if (p.yearStart) {
        if (!yearStart || p.yearStart < yearStart) yearStart = p.yearStart;
        if (!yearEnd || p.yearEnd > yearEnd) yearEnd = p.yearEnd;
      }
      if (!category) category = detectCategory(title);
    }

    // Pricing
    const compPrices = items.filter(r => r.seller !== 'dynatrack').map(r => parseFloat(r.price)).filter(p => p > 0);
    const soldPrices = sales.map(r => parseFloat(r.salePrice)).filter(p => p > 0);
    const avgComp = compPrices.length > 0 ? Math.round(compPrices.reduce((a, b) => a + b, 0) / compPrices.length * 100) / 100 : null;
    const avgSold = soldPrices.length > 0 ? Math.round(soldPrices.reduce((a, b) => a + b, 0) / soldPrices.length * 100) / 100 : null;

    res.json({
      partNumber: partNum,
      partNumberBase: basePn,
      found: allTitles.length > 0,
      references: { competitor: items.length, yourListings: listings.length, yourSales: sales.length, total: allTitles.length },
      fitment: {
        yearStart, yearEnd,
        yearRange: yearStart && yearEnd ? (yearStart === yearEnd ? `${yearStart}` : `${yearStart}-${yearEnd}`) : null,
        engines: [...engines], drivetrains: [...drivetrains], transmissions: [...transmissions],
        category: category || 'OTHER',
      },
      doesNotFit: fitmentData?.does_not_fit || null,
      programmingRequired: fitmentData?.programming_required || null,
      programmingNote: fitmentData?.programming_note || null,
      pricing: { competitorAvg: avgComp, competitorCount: compPrices.length, yourAvgSoldPrice: avgSold, yourSoldCount: soldPrices.length },
      inventory: { activeListings: listings.length, totalQty: listings.reduce((s, r) => s + (parseInt(r.quantityAvailable) || 0), 0) },
      sampleTitle: allTitles[0] || null,
      sellers: [...new Set(items.map(r => r.seller).filter(Boolean))],
    });
  } catch (err) {
    res.status(500).json({ error: 'Lookup failed', detail: err.message });
  }
});

/**
 * PATCH /api/parts-lookup/:partNumber/fitment
 */
router.patch('/:partNumber/fitment', async (req, res) => {
  const { partNumber } = req.params;
  const basePn = normalizePartNumber(partNumber);
  const { yearStart, yearEnd, makes, models, engines, doesNotFit, programmingRequired, programmingNote, category, confirmedBy } = req.body;

  try {
    const existing = await database('fitment_data').where('part_number', partNumber).first();
    if (existing) {
      await database('fitment_data').where('part_number', partNumber).update({
        year_start: yearStart || existing.year_start,
        year_end: yearEnd || existing.year_end,
        makes: makes || existing.makes,
        models: models || existing.models,
        engines: engines || existing.engines,
        does_not_fit: doesNotFit || existing.does_not_fit,
        programming_required: programmingRequired || existing.programming_required,
        programming_note: programmingNote || existing.programming_note,
        category: category || existing.category,
        confirmed_by: confirmedBy || 'lister',
        confirmed_count: (existing.confirmed_count || 0) + 1,
        updated_at: new Date(),
      });
    } else {
      await database('fitment_data').insert({
        part_number: partNumber,
        part_number_base: basePn,
        year_start: yearStart || null, year_end: yearEnd || null,
        makes: makes || null, models: models || null, engines: engines || null,
        does_not_fit: doesNotFit || null,
        programming_required: programmingRequired || null,
        programming_note: programmingNote || null,
        category: category || null,
        confidence: 'medium', source: 'lister',
        confirmed_by: confirmedBy || 'lister', confirmed_count: 1,
        created_at: new Date(), updated_at: new Date(),
      });
    }
    res.json({ success: true, partNumber, message: 'Fitment data updated' });
  } catch (err) {
    res.status(500).json({ error: 'Write-back failed', detail: err.message });
  }
});

module.exports = router;
