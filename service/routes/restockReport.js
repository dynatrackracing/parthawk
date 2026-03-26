'use strict';

const router = require('express-promise-router')();
const { database } = require('../database/database');
const { normalizePartNumber } = require('../lib/partNumberUtils');
const { extractPartNumbers: piExtractPNs, vehicleYearMatchesPart } = require('../utils/partIntelligence');

// Make detection — word boundaries, scans entire title
const MAKE_PATTERNS = [
  [/\bToyota\b/i, 'Toyota'], [/\bHonda\b/i, 'Honda'], [/\bFord\b/i, 'Ford'],
  [/\bDodge\b/i, 'Dodge'], [/\bChrysler\b/i, 'Chrysler'], [/\bJeep\b/i, 'Jeep'],
  [/\bRam\b(?!\w)/i, 'Ram'],
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
  [/\bSaab\b/i, 'Saab'], [/\bSuzuki\b/i, 'Suzuki'], [/\bIsuzu\b/i, 'Isuzu'],
  [/\bHummer\b/i, 'Hummer'], [/\bGenesis\b/i, 'Genesis'], [/\bMaserati\b/i, 'Maserati'],
  [/\bAlfa Romeo\b/i, 'Alfa Romeo'], [/\bSmart\b/i, 'Smart'],
  [/\bOldsmobile\b/i, 'Oldsmobile'], [/\bPlymouth\b/i, 'Plymouth'],
  [/\bRange Rover\b/i, 'Land Rover'], [/\bLand Rover\b/i, 'Land Rover'],
  // Model-implies-make: Explorer=Ford, Mountaineer=Mercury, Civic=Honda etc
  [/\bExplorer\b/i, 'Ford'], [/\bMountaineer\b/i, 'Mercury'],
  [/\bEscalade\b/i, 'Cadillac'], [/\bYukon\b/i, 'GMC'],
];

// Known compound models (2+ words that must stay together)
const COMPOUND_MODELS = {
  'GRAND': ['Cherokee','Caravan','Prix','Marquis','Vitara','Am'],
  'SANTA': ['Fe','Cruz'],
  'TOWN': ['Car','Country','&'],
  'CROWN': ['Victoria'],
  'MONTE': ['Carlo'],
  'LAND': ['Cruiser'],
  'PT': ['Cruiser'],
  'RANGE': ['Rover'],
  'COOPER': ['S','Countryman'],
  'WRANGLER': ['JK','JL'],
  'MUSTANG': ['GT','Mach'],
  'CIVIC': ['Si','Type'],
  'PARK': ['Avenue'],
};

const STOP_WORDS = new Set(['ECU','ECM','PCM','BCM','TCM','ABS','TIPM','OEM','NEW','USED','REMAN',
  'ENGINE','BODY','CONTROL','MODULE','ANTI','FUSE','POWER','BRAKE','AMPLIFIER','RADIO','CLUSTER',
  'PROGRAMMED','PLUG','PLAY','AT','MT','4WD','AWD','2WD','FWD','INTEGRATED','LOCK','PUMP',
  'ELECTRIC','STEERING','THROTTLE','VIN','TESTED','GENUINE','REBUILT','V6','V8','V10',
  'HEMI','TURBO','SUPERCHARGED','AUTOMATIC','MANUAL']);

function extractMake(title) {
  for (const [re, name] of MAKE_PATTERNS) {
    if (re.test(title)) return name;
  }
  return null;
}

function extractModel(title, make) {
  if (!make) return null;
  const tu = title.toUpperCase();
  // Find make position — try canonical name first, then aliases
  const makeNames = [make.toUpperCase()];
  if (make === 'Chevrolet') makeNames.push('CHEVY');
  if (make === 'Volkswagen') makeNames.push('VW');
  if (make === 'Land Rover') makeNames.push('RANGE ROVER');

  let mi = -1;
  let matchLen = 0;
  for (const mn of makeNames) {
    const idx = tu.indexOf(mn);
    if (idx !== -1 && (mi === -1 || idx < mi)) { mi = idx; matchLen = mn.length; }
  }
  if (mi === -1) return null;

  const after = title.substring(mi + matchLen).trim().split(/\s+/);
  const mw = [];
  for (let i = 0; i < after.length; i++) {
    const w = after[i];
    const clean = w.replace(/[^A-Za-z0-9\-]/g, '');
    if (!clean) continue;
    if (/^\d{4}$/.test(clean) || /^\d{4}-\d{4}$/.test(clean)) {
      if (mw.length > 0) break; else continue; // skip leading years
    }
    if (/^\d+\.\d+[lL]?$/.test(clean)) break;
    if (STOP_WORDS.has(clean.toUpperCase())) break;
    mw.push(clean);

    // Check if this starts a compound model
    const upper = clean.toUpperCase();
    if (COMPOUND_MODELS[upper] && i + 1 < after.length) {
      const next = after[i + 1]?.replace(/[^A-Za-z0-9\-&]/g, '') || '';
      if (COMPOUND_MODELS[upper].some(c => c.toUpperCase() === next.toUpperCase())) {
        mw.push(next);
        break;
      }
    }

    // Number suffix (Ram 1500, F-150)
    if (mw.length >= 2 && /^\d/.test(clean)) break;
    if (mw.length >= 1 && !COMPOUND_MODELS[upper]) break;
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
  if (/\b(STARTER MOTOR|STARTER)\b/.test(t)) return 'Starter';
  if (/\b(SEAT BELT|SEATBELT)\b/.test(t)) return 'Seat Belt';
  if (/\b(WINDOW MOTOR|REGULATOR)\b/.test(t)) return 'Regulator';
  if (/\b(HEADLIGHT|HEAD LIGHT|HEAD LAMP)\b/.test(t)) return 'Headlight';
  if (/\b(TAIL LIGHT|TAILLIGHT)\b/.test(t)) return 'Tail Light';
  if (/\b(STEERING|EPS|POWER STEERING)\b/.test(t)) return 'Steering';
  if (/\b(TRANSFER CASE)\b/.test(t)) return 'Transfer Case';
  if (/\b(WIPER)\b/.test(t)) return 'Wiper';
  if (/\b(SENSOR|CAMERA|BLIND SPOT|PARKING)\b/.test(t)) return 'Sensor';
  if (/\b(ACTUATOR|MULTIAIR|VVT)\b/.test(t)) return 'Actuator';
  if (/\b(INTAKE MANIFOLD)\b/.test(t)) return 'Intake';
  if (/\b(CLIMATE|HVAC|AC CONTROL)\b/.test(t)) return 'Climate Control';
  return null;
}

function extractPartNumbers(title) {
  const pns = [];
  const m1 = title.match(/\b(\d{7,10}[A-Z]{0,2})\b/g);
  if (m1) pns.push(...m1);
  const m2 = title.match(/\b([A-Z]{1,4}\d{1,2}[A-Z]-[A-Z0-9]{3,7}(?:-[A-Z]{1,3})?)\b/g);
  if (m2) pns.push(...m2);
  const m3 = title.match(/\b(\d{5}-[A-Z0-9]{2,7}(?:-[A-Z0-9]{1,3})?)\b/g);
  if (m3) pns.push(...m3);
  return pns;
}

function getPartLabel(title, make, model) {
  // Remove make, model, years, PNs, engine specs → what's left is the part description
  let t = title;
  if (make) t = t.replace(new RegExp('\\b' + make.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'gi'), '');
  if (make === 'Chevrolet') t = t.replace(/\bChevy\b/gi, '');
  if (model) t = t.replace(new RegExp('\\b' + model.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'gi'), '');
  t = t.replace(/\b\d{4}(-\d{4})?\b/g, '');
  t = t.replace(/\b\d{7,10}[A-Z]{0,2}\b/g, '');
  t = t.replace(/\b[A-Z]{1,4}\d{1,2}[A-Z]-[A-Z0-9]{3,7}(?:-[A-Z]{1,3})?\b/g, '');
  t = t.replace(/\b\d{5}-[A-Z0-9]{2,7}\b/g, '');
  t = t.replace(/\b\d+\.\d+L\b/gi, '');
  t = t.replace(/\b(OEM|Programmed|Tested|REMAN|AT|MT|4WD|AWD|2WD|FWD|RWD|V6|V8)\b/gi, '');
  t = t.replace(/[,\-]/g, ' ').replace(/\s+/g, ' ').trim();
  return t || 'Part';
}

router.get('/report', async (req, res) => {
  try {
    const days = parseInt(req.query.days) || 30;
    const clampedDays = Math.min(Math.max(days, 1), 365);

    const sales = await database('YourSale')
      .where('soldDate', '>=', database.raw(`NOW() - INTERVAL '${clampedDays} days'`))
      .whereNotNull('title')
      .whereRaw('"salePrice"::numeric >= 50')
      .select('title', 'salePrice', 'soldDate', 'sku');

    const groups = {};
    for (const sale of sales) {
      const title = sale.title || '';
      const make = extractMake(title);
      const model = make ? extractModel(title, make) : null;
      let pt = extractPartType(title);
      if (!pt) pt = getPartLabel(title, make, model);
      const pns = piExtractPNs(title);
      const basePn = pns.length > 0 ? pns[0].base : null;
      const key = `${make || '?'}|${model || ''}|${pt}|${basePn || title.substring(0, 30)}`;

      if (!groups[key]) {
        groups[key] = { make: make || '?', model, partType: pt, basePn, allPns: new Set(), sold: 0, totalPrice: 0, lastSold: null, sampleTitle: title };
      }
      const g = groups[key];
      g.sold++;
      g.totalPrice += parseFloat(sale.salePrice) || 0;
      for (const pn of pns) g.allPns.add(pn.raw);
      if (!g.lastSold || new Date(sale.soldDate) > new Date(g.lastSold)) g.lastSold = sale.soldDate;
    }

    const listings = await database('YourListing').where('listingStatus', 'Active').whereNotNull('title').select('title', 'quantityAvailable', 'sku');
    const stockByBasePn = {};
    const listingTitles = [];
    for (const l of listings) {
      const qty = parseInt(l.quantityAvailable) || 1;
      listingTitles.push({ title: (l.title || '').toUpperCase(), qty });
      // Use shared part number extractor (handles all OEM formats)
      const pns = piExtractPNs(l.title || '');
      for (const pn of pns) {
        if (pn.base) stockByBasePn[pn.base] = (stockByBasePn[pn.base] || 0) + qty;
        if (pn.raw && pn.raw !== pn.base) stockByBasePn[pn.raw] = (stockByBasePn[pn.raw] || 0) + qty;
      }
      // Also index by SKU as part number
      if (l.sku) {
        const skuBase = normalizePartNumber(l.sku);
        if (skuBase && skuBase.length >= 5) stockByBasePn[skuBase] = (stockByBasePn[skuBase] || 0) + qty;
      }
    }

    // Fallback stock lookup: match by make + partType keywords in listing titles
    // Now with year filtering to prevent cross-year false positives
    function titleStockFallback(make, partType, yearStart) {
      if (!make || make === '?' || !partType) return 0;
      const makeUp = make.toUpperCase();
      const ptPatterns = {
        'ECM': ['ECM','ECU','PCM','ENGINE CONTROL','ENGINE COMPUTER'],
        'BCM': ['BCM','BODY CONTROL'],
        'TCM': ['TCM','TCU','TRANSMISSION CONTROL'],
        'ABS': ['ABS','ANTI LOCK','ANTI-LOCK','BRAKE MODULE'],
        'TIPM': ['TIPM'],
        'Fuse Box': ['FUSE BOX','JUNCTION','IPDM','RELAY BOX'],
        'Amplifier': ['AMPLIFIER','BOSE','HARMAN','JBL'],
        'Radio': ['RADIO','STEREO','RECEIVER','INFOTAINMENT'],
        'Cluster': ['CLUSTER','SPEEDOMETER','INSTRUMENT','GAUGE'],
        'Throttle': ['THROTTLE BODY'],
      };
      const patterns = ptPatterns[partType];
      if (!patterns) return 0;
      let count = 0;
      for (const lt of listingTitles) {
        if (!lt.title.includes(makeUp)) continue;
        if (!patterns.some(p => lt.title.includes(p))) continue;
        // Year filter: if listing has a year and we have a year, check match
        if (yearStart) {
          const yearCheck = vehicleYearMatchesPart(yearStart, lt.title);
          if (yearCheck.confirmed && !yearCheck.matches) continue;
        }
        count += lt.qty;
      }
      return count;
    }

    const items = [];
    for (const [, g] of Object.entries(groups)) {
      let stock = g.basePn ? (stockByBasePn[g.basePn] || 0) : 0;
      // Fallback: if no PN match, try title-based matching
      if (stock === 0 && g.make && g.make !== '?') {
        const yr = g.sampleTitle ? g.sampleTitle.match(/\b((?:19|20)\d{2})\b/) : null;
        stock = titleStockFallback(g.make, g.partType, yr ? parseInt(yr[1]) : null);
      }
      const avgPrice = g.sold > 0 ? Math.round(g.totalPrice / g.sold * 100) / 100 : 0;
      const years = g.sampleTitle.match(/\b((?:19|20)\d{2})\b/g);
      let yearRange = null;
      if (years) { const s = [...new Set(years.map(Number))].sort(); yearRange = s[0] === s[s.length - 1] ? String(s[0]) : s[0] + '-' + s[s.length - 1]; }

      // === SCORING: price is king ===
      let score = 0;
      // Price (dominant factor, max 35)
      score += avgPrice >= 500 ? 35 : avgPrice >= 300 ? 28 : avgPrice >= 200 ? 22 : avgPrice >= 150 ? 15 : avgPrice >= 100 ? 10 : 5;
      // Stock urgency (max 30)
      score += stock === 0 ? 30 : stock === 1 ? 20 : (g.sold > stock ? 10 : 0);
      // Demand volume (max 20)
      score += g.sold >= 4 ? 20 : g.sold >= 3 ? 15 : g.sold >= 2 ? 10 : 5;
      // Recency (max 15)
      const daysSince = g.lastSold ? Math.floor((Date.now() - new Date(g.lastSold).getTime()) / 86400000) : 99;
      score += daysSince <= 3 ? 15 : daysSince <= 7 ? 12 : daysSince <= 14 ? 8 : 4;
      score = Math.min(100, score);

      // Floor rules: high-value parts always surface
      if (avgPrice >= 500 && g.sold >= 1 && stock <= 1) score = Math.max(score, 85);
      if (avgPrice >= 300 && g.sold >= 1 && stock <= 1) score = Math.max(score, 75);
      if (avgPrice >= 200 && g.sold >= 2 && stock === 0) score = Math.max(score, 75);

      const action = stock === 0 ? 'RESTOCK NOW' : stock === 1 ? 'LOW STOCK' : (g.sold > stock ? 'SELLING FAST' : 'MONITOR');

      items.push({
        score, action, make: g.make, model: g.model, partType: g.partType,
        basePn: g.basePn, variantPns: [...g.allPns].slice(0, 5), yearRange,
        sold7d: g.sold, activeStock: stock, avgPrice, revenue: Math.round(g.totalPrice),
        daysSinceSold: daysSince, sampleTitle: g.sampleTitle,
      });
    }

    const filtered = items.filter(i => i.activeStock <= 1 || i.sold7d > i.activeStock || i.avgPrice >= 300);
    filtered.sort((a, b) => b.score - a.score || b.revenue - a.revenue);
    const top = filtered.slice(0, 100);

    // Tier rules: price-aware — high value parts with low stock are always green
    const tiers = { green: [], yellow: [], orange: [] };
    for (const item of top) {
      if (item.score >= 75) { item.tier = 'green'; tiers.green.push(item); }
      else if (item.score >= 60) { item.tier = 'yellow'; tiers.yellow.push(item); }
      else { item.tier = 'orange'; tiers.orange.push(item); }
    }

    // Get listing count for diagnostics
    let activeListingCount = 0;
    try {
      const lc = await database('YourListing').where('listingStatus', 'Active').count('* as cnt').first();
      activeListingCount = parseInt(lc?.cnt || 0);
    } catch (e) { /* ignore */ }

    res.json({ success: true, generatedAt: new Date().toISOString(), days: clampedDays,
      period: clampedDays === 1 ? 'Last 24 hours' : `Last ${clampedDays} days`, tiers,
      summary: { green: tiers.green.length, yellow: tiers.yellow.length, orange: tiers.orange.length,
        total: top.length, salesAnalyzed: sales.length, activeListings: activeListingCount },
    });
  } catch (err) {
    res.status(500).json({ error: err.message, stack: err.stack });
  }
});

/**
 * GET /restock/found-items
 * Returns all claimed scout alerts (GOT ONE) for THE QUARRY items,
 * so the THE QUARRY page can show "FOUND — Pulled from LKQ Raleigh"
 */
router.get('/found-items', async (req, res) => {
  try {
    const found = await database('scout_alerts')
      .where('source', 'bone_pile')
      .where('claimed', true)
      .select('source_title', 'yard_name', 'claimed_at', 'vehicle_year', 'vehicle_make', 'vehicle_model');

    // Build lookup by normalized title prefix for matching against report items
    const foundMap = {};
    for (const f of found) {
      // Key by first 40 chars of title (same dedup key used in alert generation)
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
