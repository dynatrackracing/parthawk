'use strict';

const router = require('express-promise-router')();
const { database } = require('../database/database');

/**
 * GET /trim-validation/lookup?make=BMW&partType=amp
 * Returns validation data for a given make and optional part type.
 */
router.get('/lookup', async (req, res) => {
  try {
    const { make, partType } = req.query;
    if (!make) return res.status(400).json({ success: false, error: 'make is required' });

    let query = database('trim_value_validation').where('make', 'ilike', make);
    if (partType) query = query.where('part_type', partType);
    query = query.orderBy('delta', 'desc');

    const rows = await query;
    res.json({ success: true, count: rows.length, validations: rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
