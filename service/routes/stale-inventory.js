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
// DISABLED 2026-04-08 by owner directive. DarkHawk is read-only for inventory management.
router.post('/run', (req, res) => {
  res.status(410).json({ error: 'gone', message: 'eBay write endpoints permanently disabled 2026-04-08. DarkHawk is read-only for inventory management.' });
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

// === Manual Inventory Controls (Phase 5) ===

const TradingAPI = require('../ebay/TradingAPI');
const { database } = require('../database/database');
const { v4: uuidv4 } = require('uuid');

/**
 * GET /stale-inventory/candidates
 * Listings needing action: aged out, reduced 2+ times, or overpriced verdict.
 */
router.get('/candidates', async (req, res) => {
  try {
    const listings = await database('YourListing')
      .where('listingStatus', 'Active')
      .where('quantityAvailable', '>', 0)
      .orderBy('startTime', 'asc')
      .limit(100)
      .select('id', 'ebayItemId', 'title', 'currentPrice', 'startTime', 'isProgrammed');

    const candidates = [];
    for (const l of listings) {
      const daysListed = l.startTime ? Math.floor((Date.now() - new Date(l.startTime).getTime()) / 86400000) : 0;
      if (daysListed < 60) continue;

      // Count prior reductions
      let reductionCount = 0;
      try {
        const actions = await database('stale_inventory_action')
          .where('ebay_item_id', l.ebayItemId)
          .where('action_type', 'REDUCE_PRICE')
          .count('* as c').first();
        reductionCount = parseInt(actions?.c || 0);
      } catch (e) {}

      let recommendation = 'hold';
      if (daysListed > 180 && reductionCount >= 2) recommendation = 'end';
      else if (daysListed > 120) recommendation = 'deep_discount';
      else if (daysListed > 90) recommendation = 'reduce';
      else recommendation = 'monitor';

      candidates.push({
        id: l.id,
        ebayItemId: l.ebayItemId,
        title: l.title,
        currentPrice: parseFloat(l.currentPrice),
        daysListed,
        reductionCount,
        isProgrammed: l.isProgrammed,
        recommendation,
      });
    }

    candidates.sort((a, b) => b.daysListed - a.daysListed);
    res.json({ success: true, candidates, total: candidates.length });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// DISABLED 2026-04-08 — eBay write endpoints permanently disabled
const GONE_MSG = { error: 'gone', message: 'eBay write endpoints permanently disabled 2026-04-08. DarkHawk is read-only for inventory management.' };
router.post('/revise-price', (req, res) => res.status(410).json(GONE_MSG));
router.post('/end-item', (req, res) => res.status(410).json(GONE_MSG));
router.post('/relist-item', (req, res) => res.status(410).json(GONE_MSG));
router.post('/bulk-end', (req, res) => res.status(410).json(GONE_MSG));

/* ORIGINAL WRITE HANDLERS REMOVED 2026-04-08 — preserved in git history
router.post('/revise-price', async (req, res) => {
  const { ebayItemId, newPrice } = req.body;
  if (!ebayItemId || !newPrice) return res.status(400).json({ error: 'ebayItemId and newPrice required' });
  if (parseFloat(newPrice) <= 0) return res.status(400).json({ error: 'newPrice must be > 0' });

  try {
    // Get current price
    const listing = await database('YourListing').where('ebayItemId', ebayItemId).first();
    if (!listing) return res.status(404).json({ error: 'Listing not found' });
    if (listing.listingStatus !== 'Active') return res.status(400).json({ error: 'Listing is not active' });

    const oldPrice = parseFloat(listing.currentPrice);
    const api = new TradingAPI();
    await api.reviseItem({ ebayItemId, startPrice: parseFloat(newPrice) });

    // Update local record
    await database('YourListing').where('ebayItemId', ebayItemId).update({ currentPrice: parseFloat(newPrice), updatedAt: new Date() });

    // Log action
    await database('stale_inventory_action').insert({
      id: uuidv4(), ebay_item_id: ebayItemId, listing_id: listing.id, title: listing.title,
      action_type: 'manual_revise', old_price: oldPrice, new_price: parseFloat(newPrice),
      days_listed: listing.startTime ? Math.floor((Date.now() - new Date(listing.startTime).getTime()) / 86400000) : null,
      executed: true, executed_at: new Date(), createdAt: new Date(),
    });

    res.json({ success: true, oldPrice, newPrice: parseFloat(newPrice) });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /stale-inventory/end-item
 * End a listing on eBay.
 */
router.post('/end-item', async (req, res) => {
  const { ebayItemId, reason = 'NotAvailable' } = req.body;
  if (!ebayItemId) return res.status(400).json({ error: 'ebayItemId required' });

  try {
    const listing = await database('YourListing').where('ebayItemId', ebayItemId).first();
    if (!listing) return res.status(404).json({ error: 'Listing not found' });
    if (listing.listingStatus !== 'Active') return res.status(400).json({ error: 'Listing is not active' });

    const api = new TradingAPI();
    const result = await api.endItem({ ebayItemId, endingReason: reason });

    await database('YourListing').where('ebayItemId', ebayItemId).update({ listingStatus: 'Ended', updatedAt: new Date() });

    await database('stale_inventory_action').insert({
      id: uuidv4(), ebay_item_id: ebayItemId, listing_id: listing.id, title: listing.title,
      action_type: 'end', old_price: parseFloat(listing.currentPrice),
      days_listed: listing.startTime ? Math.floor((Date.now() - new Date(listing.startTime).getTime()) / 86400000) : null,
      executed: true, executed_at: new Date(), createdAt: new Date(),
    });

    res.json({ success: true, endTime: result.endTime });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /stale-inventory/relist-item
 * Relist an ended listing on eBay.
 */
router.post('/relist-item', async (req, res) => {
  const { ebayItemId, newPrice } = req.body;
  if (!ebayItemId) return res.status(400).json({ error: 'ebayItemId required' });

  try {
    const listing = await database('YourListing').where('ebayItemId', ebayItemId).first();
    if (!listing) return res.status(404).json({ error: 'Listing not found' });

    const api = new TradingAPI();
    const result = await api.relistItem({ ebayItemId, startPrice: newPrice ? parseFloat(newPrice) : null });

    await database('stale_inventory_action').insert({
      id: uuidv4(), ebay_item_id: ebayItemId, listing_id: listing.id, title: listing.title,
      action_type: 'relist', old_price: parseFloat(listing.currentPrice), new_price: newPrice ? parseFloat(newPrice) : parseFloat(listing.currentPrice),
      executed: true, executed_at: new Date(), createdAt: new Date(),
    });

    res.json({ success: true, newItemId: result.newItemId, fees: result.fees });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /stale-inventory/bulk-end
 * End multiple listings. Max 25 per call.
 */
router.post('/bulk-end', async (req, res) => {
  const { ebayItemIds, reason = 'NotAvailable' } = req.body;
  if (!ebayItemIds || !Array.isArray(ebayItemIds)) return res.status(400).json({ error: 'ebayItemIds array required' });
  if (ebayItemIds.length > 25) return res.status(400).json({ error: 'Max 25 items per bulk end' });

  const api = new TradingAPI();
  const results = [];

  for (const ebayItemId of ebayItemIds) {
    try {
      const listing = await database('YourListing').where('ebayItemId', ebayItemId).first();
      if (!listing || listing.listingStatus !== 'Active') {
        results.push({ ebayItemId, success: false, error: 'Not active' });
        continue;
      }

      await api.endItem({ ebayItemId, endingReason: reason });
      await database('YourListing').where('ebayItemId', ebayItemId).update({ listingStatus: 'Ended', updatedAt: new Date() });
      await database('stale_inventory_action').insert({
        id: uuidv4(), ebay_item_id: ebayItemId, listing_id: listing.id, title: listing.title,
        action_type: 'end', old_price: parseFloat(listing.currentPrice),
        executed: true, executed_at: new Date(), createdAt: new Date(),
      });
      results.push({ ebayItemId, success: true });
    } catch (err) {
      results.push({ ebayItemId, success: false, error: err.message });
    }
    // Rate limit: 1 second between calls
    await new Promise(r => setTimeout(r, 1000));
  }

  res.json({
    success: true,
    results,
    totalEnded: results.filter(r => r.success).length,
    totalFailed: results.filter(r => !r.success).length,
  });
});
// END OF REMOVED HANDLERS */

module.exports = router;
