'use strict';

const router = require('express-promise-router')();
const { log } = require('../lib/logger');
const CacheService = require('../services/CacheService');

/**
 * GET /cache/active
 * Active claims — parts in the field, not yet listed.
 * Query: ?source=daily_feed&claimedBy=marcus&sortBy=value
 */
router.get('/active', async (req, res) => {
  try {
    const service = new CacheService();
    const claims = await service.getActiveClaims(req.query);
    res.json({ success: true, claims, total: claims.length });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /cache/history
 * Resolved entries (listed, returned, deleted).
 * Query: ?days=30&limit=100
 */
router.get('/history', async (req, res) => {
  try {
    const service = new CacheService();
    const { days = 30, limit = 100 } = req.query;
    const entries = await service.getHistory({ days: parseInt(days), limit: parseInt(limit) });
    res.json({ success: true, entries, total: entries.length });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /cache/claimed-pns
 * Lightweight endpoint for attack list sync.
 * Returns normalized part numbers + cache IDs for active claims.
 */
router.get('/claimed-pns', async (req, res) => {
  try {
    const service = new CacheService();
    const result = await service.getClaimedPNs();
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /cache/stats
 * Dashboard stats: counts by status, source, avg time to list.
 */
router.get('/stats', async (req, res) => {
  try {
    const service = new CacheService();
    const stats = await service.getStats();
    res.json({ success: true, stats });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /cache/claim
 * Create a cache entry. Called by all puller tools + manual entry.
 *
 * Body for tool claim:
 * { partType, partDescription, partNumber, vehicle: {year,make,model,trim,vin},
 *   yard: {name,row}, estimatedValue, priceSource, claimedBy, source, sourceId }
 *
 * Body for manual by part number:
 * { partNumber, source: 'manual', notes }
 *
 * Body for manual by YMM+description:
 * { partType, partDescription, vehicle: {year,make,model}, source: 'manual', notes }
 */
router.post('/claim', async (req, res) => {
  try {
    const service = new CacheService();
    const result = await service.claim(req.body);
    res.status(201).json({ success: true, cached: result });
  } catch (err) {
    log.error({ err, body: req.body }, 'Cache claim failed');
    res.status(400).json({ success: false, error: err.message });
  }
});

/**
 * POST /cache/:id/return
 * Return a claimed part back to alerts.
 * Body: { reason: "couldn't find it" }
 */
router.post('/:id/return', async (req, res) => {
  try {
    const service = new CacheService();
    const result = await service.returnToAlerts(req.params.id, req.body.reason);
    res.json(result);
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

/**
 * POST /cache/:id/resolve
 * Manually mark a cache entry as listed.
 * Body: { ebayItemId: "123456789" }
 */
router.post('/:id/resolve', async (req, res) => {
  try {
    const service = new CacheService();
    const result = await service.manualResolve(req.params.id, req.body.ebayItemId);
    res.json(result);
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

/**
 * DELETE /cache/:id
 * Delete a claim (mistake).
 */
router.delete('/:id', async (req, res) => {
  try {
    const service = new CacheService();
    const result = await service.deleteClaim(req.params.id);
    res.json(result);
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

/**
 * POST /cache/resolve
 * Manual trigger for auto-resolution (normally runs after YourListing sync).
 */
router.post('/resolve', async (req, res) => {
  try {
    const service = new CacheService();
    const result = await service.resolveFromListings();
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /cache/check-stock
 * Check if a part is already in the cache (active claims).
 * Used by Hawk Eye and Nest Protector to prevent duplicate pulls.
 * Query: ?pn=68209529AI or ?make=Ram&model=1500&year=2017&partType=ECM
 */
router.get('/check-stock', async (req, res) => {
  try {
    const service = new CacheService();
    const { pn, make, model, year, partType } = req.query;
    const cached = await service.checkCacheStock({
      partNumber: pn,
      make, model,
      year: year ? parseInt(year) : null,
      partType,
    });
    res.json({
      success: true,
      inCache: cached.length > 0,
      totalCached: cached.length,
      cached: cached.map(c => ({
        id: c.id,
        partType: c.part_type,
        partNumber: c.part_number,
        partDescription: c.part_description,
        vehicle: `${c.vehicle_year || ''} ${c.vehicle_make || ''} ${c.vehicle_model || ''}`.trim(),
        claimedBy: c.claimed_by,
        claimedAt: c.claimed_at,
        source: c.source,
        yardName: c.yard_name,
        estimatedValue: c.estimated_value,
      })),
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
