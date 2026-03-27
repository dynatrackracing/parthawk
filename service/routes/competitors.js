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

      // Score: weighted by volume (40%), median price (35%), seller count (25%)
      const volumeScore = Math.min(100, (group.count / 5) * 100);
      const priceScore = Math.min(100, (median / 300) * 100);
      const sellerScore = Math.min(100, (group.sellers.size / 3) * 100);
      const score = Math.round(volumeScore * 0.4 + priceScore * 0.35 + sellerScore * 0.25);

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

// Helper: normalize a title for fuzzy matching
function normalizeTitle(title) {
  if (!title) return '';
  return title
    .toUpperCase()
    .replace(/[^A-Z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .substring(0, 50);
}

// Helper: check if a normalized key matches any title in a set (fuzzy - 70% word overlap)
function matchesAny(key, titleSet) {
  if (titleSet.has(key)) return true;
  const words = key.split(' ').filter(w => w.length > 3);
  if (words.length === 0) return false;
  for (const t of titleSet) {
    let matches = 0;
    for (const w of words) {
      if (t.includes(w)) matches++;
    }
    if (matches / words.length >= 0.7) return true;
  }
  return false;
}

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
  const { sellerId } = req.params;
  const deleteData = req.query.deleteData === 'true';

  try {
    // Remove from SoldItemSeller
    const deleted = await database('SoldItemSeller').where('name', sellerId).del();

    let itemsDeleted = 0;
    if (deleteData) {
      const result = await database('SoldItem').where('seller', sellerId).del();
      itemsDeleted = result;
    }

    res.json({
      success: true,
      seller: sellerId,
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
  const { sellerId } = req.params;
  const { pages = 5 } = req.query;

  // Auto-add seller to SoldItemSeller if not exists
  try {
    const exists = await database('SoldItemSeller').where('name', sellerId).first();
    if (!exists) {
      await database('SoldItemSeller').insert({ name: sellerId, enabled: true, itemsScraped: 0, createdAt: new Date(), updatedAt: new Date() });
    }
  } catch (e) { /* ignore duplicate */ }

  res.json({ started: true, seller: sellerId, maxPages: parseInt(pages) });

  // Run in background
  try {
    const manager = new SoldItemsManager();
    const result = await manager.scrapeCompetitor({
      seller: sellerId,
      categoryId: '6030',
      maxPages: parseInt(pages),
      useScraper: false,
    });
    log.info({ seller: sellerId, result }, 'Manual competitor scrape complete');
  } catch (err) {
    log.error({ err: err.message, seller: sellerId }, 'Manual competitor scrape failed');
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
      const key = (item.title || '').substring(0, 40).toUpperCase().trim();
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
