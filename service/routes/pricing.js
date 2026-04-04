'use strict';

const { log } = require('../lib/logger');
const router = require('express-promise-router')();
const { isAdmin, authMiddleware } = require('../middleware/Middleware');
const PricePredictionService = require('../services/PricePredictionService');

/**
 * GET /pricing/predict/:listingId
 * Get ML-based price prediction for a specific listing
 */
router.get('/predict/:listingId', authMiddleware, async (req, res) => {
  const { listingId } = req.params;

  try {
    const service = new PricePredictionService();
    const prediction = await service.predictOptimalPrice(listingId);

    res.json({
      success: true,
      prediction,
    });
  } catch (err) {
    log.error({ err, listingId }, 'Error predicting price');
    res.status(500).json({
      success: false,
      error: err.message,
    });
  }
});

/**
 * GET /pricing/batch
 * Get batch price predictions for all active listings
 */
router.get('/batch', authMiddleware, async (req, res) => {
  const { limit = 50 } = req.query;

  try {
    const service = new PricePredictionService();
    const predictions = await service.batchPredictPrices(parseInt(limit, 10));

    // Summarize results
    const summary = {
      total: predictions.length,
      raisePrice: predictions.filter(p => p.recommendation === 'RAISE_PRICE').length,
      reducePrice: predictions.filter(p => p.recommendation === 'REDUCE_PRICE').length,
      priceOk: predictions.filter(p => p.recommendation === 'PRICE_OK').length,
      insufficientData: predictions.filter(p => p.recommendation === 'INSUFFICIENT_DATA').length,
    };

    res.json({
      success: true,
      summary,
      predictions,
    });
  } catch (err) {
    log.error({ err }, 'Error running batch predictions');
    res.status(500).json({
      success: false,
      error: err.message,
    });
  }
});

/**
 * GET /pricing/underpriced
 * Find items that are priced below market value
 */
router.get('/underpriced', authMiddleware, async (req, res) => {
  const { limit = 20 } = req.query;

  try {
    const service = new PricePredictionService();
    const underpriced = await service.findUnderpricedItems(parseInt(limit, 10));

    // Calculate total potential gain
    const totalPotentialGain = underpriced.reduce((acc, item) => acc + (item.potentialGain || 0), 0);

    res.json({
      success: true,
      count: underpriced.length,
      totalPotentialGain,
      items: underpriced,
    });
  } catch (err) {
    log.error({ err }, 'Error finding underpriced items');
    res.status(500).json({
      success: false,
      error: err.message,
    });
  }
});

/**
 * GET /pricing/overpriced
 * Find items that may be priced too high
 */
router.get('/overpriced', authMiddleware, async (req, res) => {
  const { limit = 20 } = req.query;

  try {
    const service = new PricePredictionService();
    const overpriced = await service.findOverpricedItems(parseInt(limit, 10));

    res.json({
      success: true,
      count: overpriced.length,
      items: overpriced,
    });
  } catch (err) {
    log.error({ err }, 'Error finding overpriced items');
    res.status(500).json({
      success: false,
      error: err.message,
    });
  }
});

/**
 * GET /pricing/velocity/:keywords
 * Analyze price velocity for a set of keywords
 */
router.get('/velocity/:keywords', authMiddleware, async (req, res) => {
  const { keywords } = req.params;

  try {
    const service = new PricePredictionService();
    const velocity = await service.analyzePriceVelocity(keywords);

    if (!velocity) {
      return res.json({
        success: true,
        message: 'Insufficient data for velocity analysis',
        velocity: null,
      });
    }

    res.json({
      success: true,
      keywords,
      velocity,
    });
  } catch (err) {
    log.error({ err, keywords }, 'Error analyzing price velocity');
    res.status(500).json({
      success: false,
      error: err.message,
    });
  }
});

/**
 * GET /pricing/market-summary
 * Get overall market pricing summary
 */
router.get('/market-summary', authMiddleware, async (req, res) => {
  try {
    const SoldItem = require('../models/SoldItem');
    const CompetitorListing = require('../models/CompetitorListing');
    const YourListing = require('../models/YourListing');

    // Get aggregate stats
    const [soldStats, competitorStats, yourStats] = await Promise.all([
      SoldItem.query()
        .select(
          SoldItem.raw('COUNT(*) as count'),
          SoldItem.raw('AVG("soldPrice") as avg_price'),
          SoldItem.raw('MIN("soldPrice") as min_price'),
          SoldItem.raw('MAX("soldPrice") as max_price')
        )
        .first(),
      CompetitorListing.query()
        .select(
          CompetitorListing.raw('COUNT(*) as count'),
          CompetitorListing.raw('AVG("currentPrice") as avg_price'),
          CompetitorListing.raw('MIN("currentPrice") as min_price'),
          CompetitorListing.raw('MAX("currentPrice") as max_price')
        )
        .first(),
      YourListing.query()
        .select(
          YourListing.raw('COUNT(*) as count'),
          YourListing.raw('AVG("currentPrice") as avg_price'),
          YourListing.raw('MIN("currentPrice") as min_price'),
          YourListing.raw('MAX("currentPrice") as max_price')
        )
        .first(),
    ]);

    // Calculate market opportunity
    const soldAvg = parseFloat(soldStats?.avg_price || 0);
    const competitorAvg = parseFloat(competitorStats?.avg_price || 0);
    const yourAvg = parseFloat(yourStats?.avg_price || 0);

    let marketInsight = '';
    if (soldAvg > 0 && competitorAvg > 0) {
      const competitorPremium = ((competitorAvg - soldAvg) / soldAvg) * 100;
      if (competitorPremium > 10) {
        marketInsight = `Competitors are pricing ${competitorPremium.toFixed(1)}% above sold prices. Market may be overpriced.`;
      } else if (competitorPremium < -10) {
        marketInsight = `Competitors are pricing ${Math.abs(competitorPremium).toFixed(1)}% below historical sold prices. Opportunity to price competitively.`;
      } else {
        marketInsight = `Market pricing is aligned with historical sold prices (${competitorPremium.toFixed(1)}% difference).`;
      }
    }

    res.json({
      success: true,
      marketSummary: {
        soldItems: {
          count: parseInt(soldStats?.count || 0, 10),
          avgPrice: soldAvg,
          minPrice: parseFloat(soldStats?.min_price || 0),
          maxPrice: parseFloat(soldStats?.max_price || 0),
        },
        competitorListings: {
          count: parseInt(competitorStats?.count || 0, 10),
          avgPrice: competitorAvg,
          minPrice: parseFloat(competitorStats?.min_price || 0),
          maxPrice: parseFloat(competitorStats?.max_price || 0),
        },
        yourListings: {
          count: parseInt(yourStats?.count || 0, 10),
          avgPrice: yourAvg,
          minPrice: parseFloat(yourStats?.min_price || 0),
          maxPrice: parseFloat(yourStats?.max_price || 0),
        },
        marketInsight,
      },
    });
  } catch (err) {
    log.error({ err }, 'Error getting market summary');
    res.status(500).json({
      success: false,
      error: err.message,
    });
  }
});

/**
 * GET /pricing/sniper-preview
 * Dry-run: show what the next sniper batch would contain without scraping.
 */
router.get('/sniper-preview', async (req, res) => {
  try {
    const PriceCheckCronRunner = require('../lib/PriceCheckCronRunner');
    const runner = new PriceCheckCronRunner();
    const batchSize = parseInt(req.query.size) || 35;
    const queue = await runner.buildQueue(batchSize);

    res.json({
      success: true,
      batchSize,
      queueLength: queue.length,
      items: queue.map(item => ({
        id: item.id,
        ebayItemId: item.ebayItemId,
        title: item.title,
        currentPrice: item.currentPrice,
        lastChecked: item.last_checked || 'never',
      })),
    });
  } catch (err) {
    log.error({ err }, 'Sniper preview error');
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
