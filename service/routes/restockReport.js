'use strict';

const router = require('express-promise-router')();
const { database } = require('../database/database');

// Extract make, model, part type, and part number from title using JS (more reliable than SQL regex)
const MAKES = ['Toyota','Honda','Ford','Dodge','Chrysler','Jeep','Ram','Chevrolet','GMC','Nissan','Hyundai','Kia','Mazda','Subaru','BMW','Mercedes','Volkswagen','Audi','Lexus','Acura','Infiniti','Volvo','Mitsubishi','Buick','Cadillac','Lincoln','Mini','Pontiac','Saturn','Mercury','Scion'];
const MAKE_ALIASES = { 'Chevy': 'Chevrolet', 'VW': 'Volkswagen' };
const STOP_WORDS = new Set(['ECU','ECM','PCM','BCM','TCM','ABS','TIPM','OEM','NEW','USED','REMAN','Engine','Body','Control','Module','Anti','Fuse','Power','Brake','Amplifier','Radio','Cluster','Programmed','Plug','Play','AT','MT','4WD','AWD','2WD','FWD','Integrated','Lock','Pump','Electric','Steering']);

function extractMake(title) {
  const tu = title.toUpperCase();
  for (const m of MAKES) { if (tu.includes(m.toUpperCase())) return m; }
  for (const [alias, canonical] of Object.entries(MAKE_ALIASES)) { if (tu.includes(alias.toUpperCase())) return canonical; }
  return null;
}

function extractModel(title, make) {
  if (!make) return null;
  const tu = title.toUpperCase();
  const mi = tu.indexOf(make.toUpperCase());
  if (mi === -1) return null;
  const after = title.substring(mi + make.length).trim().split(/\s+/);
  const COMPOUNDS = new Set(['GRAND','TOWN','LAND']);
  const mw = [];
  for (const w of after) {
    const clean = w.replace(/[^A-Za-z0-9\-]/g, '');
    if (!clean || /^\d{4}$/.test(clean) || /^\d+\.\d+[lL]?$/.test(clean)) break;
    if (STOP_WORDS.has(clean) || STOP_WORDS.has(clean.toUpperCase())) break;
    mw.push(clean);
    if (mw.length === 1 && COMPOUNDS.has(clean.toUpperCase())) continue;
    if (mw.length === 2 && /^\d/.test(clean)) break; // Ram 1500
    if (mw.length >= 1 && !COMPOUNDS.has(mw[0].toUpperCase())) break;
    if (mw.length >= 2) break;
  }
  return mw.length > 0 ? mw.join(' ') : null;
}

function extractPartType(title) {
  const t = title.toUpperCase();
  if (/\b(TCM|TCU|TRANSMISSION CONTROL)\b/.test(t)) return 'TCM';
  if (/\b(BCM|BODY CONTROL)\b/.test(t)) return 'BCM';
  if (/\b(ECU|ECM|PCM|ENGINE CONTROL|ENGINE COMPUTER|ENGINE MODULE|DME)\b/.test(t)) return 'ECM';
  if (/\bTIPM\b/.test(t)) return 'TIPM';
  if (/\b(FUSE BOX|FUSE RELAY|JUNCTION|IPDM|RELAY BOX)\b/.test(t)) return 'Fuse Box';
  if (/\b(ABS|ANTI.?LOCK|BRAKE PUMP|BRAKE MODULE)\b/.test(t)) return 'ABS';
  if (/\b(AMPLIFIER|BOSE|HARMAN|JBL)\b/.test(t)) return 'Amplifier';
  if (/\b(RADIO|STEREO|RECEIVER|INFOTAINMENT)\b/.test(t)) return 'Radio';
  if (/\b(CLUSTER|SPEEDOMETER|GAUGE|INSTRUMENT)\b/.test(t)) return 'Cluster';
  if (/\b(THROTTLE BODY)\b/.test(t)) return 'Throttle';
  return null;
}

function extractPartNumbers(title) {
  const pns = [];
  const chrysler = title.match(/\b(\d{7,10}[A-Z]{0,2})\b/g);
  if (chrysler) pns.push(...chrysler);
  const ford = title.match(/\b([A-Z]{1,4}\d{1,2}[A-Z]-[A-Z0-9]{3,7}(?:-[A-Z]{1,3})?)\b/g);
  if (ford) pns.push(...ford);
  const toyota = title.match(/\b(\d{5}-[A-Z0-9]{2,7}(?:-[A-Z0-9]{1,3})?)\b/g);
  if (toyota) pns.push(...toyota);
  return pns;
}

const { normalizePartNumber } = require('../lib/partNumberUtils');

router.get('/report', async (req, res) => {
  try {
    // Step 1: Get recent sales
    const sales = await database('YourSale')
      .where('soldDate', '>=', database.raw("NOW() - INTERVAL '7 days'"))
      .whereNotNull('title')
      .whereRaw('"salePrice"::numeric >= 50')
      .select('title', 'salePrice', 'soldDate', 'sku');

    // Step 2: Parse and group
    const groups = {};
    for (const sale of sales) {
      const title = sale.title || '';
      const make = extractMake(title);
      const pt = extractPartType(title);
      if (!make || !pt) continue;

      const model = extractModel(title, make);
      const pns = extractPartNumbers(title);
      const basePn = pns.length > 0 ? normalizePartNumber(pns[0]) : null;
      const key = `${make}|${model || ''}|${pt}|${basePn || ''}`;

      if (!groups[key]) {
        groups[key] = {
          make, model, partType: pt, basePn,
          allPns: new Set(), sold: 0, totalPrice: 0, lastSold: null,
          sampleTitle: title,
        };
      }
      const g = groups[key];
      g.sold++;
      g.totalPrice += parseFloat(sale.salePrice) || 0;
      for (const pn of pns) g.allPns.add(pn);
      if (!g.lastSold || new Date(sale.soldDate) > new Date(g.lastSold)) g.lastSold = sale.soldDate;
    }

    // Step 3: Get all active listings for stock check
    const listings = await database('YourListing')
      .where('listingStatus', 'Active')
      .whereNotNull('title')
      .select('title', 'quantityAvailable');

    // Build listing index by base part number
    const stockByBasePn = {};
    const stockByMakePt = {};
    for (const l of listings) {
      const qty = parseInt(l.quantityAvailable) || 1;
      const pns = extractPartNumbers(l.title || '');
      for (const pn of pns) {
        const base = normalizePartNumber(pn);
        if (base) stockByBasePn[base] = (stockByBasePn[base] || 0) + qty;
      }
      // Also index by make+partType for fallback
      const mk = extractMake(l.title || '');
      const pt = extractPartType(l.title || '');
      if (mk && pt) {
        const k = `${mk}|${pt}`;
        stockByMakePt[k] = (stockByMakePt[k] || 0) + qty;
      }
    }

    // Step 4: Build results with stock counts
    const items = [];
    for (const [key, g] of Object.entries(groups)) {
      // Stock: check by base part number first, fall back to make+partType
      let stock = 0;
      if (g.basePn && stockByBasePn[g.basePn] != null) {
        stock = stockByBasePn[g.basePn];
      }
      // No basePn match — don't use make+partType fallback (too broad)

      const avgPrice = g.sold > 0 ? Math.round(g.totalPrice / g.sold * 100) / 100 : 0;

      // Extract year range from sample title
      const years = g.sampleTitle.match(/\b((?:19|20)\d{2})\b/g);
      let yearRange = null;
      if (years && years.length > 0) {
        const sorted = [...new Set(years.map(Number))].sort();
        yearRange = sorted[0] === sorted[sorted.length-1] ? String(sorted[0]) : sorted[0] + '-' + sorted[sorted.length-1];
      }

      // Score
      let score = 0;
      score += g.sold >= 4 ? 35 : g.sold >= 3 ? 28 : g.sold >= 2 ? 20 : 10;
      score += avgPrice >= 300 ? 25 : avgPrice >= 200 ? 20 : avgPrice >= 150 ? 15 : avgPrice >= 100 ? 10 : 5;
      score += stock === 0 ? 25 : stock === 1 ? 15 : 0;
      const daysSinceSold = g.lastSold ? Math.floor((Date.now() - new Date(g.lastSold).getTime()) / 86400000) : 99;
      score += daysSinceSold <= 3 ? 15 : daysSinceSold <= 5 ? 10 : 5;
      score = Math.min(100, score);
      // $300+ floor
      if (avgPrice >= 300 && g.sold >= 1) score = Math.max(score, 75);

      let action = 'MONITOR';
      if (stock === 0 && avgPrice >= 200) action = 'RESTOCK NOW';
      else if (stock === 0) action = 'OUT OF STOCK';
      else if (stock === 1 && g.sold >= 2) action = 'LOW STOCK';
      else if (g.sold > stock) action = 'SELLING FAST';

      items.push({
        score, action, make: g.make, model: g.model, partType: g.partType,
        basePn: g.basePn, variantPns: [...g.allPns].slice(0, 5),
        yearRange, sold7d: g.sold, activeStock: stock,
        avgPrice, revenue: Math.round(g.totalPrice),
        daysSinceSold, sampleTitle: g.sampleTitle,
      });
    }

    // Filter and sort
    const filtered = items.filter(i => i.activeStock <= 1 || i.sold7d > i.activeStock || i.avgPrice >= 300);
    filtered.sort((a, b) => b.revenue - a.revenue);
    const top = filtered.slice(0, 100);

    const tiers = { green: [], yellow: [], orange: [] };
    for (const item of top) {
      if (item.score >= 75) { item.tier = 'green'; tiers.green.push(item); }
      else if (item.score >= 50) { item.tier = 'yellow'; tiers.yellow.push(item); }
      else { item.tier = 'orange'; tiers.orange.push(item); }
    }

    res.json({
      success: true,
      generatedAt: new Date().toISOString(),
      period: 'Last 7 days',
      tiers,
      summary: {
        green: tiers.green.length, yellow: tiers.yellow.length, orange: tiers.orange.length,
        total: top.length, salesAnalyzed: sales.length,
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message, stack: err.stack });
  }
});

module.exports = router;
