'use strict';

const router = require('express-promise-router')();
const { findOpportunities, normalizeOppTitle } = require('../services/OpportunityService');
const { database } = require('../database/database');
const { extractMarkVehicleWithFallback } = require('../lib/markVehicleExtractor');

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

// ---------------------------------------------------------------------------
// Sky Watch Research endpoints
// ---------------------------------------------------------------------------

function normalizeTitle(title) {
  if (!title) return '';
  return title.toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim();
}

function computeResearchStats(results) {
  const parts = Array.isArray(results) ? results : [];
  const partsFoundCount = parts.length;
  let totalEstimatedValue = 0;
  let highValueCount = 0;

  for (const p of parts) {
    const avg = parseFloat(p.avgPrice) || 0;
    const sold = parseInt(p.soldCount) || 0;
    totalEstimatedValue += avg;
    if (avg >= 150 && sold >= 3) highValueCount++;
  }

  return {
    total_estimated_value: Math.round(totalEstimatedValue * 100) / 100,
    parts_found_count: partsFoundCount,
    high_value_count: highValueCount,
  };
}

/**
 * GET /opportunities/research
 * Returns all sky_watch_research rows with custom sort order.
 */
router.get('/research', async (req, res) => {
  try {
    const { status } = req.query;
    let query = database('sky_watch_research').select('*');

    if (status) {
      query = query.where('status', status);
    }

    query = query.orderByRaw(`
      CASE status
        WHEN 'new' THEN 0
        WHEN 'reviewed' THEN 1
        WHEN 'marked' THEN 2
        WHEN 'dismissed' THEN 3
        ELSE 4
      END ASC,
      created_at DESC
    `);

    const rows = await query;
    res.json({ success: true, total: rows.length, research: rows });
  } catch (err) {
    console.error('Error fetching sky watch research:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /opportunities/research
 * Upsert a sky watch research entry.
 */
router.post('/research', async (req, res) => {
  try {
    const { vehicle_year, vehicle_make, vehicle_model, vehicle_engine, vehicle_trim, source, source_vin, results } = req.body;

    if (!vehicle_year || !vehicle_make || !vehicle_model || !source || !results) {
      return res.status(400).json({ success: false, error: 'vehicle_year, vehicle_make, vehicle_model, source, and results are required' });
    }

    const stats = computeResearchStats(results);

    // Auto-save rule: only save if 1+ high value parts OR 3+ total parts
    if (stats.high_value_count < 1 && stats.parts_found_count < 3) {
      return res.json({ success: true, saved: false, reason: 'too_thin', stats });
    }

    const row = {
      vehicle_year,
      vehicle_make,
      vehicle_model,
      vehicle_engine: vehicle_engine || null,
      vehicle_trim: vehicle_trim || null,
      source,
      source_vin: source_vin || null,
      results: JSON.stringify(results),
      ...stats,
      status: 'new',
      updated_at: new Date(),
    };

    // Upsert: conflict on unique(vehicle_year, vehicle_make, vehicle_model, vehicle_engine)
    const [saved] = await database('sky_watch_research')
      .insert({ ...row, created_at: new Date() })
      .onConflict(['vehicle_year', 'vehicle_make', 'vehicle_model', 'vehicle_engine'])
      .merge({
        ...row,
      })
      .returning('*');

    res.json({ success: true, saved: true, research: saved });
  } catch (err) {
    console.error('Error saving sky watch research:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /opportunities/research/:id/mark
 * Mark a single part from the research into the_mark table.
 */
router.post('/research/:id/mark', async (req, res) => {
  try {
    const { id } = req.params;
    const { partType, title, avgPrice } = req.body;

    if (!partType) return res.status(400).json({ success: false, error: 'partType required' });

    const research = await database('sky_watch_research').where('id', id).first();
    if (!research) return res.status(404).json({ success: false, error: 'research not found' });

    const normalizedTitle = normalizeTitle(`${research.vehicle_year} ${research.vehicle_make} ${research.vehicle_model} ${partType}`);
    const originalTitle = `${research.vehicle_year} ${research.vehicle_make} ${research.vehicle_model} ${partType} — avg $${avgPrice || 0}`;

    const vehicle = extractMarkVehicleWithFallback(title || originalTitle, {
      year: research.vehicle_year,
      make: research.vehicle_make,
      model: research.vehicle_model,
    });

    await database('the_mark')
      .insert({
        normalizedTitle,
        originalTitle: title || originalTitle,
        partType,
        medianPrice: Math.round(parseFloat(avgPrice) || 0),
        sourceSignal: 'sky_watch',
        source: 'SKY',
        year_start: vehicle.year_start,
        year_end: vehicle.year_end,
        make: vehicle.make,
        model: vehicle.model,
        needs_review: vehicle.needs_review,
        markedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .onConflict('normalizedTitle')
      .merge({
        medianPrice: Math.round(parseFloat(avgPrice) || 0),
        year_start: vehicle.year_start,
        year_end: vehicle.year_end,
        make: vehicle.make,
        model: vehicle.model,
        needs_review: vehicle.needs_review,
        updatedAt: new Date(),
      });

    await database('sky_watch_research').where('id', id).update({ status: 'marked', updated_at: new Date() });

    res.json({ success: true, marked: normalizedTitle });
  } catch (err) {
    console.error('Error marking from sky watch research:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /opportunities/research/:id/mark-all-high
 * Mark all high-value parts from research results at once.
 */
router.post('/research/:id/mark-all-high', async (req, res) => {
  try {
    const { id } = req.params;
    const research = await database('sky_watch_research').where('id', id).first();
    if (!research) return res.status(404).json({ success: false, error: 'research not found' });

    const results = typeof research.results === 'string' ? JSON.parse(research.results) : research.results;
    const parts = Array.isArray(results) ? results : [];

    const highValueParts = parts.filter(p => {
      const avg = parseFloat(p.avgPrice) || 0;
      const sold = parseInt(p.soldCount) || 0;
      return avg >= 150 && sold >= 3;
    });

    if (highValueParts.length === 0) {
      return res.json({ success: true, marked: 0, message: 'no high-value parts found' });
    }

    const marked = [];
    for (const p of highValueParts) {
      const partType = p.partType || p.name || 'Unknown';
      const avgPrice = parseFloat(p.avgPrice) || 0;
      const normalizedTitle = normalizeTitle(`${research.vehicle_year} ${research.vehicle_make} ${research.vehicle_model} ${partType}`);
      const originalTitle = `${research.vehicle_year} ${research.vehicle_make} ${research.vehicle_model} ${partType} — avg $${avgPrice}`;

      const vehicle = extractMarkVehicleWithFallback(originalTitle, {
        year: research.vehicle_year,
        make: research.vehicle_make,
        model: research.vehicle_model,
      });

      await database('the_mark')
        .insert({
          normalizedTitle,
          originalTitle,
          partType,
          medianPrice: Math.round(avgPrice),
          sourceSignal: 'sky_watch',
          source: 'SKY',
          year_start: vehicle.year_start,
          year_end: vehicle.year_end,
          make: vehicle.make,
          model: vehicle.model,
          needs_review: vehicle.needs_review,
          markedAt: new Date(),
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        .onConflict('normalizedTitle')
        .merge({
          medianPrice: Math.round(avgPrice),
          year_start: vehicle.year_start,
          year_end: vehicle.year_end,
          make: vehicle.make,
          model: vehicle.model,
          needs_review: vehicle.needs_review,
          updatedAt: new Date(),
        });

      marked.push(normalizedTitle);
    }

    await database('sky_watch_research').where('id', id).update({ status: 'marked', updated_at: new Date() });

    res.json({ success: true, marked: marked.length, titles: marked });
  } catch (err) {
    console.error('Error marking all high-value from sky watch research:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /opportunities/research/:id/review
 * Set status to reviewed.
 */
router.post('/research/:id/review', async (req, res) => {
  try {
    const { id } = req.params;
    const updated = await database('sky_watch_research')
      .where('id', id)
      .update({ status: 'reviewed', reviewed_at: new Date(), updated_at: new Date() });

    if (!updated) return res.status(404).json({ success: false, error: 'research not found' });
    res.json({ success: true, status: 'reviewed' });
  } catch (err) {
    console.error('Error reviewing sky watch research:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /opportunities/research/:id/dismiss
 * Set status to dismissed.
 */
router.post('/research/:id/dismiss', async (req, res) => {
  try {
    const { id } = req.params;
    const updated = await database('sky_watch_research')
      .where('id', id)
      .update({ status: 'dismissed', updated_at: new Date() });

    if (!updated) return res.status(404).json({ success: false, error: 'research not found' });
    res.json({ success: true, status: 'dismissed' });
  } catch (err) {
    console.error('Error dismissing sky watch research:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * DELETE /opportunities/research/:id
 * Hard delete a research entry.
 */
router.delete('/research/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const deleted = await database('sky_watch_research').where('id', id).del();

    if (!deleted) return res.status(404).json({ success: false, error: 'research not found' });
    res.json({ success: true, deleted: true });
  } catch (err) {
    console.error('Error deleting sky watch research:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
