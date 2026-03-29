'use strict';

/**
 * OpportunityService — Surfaces parts with strong market demand we don't stock.
 *
 * Data sources (no scraping — reads existing caches):
 *   1. market_demand_cache — eBay sold comps (median price, sold count)
 *   2. YourListing — current active stock
 *   3. YourSale — our historical sales (proven seller bonus)
 *
 * Scoring (max 110):
 *   Demand:   max 35pts (eBay sold count)
 *   Price:    max 25pts (median price tiers)
 *   Velocity: max 15pts (sales per week)
 *   History:  20pts if we've sold this before
 *   Scarcity: max 15pts (niche high-margin parts)
 *   Floor: median >= $300 + any market signal → minimum 75
 *
 * Hard excludes: complete engines, complete transmissions, body panels.
 * Always allows: modules, sensors, pumps, throttle bodies, amplifiers, etc.
 */

const { database } = require('../database/database');
const { extractPartNumbers } = require('../utils/partIntelligence');

// ── Hard exclude / allow filters ────────────────────────────────

// Engine bolt-on accessories we sell (unbolt from outside without opening engine)
const ENGINE_ALLOW_WORDS = [
  'MODULE', 'COMPUTER', 'CONTROL', 'SENSOR', 'MOUNT', 'HARNESS',
  'COIL', 'INJECTOR', 'FUEL RAIL', 'PUMP', 'THROTTLE', 'INTAKE MANIFOLD',
  'EXHAUST MANIFOLD', 'PULLEY', 'TENSIONER', 'SOLENOID', 'ALTERNATOR',
  'STARTER', 'TURBO', 'SUPERCHARGER', 'COMPRESSOR', 'WATER PUMP',
  'THERMOSTAT', 'EGR', 'FILTER HOUSING', 'VALVE COVER', 'IGNITION',
];
// Engine internals we do NOT sell (require opening the engine)
const ENGINE_SKIP_WORDS = [
  'LONG BLOCK', 'SHORT BLOCK', 'ENGINE ASSEMBLY', 'ENGINE MOTOR',
  'COMPLETE ENGINE', 'BARE ENGINE', 'REMANUFACTURED ENGINE',
  'PISTON', 'CONNECTING ROD', 'CRANKSHAFT', 'CAMSHAFT',
  'TIMING CHAIN', 'TIMING BELT', 'TIMING COVER',
  'CYLINDER HEAD', 'HEAD GASKET', 'VALVE SPRING',
  'OIL PAN', 'OIL PUMP', 'ENGINE BLOCK',
];

const TRANS_ALLOW_WORDS = [
  'MODULE', 'COMPUTER', 'CONTROL', 'SENSOR', 'SOLENOID', 'MOUNT',
  'HARNESS', 'FILTER', 'COOLER', 'PAN', 'TCM', 'TCU',
];

const BODY_PANEL_WORDS = [
  'bumper cover', 'bumper assembly', 'fender', 'hood panel', 'quarter panel',
  'door shell', 'door assembly', 'bed side', 'radiator support', 'tailgate shell',
  'trunk lid', 'roof panel', 'rocker panel',
];

const ALWAYS_ALLOW_TYPES = new Set([
  'ECM', 'PCM', 'ECU', 'BCM', 'TCM', 'TCU', 'ABS', 'TIPM', 'IPDM',
  'AMP', 'AMPLIFIER', 'CLUSTER', 'RADIO', 'THROTTLE', 'STEERING',
  'YAW', 'CAMERA', 'REGULATOR', 'MIRROR', 'BLOWER', 'FAN',
]);

function shouldExclude(title) {
  if (!title) return true;
  const t = title.toUpperCase();

  for (const type of ALWAYS_ALLOW_TYPES) {
    if (t.includes(type)) return false;
  }

  // Engine: skip internals first, then check if it's a bolt-on accessory
  if (t.includes('ENGINE')) {
    if (ENGINE_SKIP_WORDS.some(w => t.includes(w))) return true;
    if (!ENGINE_ALLOW_WORDS.some(w => t.includes(w))) return true;
  }
  if (t.includes('TRANSMISSION') && !TRANS_ALLOW_WORDS.some(w => t.includes(w))) return true;

  const tLower = title.toLowerCase();
  if (BODY_PANEL_WORDS.some(w => tLower.includes(w))) return true;

  return false;
}

// ── Part type detection ─────────────────────────────────────────

function detectPartType(title) {
  const t = (title || '').toUpperCase();
  if (t.includes('TCM') || t.includes('TCU') || t.includes('TRANSMISSION CONTROL')) return 'TCM';
  if (t.includes('BCM') || t.includes('BODY CONTROL')) return 'BCM';
  if (t.includes('ECM') || t.includes('ECU') || t.includes('PCM') || t.includes('ENGINE CONTROL') || t.includes('ENGINE COMPUTER')) return 'ECM';
  if (t.includes('ABS') || t.includes('ANTI LOCK') || t.includes('ANTI-LOCK') || t.includes('BRAKE MODULE')) return 'ABS';
  if (t.includes('TIPM') || t.includes('FUSE BOX') || t.includes('JUNCTION') || t.includes('RELAY BOX') || t.includes('IPDM')) return 'TIPM';
  if (t.includes('AMPLIFIER') || t.includes('BOSE') || t.includes('HARMAN') || t.includes('ALPINE') || t.includes('JBL')) return 'AMP';
  if (t.includes('CLUSTER') || t.includes('SPEEDOMETER') || t.includes('INSTRUMENT')) return 'CLUSTER';
  if (t.includes('RADIO') || t.includes('HEAD UNIT') || t.includes('INFOTAINMENT') || t.includes('STEREO')) return 'RADIO';
  if (t.includes('THROTTLE')) return 'THROTTLE';
  if (t.includes('STEERING') || t.includes('EPS')) return 'STEERING';
  if (t.includes('YAW RATE')) return 'YAW';
  if (t.includes('CAMERA')) return 'CAMERA';
  if (t.includes('WINDOW') && t.includes('REGULATOR')) return 'REGULATOR';
  if (t.includes('MIRROR')) return 'MIRROR';
  if (t.includes('BLOWER')) return 'BLOWER';
  if (t.includes('ALTERNATOR')) return 'ALTERNATOR';
  if (t.includes('STARTER')) return 'STARTER';
  if (t.includes('INTAKE MANIFOLD')) return 'INTAKE';
  if (t.includes('VALVE COVER')) return 'VALVE COVER';
  return null;
}

// ── Title parser — extract year/make/model/partType/partNumber/engine ──

const MAKES_MAP = {
  'ACURA':1,'AUDI':1,'BMW':1,'BUICK':1,'CADILLAC':1,'CHEVROLET':1,'CHEVY':'CHEVROLET',
  'CHRYSLER':1,'DODGE':1,'FIAT':1,'FORD':1,'GENESIS':1,'GMC':1,'HONDA':1,'HYUNDAI':1,
  'INFINITI':1,'JAGUAR':1,'JEEP':1,'KIA':1,'LAND ROVER':1,'LEXUS':1,'LINCOLN':1,
  'MAZDA':1,'MERCEDES-BENZ':1,'MERCEDES':'MERCEDES-BENZ','MINI':1,'MITSUBISHI':1,
  'NISSAN':1,'PORSCHE':1,'RAM':1,'SCION':1,'SUBARU':1,'TESLA':1,'TOYOTA':1,
  'VOLKSWAGEN':1,'VW':'VOLKSWAGEN','VOLVO':1,
};

const MODELS_LIST = [
  'Grand Cherokee','Grand Caravan','Transit Connect','Ram 1500','Ram 2500','Ram 3500',
  'GL-Class','ML-Class','R-Class','Santa Fe','CR-V','HR-V','F-150','F-250','F-350',
  'Accord','Altima','Camaro','Camry','Caravan','Challenger','Charger','Cherokee',
  'Civic','Colorado','Compass','Corolla','Cruze','Dart','Durango','Edge','Elantra',
  'Equinox','Escape','Explorer','Express','Fiesta','Fit','Focus','Forte','Frontier',
  'Fusion','G35','G37','Highlander','Impala','Journey','Jetta','Kicks','Kona',
  'Malibu','Maxima','Murano','Mustang','MKX','Optima','Outback','Pacifica',
  'Pathfinder','Patriot','Pilot','Prius','Q50','Q60','QX60','Renegade','Rio',
  'Rogue','Sentra','Sienna','Sierra','Silverado','Sorento','Soul','Sportage',
  'Sonata','Suburban','Tacoma','Tahoe','Terrain','Titan','Transit','Traverse',
  'Tucson','Tundra','Versa','Wrangler','Xterra',
];
// Pre-build model regexes sorted by length desc so "Grand Cherokee" matches before "Cherokee"
const MODEL_PATTERNS = MODELS_LIST
  .sort((a, b) => b.length - a.length)
  .map(m => ({ name: m, re: new RegExp('\\b' + m.replace(/[-]/g, '[-\\s]?') + '\\b', 'i') }));

const PART_TYPE_PATTERNS = [
  { re: /\b(ECM|ECU|PCM|ENGINE\s*CONTROL|ENGINE\s*COMPUTER)\b/i, type: 'ECM' },
  { re: /\bBCM\b|\bBODY\s*CONTROL\b/i, type: 'BCM' },
  { re: /\b(TCM|TCU|TRANSMISSION\s*CONTROL)\b/i, type: 'TCM' },
  { re: /\bTIPM\b/i, type: 'TIPM' },
  { re: /\bABS\b.*(MODULE|PUMP|CONTROL)/i, type: 'ABS Module' },
  { re: /\b(FUSE\s*BOX|JUNCTION|RELAY\s*BOX)\b/i, type: 'Fuse Box' },
  { re: /\b(AMPLIFIER|AMP)\b/i, type: 'Amplifier' },
  { re: /\b(RADIO|HEAD\s*UNIT|STEREO|INFOTAINMENT)\b/i, type: 'Radio' },
  { re: /\b(CLUSTER|SPEEDOMETER|INSTRUMENT)\b/i, type: 'Cluster' },
  { re: /\bTHROTTLE\b/i, type: 'Throttle Body' },
  { re: /\b(IGNITION\s*SWITCH|IGNITION)\b/i, type: 'Ignition Switch' },
  { re: /\b(BACKUP\s*CAMERA|CAMERA)\b/i, type: 'Camera' },
  { re: /\b(BLIND\s*SPOT|BSM)\b/i, type: 'Blind Spot Module' },
  { re: /\b(HVAC|CLIMATE\s*CONTROL)\b/i, type: 'HVAC Module' },
  { re: /\b(AIRBAG|SRS)\b/i, type: 'Airbag Module' },
  { re: /\b(SIDE\s*MIRROR|MIRROR)\b/i, type: 'Mirror' },
  { re: /\bSEAT\s*BELT\b/i, type: 'Seat Belt' },
];

function parseTitle(title) {
  const result = { year: null, yearEnd: null, make: null, model: null, partType: null, partNumber: null, engineSize: null };
  if (!title) return result;
  const t = title;

  // Year range: "2015-2020" or single: "2017"
  const rangeMatch = t.match(/\b((?:19|20)\d{2})\s*[-–]\s*((?:19|20)\d{2})\b/);
  if (rangeMatch) {
    result.year = parseInt(rangeMatch[1]);
    result.yearEnd = parseInt(rangeMatch[2]);
  } else {
    const singleMatch = t.match(/\b((?:19|20)\d{2})\b/);
    if (singleMatch) result.year = parseInt(singleMatch[1]);
  }

  // Make
  const tUpper = t.toUpperCase();
  // Check multi-word makes first
  if (/\bLAND\s+ROVER\b/i.test(t)) result.make = 'LAND ROVER';
  else if (/\bMERCEDES[-\s]?BENZ\b/i.test(t)) result.make = 'MERCEDES-BENZ';
  else {
    for (const [key, val] of Object.entries(MAKES_MAP)) {
      if (key.includes(' ')) continue; // skip multi-word, handled above
      const re = new RegExp('\\b' + key + '\\b', 'i');
      if (re.test(t)) {
        result.make = typeof val === 'string' ? val : key;
        break;
      }
    }
  }

  // Model
  for (const { name, re } of MODEL_PATTERNS) {
    if (re.test(t)) { result.model = name; break; }
  }

  // Part type
  for (const { re, type } of PART_TYPE_PATTERNS) {
    if (re.test(t)) { result.partType = type; break; }
  }

  // Part number: last alphanumeric token with both letters+digits, 6+ chars
  const tokens = t.match(/[A-Z0-9][-A-Z0-9]{5,}/gi) || [];
  for (let i = tokens.length - 1; i >= 0; i--) {
    const tok = tokens[i];
    if (/[A-Za-z]/.test(tok) && /\d/.test(tok) && tok.length >= 6) {
      // Skip year-like tokens and common non-PN patterns
      if (/^(19|20)\d{2}$/.test(tok)) continue;
      result.partNumber = tok.toUpperCase();
      break;
    }
  }

  // Engine size: "5.7L", "3.5L", etc.
  const engineMatch = t.match(/\b(\d\.\d)L\b/i);
  if (engineMatch) result.engineSize = engineMatch[1] + 'L';

  return result;
}

// ── Parse cache key back into components ────────────────────────

function parseCacheKey(key) {
  if (key.includes('|')) {
    const parts = key.split('|');
    return {
      type: 'KEYWORD',
      year: /^\d{4}$/.test(parts[0]) ? parseInt(parts[0]) : null,
      make: parts.length >= 2 ? parts[1] : null,
      model: parts.length >= 3 ? parts[2] : null,
      partType: parts.length >= 4 ? parts[3] : null,
    };
  }
  return { type: 'PN', pn: key, year: null, make: null, model: null, partType: null };
}

// ── Main opportunity finder ─────────────────────────────────────

async function findOpportunities() {
  // 1. Load market demand cache
  const cacheRows = await database('market_demand_cache')
    .where('ebay_avg_price', '>', 0)
    .select('part_number_base', 'ebay_avg_price', 'ebay_sold_90d', 'last_updated');

  if (cacheRows.length === 0) return [];

  // 2. Load active stock — index by base PN
  const listings = await database('YourListing')
    .where('listingStatus', 'Active')
    .whereNotNull('title')
    .select('title', 'quantityAvailable');

  const stockByPN = new Set();
  for (const listing of listings) {
    const pns = extractPartNumbers(listing.title || '');
    for (const pn of pns) {
      stockByPN.add(pn.base);
      stockByPN.add(pn.normalized);
    }
  }

  // 3. Load our 180d sales history — index by base PN and by keyword combo
  const salesRows = await database.raw(`
    SELECT title, COUNT(*) as cnt, ROUND(AVG("salePrice")::numeric, 2) as avg_price,
           MAX("soldDate") as last_sold
    FROM "YourSale"
    WHERE "soldDate" > NOW() - INTERVAL '180 days' AND title IS NOT NULL
    GROUP BY title
  `);

  const salesByPN = new Map();
  const salesByKeyword = new Map(); // "MAKE|MODEL|PARTTYPE" → {count, avgPrice, lastSold}

  for (const row of (salesRows.rows || salesRows)) {
    const title = row.title || '';
    const cnt = parseInt(row.cnt) || 0;
    const price = parseFloat(row.avg_price) || 0;

    const pns = extractPartNumbers(title);
    for (const pn of pns) {
      if (!salesByPN.has(pn.base)) {
        salesByPN.set(pn.base, { count: 0, avgPrice: 0, lastSold: null, sampleTitle: title });
      }
      const e = salesByPN.get(pn.base);
      e.count += cnt;
      e.avgPrice = price;
      if (!e.lastSold || new Date(row.last_sold) > new Date(e.lastSold)) e.lastSold = row.last_sold;
    }

    // Keyword index for make|model|partType matching
    const partType = detectPartType(title);
    if (partType) {
      const titleUpper = title.toUpperCase();
      // Build a rough keyword key
      const MAKES = ['FORD','TOYOTA','HONDA','DODGE','JEEP','CHRYSLER','RAM','CHEVROLET','GMC',
        'NISSAN','BMW','MERCEDES','MAZDA','KIA','HYUNDAI','SUBARU','LEXUS','ACURA','CADILLAC',
        'BUICK','LINCOLN','VOLVO','AUDI','VOLKSWAGEN','INFINITI','MITSUBISHI','PONTIAC','SATURN',
        'MERCURY','SCION','MINI','PORSCHE','JAGUAR','LAND ROVER'];
      let make = null;
      for (const m of MAKES) { if (titleUpper.includes(m)) { make = m; break; } }
      if (make) {
        const kwKey = [make, partType].join('|');
        if (!salesByKeyword.has(kwKey)) {
          salesByKeyword.set(kwKey, { count: 0, avgPrice: 0, lastSold: null });
        }
        const e = salesByKeyword.get(kwKey);
        e.count += cnt;
        e.avgPrice = price;
        if (!e.lastSold || new Date(row.last_sold) > new Date(e.lastSold)) e.lastSold = row.last_sold;
      }
    }
  }

  // 4. Score each market cache entry
  const opportunities = [];
  let filteredCount = 0;
  let totalConsidered = 0;

  for (const row of cacheRows) {
    const key = row.part_number_base;
    const median = parseFloat(row.ebay_avg_price) || 0;
    const soldCount = parseInt(row.ebay_sold_90d) || 0;
    const parsed = parseCacheKey(key);

    // Demand threshold
    if (median >= 150 && soldCount < 1) continue;
    if (median < 150 && soldCount < 2) continue;

    // Check stock
    let inStock = false;
    if (parsed.type === 'PN') {
      inStock = stockByPN.has(parsed.pn);
    } else if (parsed.make && parsed.partType) {
      // For keyword keys, check if we have a listing with this make+model+partType
      try {
        let q = database('YourListing').where('listingStatus', 'Active')
          .where('title', 'ilike', `%${parsed.make}%`);
        if (parsed.model && parsed.model !== parsed.partType) {
          q = q.where('title', 'ilike', `%${parsed.model}%`);
        }
        const ptKeywords = {
          'ECM': ['ECM','ECU','PCM'], 'BCM': ['BCM'], 'ABS': ['ABS'],
          'TIPM': ['TIPM','FUSE','IPDM'], 'TCM': ['TCM','TCU'],
          'AMP': ['Amplifier','AMP'], 'CLUSTER': ['Cluster','Speedometer'],
          'RADIO': ['Radio','Stereo'], 'STEERING': ['Steering','EPS'],
          'MIRROR': ['Mirror'], 'THROTTLE': ['Throttle'],
        };
        const kws = ptKeywords[parsed.partType] || [parsed.partType];
        q = q.where(function() {
          for (const kw of kws) this.orWhere('title', 'ilike', `%${kw}%`);
        });
        const match = await q.first();
        inStock = !!match;
      } catch (e) { inStock = false; }
    }

    if (inStock) continue;

    // Sales history check
    let soldByUs = null;
    if (parsed.type === 'PN') {
      soldByUs = salesByPN.get(parsed.pn) || null;
    } else if (parsed.make && parsed.partType) {
      const kwKey = [parsed.make, parsed.partType].join('|');
      soldByUs = salesByKeyword.get(kwKey) || null;
    }
    const historyBonus = !!soldByUs;

    // Build description
    let description;
    if (parsed.type === 'KEYWORD') {
      description = [parsed.year, parsed.make, parsed.model, parsed.partType].filter(Boolean).join(' ');
    } else {
      // Try to find a sample title from our sales
      const saleEntry = salesByPN.get(parsed.pn);
      if (saleEntry?.sampleTitle) {
        description = saleEntry.sampleTitle;
      } else {
        try {
          const sample = await database('YourSale').where('title', 'ilike', `%${parsed.pn}%`).first('title');
          description = sample ? sample.title : `Part Number ${parsed.pn}`;
        } catch (e) {
          description = `Part Number ${parsed.pn}`;
        }
      }
    }

    // Hard exclude
    if (shouldExclude(description)) continue;

    // ── Parse title for structured fields ──
    const titleParsed = parseTitle(description);

    // Merge: cache key fields take priority, title-parsed fills gaps
    const oppMake = parsed.make || titleParsed.make;
    const oppModel = parsed.model || titleParsed.model;
    const oppYear = parsed.year || titleParsed.year;
    const oppYearEnd = titleParsed.yearEnd || null;
    const oppPartType = parsed.partType || detectPartType(description) || titleParsed.partType;
    const oppPartNumber = titleParsed.partNumber || (parsed.type === 'PN' ? parsed.pn : null);
    const oppEngine = titleParsed.engineSize || null;

    // ── FILTER GATE: must have BOTH vehicle AND part identity ──
    totalConsidered++;
    if (!oppMake) { filteredCount++; continue; }
    if (!oppPartType && !oppPartNumber) { filteredCount++; continue; }

    const velocity = soldCount > 0 ? Math.round((soldCount / 90) * 7 * 10) / 10 : 0;

    // ── SCORING ──
    let demandScore = 0;
    if (soldCount >= 50) demandScore = 35;
    else if (soldCount >= 30) demandScore = 30;
    else if (soldCount >= 20) demandScore = 25;
    else if (soldCount >= 10) demandScore = 20;
    else if (soldCount >= 5) demandScore = 14;
    else if (soldCount >= 2) demandScore = 8;
    else if (soldCount >= 1) demandScore = 4;

    let priceScore = 0;
    if (median >= 400) priceScore = 25;
    else if (median >= 300) priceScore = 22;
    else if (median >= 200) priceScore = 18;
    else if (median >= 150) priceScore = 14;
    else if (median >= 100) priceScore = 10;
    else if (median >= 75) priceScore = 6;
    else if (median >= 50) priceScore = 3;

    let velocityScore = 0;
    if (velocity >= 5) velocityScore = 15;
    else if (velocity >= 3) velocityScore = 12;
    else if (velocity >= 2) velocityScore = 10;
    else if (velocity >= 1) velocityScore = 7;
    else if (velocity >= 0.5) velocityScore = 4;

    const historyScore = historyBonus ? 20 : 0;

    let scarcityScore = 0;
    if (soldCount <= 5 && median >= 200) scarcityScore = 15;
    else if (soldCount <= 10 && median >= 150) scarcityScore = 10;
    else if (soldCount <= 20 && median >= 100) scarcityScore = 5;

    let score = demandScore + priceScore + velocityScore + historyScore + scarcityScore;

    if (median >= 300 && soldCount >= 1) score = Math.max(75, score);

    let recommendation;
    if (score >= 85) recommendation = 'HIGH PRIORITY — strong demand, high margin';
    else if (score >= 70) recommendation = 'STRONG — proven market, worth hunting';
    else if (score >= 55) recommendation = 'MODERATE — good opportunity if convenient';
    else if (score >= 40) recommendation = 'WATCH — market exists, check yard availability';
    else recommendation = 'LOW — limited data, may be niche';

    opportunities.push({
      cacheKey: key, description,
      partType: oppPartType, partNumber: oppPartNumber,
      make: oppMake, model: oppModel, year: oppYear, yearEnd: oppYearEnd,
      engineSize: oppEngine,
      marketMedian: median, soldCount, velocity, score,
      demandScore, priceScore, velocityScore, historyScore, scarcityScore,
      recommendation, inStock: false, soldByUs: historyBonus,
      lastSoldByUs: soldByUs?.lastSold || null,
      ourAvgPrice: soldByUs?.avgPrice || null,
      ourSoldCount: soldByUs?.count || null,
      lastUpdated: row.last_updated,
    });
  }

  console.log(`[OpportunityService] Filter gate: ${filteredCount} filtered out of ${totalConsidered} considered, ${opportunities.length} passed`);

  opportunities.sort((a, b) => b.score !== a.score ? b.score - a.score : b.marketMedian - a.marketMedian);
  return opportunities;
}

module.exports = { findOpportunities, shouldExclude, parseCacheKey, parseTitle };
