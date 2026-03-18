'use strict';

const { log } = require('../lib/logger');
const router = require('express-promise-router')();
const AttackListService = require('../services/AttackListService');
const DeadInventoryService = require('../services/DeadInventoryService');
const { database } = require('../database/database');

/**
 * GET /attack-list
 * Get attack list across all yards — sorted by opportunity
 */
router.get('/', async (req, res) => {
  try {
    const { days = 90, activeOnly } = req.query;
    const service = new AttackListService();
    const results = await service.getAllYardsAttackList({
      daysBack: parseInt(days),
      activeOnly: activeOnly === 'true',
    });

    // Enrich with dead inventory warnings (best effort, non-blocking)
    const deadService = new DeadInventoryService();
    for (const yard of results) {
      for (const vehicle of (yard.vehicles || [])) {
        for (const part of (vehicle.parts || [])) {
          if (part.partNumber) {
            try {
              const warning = await deadService.getWarning(part.partNumber);
              if (warning) part.deadWarning = warning;
            } catch (e) { /* ignore */ }
          }
        }
      }
    }

    res.json({
      success: true,
      generated_at: new Date().toISOString(),
      yards: results,
    });
  } catch (err) {
    log.error({ err }, 'Error generating attack list');
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /attack-list/yard/:yardId
 * Get full attack list for a specific yard
 */
router.get('/yard/:yardId', async (req, res) => {
  try {
    const { yardId } = req.params;
    const { days = 90, limit = 100 } = req.query;

    const yard = await database('yard').where('id', yardId).first();
    if (!yard) return res.status(404).json({ error: 'Yard not found' });

    const service = new AttackListService();
    const list = await service.getAttackList(yardId, { 
      daysBack: parseInt(days),
      limit: parseInt(limit),
    });

    res.json({
      success: true,
      yard: {
        id: yard.id,
        name: yard.name,
        chain: yard.chain,
        distance_from_base: yard.distance_from_base,
        last_scraped: yard.last_scraped,
      },
      ...list,
    });
  } catch (err) {
    log.error({ err }, 'Error generating yard attack list');
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /attack-list/summary
 * Quick summary — which yards have the most opportunity today
 */
router.get('/summary', async (req, res) => {
  try {
    const service = new AttackListService();
    const results = await service.getAllYardsAttackList({ daysBack: 90 });

    const summary = results.map(r => ({
      yard: r.yard.name,
      distance: r.yard.distance_from_base,
      vehicles_on_lot: r.total_vehicles,
      hot_vehicles: r.hot_vehicles,
      top_score: r.top_score,
      est_value: r.est_total_value,
      last_scraped: r.yard.last_scraped,
      visit_priority: r.top_score >= 70 ? '🔴 GO TODAY' : r.top_score >= 45 ? '🟡 CONSIDER' : '⬜ SKIP',
    }));

    res.json({ success: true, summary, generated_at: new Date().toISOString() });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /attack-list/log-pull
 * Log a part as pulled. Auto-creates pull_session if needed.
 * Body: { vehicleId, itemId, yardId? }
 */
router.post('/log-pull', async (req, res) => {
  try {
    const { vehicleId, itemId } = req.body;

    // Find the yard for this vehicle
    let yardId = req.body.yardId;
    if (!yardId && vehicleId) {
      try {
        const vehicle = await database('yard_vehicle').where('id', vehicleId).first();
        if (vehicle) yardId = vehicle.yard_id;
      } catch (e) { /* ignore */ }
    }

    // Auto-create or find today's pull session for this yard
    let sessionId = null;
    if (yardId) {
      try {
        const today = new Date().toISOString().slice(0, 10);
        let session = await database('pull_session')
          .where('yard_id', yardId)
          .where('date', today)
          .first();

        if (!session) {
          const { v4: uuidv4 } = require('uuid');
          const inserted = await database('pull_session').insert({
            id: uuidv4(),
            yard_id: yardId,
            date: today,
            createdAt: new Date(),
            updatedAt: new Date(),
          }).returning('id');
          sessionId = inserted[0]?.id || inserted[0];
        } else {
          sessionId = session.id;
        }
      } catch (e) {
        log.warn({ err: e.message }, 'pull_session create failed');
      }
    }

    res.json({ success: true, sessionId });
  } catch (err) {
    log.error({ err }, 'Error logging pull');
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /attack-list/visit-feedback
 * Log yard visit feedback after a session.
 * Body: { yardId, rating (1-5), notes?, pullerName? }
 */
router.post('/visit-feedback', async (req, res) => {
  try {
    const { yardId, rating, notes, pullerName } = req.body;
    if (!yardId || !rating) return res.status(400).json({ error: 'yardId and rating required' });

    const { v4: uuidv4 } = require('uuid');
    await database('yard_visit_feedback').insert({
      id: uuidv4(),
      yard_id: yardId,
      puller_name: pullerName || null,
      visit_date: new Date().toISOString().slice(0, 10),
      rating: parseInt(rating),
      notes: notes || null,
      createdAt: new Date(),
    });

    res.json({ success: true });
  } catch (err) {
    log.error({ err }, 'Error saving visit feedback');
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /attack-list/last-visit/:yardId
 * Get most recent visit feedback for a yard.
 */
router.get('/last-visit/:yardId', async (req, res) => {
  try {
    const { yardId } = req.params;
    const visit = await database('yard_visit_feedback')
      .where('yard_id', yardId)
      .orderBy('visit_date', 'desc')
      .first();

    if (!visit) return res.json({ success: true, found: false });

    const daysAgo = Math.floor((Date.now() - new Date(visit.visit_date).getTime()) / 86400000);
    res.json({
      success: true,
      found: true,
      visit: {
        daysAgo,
        rating: visit.rating,
        notes: visit.notes,
        pullerName: visit.puller_name,
        date: visit.visit_date,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
