'use strict';

const router = require('express-promise-router')();
const blockedComps = require('../services/BlockedCompsService');

/** POST /blocked-comps/block — Comp block by Item.id */
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

/** POST /blocked-comps/block-sold — Sold block by partType+year+make+model */
router.post('/block-sold', async (req, res) => {
  try {
    const result = await blockedComps.blockSold(req.body);
    res.json({ success: true, blocked: result });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

/** DELETE /blocked-comps/by-id/:id — Unified unblock by row id (both types) */
router.delete('/by-id/:id', async (req, res) => {
  try {
    const result = await blockedComps.unblockById(parseInt(req.params.id));
    res.json(result);
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

/** DELETE /blocked-comps/:itemId — Comp unblock by Item.id (backward compat) */
router.delete('/:itemId', async (req, res) => {
  try {
    const result = await blockedComps.unblock(req.params.itemId);
    res.json(result);
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

/** GET /blocked-comps — List all blocked comps. ?search=&type=comp|sold&limit=100&offset=0 */
router.get('/', async (req, res) => {
  try {
    const { search, limit = 100, offset = 0, type } = req.query;
    const result = await blockedComps.list({
      search, limit: parseInt(limit), offset: parseInt(offset), type: type || undefined,
    });
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
