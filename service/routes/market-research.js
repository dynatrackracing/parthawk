'use strict';

const { log } = require('../lib/logger');
const router = require('express-promise-router')();
const { isAdmin, authMiddleware } = require('../middleware/Middleware');
const MarketResearchManager = require('../managers/MarketResearchManager');

/**
 * POST /market-research/inventory
 * Run market research for inventory items
 * Body: { limit, maxActivePages, maxSoldPages, categoryId }
 */
router.post('/inventory', authMiddleware, isAdmin, async (req, res) => {
  log.info('Starting market research for inventory');

  const {
    limit = 10,
    maxActivePages = 2,
    maxSoldPages = 3,
    categoryId = '35596',
  } = req.body || {};

  try {
    const manager = new MarketResearchManager();
    const results = await manager.researchAllInventory({
      limit,
      maxActivePages,
      maxSoldPages,
      categoryId,
    });

    log.info({ results }, 'Completed market research for inventory');
    res.json({
      success: true,
      message: 'Market research completed',
      results,
    });
  } catch (err) {
    log.error({ err }, 'Error running market research');
    res.status(500).json({
      success: false,
      message: 'Market research failed',
      error: err.message,
    });
  }
});

/**
 * POST /market-research/keywords
 * Run market research by custom keywords
 * Body: { keywords, categoryId, maxActivePages, maxSoldPages }
 */
router.post('/keywords', authMiddleware, isAdmin, async (req, res) => {
  const { keywords, categoryId = '35596', maxActivePages = 2, maxSoldPages = 3 } = req.body || {};

  if (!keywords) {
    return res.status(400).json({
      success: false,
      message: 'Keywords are required',
    });
  }

  log.info({ keywords, categoryId }, 'Starting market research by keywords');

  try {
    const manager = new MarketResearchManager();
    const results = await manager.researchByKeywords({
      keywords,
      categoryId,
      maxActivePages,
      maxSoldPages,
    });

    log.info({ keywords, results }, 'Completed market research by keywords');
    res.json({
      success: true,
      message: 'Market research completed',
      results,
    });
  } catch (err) {
    log.error({ err, keywords }, 'Error running market research by keywords');
    res.status(500).json({
      success: false,
      message: 'Market research failed',
      error: err.message,
    });
  }
});

/**
 * GET /market-research/all-sold
 * Get all sold items
 */
router.get('/all-sold', authMiddleware, async (req, res) => {
  const { limit = 200 } = req.query;

  try {
    const SoldItem = require('../models/SoldItem');
    const soldItems = await SoldItem.query()
      .orderBy('soldDate', 'desc')
      .limit(parseInt(limit, 10));

    res.json({
      success: true,
      count: soldItems.length,
      soldItems,
    });
  } catch (err) {
    log.error({ err }, 'Error getting all sold items');
    res.status(500).json({
      success: false,
      error: err.message,
    });
  }
});

/**
 * GET /market-research/all-competitors
 * Get all competitor listings
 */
router.get('/all-competitors', authMiddleware, async (req, res) => {
  const { limit = 100 } = req.query;

  try {
    const CompetitorListing = require('../models/CompetitorListing');
    const competitors = await CompetitorListing.query()
      .orderBy('scrapedAt', 'desc')
      .limit(parseInt(limit, 10));

    res.json({
      success: true,
      count: competitors.length,
      competitors,
    });
  } catch (err) {
    log.error({ err }, 'Error getting all competitor listings');
    res.status(500).json({
      success: false,
      error: err.message,
    });
  }
});

/**
 * GET /market-research/stats
 * Get market research statistics
 */
router.get('/stats', authMiddleware, async (req, res) => {
  try {
    const manager = new MarketResearchManager();
    const stats = await manager.getStats();

    res.json({
      success: true,
      stats,
    });
  } catch (err) {
    log.error({ err }, 'Error getting market research stats');
    res.status(500).json({
      success: false,
      error: err.message,
    });
  }
});

/**
 * GET /market-research/competitors
 * Get competitor listings for a specific inventory item
 */
router.get('/competitors/:yourListingId', authMiddleware, async (req, res) => {
  const { yourListingId } = req.params;
  const { limit = 50 } = req.query;

  try {
    const CompetitorListing = require('../models/CompetitorListing');
    const competitors = await CompetitorListing.query()
      .where('yourListingId', yourListingId)
      .orderBy('scrapedAt', 'desc')
      .limit(parseInt(limit, 10));

    res.json({
      success: true,
      yourListingId,
      competitors,
      count: competitors.length,
    });
  } catch (err) {
    log.error({ err, yourListingId }, 'Error getting competitor listings');
    res.status(500).json({
      success: false,
      error: err.message,
    });
  }
});

/**
 * GET /market-research/sold/:yourListingId
 * Get sold items for a specific inventory item
 */
router.get('/sold/:yourListingId', authMiddleware, async (req, res) => {
  const { yourListingId } = req.params;
  const { limit = 50 } = req.query;

  try {
    const SoldItem = require('../models/SoldItem');
    const soldItems = await SoldItem.query()
      .where('yourListingId', yourListingId)
      .orderBy('soldDate', 'desc')
      .limit(parseInt(limit, 10));

    res.json({
      success: true,
      yourListingId,
      soldItems,
      count: soldItems.length,
    });
  } catch (err) {
    log.error({ err, yourListingId }, 'Error getting sold items');
    res.status(500).json({
      success: false,
      error: err.message,
    });
  }
});

/**
 * GET /market-research/price-analysis/:yourListingId
 * Get price analysis for a specific inventory item
 */
router.get('/price-analysis/:yourListingId', authMiddleware, async (req, res) => {
  const { yourListingId } = req.params;

  try {
    const YourListing = require('../models/YourListing');
    const CompetitorListing = require('../models/CompetitorListing');
    const SoldItem = require('../models/SoldItem');

    // Get your listing
    const yourListing = await YourListing.query().findById(yourListingId);
    if (!yourListing) {
      return res.status(404).json({
        success: false,
        message: 'Listing not found',
      });
    }

    // Get competitor price stats
    const competitorStats = await CompetitorListing.query()
      .where('yourListingId', yourListingId)
      .select(
        CompetitorListing.raw('COUNT(*) as count'),
        CompetitorListing.raw('MIN("currentPrice") as min_price'),
        CompetitorListing.raw('MAX("currentPrice") as max_price'),
        CompetitorListing.raw('AVG("currentPrice") as avg_price')
      )
      .first();

    // Get sold price stats (last 30 days)
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const soldStats = await SoldItem.query()
      .where('yourListingId', yourListingId)
      .where('soldDate', '>=', thirtyDaysAgo)
      .select(
        SoldItem.raw('COUNT(*) as count'),
        SoldItem.raw('MIN("soldPrice") as min_price'),
        SoldItem.raw('MAX("soldPrice") as max_price'),
        SoldItem.raw('AVG("soldPrice") as avg_price')
      )
      .first();

    // Get top competitors
    const topCompetitors = await CompetitorListing.query()
      .where('yourListingId', yourListingId)
      .orderBy('currentPrice', 'asc')
      .limit(5)
      .select('seller', 'currentPrice', 'condition', 'freeShipping');

    res.json({
      success: true,
      yourListing: {
        id: yourListing.id,
        title: yourListing.title,
        currentPrice: yourListing.currentPrice,
      },
      competitorAnalysis: {
        count: parseInt(competitorStats?.count || 0, 10),
        minPrice: parseFloat(competitorStats?.min_price || 0),
        maxPrice: parseFloat(competitorStats?.max_price || 0),
        avgPrice: parseFloat(competitorStats?.avg_price || 0),
        topCompetitors,
      },
      soldAnalysis: {
        count: parseInt(soldStats?.count || 0, 10),
        minPrice: parseFloat(soldStats?.min_price || 0),
        maxPrice: parseFloat(soldStats?.max_price || 0),
        avgPrice: parseFloat(soldStats?.avg_price || 0),
      },
      recommendation: generatePriceRecommendation(yourListing, competitorStats, soldStats),
    });
  } catch (err) {
    log.error({ err, yourListingId }, 'Error getting price analysis');
    res.status(500).json({
      success: false,
      error: err.message,
    });
  }
});

/**
 * Generate price recommendation based on market data
 */
function generatePriceRecommendation(yourListing, competitorStats, soldStats) {
  const yourPrice = yourListing.currentPrice;
  const competitorAvg = parseFloat(competitorStats?.avg_price || 0);
  const soldAvg = parseFloat(soldStats?.avg_price || 0);

  if (competitorAvg === 0 && soldAvg === 0) {
    return {
      action: 'INSUFFICIENT_DATA',
      message: 'Not enough market data to make a recommendation',
    };
  }

  // Use sold price as primary indicator (actual sales), competitor as secondary
  const marketPrice = soldAvg > 0 ? soldAvg : competitorAvg;
  const priceDiff = yourPrice - marketPrice;
  const priceDiffPercent = (priceDiff / marketPrice) * 100;

  if (priceDiffPercent > 20) {
    return {
      action: 'REDUCE_PRICE',
      message: `Your price ($${yourPrice}) is ${priceDiffPercent.toFixed(1)}% above market average ($${marketPrice.toFixed(2)})`,
      suggestedPrice: marketPrice * 1.05, // 5% above market
    };
  } else if (priceDiffPercent < -20) {
    return {
      action: 'RAISE_PRICE',
      message: `Your price ($${yourPrice}) is ${Math.abs(priceDiffPercent).toFixed(1)}% below market average ($${marketPrice.toFixed(2)})`,
      suggestedPrice: marketPrice * 0.95, // 5% below market
    };
  } else {
    return {
      action: 'PRICE_OK',
      message: `Your price ($${yourPrice}) is within market range (avg: $${marketPrice.toFixed(2)})`,
    };
  }
}

module.exports = router;
