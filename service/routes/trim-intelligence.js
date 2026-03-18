'use strict';

const router = require('express-promise-router')();
const TrimIntelligenceService = require('../services/TrimIntelligenceService');

/**
 * GET /trim-intelligence/:year/:make/:model/:trim
 * Get trim intelligence. Auto-researches on first encounter.
 */
router.get('/:year/:make/:model/:trim', async (req, res) => {
  try {
    const { year, make, model, trim } = req.params;
    const service = new TrimIntelligenceService();
    const result = await service.getTrimIntelligence({
      year: parseInt(year),
      make: decodeURIComponent(make),
      model: decodeURIComponent(model),
      trim: decodeURIComponent(trim),
    });

    if (!result) {
      return res.json({ success: true, found: false });
    }

    res.json({
      success: true,
      found: true,
      intelligence: result,
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
