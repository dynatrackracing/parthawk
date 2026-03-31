'use strict';

const router = require('express-promise-router')();
const { log } = require('../lib/logger');
const { database } = require('../database/database');
const PhoenixService = require('../services/PhoenixService');
const SoldItemsManager = require('../managers/SoldItemsManager');

// GET /phoenix — Main scored list
router.get('/', async (req, res) => {
  try {
    const service = new PhoenixService();
    const days = parseInt(req.query.days) || 180;
    const limit = parseInt(req.query.limit) || 100;
    const seller = req.query.seller || null;
    const sellers = await service.getRebuildSellers();
    const data = await service.getPhoenixList({ days, limit, seller });
    res.json({
      success: true,
      data,
      meta: { days, limit, total: data.length, seller: seller || 'all', allSellers: sellers.filter(s => s.enabled).map(s => s.name) },
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /phoenix/stats — Summary metrics
router.get('/stats', async (req, res) => {
  try {
    const service = new PhoenixService();
    const days = parseInt(req.query.days) || 180;
    const seller = req.query.seller || null;
    const stats = await service.getPhoenixStats({ days, seller });
    res.json({ success: true, stats });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /phoenix/sellers — List rebuild sellers
router.get('/sellers', async (req, res) => {
  try {
    const service = new PhoenixService();
    const sellers = await service.getRebuildSellers();
    res.json({ success: true, sellers });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /phoenix/sellers — Add a rebuild seller
router.post('/sellers', async (req, res) => {
  try {
    const { name } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ success: false, message: 'Seller name is required' });
    const service = new PhoenixService();
    const seller = await service.addRebuildSeller(name);
    res.json({ success: true, seller, message: 'Added rebuild seller: ' + name.trim().toLowerCase() });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// DELETE /phoenix/sellers/:name — Remove rebuild seller
router.delete('/sellers/:name', async (req, res) => {
  try {
    const service = new PhoenixService();
    const result = await service.removeRebuildSeller(req.params.name);
    res.json({ success: true, ...result, message: 'Removed rebuild seller: ' + req.params.name });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /phoenix/sellers/:name/scrape — Trigger scrape (non-blocking)
router.post('/sellers/:name/scrape', async (req, res) => {
  const sellerName = req.params.name;
  const maxPages = parseInt(req.body.maxPages) || 5;
  res.json({ success: true, message: 'Scrape started for ' + sellerName, started: true });

  // Run in background — don't block the request
  const manager = new SoldItemsManager();
  try {
    const result = await manager.scrapeCompetitor({
      seller: sellerName,
      categoryId: '6030',
      maxPages,
    });
    log.info({ seller: sellerName, result }, 'Phoenix seller scrape complete');

    // Update seller stats so UI and auto-scrape skip window stay current
    try {
      await database('SoldItemSeller').where('name', sellerName).update({
        lastScrapedAt: new Date(),
        itemsScraped: database.raw('"itemsScraped" + ?', [result.stored]),
        updatedAt: new Date(),
      });
    } catch (e) { log.warn({ err: e.message, seller: sellerName }, 'Could not update seller stats'); }
  } catch (err) {
    log.error({ err: err.message, seller: sellerName }, 'Phoenix seller scrape failed');
  } finally {
    try { await manager.scraper.closeBrowser(); } catch (e) {}
  }
});

module.exports = router;
