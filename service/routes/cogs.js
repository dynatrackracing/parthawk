'use strict';

const router = require('express-promise-router')();
const COGSService = require('../services/COGSService');
const { database } = require('../database/database');
const { v4: uuidv4 } = require('uuid');
const { log } = require('../lib/logger');

/**
 * POST /cogs/gate
 * Calculate max spend for gate negotiation
 * Body: { yardId, parts: [{ partType, marketValue }] }
 */
router.post('/gate', async (req, res) => {
  try {
    const { yardId, parts } = req.body;
    if (!yardId || !parts?.length) {
      return res.status(400).json({ error: 'yardId and parts required' });
    }
    const result = await COGSService.calculateGateMax(yardId, parts);
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /cogs/session
 * Record a pull session with full true COGS calculation
 */
router.post('/session', async (req, res) => {
  try {
    const { yardId, parts, totalPaid, pullerId, notes } = req.body;
    if (!yardId || !parts?.length || totalPaid === undefined) {
      return res.status(400).json({ error: 'yardId, parts, and totalPaid required' });
    }

    const calculation = await COGSService.calculateSession({ yardId, parts, totalPaid });
    const { session } = calculation;

    // Save session to database
    const sessionId = uuidv4();
    await database('pull_session').insert({
      id: sessionId,
      yard_id: yardId,
      puller_id: pullerId || null,
      date: new Date(),
      parts_cost: totalPaid,
      gate_fee: session.entryFee,
      tax_paid: 0,
      total_true_cogs: session.totalTrueCost,
      total_market_value: session.totalMarketValue,
      blended_cogs_pct: session.blendedCogsRate,
      notes: notes || null,
      createdAt: new Date(),
      updatedAt: new Date(),
    }).catch(err => {
      log.warn({ err: err.message }, 'Could not save pull session - table may not exist yet');
    });

    res.json({ success: true, sessionId, ...calculation });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /cogs/yard-profile/:yardId
 * Get yard profile with COGS reference for the gate negotiation screen
 */
router.get('/yard-profile/:yardId', async (req, res) => {
  try {
    const profile = await COGSService.getYardProfile(req.params.yardId);
    res.json({ success: true, ...profile });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /cogs/yards
 * Get all yards with their cost profiles for gate negotiation UI
 */
router.get('/yards', async (req, res) => {
  try {
    const yards = await database('yard')
      .where('enabled', true)
      .where(function() { this.where('flagged', false).orWhereNull('flagged'); })
      .select('id', 'name', 'chain', 'distance_from_base', 'entry_fee', 'visit_frequency')
      .orderBy('distance_from_base', 'asc');

    const BASE_ADDRESSES = {
      nc: 'Hillsborough, NC',
      fl: '7413 S O\'Brien St, Tampa, FL 33616',
    };

    const yardsWithCalc = yards.map(y => ({
      ...y,
      region: y.region || 'nc',
      base_address: BASE_ADDRESSES[y.region || 'nc'] || BASE_ADDRESSES.nc,
      fixed_overhead: parseFloat(y.entry_fee || 0),
    }));

    res.json({ success: true, yards: yardsWithCalc });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
