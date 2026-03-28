'use strict';

const { log } = require('../lib/logger');
const router = require('express-promise-router')();
const { authMiddleware } = require('../middleware/Middleware');
const DemandAnalysisService = require('../services/DemandAnalysisService');

/**
 * GET /demand-analysis/sell-through
 * Calculate sell-through rate for inventory
 */
router.get('/sell-through', authMiddleware, async (req, res) => {
  const { days = 30 } = req.query;

  try {
    const service = new DemandAnalysisService();
    const result = await service.calculateSellThroughRate(parseInt(days, 10));

    res.json({
      success: true,
      ...result,
    });
  } catch (err) {
    log.error({ err }, 'Error calculating sell-through rate');
    res.status(500).json({
      success: false,
      error: err.message,
    });
  }
});

/**
 * GET /demand-analysis/stale-inventory
 * Find stale inventory that hasn't sold
 */
router.get('/stale-inventory', authMiddleware, async (req, res) => {
  const { days = 60, limit = 50 } = req.query;

  try {
    const service = new DemandAnalysisService();
    const items = await service.findStaleInventory(
      parseInt(days, 10),
      parseInt(limit, 10)
    );

    res.json({
      success: true,
      threshold: parseInt(days, 10),
      count: items.length,
      items,
    });
  } catch (err) {
    log.error({ err }, 'Error finding stale inventory');
    res.status(500).json({
      success: false,
      error: err.message,
    });
  }
});

/**
 * GET /demand-analysis/velocity
 * Analyze sales velocity over time
 */
router.get('/velocity', authMiddleware, async (req, res) => {
  const { days = 90 } = req.query;

  try {
    const service = new DemandAnalysisService();
    const result = await service.analyzeSalesVelocity(parseInt(days, 10));

    res.json({
      success: true,
      ...result,
    });
  } catch (err) {
    log.error({ err }, 'Error analyzing sales velocity');
    res.status(500).json({
      success: false,
      error: err.message,
    });
  }
});

/**
 * GET /demand-analysis/top-performers
 * Get best selling products
 */
router.get('/top-performers', authMiddleware, async (req, res) => {
  const { limit = 20 } = req.query;

  try {
    const service = new DemandAnalysisService();
    const items = await service.getTopPerformers(parseInt(limit, 10));

    res.json({
      success: true,
      count: items.length,
      items,
    });
  } catch (err) {
    log.error({ err }, 'Error getting top performers');
    res.status(500).json({
      success: false,
      error: err.message,
    });
  }
});

/**
 * GET /demand-analysis/competition/:keywords
 * Analyze competition for a keyword/category
 */
router.get('/competition/:keywords', authMiddleware, async (req, res) => {
  const { keywords } = req.params;

  try {
    const service = new DemandAnalysisService();
    const analysis = await service.analyzeCompetition(keywords);

    if (!analysis) {
      return res.json({
        success: true,
        message: 'Insufficient data for analysis',
        analysis: null,
      });
    }

    res.json({
      success: true,
      analysis,
    });
  } catch (err) {
    log.error({ err, keywords }, 'Error analyzing competition');
    res.status(500).json({
      success: false,
      error: err.message,
    });
  }
});

/**
 * GET /demand-analysis/dashboard
 * Get comprehensive market health dashboard
 */
router.get('/dashboard', authMiddleware, async (req, res) => {
  try {
    const service = new DemandAnalysisService();
    const dashboard = await service.getMarketHealthDashboard();

    res.json({
      success: true,
      dashboard,
    });
  } catch (err) {
    log.error({ err }, 'Error getting market health dashboard');
    res.status(500).json({
      success: false,
      error: err.message,
    });
  }
});

// ── Public DarkHawk endpoints (no auth) ──

router.get('/health', async (req, res) => {
  try {
    const service = new DemandAnalysisService();
    const dashboard = await service.getMarketHealthDashboard();
    res.json({ success: true, dashboard });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/public/velocity', async (req, res) => {
  const { days = 90 } = req.query;
  try {
    const service = new DemandAnalysisService();
    const result = await service.analyzeSalesVelocity(parseInt(days, 10));
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/public/sell-through', async (req, res) => {
  const { days = 30 } = req.query;
  try {
    const service = new DemandAnalysisService();
    const result = await service.calculateSellThroughRate(parseInt(days, 10));
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/public/top-performers', async (req, res) => {
  const { limit = 10 } = req.query;
  try {
    const service = new DemandAnalysisService();
    const items = await service.getTopPerformers(parseInt(limit, 10));
    res.json({ success: true, items });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
