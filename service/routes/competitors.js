'use strict';

const router = require('express-promise-router')();
const { log } = require('../lib/logger');
const { database } = require('../database/database');
const CompetitorMonitorService = require('../services/CompetitorMonitorService');
const SoldItemsManager = require('../managers/SoldItemsManager');

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

  try {
    // Get all competitor sold items grouped by normalized title (first 50 chars uppercase)
    const competitorItems = await database('SoldItem')
      .where('soldDate', '>=', database.raw(`NOW() - INTERVAL '${days} days'`))
      .whereNot('seller', 'dynatrack')
      .whereNot('seller', 'dynatrackracing')
      .select('title', 'soldPrice', 'soldDate', 'seller', 'ebayItemId', 'condition');

    // Group competitor items by normalized title
    const compGroups = {};
    for (const item of competitorItems) {
      const key = normalizeTitle(item.title);
      if (!key || key.length < 10) continue;
      if (!compGroups[key]) {
        compGroups[key] = {
          title: item.title,
          sellers: new Set(),
          count: 0,
          totalRevenue: 0,
          prices: [],
          lastSold: null,
          ebayItemId: item.ebayItemId,
        };
      }
      const g = compGroups[key];
      g.sellers.add(item.seller);
      g.count++;
      g.totalRevenue += parseFloat(item.soldPrice) || 0;
      g.prices.push(parseFloat(item.soldPrice) || 0);
      if (!g.lastSold || new Date(item.soldDate) > new Date(g.lastSold)) g.lastSold = item.soldDate;
    }

    // Get all YOUR sold titles (from YourSale) - normalized
    const yourSales = await database('YourSale')
      .select('title');
    const yourSoldTitles = new Set(yourSales.map(s => normalizeTitle(s.title)).filter(Boolean));

    // Get all YOUR active listing titles (from YourListing) - normalized
    const yourListings = await database('YourListing')
      .where('listingStatus', 'Active')
      .select('title');
    const yourListingTitles = new Set(yourListings.map(l => normalizeTitle(l.title)).filter(Boolean));

    // Get all Item table titles for your seller - normalized
    const yourItems = await database('Item')
      .whereRaw("LOWER(seller) LIKE '%dynatrack%'")
      .select('title');
    const yourItemTitles = new Set(yourItems.map(i => normalizeTitle(i.title)).filter(Boolean));

    // Find gaps: competitor parts that we have never sold, listed, or stocked
    const gaps = [];
    for (const [key, group] of Object.entries(compGroups)) {
      // Check if we have ever dealt with this part
      const inYourSales = matchesAny(key, yourSoldTitles);
      const inYourListings = matchesAny(key, yourListingTitles);
      const inYourItems = matchesAny(key, yourItemTitles);

      if (inYourSales || inYourListings || inYourItems) continue;

      // Calculate median price
      const sorted = group.prices.sort((a, b) => a - b);
      const median = sorted.length % 2 === 0
        ? (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
        : sorted[Math.floor(sorted.length / 2)];

      // Extract part number from title - common OEM patterns
      const partNumber = extractPartNumber(group.title);

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
        partType: extractPartType(group.title),
        confluence: isConfluence,
        sellerCount: sellerCount,
      });
    }

    // Sort by score descending
    gaps.sort((a, b) => b.score - a.score);

    res.json({
      success: true,
      days,
      totalGaps: gaps.length,
      gaps: gaps.slice(0, limit),
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

  try {
    const now = new Date();
    const cutoff = new Date(now - days * 24 * 60 * 60 * 1000);
    const midpoint = new Date(now - (days / 2) * 24 * 60 * 60 * 1000);
    const recentWindow = new Date(now - 30 * 24 * 60 * 60 * 1000);

    const items = await database('SoldItem')
      .where('soldDate', '>=', cutoff)
      .where('soldPrice', '>=', 100)
      .whereNot('seller', 'dynatrack')
      .whereNot('seller', 'dynatrackracing')
      .select('title', 'soldPrice', 'soldDate', 'seller', 'ebayItemId');

    const groups = {};
    for (const item of items) {
      const key = normalizeTitle(item.title);
      if (!key || key.length < 10) continue;
      if (!groups[key]) {
        groups[key] = { title: item.title, sellers: new Set(), firstSeen: new Date(item.soldDate), recentCount: 0, olderCount: 0, totalCount: 0, prices: [], ebayItemId: item.ebayItemId };
      }
      const g = groups[key];
      g.sellers.add(item.seller);
      g.totalCount++;
      g.prices.push(parseFloat(item.soldPrice) || 0);
      const soldDate = new Date(item.soldDate);
      if (soldDate < g.firstSeen) g.firstSeen = soldDate;
      if (soldDate >= midpoint) { g.recentCount++; } else { g.olderCount++; }
    }

    const olderItems = await database('SoldItem').where('soldDate', '<', cutoff).select('title');
    const previouslySeenTitles = new Set(olderItems.map(function(i) { return normalizeTitle(i.title); }).filter(Boolean));

    const yourSales = await database('YourSale').select('title');
    const yourSoldTitles = new Set(yourSales.map(function(s) { return normalizeTitle(s.title); }).filter(Boolean));
    const yourListings = await database('YourListing').where('listingStatus', 'Active').select('title');
    const yourListingTitles = new Set(yourListings.map(function(l) { return normalizeTitle(l.title); }).filter(Boolean));

    const emerging = [];
    for (const [key, group] of Object.entries(groups)) {
      if (matchesAny(key, yourSoldTitles) || matchesAny(key, yourListingTitles)) continue;

      const sorted = group.prices.sort(function(a, b) { return a - b; });
      const median = sorted.length % 2 === 0 ? (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2 : sorted[Math.floor(sorted.length / 2)];
      const partNumber = extractPartNumber(group.title);

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
        title: group.title, partNumber, partType: extractPartType(group.title), signal, signalStrength: Math.round(signalStrength),
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

    res.json({ success: true, days, totalEmerging: emerging.length, newCount: emerging.filter(function(e) { return e.signal === 'NEW'; }).length, accelCount: emerging.filter(function(e) { return e.signal === 'ACCEL'; }).length, emerging: emerging.slice(0, limit) });
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

// Critical auto parts keywords that must never be filtered out
var KEEP_WORDS = new Set(['ECU','ECM','BCM','TCM','ABS','AMP','PCM','SRS','MAF','EPS','OEM','TIPM','HVAC','BCM','LED','A/C','AC']);

// Helper: check if a normalized key matches any title in a set (fuzzy - 70% word overlap)
function matchesAny(key, titleSet) {
  if (titleSet.has(key)) return true;
  var words = key.split(' ').filter(function(w) {
    return w.length > 3 || KEEP_WORDS.has(w);
  });
  if (words.length === 0) return false;
  for (var t of titleSet) {
    var matches = 0;
    for (var w of words) {
      if (t.includes(w)) matches++;
    }
    if (matches / words.length >= 0.7) return true;
  }
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
  try {
    const manager = new SoldItemsManager();
    const result = await manager.scrapeCompetitor({
      seller: sellerName,
      categoryId: '6030',
      maxPages: parseInt(pages),
      useScraper: false,
    });
    log.info({ seller: sellerName, result }, 'Manual competitor scrape complete');
  } catch (err) {
    log.error({ err: err.message, seller: sellerName }, 'Manual competitor scrape failed');
  }
});

/**
 * GET /competitors/:sellerId/best-sellers
 * Best sellers report from scraped sold items.
 */
router.get('/:sellerId/best-sellers', async (req, res) => {
  const { sellerId } = req.params;
  const days = parseInt(req.query.days) || 90;

  try {
    // Get all sold items for this seller
    const items = await database('SoldItem')
      .where('seller', sellerId)
      .where('soldDate', '>=', database.raw(`NOW() - INTERVAL '${days} days'`))
      .orderBy('soldPrice', 'desc')
      .select('title', 'soldPrice', 'soldDate', 'ebayItemId', 'condition', 'manufacturerPartNumber');

    // Group by approximate title (first 40 chars) to find repeated sellers
    const groups = {};
    for (const item of items) {
      const key = normalizeTitle(item.title);
      if (!groups[key]) {
        groups[key] = { title: item.title, count: 0, totalRevenue: 0, prices: [], lastSold: null, pn: item.manufacturerPartNumber, ebayItemId: item.ebayItemId };
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
    const withCounts = [];
    for (const s of sellers) {
      const countResult = await database('SoldItem').where('seller', s.name).count('* as count').first();
      withCounts.push({ ...s, soldItemCount: parseInt(countResult?.count || 0) });
    }
    res.json({ success: true, sellers: withCounts });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
