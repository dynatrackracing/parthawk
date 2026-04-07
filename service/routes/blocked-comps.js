'use strict';

const router = require('express-promise-router')();
const blockedComps = require('../services/BlockedCompsService');

/**
 * POST /blocked-comps/block
 * Block a comp item from all match pools.
 * Body: { itemId, reason? }
 */
router.post('/block', async (req, res) => {
  try {
    const { itemId, reason } = req.body;
    if (!itemId) return res.status(400).json({ success: false, error: 'itemId required' });
    const result = await blockedComps.block(itemId, { reason });
    res.json({ success: true, blocked: result });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

/**
 * DELETE /blocked-comps/:itemId
 * Unblock (restore) a previously blocked comp.
 */
router.delete('/:itemId', async (req, res) => {
  try {
    const result = await blockedComps.unblock(req.params.itemId);
    res.json(result);
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

/**
 * GET /blocked-comps
 * List all blocked comps with search + pagination.
 * Query: ?search=ECM&limit=100&offset=0
 */
router.get('/', async (req, res) => {
  try {
    const { search, limit = 100, offset = 0 } = req.query;
    const result = await blockedComps.list({
      search, limit: parseInt(limit), offset: parseInt(offset),
    });
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
