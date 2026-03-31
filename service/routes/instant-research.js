'use strict';

const router = require('express-promise-router')();
const { log } = require('../lib/logger');
const { database } = require('../database/database');
const InstantResearchService = require('../services/InstantResearchService');

/**
 * GET /api/instant-research?vehicle=2011+Toyota+Sequoia+5.7L
 * OR: ?year=2011&make=Toyota&model=Sequoia&engine=5.7L
 *
 * Database-only enrichment (no live scraping). Uses:
 * - Auto+AIC+Item for part discovery
 * - YourSale for demand history
 * - YourListing for current stock
 * - market_demand_cache for market pricing
 * - the_mark for marked parts
 */
router.get('/', async (req, res) => {
  let year, make, model, engine;

  // Support both formats: ?vehicle=string and ?year=&make=&model=
  if (req.query.vehicle) {
    const m = req.query.vehicle.match(/^(\d{4})\s+(\S+)\s+(.+?)(?:\s+(\d+\.\d+L?.*))?$/);
    if (!m) return res.status(400).json({ error: 'Format: YEAR MAKE MODEL [ENGINE]' });
    year = parseInt(m[1]); make = m[2]; model = m[3].trim(); engine = m[4] || null;
  } else {
    year = parseInt(req.query.year);
    make = req.query.make;
    model = req.query.model;
    engine = req.query.engine || null;
  }

  if (!year || !make || !model) {
    return res.status(400).json({ error: 'year, make, model required' });
  }

  try {
    const service = new InstantResearchService();
    const result = await service.researchVehicle({
      year, make, model, engine,
      drivetrain: req.query.drivetrain || null,
      refresh: req.query.refresh === 'true',
    });

    res.json({
      success: true,
      vehicle: `${year} ${make} ${model}${engine ? ' ' + engine : ''}`,
      ...result,
    });
  } catch (err) {
    log.error({ err }, '[InstantResearch] Research failed');
    res.status(500).json({ success: false, error: err.message });
  }
});

// Alias for explicit no-scrape (same behavior — all database-only now)
router.get('/quick', async (req, res) => {
  req.query.vehicle = req.query.vehicle || `${req.query.year} ${req.query.make} ${req.query.model}${req.query.engine ? ' ' + req.query.engine : ''}`;
  return router.handle(req, res);
});

/**
 * POST /api/instant-research/apify
 * Apify-powered eBay research — scrapes sold items for a vehicle.
 * Body: { year, make, model, engine?, trim?, source: 'VIN'|'STANDALONE', vin? }
 * Returns structured results with value scoring per part type.
 * Enriches market_demand_cache + saves to sky_watch_research + caches in instant_research_cache.
 */
router.post('/apify', async (req, res) => {
  const { year, make, model, engine, trim, source, vin } = req.body;
  if (!year || !make || !model) {
    return res.status(400).json({ success: false, error: 'year, make, model required' });
  }

  try {
    const ApifyResearchService = require('../services/ApifyResearchService');
    const apify = new ApifyResearchService();
    const result = await apify.researchVehicle(
      { year: parseInt(year), make, model, engine: engine || null, trim: trim || null },
      { source: source || 'STANDALONE', vin: vin || null }
    );
    res.json({ success: true, ...result });
  } catch (err) {
    if (err.message.includes('already running')) {
      return res.status(429).json({ success: false, error: err.message });
    }
    log.error({ err }, '[ApifyResearch] Research failed');
    res.status(500).json({ success: false, error: err.message });
  }
});

// Dropdown data for vehicle selection
router.get('/years', async (req, res) => {
  try {
    const r = await database.raw('SELECT DISTINCT year FROM "Auto" WHERE year >= 1995 ORDER BY year DESC');
    res.json((r.rows || r).map(r => r.year));
  } catch (e) { res.json([]); }
});

router.get('/makes', async (req, res) => {
  try {
    const r = await database.raw('SELECT DISTINCT make FROM "Auto" WHERE year = ? ORDER BY make', [req.query.year]);
    res.json((r.rows || r).map(r => r.make));
  } catch (e) { res.json([]); }
});

router.get('/models', async (req, res) => {
  try {
    const r = await database.raw('SELECT DISTINCT model FROM "Auto" WHERE year = ? AND LOWER(make) = LOWER(?) ORDER BY model', [req.query.year, req.query.make]);
    res.json((r.rows || r).map(r => r.model));
  } catch (e) { res.json([]); }
});

router.get('/engines', async (req, res) => {
  try {
    const r = await database.raw('SELECT DISTINCT engine FROM "Auto" WHERE year = ? AND LOWER(make) = LOWER(?) AND LOWER(model) = LOWER(?) AND engine IS NOT NULL ORDER BY engine', [req.query.year, req.query.make, req.query.model]);
    res.json((r.rows || r).map(r => r.engine));
  } catch (e) { res.json([]); }
});

module.exports = router;
