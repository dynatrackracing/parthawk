'use strict';

const router = require('express-promise-router')();
const { database } = require('../database/database');
const { normalizePartNumber } = require('../lib/partNumberUtils');

// Make detection with WORD BOUNDARIES — "Programmed" won't match "Ram"
const MAKE_PATTERNS = [
  [/\bToyota\b/i, 'Toyota'], [/\bHonda\b/i, 'Honda'], [/\bFord\b/i, 'Ford'],
  [/\bDodge\b/i, 'Dodge'], [/\bChrysler\b/i, 'Chrysler'], [/\bJeep\b/i, 'Jeep'],
  [/\bRam\b(?!\w)/i, 'Ram'], // \b before, no word char after — won't match "Programmed" or "Ramcharger"
  [/\bChevrolet\b/i, 'Chevrolet'], [/\bChevy\b/i, 'Chevrolet'],
  [/\bGMC\b/i, 'GMC'], [/\bNissan\b/i, 'Nissan'], [/\bHyundai\b/i, 'Hyundai'],
  [/\bKia\b/i, 'Kia'], [/\bMazda\b/i, 'Mazda'], [/\bSubaru\b/i, 'Subaru'],
  [/\bBMW\b/i, 'BMW'], [/\bMercedes\b/i, 'Mercedes'], [/\bVolkswagen\b/i, 'Volkswagen'],
  [/\bVW\b/i, 'Volkswagen'], [/\bAudi\b/i, 'Audi'], [/\bLexus\b/i, 'Lexus'],
  [/\bAcura\b/i, 'Acura'], [/\bInfiniti\b/i, 'Infiniti'], [/\bVolvo\b/i, 'Volvo'],
  [/\bMitsubishi\b/i, 'Mitsubishi'], [/\bBuick\b/i, 'Buick'], [/\bCadillac\b/i, 'Cadillac'],
  [/\bLincoln\b/i, 'Lincoln'], [/\bMini\b/i, 'Mini'], [/\bPontiac\b/i, 'Pontiac'],
  [/\bSaturn\b/i, 'Saturn'], [/\bMercury\b/i, 'Mercury'], [/\bScion\b/i, 'Scion'],
  [/\bFiat\b/i, 'Fiat'], [/\bJaguar\b/i, 'Jaguar'], [/\bPorsche\b/i, 'Porsche'],
  [/\bSaab\b/i, 'Saab'], [/\bLand Rover\b/i, 'Land Rover'],
];

const COMPOUND_MODELS = new Set(['GRAND','TOWN','CROWN','MONTE','LAND','SANTA']);
const STOP_WORDS = new Set(['ECU','ECM','PCM','BCM','TCM','ABS','TIPM','OEM','NEW','USED','REMAN','Engine','Body','Control','Module','Anti','Fuse','Power','Brake','Amplifier','Radio','Cluster','Programmed','Plug','Play','AT','MT','4WD','AWD','2WD','FWD','Integrated','Lock','Pump','Electric','Steering','Throttle','VIN','Tested','OEM','REBUILT','Genuine']);

function extractMake(title) {
  for (const [re, name] of MAKE_PATTERNS) {
    if (re.test(title)) return name;
  }
  return null;
}

function extractModel(title, make) {
  if (!make) return null;
  const tu = title.toUpperCase();
  const makeUpper = make.toUpperCase();
  // Handle aliases
  let mi = tu.indexOf(makeUpper);
  if (mi === -1 && make === 'Chevrolet') mi = tu.indexOf('CHEVY');
  if (mi === -1 && make === 'Volkswagen') mi = tu.indexOf('VW');
  if (mi === -1) return null;

  const after = title.substring(mi + (make === 'Chevrolet' && tu.indexOf('CHEVY') === mi ? 5 : makeUpper.length)).trim().split(/\s+/);
  const mw = [];
  for (const w of after) {
    const clean = w.replace(/[^A-Za-z0-9\-]/g, '');
    if (!clean || /^\d{4}$/.test(clean) || /^\d+\.\d+[lL]?$/.test(clean)) break;
    if (STOP_WORDS.has(clean.toUpperCase())) break;
    mw.push(clean);
    // Compound models: Grand Cherokee, Santa Fe, Crown Victoria, Town Car, Monte Carlo, Land Cruiser
    if (mw.length === 1 && COMPOUND_MODELS.has(clean.toUpperCase())) continue;
    // Number suffix: Ram 1500, F-150
    if (mw.length === 2 && /^\d/.test(clean)) break;
    if (mw.length >= 1 && !COMPOUND_MODELS.has(mw[0].toUpperCase())) break;
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
  if (/\b(MIRROR|SIDE VIEW)\b/.test(t)) return 'Mirror';
  if (/\b(ALTERNATOR)\b/.test(t)) return 'Alternator';
  if (/\b(STARTER|STARTER MOTOR)\b/.test(t)) return 'Starter';
  if (/\b(SEAT BELT|SEATBELT)\b/.test(t)) return 'Seat Belt';
  if (/\b(WINDOW MOTOR|REGULATOR)\b/.test(t)) return 'Regulator';
  if (/\b(HEADLIGHT|HEAD LIGHT|HEAD LAMP)\b/.test(t)) return 'Headlight';
  if (/\b(TAIL LIGHT|TAILLIGHT)\b/.test(t)) return 'Tail Light';
  if (/\b(STEERING|EPS|POWER STEERING)\b/.test(t)) return 'Steering';
  if (/\b(TRANSFER CASE|XFER)\b/.test(t)) return 'Transfer Case';
  if (/\b(WIPER)\b/.test(t)) return 'Wiper';
  if (/\b(SENSOR|CAMERA|BLIND SPOT)\b/.test(t)) return 'Sensor';
  // Fallback: grab first noun-like word after make+model+year
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

function extractFallbackPartName(title) {
  // Try to grab a descriptive chunk from the title
  // Remove year, make, model, part numbers — what's left is the part description
  let t = title;
  t = t.replace(/\b\d{4}\b/g, '').replace(/\b\d{7,10}[A-Z]{0,2}\b/g, '');
  t = t.replace(/\b[A-Z]{1,4}\d{1,2}[A-Z]-[A-Z0-9]{3,7}(?:-[A-Z]{1,3})?\b/g, '');
  t = t.replace(/\b\d{5}-[A-Z0-9]{2,7}\b/g, '');
  t = t.replace(/\b\d+\.\d+L\b/gi, '');
  for (const [re] of MAKE_PATTERNS) t = t.replace(re, '');
  t = t.replace(/\b(OEM|Programmed|Tested|REMAN|AT|MT|4WD|AWD|2WD|FWD|RWD)\b/gi, '');
  t = t.replace(/\s+/g, ' ').trim();
  return t.substring(0, 40) || 'Part';
}

router.get('/report', async (req, res) => {
  try {
    const sales = await database('YourSale')
      .where('soldDate', '>=', database.raw("NOW() - INTERVAL '7 days'"))
      .whereNotNull('title')
      .whereRaw('"salePrice"::numeric >= 50')
      .select('title', 'salePrice', 'soldDate', 'sku');

    const groups = {};
    for (const sale of sales) {
      const title = sale.title || '';
      const make = extractMake(title);
      const model = make ? extractModel(title, make) : null;
      let pt = extractPartType(title);
      if (!pt) pt = extractFallbackPartName(title);
      const pns = extractPartNumbers(title);
      const basePn = pns.length > 0 ? normalizePartNumber(pns[0]) : null;
      const key = `${make || 'Unknown'}|${model || ''}|${pt}|${basePn || title.substring(0,30)}`;

      if (!groups[key]) {
        groups[key] = { make: make || 'Unknown', model, partType: pt, basePn, allPns: new Set(), sold: 0, totalPrice: 0, lastSold: null, sampleTitle: title };
      }
      const g = groups[key];
      g.sold++;
      g.totalPrice += parseFloat(sale.salePrice) || 0;
      for (const pn of pns) g.allPns.add(pn);
      if (!g.lastSold || new Date(sale.soldDate) > new Date(g.lastSold)) g.lastSold = sale.soldDate;
    }

    // Stock index from listings
    const listings = await database('YourListing').where('listingStatus', 'Active').whereNotNull('title').select('title', 'quantityAvailable');
    const stockByBasePn = {};
    for (const l of listings) {
      const qty = parseInt(l.quantityAvailable) || 1;
      for (const pn of extractPartNumbers(l.title || '')) {
        const base = normalizePartNumber(pn);
        if (base) stockByBasePn[base] = (stockByBasePn[base] || 0) + qty;
      }
    }

    const items = [];
    for (const [, g] of Object.entries(groups)) {
      const stock = g.basePn ? (stockByBasePn[g.basePn] || 0) : 0;
      const avgPrice = g.sold > 0 ? Math.round(g.totalPrice / g.sold * 100) / 100 : 0;
      const years = g.sampleTitle.match(/\b((?:19|20)\d{2})\b/g);
      let yearRange = null;
      if (years) { const s = [...new Set(years.map(Number))].sort(); yearRange = s[0] === s[s.length-1] ? String(s[0]) : s[0]+'-'+s[s.length-1]; }

      let score = 0;
      score += g.sold >= 4 ? 35 : g.sold >= 3 ? 28 : g.sold >= 2 ? 20 : 10;
      score += avgPrice >= 300 ? 25 : avgPrice >= 200 ? 20 : avgPrice >= 150 ? 15 : avgPrice >= 100 ? 10 : 5;
      score += stock === 0 ? 25 : stock === 1 ? 15 : 0;
      const daysSince = g.lastSold ? Math.floor((Date.now() - new Date(g.lastSold).getTime()) / 86400000) : 99;
      score += daysSince <= 3 ? 15 : daysSince <= 5 ? 10 : 5;
      score = Math.min(100, score);
      if (avgPrice >= 300 && g.sold >= 1) score = Math.max(score, 75);

      // Action by stock level ONLY
      const action = stock === 0 ? 'RESTOCK NOW' : stock === 1 ? 'LOW STOCK' : 'MONITOR';

      items.push({
        score, action, make: g.make, model: g.model, partType: g.partType,
        basePn: g.basePn, variantPns: [...g.allPns].slice(0, 5), yearRange,
        sold7d: g.sold, activeStock: stock, avgPrice, revenue: Math.round(g.totalPrice),
        daysSinceSold: daysSince, sampleTitle: g.sampleTitle,
      });
    }

    // Show everything where stock is 0 or 1, OR sold > stock, OR $300+
    const filtered = items.filter(i => i.activeStock <= 1 || i.sold7d > i.activeStock || i.avgPrice >= 300);
    filtered.sort((a, b) => b.revenue - a.revenue);
    const top = filtered.slice(0, 100);

    // Tier by SCORE only
    const tiers = { green: [], yellow: [], orange: [] };
    for (const item of top) {
      if (item.score >= 75) { item.tier = 'green'; tiers.green.push(item); }
      else if (item.score >= 50) { item.tier = 'yellow'; tiers.yellow.push(item); }
      else { item.tier = 'orange'; tiers.orange.push(item); }
    }

    res.json({ success: true, generatedAt: new Date().toISOString(), period: 'Last 7 days', tiers,
      summary: { green: tiers.green.length, yellow: tiers.yellow.length, orange: tiers.orange.length, total: top.length, salesAnalyzed: sales.length },
    });
  } catch (err) {
    res.status(500).json({ error: err.message, stack: err.stack });
  }
});

module.exports = router;
