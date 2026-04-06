'use strict';

const router = require('express-promise-router')();
const { log } = require('../lib/logger');
const { database } = require('../database/database');
const CompetitorMonitorService = require('../services/CompetitorMonitorService');
const SoldItemsManager = require('../managers/SoldItemsManager');

// Load hidden parts set for filtering intel results
async function loadHiddenSet() {
  try {
    const rows = await database('hidden_parts').select('part_number_base', 'make', 'model');
    const set = new Set();
    for (const r of rows) set.add(`${r.part_number_base}|${(r.make || '').toUpperCase()}|${(r.model || '').toUpperCase()}`);
    return set;
  } catch (e) { return new Set(); }
}

function isHidden(hiddenSet, partNumberBase, make, model) {
  if (!partNumberBase || hiddenSet.size === 0) return false;
  const pn = partNumberBase.toUpperCase();
  const m = (make || '').toUpperCase();
  const md = (model || '').toUpperCase();
  // Check exact match and make/model-agnostic match
  return hiddenSet.has(`${pn}|${m}|${md}`) || hiddenSet.has(`${pn}||`);
}

/**
 * POST /competitors/scan
 * Run competitor price monitoring scan.
 */
router.post('/scan', async (req, res) => {
  try {
    const service = new CompetitorMonitorService();
    const result = await service.scan();
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /competitors/alerts
 * Get active competitor alerts.
 */
router.get('/alerts', async (req, res) => {
  try {
    const { dismissed, limit } = req.query;
    const service = new CompetitorMonitorService();
    const alerts = await service.getAlerts({
      dismissed: dismissed === 'true',
      limit: parseInt(limit) || 50,
    });
    res.json({ success: true, alerts });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /competitors/alerts/:id/dismiss
 * Dismiss a competitor alert.
 */
router.post('/alerts/:id/dismiss', async (req, res) => {
  try {
    const service = new CompetitorMonitorService();
    const result = await service.dismiss(req.params.id);
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /competitors/gap-intel
 * Gap intelligence: parts competitors sell that we have never sold or stocked.
 * Scored by competitor revenue volume and median price.
 * Query: days (default 90), limit (default 50)
 */
router.get('/gap-intel', async (req, res) => {
  const days = parseInt(req.query.days) || 90;
  const limit = parseInt(req.query.limit) || 50;
  const sellerFilter = req.query.seller || null;

  try {
    // Exclude rebuild sellers — their data is reference intel, not competitive
    const rebuildSellers = await database('SoldItemSeller').where('type', 'rebuild').select('name');
    const rebuildNames = rebuildSellers.map(s => s.name);

    // Get competitor sold items (capped at 5000, $100+ only)
    let competitorQuery = database('SoldItem')
      .where('soldDate', '>=', database.raw(`NOW() - INTERVAL '${days} days'`))
      .where('soldPrice', '>=', 100)
      .whereNot('seller', 'dynatrack')
      .whereNot('seller', 'dynatrackracing');

    if (rebuildNames.length > 0) {
      competitorQuery = competitorQuery.whereNotIn('seller', rebuildNames);
    }

    if (sellerFilter) {
      competitorQuery = competitorQuery.where('seller', sellerFilter);
    }

    const competitorItems = await competitorQuery
      .orderBy('soldDate', 'desc')
      .limit(5000)
      .select('title', 'soldPrice', 'soldDate', 'seller', 'ebayItemId', 'partNumberBase', 'partType', 'extractedMake', 'extractedModel');

    // Group by partNumberBase (exact) or normalizeTitle (fallback)
    const compGroups = {};
    for (const item of competitorItems) {
      const key = item.partNumberBase || normalizeTitle(item.title);
      if (!key || key.length < 3) continue;
      if (!compGroups[key]) {
        compGroups[key] = {
          title: item.title,
          sellers: new Set(),
          count: 0,
          totalRevenue: 0,
          prices: [],
          lastSold: null,
          ebayItemId: item.ebayItemId,
          _partNumberBase: item.partNumberBase || null,
          _partType: item.partType || null,
        };
      }
      const g = compGroups[key];
      g.sellers.add(item.seller);
      g.count++;
      g.totalRevenue += parseFloat(item.soldPrice) || 0;
      g.prices.push(parseFloat(item.soldPrice) || 0);
      if (!g.lastSold || new Date(item.soldDate) > new Date(g.lastSold)) g.lastSold = item.soldDate;
    }

    // Build match sets from our data (PNs + partType|make|model keys)
    const yourSales = await database('YourSale').select('title').limit(25000);
    const yourListings = await database('YourListing').where('listingStatus', 'Active').select('title').limit(10000);
    const yourItems = await database('Item').whereRaw("LOWER(seller) LIKE '%dynatrack%'").select('title').limit(5000);

    const allOurTitles = [
      ...yourSales.map(s => s.title),
      ...yourListings.map(l => l.title),
      ...yourItems.map(i => i.title),
    ].filter(Boolean);
    const { pnSet: yourPNs, keySet: yourKeys } = buildMatchSets(allOurTitles);

    let dismissedTitles = new Set();
    try {
      const dismissed = await database('dismissed_intel').select('normalizedTitle');
      dismissedTitles = new Set(dismissed.map(function(d) { return d.normalizedTitle; }));
    } catch (e) { /* table may not exist yet */ }

    // Exclude items already in the_mark (actively tracked)
    let markedTitles = new Set();
    let markedPNs = new Set();
    try {
      const marks = await database('the_mark').where('active', true).select('normalizedTitle', 'partNumber');
      markedTitles = new Set(marks.map(function(m) { return m.normalizedTitle; }));
      for (const m of marks) {
        if (m.partNumber) markedPNs.add(m.partNumber.toUpperCase());
      }
    } catch (e) { /* table may not exist yet */ }

    // Check yard_vehicle for local matches (moved BEFORE gap loop)
    let yardMakes = new Set();
    try {
      const yardVehicles = await database('yard_vehicle').where('active', true).select('make').limit(5000);
      for (const v of yardVehicles) {
        if (v.make) yardMakes.add(v.make.toUpperCase());
      }
    } catch (e) { /* yard_vehicle may not have data */ }

    // Find gaps: competitor parts that we have never sold, listed, or stocked
    const gaps = [];
    for (const [key, group] of Object.entries(compGroups)) {
      if (weAlreadySellThis(group.title, yourPNs, yourKeys)) continue;
      if (dismissedTitles.has(key)) continue;
      if (markedTitles.has(key)) continue;
      if (group._partNumberBase && markedPNs.has(group._partNumberBase.toUpperCase())) continue;

      // Calculate median price
      const sorted = group.prices.sort((a, b) => a - b);
      const median = sorted.length % 2 === 0
        ? (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
        : sorted[Math.floor(sorted.length / 2)];

      const partNumber = group._partNumberBase || extractPartNumber(group.title);

      const sellerCount = group.sellers.size;
      const isConfluence = sellerCount >= 2;
      const volumeScore = Math.min(100, (group.count / 30) * 100);
      const priceScore = Math.min(100, (median / 500) * 100);
      const partNumberScore = partNumber ? 100 : 0;
      // Confluence reshapes the weights - multi-seller validation is the strongest signal
      let score;
      if (isConfluence) {
        const confluenceScore = Math.min(100, (sellerCount / 4) * 100); // 2=50, 3=75, 4+=100
        score = Math.round(confluenceScore * 0.30 + volumeScore * 0.25 + priceScore * 0.25 + partNumberScore * 0.20);
        // Confluence floor: never below 60 if 2+ sellers agree
        score = Math.max(60, score);
      } else {
        const sellerScore = Math.min(100, (sellerCount / 3) * 100);
        score = Math.round(volumeScore * 0.35 + priceScore * 0.30 + sellerScore * 0.15 + partNumberScore * 0.20);
      }

      gaps.push({
        title: group.title,
        normalizedTitle: key,
        sellers: Array.from(group.sellers),
        soldCount: group.count,
        totalRevenue: Math.round(group.totalRevenue),
        medianPrice: Math.round(median),
        avgPrice: Math.round(group.totalRevenue / group.count),
        minPrice: Math.round(Math.min(...group.prices)),
        maxPrice: Math.round(Math.max(...group.prices)),
        lastSold: group.lastSold,
        score,
        ebayItemId: group.ebayItemId,
        partNumber: partNumber,
        partType: group._partType || extractPartType(group.title),
        confluence: isConfluence,
        sellerCount: sellerCount,
        yardMatch: titleMatchesYard(group.title, yardMakes),
      });
    }

    // Sort by score descending
    gaps.sort((a, b) => b.score - a.score);

    // Filter hidden parts
    const hiddenSet = await loadHiddenSet();
    const visibleGaps = gaps.filter(g => !isHidden(hiddenSet, g.partNumber || g.partNumberBase, g.make, g.model));

    res.json({
      success: true,
      days,
      totalGaps: visibleGaps.length,
      gaps: visibleGaps.slice(0, limit),
    });
  } catch (err) {
    log.error({ err }, 'Gap intel error');
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /competitors/emerging
 * Detect NEW (first-ever appearance) and ACCELERATING parts from competitor data.
 * Query: days (default 90), limit (default 40)
 */
router.get('/emerging', async (req, res) => {
  const days = parseInt(req.query.days) || 90;
  const limit = parseInt(req.query.limit) || 40;
  const sellerFilter = req.query.seller || null;

  try {
    const now = new Date();
    const cutoff = new Date(now - days * 24 * 60 * 60 * 1000);
    const midpoint = new Date(now - (days / 2) * 24 * 60 * 60 * 1000);
    const recentWindow = new Date(now - 30 * 24 * 60 * 60 * 1000);

    // Exclude rebuild sellers — their data is reference intel, not competitive
    const rebuildSellers = await database('SoldItemSeller').where('type', 'rebuild').select('name');
    const rebuildNames = rebuildSellers.map(s => s.name);

    let emergingQuery = database('SoldItem')
      .where('soldDate', '>=', cutoff)
      .where('soldPrice', '>=', 100)
      .whereNot('seller', 'dynatrack')
      .whereNot('seller', 'dynatrackracing');

    if (rebuildNames.length > 0) {
      emergingQuery = emergingQuery.whereNotIn('seller', rebuildNames);
    }

    if (sellerFilter) {
      emergingQuery = emergingQuery.where('seller', sellerFilter);
    }

    const items = await emergingQuery
      .orderBy('soldDate', 'desc')
      .limit(5000)
      .select('title', 'soldPrice', 'soldDate', 'seller', 'ebayItemId', 'partNumberBase', 'partType');

    const groups = {};
    for (const item of items) {
      const key = item.partNumberBase || normalizeTitle(item.title);
      if (!key || key.length < 3) continue;
      if (!groups[key]) {
        groups[key] = { title: item.title, sellers: new Set(), firstSeen: new Date(item.soldDate), recentCount: 0, olderCount: 0, totalCount: 0, prices: [], ebayItemId: item.ebayItemId, _partNumberBase: item.partNumberBase || null, _partType: item.partType || null };
      }
      const g = groups[key];
      g.sellers.add(item.seller);
      g.totalCount++;
      g.prices.push(parseFloat(item.soldPrice) || 0);
      const soldDate = new Date(item.soldDate);
      if (soldDate < g.firstSeen) g.firstSeen = soldDate;
      if (soldDate >= midpoint) { g.recentCount++; } else { g.olderCount++; }
    }

    const olderItems = await database('SoldItem').where('soldDate', '<', cutoff).select('title').limit(10000);
    const previouslySeenTitles = new Set(olderItems.map(function(i) { return normalizeTitle(i.title); }).filter(Boolean));

    // Build match sets from our data
    const yourSales = await database('YourSale').select('title').limit(25000);
    const yourListings = await database('YourListing').where('listingStatus', 'Active').select('title').limit(10000);
    const allOurTitles = [...yourSales.map(s => s.title), ...yourListings.map(l => l.title)].filter(Boolean);
    const { pnSet: yourPNs, keySet: yourKeys } = buildMatchSets(allOurTitles);

    let dismissedTitles = new Set();
    try {
      const dismissed = await database('dismissed_intel').select('normalizedTitle');
      dismissedTitles = new Set(dismissed.map(function(d) { return d.normalizedTitle; }));
    } catch (e) { /* table may not exist yet */ }

    // Load marks + hidden for filtering
    let emMarkedTitles = new Set(), emMarkedPNs = new Set();
    try {
      const marks = await database('the_mark').where('active', true).select('normalizedTitle', 'partNumber');
      emMarkedTitles = new Set(marks.map(m => m.normalizedTitle));
      for (const m of marks) { if (m.partNumber) emMarkedPNs.add(m.partNumber.toUpperCase()); }
    } catch (e) {}

    const emerging = [];
    for (const [key, group] of Object.entries(groups)) {
      if (weAlreadySellThis(group.title, yourPNs, yourKeys)) continue;
      if (dismissedTitles.has(key)) continue;
      if (emMarkedTitles.has(key)) continue;
      if (group._partNumberBase && emMarkedPNs.has(group._partNumberBase.toUpperCase())) continue;

      const sorted = group.prices.sort(function(a, b) { return a - b; });
      const median = sorted.length % 2 === 0 ? (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2 : sorted[Math.floor(sorted.length / 2)];
      const partNumber = group._partNumberBase || extractPartNumber(group.title);

      let signal = null;
      let signalStrength = 0;

      if (group.firstSeen >= recentWindow && group.totalCount <= 5 && !previouslySeenTitles.has(key)) {
        signal = 'NEW';
        const rarityScore = Math.max(0, 100 - (group.totalCount - 1) * 20);
        const priceWeight = Math.min(100, (median / 400) * 100);
        const pnBonus = partNumber ? 20 : 0;
        signalStrength = Math.min(100, rarityScore * 0.45 + priceWeight * 0.35 + pnBonus);
      } else if (group.recentCount >= 4 && group.olderCount > 0 && group.recentCount >= group.olderCount * 3) {
        signal = 'ACCEL';
        const acceleration = group.recentCount / Math.max(1, group.olderCount);
        signalStrength = Math.min(100, (acceleration / 6) * 40 + (median / 400) * 30 + (group.recentCount / 20) * 20 + (partNumber ? 10 : 0));
      }

      if (!signal) continue;

      emerging.push({
        title: group.title, partNumber, partType: group._partType || extractPartType(group.title), signal, signalStrength: Math.round(signalStrength),
        sellers: Array.from(group.sellers), totalCount: group.totalCount, recentCount: group.recentCount,
        olderCount: group.olderCount, medianPrice: Math.round(median),
        totalRevenue: Math.round(group.prices.reduce(function(a, b) { return a + b; }, 0)),
        firstSeen: group.firstSeen.toISOString(), ebayItemId: group.ebayItemId,
      });
    }

    emerging.sort(function(a, b) {
      if (a.signal === 'NEW' && b.signal !== 'NEW') return -1;
      if (b.signal === 'NEW' && a.signal !== 'NEW') return 1;
      return b.signalStrength - a.signalStrength;
    });

    // Filter hidden parts
    const hiddenSet2 = await loadHiddenSet();
    const visibleEmerging = emerging.filter(e => !isHidden(hiddenSet2, e.partNumber || e.partNumberBase, e.make, e.model));
    res.json({ success: true, days, totalEmerging: visibleEmerging.length, newCount: visibleEmerging.filter(function(e) { return e.signal === 'NEW'; }).length, accelCount: visibleEmerging.filter(function(e) { return e.signal === 'ACCEL'; }).length, emerging: visibleEmerging.slice(0, limit) });
  } catch (err) {
    log.error({ err }, 'Emerging parts error');
    res.status(500).json({ success: false, error: err.message });
  }
});

// Helper: normalize a title for fuzzy matching
function normalizeTitle(title) {
  if (!title) return '';
  return title
    .toUpperCase()
    .replace(/[^A-Z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .substring(0, 65);
}

// Known automotive makes for title parsing
var KNOWN_MAKES_UPPER = ['FORD','CHEVROLET','CHEVY','DODGE','RAM','CHRYSLER','JEEP','TOYOTA','HONDA','NISSAN','HYUNDAI','KIA','SUBARU','MAZDA','MITSUBISHI','BMW','MERCEDES','AUDI','VOLKSWAGEN','VOLVO','MINI','PORSCHE','LEXUS','ACURA','INFINITI','GENESIS','CADILLAC','BUICK','GMC','LINCOLN','PONTIAC','SATURN','OLDSMOBILE','JAGUAR','LAND ROVER','FIAT','SCION','SUZUKI','SAAB'];

/**
 * Extract a structured key from a title: "PARTTYPE|MAKE|MODEL"
 * Used for two-tier gap-intel matching instead of fuzzy word overlap.
 */
function buildTitleKey(title) {
  if (!title) return null;
  var upper = title.toUpperCase();

  var partType = extractPartType(title) || null;
  if (!partType) return null;

  var make = null;
  for (var m of KNOWN_MAKES_UPPER) {
    if (upper.includes(m)) { make = m; break; }
  }
  if (!make) return null;

  // Extract model: first non-noise word(s) after make
  var makeIdx = upper.indexOf(make);
  var afterMake = upper.substring(makeIdx + make.length).trim();
  var modelWords = [];
  var stopWords = new Set(['OEM','GENUINE','PROGRAMMED','REBUILT','PLUG','PLAY','ASSEMBLY','MODULE','UNIT','REMAN','REMANUFACTURED','NEW','USED','TESTED','ENGINE','CONTROL','COMPUTER','ELECTRONIC','ANTI','LOCK','BRAKE','PUMP','FUSE','POWER','BOX','BODY','TRANSMISSION','ECU','ECM','PCM','BCM','TCM','ABS','TIPM','SRS','HVAC','INSTRUMENT','CLUSTER','SPEEDOMETER','RADIO','HEAD','STEREO','AMPLIFIER','THROTTLE','INTAKE','ALTERNATOR','STARTER','TURBO','CAMERA','SENSOR','WORKING','FAST','FREE','SHIPPING','SHIP']);
  for (var w of afterMake.replace(/[^A-Z0-9\s]/g, '').split(/\s+/)) {
    if (!w || w.length < 2) continue;
    if (/^\d{4}$/.test(w)) continue; // skip years
    if (stopWords.has(w)) continue;
    modelWords.push(w);
    if (modelWords.length >= 2) break;
  }
  var model = modelWords.join(' ') || null;
  if (!model) return null;

  return partType + '|' + make + '|' + model;
}

/**
 * Build PN and title-key sets from an array of title strings.
 * Returns { pnSet: Set<string>, keySet: Set<string> }
 */
function buildMatchSets(titles) {
  var pnSet = new Set();
  var keySet = new Set();
  for (var title of titles) {
    if (!title) continue;
    // Extract part number
    var pn = extractPartNumber(title);
    if (pn) {
      var pnBase = pn.replace(/[-\s]/g, '').replace(/[A-Z]{1,2}$/, '');
      if (pnBase.length >= 5) pnSet.add(pnBase);
      pnSet.add(pn.replace(/[-\s]/g, ''));
    }
    // Extract title key
    var key = buildTitleKey(title);
    if (key) keySet.add(key);
  }
  return { pnSet, keySet };
}

/**
 * Two-tier matching: do we already sell this part?
 * Tier 1: PN match (if extractable). Tier 2: strict partType|make|model key match.
 */
function weAlreadySellThis(competitorTitle, yourPNs, yourKeys) {
  // Tier 1: check by part number
  var pn = extractPartNumber(competitorTitle);
  if (pn) {
    var pnClean = pn.replace(/[-\s]/g, '');
    var pnBase = pnClean.replace(/[A-Z]{1,2}$/, '');
    if (yourPNs.has(pnClean) || (pnBase.length >= 5 && yourPNs.has(pnBase))) return true;
  }

  // Tier 2: strict partType|make|model key
  var key = buildTitleKey(competitorTitle);
  if (key && yourKeys.has(key)) return true;

  // No match — this is a gap
  return false;
}

// Extract OEM part number from title
// Matches patterns like: CT43-2C405-AB, 39132-26BL0, 8T0-035-223AN, 68059524AI, BBM466A20
function extractPartNumber(title) {
  if (!title) return null;

  // Common OEM part number patterns (alphanumeric with dashes/spaces, 6+ chars)
  const patterns = [
    /\b([A-Z]{1,4}\d{1,4}[-\s]?\d{2,5}[-\s]?[A-Z0-9]{1,5})\b/i,    // CT43-2C405-AB, 8T0 035 223AN
    /\b(\d{4,6}[-]?[A-Z0-9]{2,6}[-]?[A-Z0-9]{0,4})\b/i,             // 39132-26BL0, 68059524AI
    /\b([A-Z]{2,4}\d{3,6}[A-Z]?\d{0,2})\b/i,                         // BBM466A20, MR578042
    /\b(\d{2,3}[-]\d{4,5}[-]\d{3,5}[-]?[A-Z]{0,2})\b/,               // 84010-48180, 99211-F1000
  ];

  for (const pattern of patterns) {
    const match = title.match(pattern);
    if (match && match[1] && match[1].length >= 6) {
      // Filter out obvious non-part-numbers (years, mileage)
      const candidate = match[1].replace(/\s+/g, '-');
      if (/^(19|20)\d{2}$/.test(candidate)) continue; // skip years
      if (/^\d{1,3},?\d{3}$/.test(candidate)) continue; // skip mileage
      return candidate.toUpperCase();
    }
  }
  return null;
}

var PART_TYPES = [
  { keywords: ['ECU', 'ECM', 'PCM', 'ENGINE CONTROL', 'ENGINE COMPUTER'], type: 'ECM' },
  { keywords: ['BCM', 'BODY CONTROL'], type: 'BCM' },
  { keywords: ['TCM', 'TRANSMISSION CONTROL', 'TRANS CONTROL'], type: 'TCM' },
  { keywords: ['ABS', 'ANTI LOCK', 'ANTILOCK', 'BRAKE PUMP', 'BRAKE MODULE'], type: 'ABS' },
  { keywords: ['TIPM', 'TOTALLY INTEGRATED', 'POWER MODULE'], type: 'TIPM' },
  { keywords: ['FUSE BOX', 'FUSE RELAY', 'JUNCTION BOX', 'RELAY BOX'], type: 'FUSE BOX' },
  { keywords: ['AMPLIFIER', 'AMP ', 'AUDIO AMP', 'BOSE', 'BANG', 'HARMAN', 'JBL', 'ALPINE', 'INFINITY'], type: 'AMP' },
  { keywords: ['RADIO', 'STEREO', 'HEAD UNIT', 'INFOTAINMENT', 'NAVIGATION'], type: 'RADIO' },
  { keywords: ['CLUSTER', 'INSTRUMENT CLUSTER', 'SPEEDOMETER', 'GAUGE'], type: 'CLUSTER' },
  { keywords: ['THROTTLE BODY', 'THROTTLE ASSY'], type: 'THROTTLE' },
  { keywords: ['HVAC', 'CLIMATE CONTROL', 'A/C CONTROL', 'HEATER CONTROL'], type: 'HVAC' },
  { keywords: ['AIRBAG', 'AIR BAG', 'SRS', 'RESTRAINT'], type: 'AIRBAG' },
  { keywords: ['STEERING MODULE', 'STEERING CONTROL', 'EPS', 'POWER STEERING CONTROL'], type: 'STEERING' },
  { keywords: ['CAMERA', 'BACKUP CAM', 'REAR VIEW', 'SURROUND VIEW'], type: 'CAMERA' },
  { keywords: ['BLIND SPOT', 'LANE ASSIST', 'LANE DEPARTURE'], type: 'SENSOR' },
  { keywords: ['LIFTGATE', 'LIFT GATE', 'TAILGATE MODULE'], type: 'LIFTGATE' },
  { keywords: ['PARKING SENSOR', 'PARK ASSIST', 'PDC'], type: 'SENSOR' },
  { keywords: ['TRANSFER CASE MODULE', 'TRANSFER CASE CONTROL'], type: 'XFER' },
];

function extractPartType(title) {
  if (!title) return null;
  var upper = title.toUpperCase();
  for (var i = 0; i < PART_TYPES.length; i++) {
    for (var j = 0; j < PART_TYPES[i].keywords.length; j++) {
      if (upper.includes(PART_TYPES[i].keywords[j])) return PART_TYPES[i].type;
    }
  }
  return null;
}

/**
 * POST /competitors/cleanup
 * Purge sold data older than 90 days for all sellers EXCEPT importapart and pro-rebuild.
 * These two are permanent fixtures - their data is never purged.
 */
router.post('/cleanup', async (req, res) => {
  const protectedSellers = ['importapart', 'pro-rebuild'];
  const retentionDays = parseInt(req.query.days) || 90;

  try {
    const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);

    const result = await database('SoldItem')
      .where('soldDate', '<', cutoff)
      .whereNotIn('seller', protectedSellers)
      .del();

    res.json({
      success: true,
      purged: result,
      retentionDays,
      protectedSellers,
      cutoffDate: cutoff.toISOString(),
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /competitors/auto-scrape
 * Emergency override — scrapes ALL enabled sellers at once.
 * Prefer drip cron (CompetitorDripRunner, 4x daily) for normal operations.
 * Skips sellers scraped in the last 20 hours.
 */
router.post('/auto-scrape', async (req, res) => {
  log.warn('Manual auto-scrape triggered — prefer drip cron for rate limiting');
  try {
    const sellers = await database('SoldItemSeller').where('enabled', true);
    const results = [];
    const skipWindow = new Date(Date.now() - 20 * 60 * 60 * 1000);

    for (const seller of sellers) {
      if (seller.lastScrapedAt && new Date(seller.lastScrapedAt) > skipWindow) {
        results.push({ seller: seller.name, skipped: true, reason: 'scraped recently' });
        continue;
      }

      const manager = new SoldItemsManager();
      try {
        const result = await manager.scrapeCompetitor({
          seller: seller.name,
          categoryId: '6030',
          maxPages: 3,
        });

        await database('SoldItemSeller').where('name', seller.name).update({
          lastScrapedAt: new Date(),
          itemsScraped: (seller.itemsScraped || 0) + result.stored,
          updatedAt: new Date(),
        });

        results.push({ seller: seller.name, ...result });
      } catch (err) {
        log.error({ err: err.message, seller: seller.name }, 'Auto-scrape failed for seller');
        results.push({ seller: seller.name, error: err.message });
      } finally {
        try { await manager.scraper.closeBrowser(); } catch (e) {}
      }
    }

    res.json({ success: true, results });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/dismiss', async (req, res) => {
  const { title } = req.body;
  if (!title) return res.status(400).json({ success: false, error: 'title required' });
  try {
    const key = normalizeTitle(title);
    const exists = await database('dismissed_intel').where('normalizedTitle', key).first();
    if (!exists) {
      await database('dismissed_intel').insert({ normalizedTitle: key, originalTitle: title, dismissedAt: new Date() });
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/undismiss', async (req, res) => {
  const { title } = req.body;
  if (!title) return res.status(400).json({ success: false, error: 'title required' });
  try {
    const key = normalizeTitle(title);
    await database('dismissed_intel').where('normalizedTitle', key).del();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /competitors/mark
 * Add an item to The Mark (want list).
 * Body: { title, partNumber, partType, medianPrice, sourceSignal, sourceSellers, score }
 */
router.post('/mark', async (req, res) => {
  const { title, partNumber, partType, medianPrice, sourceSignal, sourceSellers, score } = req.body;
  if (!title) return res.status(400).json({ success: false, error: 'title required' });

  try {
    const key = normalizeTitle(title);
    const exists = await database('the_mark').where('normalizedTitle', key).first();
    if (exists) {
      // Reactivate if previously graduated
      if (!exists.active) {
        await database('the_mark').where('normalizedTitle', key).update({
          active: true,
          graduatedAt: null,
          graduatedReason: null,
          updatedAt: new Date(),
        });
      }
      return res.json({ success: true, exists: true, id: exists.id });
    }

    const inserted = await database('the_mark').insert({
      normalizedTitle: key,
      originalTitle: title,
      partNumber: partNumber || null,
      partType: partType || null,
      medianPrice: medianPrice || null,
      sourceSignal: sourceSignal || 'gap-intel',
      sourceSellers: sourceSellers || null,
      scoreAtMark: score || null,
      source: 'PERCH',
      active: true,
      markedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    }).returning('id');

    res.json({ success: true, id: inserted[0]?.id || inserted[0] });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /competitors/marks
 * Get all active marks. Query: all=true to include graduated.
 */
router.get('/marks', async (req, res) => {
  try {
    const showAll = req.query.all === 'true';
    let query = database('the_mark').orderBy('markedAt', 'desc');
    if (!showAll) {
      query = query.where('active', true);
    }
    const marks = await query.limit(200);

    // Check which marks have matching vehicles in yards right now
    let yardMakes = new Set();
    try {
      const yardVehicles = await database('yard_vehicle').select('make').limit(5000);
      for (const v of yardVehicles) {
        if (v.make) yardMakes.add(v.make.toUpperCase());
      }
    } catch (e) {}

    // Check which marks have been listed/sold (candidates for auto-graduation)
    const yourSales = await database('YourSale').select('title').limit(25000);
    const yourSoldTitles = new Set(yourSales.map(function(s) { return normalizeTitle(s.title); }).filter(Boolean));
    const yourListings = await database('YourListing').where('listingStatus', 'Active').select('title').limit(10000);
    const yourListingTitles = new Set(yourListings.map(function(l) { return normalizeTitle(l.title); }).filter(Boolean));

    const enriched = marks.map(function(m) {
      var yardMatch = titleMatchesYard(m.originalTitle, yardMakes);
      var inYourInventory = matchesAny(m.normalizedTitle, yourListingTitles);
      var youSoldIt = matchesAny(m.normalizedTitle, yourSoldTitles);

      return {
        ...m,
        yardMatch: yardMatch,
        inYourInventory: inYourInventory,
        youSoldIt: youSoldIt,
        status: !m.active ? 'graduated' : youSoldIt ? 'sold' : inYourInventory ? 'listed' : yardMatch ? 'in-yard' : 'hunting',
      };
    });

    res.json({ success: true, marks: enriched, total: enriched.length });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * DELETE /competitors/mark/:id
 * Remove an item from The Mark.
 */
router.delete('/mark/:id', async (req, res) => {
  try {
    await database('the_mark').where('id', req.params.id).del();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * PATCH /competitors/mark/:id
 * Update notes on a mark.
 */
router.patch('/mark/:id', async (req, res) => {
  try {
    const { notes } = req.body;
    await database('the_mark').where('id', req.params.id).update({ notes, updatedAt: new Date() });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /competitors/mark/graduate
 * Auto-graduate marks that you've now sold. Uses shared graduateMarks() function.
 */
router.post('/mark/graduate', async (req, res) => {
  try {
    const graduated = await graduateMarks();
    res.json({ success: true, graduated });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /competitors/mark/check-vehicle
 * Check if a make/model matches any active marks. Used by attack list.
 * Query: make, model, year (all optional)
 */
router.get('/mark/check-vehicle', async (req, res) => {
  const { make, model, year } = req.query;
  if (!make) return res.json({ success: true, matches: [] });

  try {
    const activeMarks = await database('the_mark').where('active', true);
    const makeUpper = make.toUpperCase();
    const modelUpper = model ? model.toUpperCase() : null;

    const matches = activeMarks.filter(function(m) {
      var title = m.originalTitle.toUpperCase();
      if (!title.includes(makeUpper)) return false;
      if (modelUpper && !title.includes(modelUpper)) return false;
      if (year && !title.includes(String(year))) return false;
      return true;
    }).map(function(m) {
      return {
        id: m.id,
        title: m.originalTitle,
        partType: m.partType,
        partNumber: m.partNumber,
        medianPrice: m.medianPrice,
        markedAt: m.markedAt,
      };
    });

    res.json({ success: true, matches });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /competitors/seed-defaults
 * Add default competitors if not already tracked.
 */
router.post('/seed-defaults', async (req, res) => {
  const defaults = ['importapart', 'pro-rebuild'];
  const added = [];
  for (const name of defaults) {
    try {
      const exists = await database('SoldItemSeller').where('name', name).first();
      if (!exists) {
        await database('SoldItemSeller').insert({
          name,
          enabled: true,
          itemsScraped: 0,
          createdAt: new Date(),
          updatedAt: new Date(),
        });
        added.push(name);
      }
    } catch (e) { /* ignore duplicate */ }
  }
  res.json({ success: true, added });
});

/**
 * DELETE /competitors/:sellerId
 * Remove a seller from tracking. Optionally delete their sold data.
 * Query: deleteData=true to also remove their SoldItem records
 */
router.delete('/:sellerId', async (req, res) => {
  const sellerName = req.params.sellerId.toLowerCase().trim();
  const deleteData = req.query.deleteData === 'true';

  try {
    // Remove from SoldItemSeller
    const deleted = await database('SoldItemSeller').where('name', sellerName).del();

    let itemsDeleted = 0;
    if (deleteData) {
      const result = await database('SoldItem').where('seller', sellerName).del();
      itemsDeleted = result;
    }

    res.json({
      success: true,
      seller: sellerName,
      removed: deleted > 0,
      itemsDeleted,
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /competitors/:sellerId/scrape
 * Trigger scrape for a specific competitor seller. Runs in background.
 */
router.post('/:sellerId/scrape', async (req, res) => {
  const sellerName = req.params.sellerId.toLowerCase().trim();
  const { pages = 3 } = req.query;

  // Auto-add seller to SoldItemSeller if not exists
  try {
    const exists = await database('SoldItemSeller').where('name', sellerName).first();
    if (!exists) {
      await database('SoldItemSeller').insert({ name: sellerName, enabled: true, itemsScraped: 0, createdAt: new Date(), updatedAt: new Date() });
    }
  } catch (e) { /* ignore duplicate */ }

  res.json({ started: true, seller: sellerName, maxPages: parseInt(pages) });

  // Run in background
  const manager = new SoldItemsManager();
  try {
    const result = await manager.scrapeCompetitor({
      seller: sellerName,
      categoryId: '6030',
      maxPages: parseInt(pages),
    });
    log.info({ seller: sellerName, result }, 'Manual competitor scrape complete');

    // Update seller stats (was missing — #7)
    try {
      await database('SoldItemSeller').where('name', sellerName).update({
        lastScrapedAt: new Date(),
        itemsScraped: database.raw('"itemsScraped" + ?', [result.stored]),
        updatedAt: new Date(),
      });
    } catch (e) { log.warn({ err: e.message, seller: sellerName }, 'Could not update seller stats'); }
  } catch (err) {
    log.error({ err: err.message, seller: sellerName }, 'Manual competitor scrape failed');
  } finally {
    try { await manager.scraper.closeBrowser(); } catch (e) {}
  }
});

/**
 * GET /competitors/:sellerId/best-sellers
 * Best sellers report from scraped sold items.
 */
router.get('/:sellerId/best-sellers', async (req, res) => {
  const sellerId = req.params.sellerId.toLowerCase().trim();
  const days = parseInt(req.query.days) || 90;

  try {
    // Get all sold items for this seller
    const items = await database('SoldItem')
      .where('seller', sellerId)
      .where('soldDate', '>=', database.raw(`NOW() - INTERVAL '${days} days'`))
      .orderBy('soldPrice', 'desc')
      .select('title', 'soldPrice', 'soldDate', 'ebayItemId', 'condition', 'manufacturerPartNumber', 'partNumberBase');

    // Group by partNumberBase (exact) or normalizeTitle (fallback)
    const groups = {};
    for (const item of items) {
      const key = item.partNumberBase || normalizeTitle(item.title);
      if (!key || key.length < 3) continue;
      if (!groups[key]) {
        groups[key] = { title: item.title, count: 0, totalRevenue: 0, prices: [], lastSold: null, pn: item.partNumberBase || item.manufacturerPartNumber, ebayItemId: item.ebayItemId };
      }
      const g = groups[key];
      g.count++;
      g.totalRevenue += parseFloat(item.soldPrice) || 0;
      g.prices.push(parseFloat(item.soldPrice) || 0);
      if (!g.lastSold || new Date(item.soldDate) > new Date(g.lastSold)) g.lastSold = item.soldDate;
    }

    // Build sorted list by revenue
    const bestSellers = Object.values(groups)
      .map(g => ({
        title: g.title,
        partNumber: g.pn || null,
        soldCount: g.count,
        totalRevenue: Math.round(g.totalRevenue),
        avgPrice: Math.round(g.totalRevenue / g.count),
        minPrice: Math.round(Math.min(...g.prices)),
        maxPrice: Math.round(Math.max(...g.prices)),
        lastSold: g.lastSold,
        velocity: Math.round(g.count / (days / 7) * 10) / 10, // per week
        ebayItemId: g.ebayItemId || null,
      }))
      .sort((a, b) => b.totalRevenue - a.totalRevenue);

    res.json({
      success: true,
      seller: sellerId,
      days,
      totalSold: items.length,
      totalRevenue: Math.round(items.reduce((s, i) => s + (parseFloat(i.soldPrice) || 0), 0)),
      uniqueProducts: bestSellers.length,
      bestSellers: bestSellers.slice(0, 100),
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /competitors/sellers
 * List all tracked competitor sellers with stats.
 */
router.get('/sellers', async (req, res) => {
  try {
    const sellers = await database('SoldItemSeller').orderBy('name');

    // Single grouped query instead of N+1
    const counts = await database('SoldItem')
      .select('seller')
      .count('* as count')
      .groupBy('seller');
    const countMap = {};
    for (const c of counts) {
      countMap[c.seller] = parseInt(c.count || 0);
    }

    var withCounts = sellers.map(function(s) {
      var hoursAgo = s.lastScrapedAt ? Math.floor((Date.now() - new Date(s.lastScrapedAt).getTime()) / 3600000) : null;
      var scrapeAlert = null;
      if (s.enabled && (!s.lastScrapedAt || hoursAgo > 48)) {
        scrapeAlert = !s.lastScrapedAt ? 'Never scraped' : 'Last scrape ' + Math.floor(hoursAgo / 24) + 'd ago - may be failing';
      }
      return { ...s, soldItemCount: countMap[s.name] || 0, scrapeAlert: scrapeAlert };
    });

    var alerts = withCounts.filter(function(s) { return s.scrapeAlert; }).map(function(s) { return { seller: s.name, message: s.scrapeAlert }; });

    res.json({ success: true, sellers: withCounts, scrapeAlerts: alerts });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Check if a normalized title matches any title in a Set (word overlap >= 80%)
function matchesAny(normalizedTitle, titleSet) {
  if (!normalizedTitle || titleSet.size === 0) return false;
  const words = normalizedTitle.split(/\s+/).filter(w => w.length > 2);
  if (words.length === 0) return false;
  for (const candidate of titleSet) {
    const cWords = candidate.split(/\s+/).filter(w => w.length > 2);
    if (cWords.length === 0) continue;
    let matches = 0;
    for (const w of words) {
      if (cWords.includes(w)) matches++;
    }
    const overlap = matches / Math.max(words.length, 1);
    if (overlap >= 0.8) return true;
  }
  return false;
}

function titleMatchesYard(title, yardMakes) {
  if (!title || yardMakes.size === 0) return false;
  var upper = title.toUpperCase();
  for (var make of yardMakes) {
    if (make.length >= 3 && upper.includes(make)) return true;
  }
  return false;
}

// Weekly competitor scrape — Sunday 8pm UTC
// Rewired from dead FindingsAPI to SoldItemsScraper (Playwright) in Phase 2.5
// Also runs mark graduation after fresh data arrives
async function graduateMarks() {
  try {
    const activeMarks = await database('the_mark').where('active', true);
    const yListings = await database('YourListing').where('listingStatus', 'Active').select('title').limit(25000);
    const yListingTitles = new Set(yListings.map(function(l) { return normalizeTitle(l.title); }).filter(Boolean));

    let graduated = 0;
    for (const mark of activeMarks) {
      if (matchesAny(mark.normalizedTitle, yListingTitles)) {
        await database('the_mark').where('id', mark.id).update({
          active: false,
          graduatedAt: new Date(),
          graduatedReason: 'Listed - part sourced and in inventory',
          updatedAt: new Date(),
        });
        log.info({ mark: mark.originalTitle }, 'Auto-graduated mark - listed');
        graduated++;
      }
    }
    return graduated;
  } catch (gradErr) {
    log.error({ err: gradErr.message }, 'Auto-graduation check failed');
    return 0;
  }
}

// REMOVED: Sunday 8pm blast-all-sellers cron.
// Replaced by CompetitorDripRunner (4x daily, 1 seller per run, registered in index.js).
// graduateMarks() runs daily at midnight via index.js drip cron.

module.exports = router;
