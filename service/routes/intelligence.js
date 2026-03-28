'use strict';

const { log } = require('../lib/logger');
const router = require('express-promise-router')();
const { authMiddleware } = require('../middleware/Middleware');
const WhatToPullService = require('../services/WhatToPullService');
const PricingService = require('../services/PricingService');
const DeadInventoryService = require('../services/DeadInventoryService');
const OpportunityService = require('../services/OpportunityService');
const LearningsService = require('../services/LearningsService');

/**
 * GET /intelligence/learnings
 * Aggregate actionable patterns from dead inventory, returns, and stale actions
 */
router.get('/learnings', async (req, res) => {
  try {
    const service = new LearningsService();
    const result = await service.getLearnings();
    res.json({ success: true, ...result });
  } catch (err) {
    log.error({ err }, 'Error getting learnings');
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /intelligence/what-to-pull
 * Get recommendations for parts to pull from junkyards
 * Query params: make, model, year, categoryId, limit, daysBack
 */
router.get('/what-to-pull', authMiddleware, async (req, res, next) => {
  log.info({ query: req.query }, 'Getting what-to-pull recommendations');

  const {
    make,
    model,
    year,
    categoryId,
    limit = 50,
    daysBack = 30,
  } = req.query;

  try {
    const service = new WhatToPullService();
    const recommendations = await service.getRecommendations({
      make,
      model,
      year: year ? parseInt(year, 10) : undefined,
      categoryId,
      limit: parseInt(limit, 10),
      daysBack: parseInt(daysBack, 10),
    });

    res.json({
      success: true,
      filters: { make, model, year, categoryId },
      recommendations,
    });
  } catch (err) {
    log.error({ err }, 'Error getting what-to-pull recommendations');
    res.status(500).json({
      success: false,
      error: err.message,
    });
  }
});

/**
 * GET /intelligence/pricing
 * Get pricing recommendations for your listings
 * Query params: ebayItemId, all, daysBack
 */
router.get('/pricing', authMiddleware, async (req, res, next) => {
  log.info({ query: req.query }, 'Getting pricing recommendations');

  const {
    ebayItemId,
    all,
    daysBack = 30,
  } = req.query;

  try {
    const service = new PricingService();
    const result = await service.getRecommendations({
      ebayItemId,
      all: all === 'true',
      daysBack: parseInt(daysBack, 10),
    });

    res.json({
      success: true,
      ...result,
    });
  } catch (err) {
    log.error({ err }, 'Error getting pricing recommendations');
    res.status(500).json({
      success: false,
      error: err.message,
    });
  }
});

/**
 * GET /intelligence/dead-inventory
 * Get listings that are stale and need action
 * Query params: daysThreshold, includeMarketData, limit, page
 */
router.get('/dead-inventory', authMiddleware, async (req, res, next) => {
  log.info({ query: req.query }, 'Getting dead inventory');

  const {
    daysThreshold = 90,
    includeMarketData = 'true',
    limit = 50,
    page = 1,
  } = req.query;

  try {
    const service = new DeadInventoryService();
    const result = await service.getDeadInventory({
      daysThreshold: parseInt(daysThreshold, 10),
      includeMarketData: includeMarketData === 'true',
      limit: parseInt(limit, 10),
      page: parseInt(page, 10),
    });

    res.json({
      success: true,
      daysThreshold: parseInt(daysThreshold, 10),
      page: parseInt(page, 10),
      ...result,
    });
  } catch (err) {
    log.error({ err }, 'Error getting dead inventory');
    res.status(500).json({
      success: false,
      error: err.message,
    });
  }
});

/**
 * GET /intelligence/opportunities
 * Find high-demand parts you're NOT stocking
 * Query params: minDemand, maxCompetition, daysBack, limit
 */
router.get('/opportunities', authMiddleware, async (req, res, next) => {
  log.info({ query: req.query }, 'Getting opportunities');

  const {
    minDemand = 10,
    maxCompetition = 10,
    daysBack = 30,
    limit = 50,
  } = req.query;

  try {
    const service = new OpportunityService();
    const result = await service.getOpportunities({
      minDemand: parseInt(minDemand, 10),
      maxCompetition: parseInt(maxCompetition, 10),
      daysBack: parseInt(daysBack, 10),
      limit: parseInt(limit, 10),
    });

    res.json({
      success: true,
      filters: {
        minDemand: parseInt(minDemand, 10),
        maxCompetition: parseInt(maxCompetition, 10),
        daysBack: parseInt(daysBack, 10),
      },
      ...result,
    });
  } catch (err) {
    log.error({ err }, 'Error getting opportunities');
    res.status(500).json({
      success: false,
      error: err.message,
    });
  }
});

/**
 * GET /intelligence/summary
 * Get a summary of all intelligence data
 */
router.get('/summary', authMiddleware, async (req, res, next) => {
  log.info('Getting intelligence summary');

  try {
    const [whatToPull, pricing, deadInventory, opportunities] = await Promise.all([
      new WhatToPullService().getRecommendations({ limit: 5 }),
      new PricingService().getRecommendations({ all: true }),
      new DeadInventoryService().getDeadInventory({ limit: 5 }),
      new OpportunityService().getOpportunities({ limit: 5 }),
    ]);

    res.json({
      success: true,
      summary: {
        topPartsToPull: whatToPull.slice(0, 5),
        pricingRecommendations: pricing.pricingRecommendations?.length || 0,
        deadInventoryCount: deadInventory.deadInventory?.length || 0,
        topOpportunities: opportunities.opportunities?.slice(0, 5),
      },
    });
  } catch (err) {
    log.error({ err }, 'Error getting intelligence summary');
    res.status(500).json({
      success: false,
      error: err.message,
    });
  }
});

module.exports = router;
