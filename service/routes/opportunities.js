'use strict';

const router = require('express-promise-router')();
const { findOpportunities } = require('../services/OpportunityService');

/**
 * GET /opportunities
 * Returns scored opportunity list — parts with market demand we don't stock.
 */
router.get('/', async (req, res) => {
  try {
    const { sort = 'score', minScore = 0, partType } = req.query;
    let opportunities = await findOpportunities();

    // Filter by minimum score
    const min = parseInt(minScore) || 0;
    if (min > 0) opportunities = opportunities.filter(o => o.score >= min);

    // Filter by part type
    if (partType) {
      const pt = partType.toUpperCase();
      opportunities = opportunities.filter(o => o.partType === pt);
    }

    // Sort
    if (sort === 'price') {
      opportunities.sort((a, b) => b.marketMedian - a.marketMedian);
    } else if (sort === 'sold') {
      opportunities.sort((a, b) => b.soldCount - a.soldCount);
    } else if (sort === 'velocity') {
      opportunities.sort((a, b) => b.velocity - a.velocity);
    }
    // default: already sorted by score

    res.json({
      success: true,
      generated_at: new Date().toISOString(),
      total: opportunities.length,
      opportunities,
    });
  } catch (err) {
    console.error('Error generating opportunities:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
