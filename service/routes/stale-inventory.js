'use strict';

const router = require('express-promise-router')();
const { log } = require('../lib/logger');
const StaleInventoryService = require('../services/StaleInventoryService');
const ReturnIntakeService = require('../services/ReturnIntakeService');
const RestockService = require('../services/RestockService');

/**
 * POST /stale-inventory/run
 * Trigger stale inventory automation scan.
 * Applies scheduled price reductions via TradingAPI.
 */
router.post('/run', async (req, res) => {
  try {
    const service = new StaleInventoryService();
    // Run in background
    service.runAutomation().catch(err => {
      log.error({ err }, 'Stale inventory automation failed');
    });
    res.json({ success: true, message: 'Stale inventory automation started' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /stale-inventory/actions
 * Get history of stale inventory actions taken.
 */
router.get('/actions', async (req, res) => {
  try {
    const { database } = require('../database/database');
    const { limit = 50, page = 1, tier } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    let query = database('stale_inventory_action').orderBy('createdAt', 'desc');
    if (tier) query = query.where('tier', tier);

    const [actions, countResult] = await Promise.all([
      query.clone().limit(parseInt(limit)).offset(offset),
      query.clone().count('* as total').first(),
    ]);

    res.json({
      success: true,
      actions,
      total: parseInt(countResult?.total || 0),
      page: parseInt(page),
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// === Return Intake ===

/**
 * POST /stale-inventory/returns
 * Log a returned part and auto-queue relist.
 */
router.post('/returns', async (req, res) => {
  try {
    const service = new ReturnIntakeService();
    const result = await service.intakeReturn(req.body);
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /stale-inventory/returns/pending
 * Get all pending relists.
 */
router.get('/returns/pending', async (req, res) => {
  try {
    const service = new ReturnIntakeService();
    const returns = await service.getPendingRelists();
    res.json({ success: true, returns });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /stale-inventory/returns/:id/relisted
 * Mark a return as relisted.
 */
router.post('/returns/:id/relisted', async (req, res) => {
  try {
    const service = new ReturnIntakeService();
    const result = await service.markRelisted(req.params.id, req.body.newEbayItemId);
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /stale-inventory/returns/:id/scrapped
 * Mark a return as scrapped.
 */
router.post('/returns/:id/scrapped', async (req, res) => {
  try {
    const service = new ReturnIntakeService();
    const result = await service.markScrapped(req.params.id);
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// === Restock ===

/**
 * POST /stale-inventory/restock/scan
 * Run restock scan.
 */
router.post('/restock/scan', async (req, res) => {
  try {
    const service = new RestockService();
    const result = await service.scanAndFlag();
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /stale-inventory/restock/flags
 * Get restock flags.
 */
router.get('/restock/flags', async (req, res) => {
  try {
    const { acknowledged, limit } = req.query;
    const service = new RestockService();
    const flags = await service.getFlags({
      acknowledged: acknowledged === 'true',
      limit: parseInt(limit) || 50,
    });
    res.json({ success: true, flags });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /stale-inventory/restock/:id/acknowledge
 * Acknowledge a restock flag.
 */
router.post('/restock/:id/acknowledge', async (req, res) => {
  try {
    const service = new RestockService();
    const result = await service.acknowledge(req.params.id);
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
