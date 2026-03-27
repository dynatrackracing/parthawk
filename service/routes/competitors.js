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
