'use strict';

const router = require('express-promise-router')();
const { findOpportunities, normalizeOppTitle } = require('../services/OpportunityService');
const { database } = require('../database/database');

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

/**
 * POST /opportunities/dismiss
 * Dismiss an opportunity so it never reappears.
 */
router.post('/dismiss', async (req, res) => {
  try {
    const { title } = req.body;
    if (!title) return res.status(400).json({ success: false, error: 'title required' });

    const key = normalizeOppTitle(title);
    if (!key) return res.status(400).json({ success: false, error: 'title is empty after normalization' });

    await database('dismissed_opportunity')
      .insert({ opportunity_key: key, original_title: title, dismissed_at: new Date() })
      .onConflict('opportunity_key')
      .merge();

    res.json({ success: true, dismissed: key });
  } catch (err) {
    console.error('Error dismissing opportunity:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /opportunities/undismiss
 * Restore a previously dismissed opportunity.
 */
router.post('/undismiss', async (req, res) => {
  try {
    const { title } = req.body;
    if (!title) return res.status(400).json({ success: false, error: 'title required' });

    const key = normalizeOppTitle(title);
    const deleted = await database('dismissed_opportunity').where('opportunity_key', key).del();

    res.json({ success: true, undismissed: key, removed: deleted });
  } catch (err) {
    console.error('Error undismissing opportunity:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /opportunities/dismissed
 * List all dismissed opportunities.
 */
router.get('/dismissed', async (req, res) => {
  try {
    const rows = await database('dismissed_opportunity')
      .orderBy('dismissed_at', 'desc')
      .select('*');

    res.json({ success: true, total: rows.length, dismissed: rows });
  } catch (err) {
    console.error('Error fetching dismissed opportunities:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
