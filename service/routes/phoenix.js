'use strict';

const router = require('express-promise-router')();
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

// POST /phoenix/sellers/:name/scrape — Trigger scrape
router.post('/sellers/:name/scrape', async (req, res) => {
  try {
    const manager = new SoldItemsManager();
    const result = await manager.scrapeCompetitor({
      seller: req.params.name,
      categoryId: '6030',
      maxPages: parseInt(req.body.maxPages) || 5,
    });
    res.json({ success: true, message: 'Scrape complete', results: result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
