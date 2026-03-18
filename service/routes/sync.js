'use strict';

const { log } = require('../lib/logger');
const router = require('express-promise-router')();
const { isAdmin, authMiddleware } = require('../middleware/Middleware');
const YourDataManager = require('../managers/YourDataManager');
const SoldItemsManager = require('../managers/SoldItemsManager');
const SellerAPI = require('../ebay/SellerAPI');

// In-memory sync status (survives across requests, resets on dyno restart)
let syncStatus = {
  syncing: false,
  lastResult: null,
  lastSyncedAt: null,
  error: null,
};

/**
 * GET /sync/status
 * Get the current sync status
 */
router.get('/status', authMiddleware, async (req, res) => {
  res.json({ success: true, ...syncStatus });
});

/**
 * POST /sync/your-data
 * Sync your eBay orders and listings (runs in background, returns 202 immediately)
 * Body: { daysBack: number } (optional, default: 365)
 */
router.post('/your-data', authMiddleware, isAdmin, async (req, res, next) => {
  if (syncStatus.syncing) {
    return res.status(409).json({
      success: false,
      message: 'Sync already in progress',
    });
  }

  log.info('Starting sync of your eBay data');
  const { daysBack = 365 } = req.body || {};

  syncStatus.syncing = true;
  syncStatus.error = null;

  // Return immediately — sync runs in background
  res.status(202).json({
    success: true,
    message: 'Sync started',
  });

  // Run sync in background
  try {
    const manager = new YourDataManager();
    const results = await manager.syncAll({ daysBack });

    log.info({ results }, 'Completed sync of your eBay data');
    syncStatus.lastResult = results;
    syncStatus.lastSyncedAt = new Date().toISOString();
    syncStatus.error = null;
  } catch (err) {
    log.error({ err }, 'Error syncing your eBay data');
    syncStatus.error = err.message;
  } finally {
    syncStatus.syncing = false;
  }
});

/**
 * POST /sync/your-orders
 * Sync only your eBay orders
 * Body: { daysBack: number } (optional, default: 365)
 */
router.post('/your-orders', authMiddleware, isAdmin, async (req, res, next) => {
  log.info('Starting sync of your eBay orders');

  const { daysBack = 365 } = req.body || {};

  try {
    const manager = new YourDataManager();
    const results = await manager.syncOrders({ daysBack });

    log.info({ results }, 'Completed sync of your eBay orders');
    res.json({
      success: true,
      message: 'Order sync completed',
      results,
    });
  } catch (err) {
    log.error({ err }, 'Error syncing your eBay orders');
    res.status(500).json({
      success: false,
      message: 'Order sync failed',
      error: err.message,
    });
  }
});

/**
 * POST /sync/your-listings
 * Sync only your eBay listings
 */
router.post('/your-listings', authMiddleware, isAdmin, async (req, res, next) => {
  log.info('Starting sync of your eBay listings');

  try {
    const manager = new YourDataManager();
    const results = await manager.syncListings();

    log.info({ results }, 'Completed sync of your eBay listings');
    res.json({
      success: true,
      message: 'Listings sync completed',
      results,
    });
  } catch (err) {
    log.error({ err }, 'Error syncing your eBay listings');
    res.status(500).json({
      success: false,
      message: 'Listings sync failed',
      error: err.message,
    });
  }
});

/**
 * POST /sync/sold-items
 * Scrape sold items from all enabled competitors
 * Body: { categoryId: string, maxPagesPerSeller: number, enrichCompatibility: boolean }
 */
router.post('/sold-items', authMiddleware, isAdmin, async (req, res, next) => {
  log.info('Starting scrape of sold items from competitors');

  const {
    categoryId = '35596',
    maxPagesPerSeller = 5,
    enrichCompatibility = false,
  } = req.body || {};

  try {
    const manager = new SoldItemsManager();
    const results = await manager.scrapeAllCompetitors({
      categoryId,
      maxPagesPerSeller,
      enrichCompatibility,
    });

    log.info({ results }, 'Completed scraping sold items');
    res.json({
      success: true,
      message: 'Scrape completed',
      results,
    });
  } catch (err) {
    log.error({ err }, 'Error scraping sold items');
    res.status(500).json({
      success: false,
      message: 'Scrape failed',
      error: err.message,
    });
  }
});

/**
 * POST /sync/sold-items/:seller
 * Scrape sold items from a specific seller
 * Params: seller - seller username
 * Body: { categoryId: string, maxPages: number, enrichCompatibility: boolean }
 */
router.post('/sold-items/:seller', authMiddleware, isAdmin, async (req, res, next) => {
  const { seller } = req.params;
  log.info({ seller }, 'Starting scrape of sold items from specific seller');

  const {
    categoryId = '35596',
    maxPages = 5,
    enrichCompatibility = false,
  } = req.body || {};

  try {
    const manager = new SoldItemsManager();
    const results = await manager.scrapeCompetitor({
      seller,
      categoryId,
      maxPages,
      enrichCompatibility,
    });

    log.info({ seller, results }, 'Completed scraping sold items from seller');
    res.json({
      success: true,
      message: 'Scrape completed',
      seller,
      results,
    });
  } catch (err) {
    log.error({ err, seller }, 'Error scraping sold items from seller');
    res.status(500).json({
      success: false,
      message: 'Scrape failed',
      error: err.message,
    });
  }
});

/**
 * POST /sync/sold-items-by-keywords
 * Scrape sold items by keyword search (market research)
 * Body: { keywords: string, categoryId: string, maxPages: number }
 */
router.post('/sold-items-by-keywords', authMiddleware, isAdmin, async (req, res, next) => {
  const { keywords, categoryId = '35596', maxPages = 5 } = req.body || {};

  if (!keywords) {
    return res.status(400).json({
      success: false,
      message: 'Keywords are required',
    });
  }

  log.info({ keywords, categoryId, maxPages }, 'Starting keyword-based sold items scrape');

  try {
    const manager = new SoldItemsManager();
    const results = await manager.scrapeByKeywords({
      keywords,
      categoryId,
      maxPages,
    });

    log.info({ keywords, results }, 'Completed keyword-based scraping');
    res.json({
      success: true,
      message: 'Keyword scrape completed',
      keywords,
      results,
    });
  } catch (err) {
    log.error({ err, keywords }, 'Error scraping by keywords');
    res.status(500).json({
      success: false,
      message: 'Keyword scrape failed',
      error: err.message,
    });
  }
});

/**
 * GET /sync/your-listings
 * Get your synced listings with pagination
 * Query params: page (default: 1), limit (default: 50), status (optional filter)
 */
router.get('/your-listings', authMiddleware, async (req, res, next) => {
  try {
    const YourListing = require('../models/YourListing');
    const { page = 1, limit = 50, status } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    let query = YourListing.query();

    if (status) {
      query = query.where('listingStatus', status);
    }

    const [listings, countResult] = await Promise.all([
      query.clone().orderBy('createdAt', 'desc').limit(parseInt(limit)).offset(offset),
      query.clone().count('* as total').first(),
    ]);

    const total = parseInt(countResult?.total || 0);
    const totalPages = Math.ceil(total / parseInt(limit));

    // Calculate daysListed for each listing
    const now = new Date();
    const listingsWithDays = listings.map(listing => {
      const startTime = listing.startTime ? new Date(listing.startTime) : now;
      const daysListed = Math.floor((now - startTime) / (1000 * 60 * 60 * 24));
      return {
        ...listing,
        daysListed: Math.max(0, daysListed),
      };
    });

    res.json({
      success: true,
      count: listingsWithDays.length,
      total,
      page: parseInt(page),
      totalPages,
      listings: listingsWithDays,
    });
  } catch (err) {
    log.error({ err }, 'Error fetching your listings');
    res.status(500).json({
      success: false,
      error: err.message,
    });
  }
});

/**
 * GET /sync/your-sales/trends
 * Get sales trends aggregated by day/week
 * Query params: period (daily/weekly), daysBack (default: 90)
 * NOTE: This route MUST come before /your-sales to avoid route conflicts
 */
router.get('/your-sales/trends', authMiddleware, async (req, res, next) => {
  try {
    const { period = 'daily', daysBack = 90 } = req.query;
    const YourSale = require('../models/YourSale');
    const { raw } = require('objection');

    const cutoff = new Date(Date.now() - parseInt(daysBack) * 24 * 60 * 60 * 1000);

    let groupBy, dateFormat;
    if (period === 'weekly') {
      // Group by week (ISO week)
      groupBy = raw("DATE_TRUNC('week', \"soldDate\")");
      dateFormat = "DATE_TRUNC('week', \"soldDate\")";
    } else {
      // Group by day
      groupBy = raw("DATE_TRUNC('day', \"soldDate\")");
      dateFormat = "DATE_TRUNC('day', \"soldDate\")";
    }

    const trends = await YourSale.query()
      .select(
        raw(`${dateFormat} as "date"`),
        raw('COUNT(*) as "count"'),
        raw('SUM("salePrice") as "revenue"'),
        raw('AVG("salePrice") as "avgPrice"')
      )
      .where('soldDate', '>=', cutoff)
      .groupByRaw(dateFormat)
      .orderBy('date', 'asc');

    // Calculate totals
    const totalRevenue = trends.reduce((sum, t) => sum + parseFloat(t.revenue || 0), 0);
    const totalCount = trends.reduce((sum, t) => sum + parseInt(t.count || 0), 0);

    res.json({
      success: true,
      period,
      daysBack: parseInt(daysBack),
      trends: trends.map(t => ({
        date: t.date,
        count: parseInt(t.count),
        revenue: parseFloat(t.revenue).toFixed(2),
        avgPrice: parseFloat(t.avgPrice).toFixed(2),
      })),
      totals: {
        count: totalCount,
        revenue: totalRevenue.toFixed(2),
        avgPrice: totalCount > 0 ? (totalRevenue / totalCount).toFixed(2) : '0.00',
      },
    });
  } catch (err) {
    log.error({ err }, 'Error fetching sales trends');
    res.status(500).json({
      success: false,
      error: err.message,
    });
  }
});

/**
 * GET /sync/your-sales
 * Get your synced sales with pagination
 * Query params: page (default: 1), limit (default: 50), daysBack (optional filter)
 */
router.get('/your-sales', authMiddleware, async (req, res, next) => {
  try {
    const YourSale = require('../models/YourSale');
    const { page = 1, limit = 50, daysBack } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    let query = YourSale.query();

    if (daysBack) {
      const cutoff = new Date(Date.now() - parseInt(daysBack) * 24 * 60 * 60 * 1000);
      query = query.where('soldDate', '>=', cutoff);
    }

    const [sales, countResult] = await Promise.all([
      query.clone().orderBy('soldDate', 'desc').limit(parseInt(limit)).offset(offset),
      query.clone().count('* as total').first(),
    ]);

    const total = parseInt(countResult?.total || 0);
    const totalPages = Math.ceil(total / parseInt(limit));

    res.json({
      success: true,
      count: sales.length,
      total,
      page: parseInt(page),
      totalPages,
      sales,
    });
  } catch (err) {
    log.error({ err }, 'Error fetching your sales');
    res.status(500).json({
      success: false,
      error: err.message,
    });
  }
});

/**
 * GET /sync/health
 * Test eBay API connectivity
 */
router.get('/health', authMiddleware, async (req, res, next) => {
  try {
    const api = new SellerAPI();
    const result = await api.healthCheck();

    if (result.success) {
      res.json({
        success: true,
        message: 'eBay API is connected',
        sellerId: result.sellerId,
      });
    } else {
      res.status(500).json({
        success: false,
        message: 'eBay API check failed',
        error: result.error,
      });
    }
  } catch (err) {
    log.error({ err }, 'Error checking eBay API health');
    res.status(500).json({
      success: false,
      message: 'Health check failed',
      error: err.message,
    });
  }
});

/**
 * GET /sync/stats
 * Get sync statistics
 */
router.get('/stats', authMiddleware, async (req, res, next) => {
  try {
    const yourDataManager = new YourDataManager();
    const soldItemsManager = new SoldItemsManager();

    const [yourStats, soldStats] = await Promise.all([
      yourDataManager.getStats(),
      soldItemsManager.getStats(),
    ]);

    res.json({
      success: true,
      yourData: yourStats,
      soldItems: soldStats,
    });
  } catch (err) {
    log.error({ err }, 'Error getting sync stats');
    res.status(500).json({
      success: false,
      error: err.message,
    });
  }
});

module.exports = router;
