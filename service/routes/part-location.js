'use strict';

const { log } = require('../lib/logger');
const router = require('express-promise-router')();
const PartLocationService = require('../services/PartLocationService');

/**
 * GET /part-location/:partType/:make/:model/:year
 * Look up part location. Triggers research if eligible and no record exists.
 * Optional query params: trim, bodyStyle
 */
router.get('/:partType/:make/:model/:year', async (req, res) => {
  try {
    const { partType, make, model, year } = req.params;
    const { trim, bodyStyle } = req.query;

    const service = new PartLocationService();
    const location = await service.getLocation({
      partType, year: parseInt(year), make, model,
      trim: trim || null,
      bodyStyle: bodyStyle || null,
    });

    if (!location) {
      return res.json({
        success: true,
        found: false,
        eligible: service.shouldResearch({ partType, year: parseInt(year) }),
      });
    }

    // Parse removal_steps if it's a string
    if (typeof location.removal_steps === 'string') {
      try { location.removal_steps = JSON.parse(location.removal_steps); }
      catch (e) { /* leave as string */ }
    }

    return res.json({ success: true, found: true, location });
  } catch (err) {
    log.error({ err }, 'Error looking up part location');
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /part-location/confirm
 * Record a field confirmation from a puller.
 * Body: { id, locationText?, removalSteps?, tools?, hazards?, avgPullMinutes? }
 */
router.post('/confirm', async (req, res) => {
  try {
    const { id, locationText, removalSteps, tools, hazards, avgPullMinutes } = req.body;
    if (!id) return res.status(400).json({ error: 'id required' });

    const service = new PartLocationService();
    const updated = await service.confirmLocation(id, {
      locationText, removalSteps, tools, hazards, avgPullMinutes,
    });

    if (!updated) return res.status(404).json({ error: 'Record not found' });

    res.json({ success: true, location: updated });
  } catch (err) {
    log.error({ err }, 'Error confirming part location');
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /part-location/flag-wrong
 * Flag a location as incorrect. Resets confidence and confirmed_count.
 * Body: { id }
 */
router.post('/flag-wrong', async (req, res) => {
  try {
    const { id } = req.body;
    if (!id) return res.status(400).json({ error: 'id required' });

    const service = new PartLocationService();
    const updated = await service.flagWrong(id);

    if (!updated) return res.status(404).json({ error: 'Record not found' });

    res.json({ success: true, location: updated });
  } catch (err) {
    log.error({ err }, 'Error flagging part location');
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
