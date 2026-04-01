'use strict';

const { log } = require('../lib/logger');
const router = require('express-promise-router')();
const LKQScraper = require('../scrapers/LKQScraper');
const { database } = require('../database/database');
const { enrichYard } = require('../services/PostScrapeService');

// In-memory scrape status tracking
let scrapeStatus = { running: false, started_at: null, finished_at: null, error: null };

/**
 * Yard Routes
 * 
 * GET  /yards              - List all yards
 * GET  /yards/:id/vehicles - Get vehicles at a yard
 * POST /yards/scrape/lkq   - Trigger LKQ scrape for all NC locations (manual trigger)
 * POST /yards/scrape/:id   - Trigger scrape for a specific yard
 */

// Simple test endpoint
router.get('/ping', async (req, res) => {
  res.json({ ok: true, time: new Date().toISOString() });
});

// List all yards
router.get('/', async (req, res) => {
  try {
    const yards = await database('yard')
      .orderBy('flagged', 'asc')
      .orderBy('visit_frequency', 'asc')
      .orderBy('distance_from_base', 'asc');
    res.json(yards);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get vehicles at a specific yard
router.get('/:id/vehicles', async (req, res) => {
  const { id } = req.params;
  const { make, model, year, active = 'true' } = req.query;

  let query = database('yard_vehicle').where('yard_id', id);

  if (active === 'true') query = query.where('active', true);
  if (year) query = query.where('year', year);
  if (make) query = query.whereIlike('make', `%${make}%`);
  if (model) query = query.whereIlike('model', `%${model}%`);

  const vehicles = await query
    .orderBy('date_added', 'desc')
    .orderBy('make', 'asc')
    .orderBy('model', 'asc');

  res.json(vehicles);
});

// Trigger LKQ scrape for all NC locations
router.post('/scrape/lkq', async (req, res) => {
  if (scrapeStatus.running) {
    return res.json({ message: 'Scrape already in progress', already_running: true, started_at: scrapeStatus.started_at });
  }

  log.info('Manual LKQ scrape triggered');
  scrapeStatus = { running: true, started_at: new Date().toISOString(), finished_at: null, error: null };

  // Run async - don't wait for it to finish
  const scraper = new LKQScraper();
  scraper.scrapeAll()
    .then(() => {
      scrapeStatus.running = false;
      scrapeStatus.finished_at = new Date().toISOString();
    })
    .catch(err => {
      log.error({ err }, 'LKQ scrape failed');
      scrapeStatus.running = false;
      scrapeStatus.finished_at = new Date().toISOString();
      scrapeStatus.error = err.message;
    });

  res.json({
    message: 'LKQ scrape started for all 4 NC locations',
    locations: ['LKQ Raleigh', 'LKQ Durham', 'LKQ Greensboro', 'LKQ East NC']
  });
});

// Get current scrape status (for polling)
router.get('/scrape/status', async (req, res) => {
  res.json(scrapeStatus);
});

// Trigger scrape for a specific yard by ID
router.post('/scrape/:id', async (req, res) => {
  const { id } = req.params;
  
  const yard = await database('yard').where('id', id).first();
  if (!yard) {
    return res.status(404).json({ error: 'Yard not found' });
  }

  if (yard.scrape_method === 'none') {
    return res.status(400).json({ error: 'This yard does not support scraping' });
  }

  log.info({ yard: yard.name }, `Manual scrape triggered for ${yard.name}`);

  // Helper: run scraper then enrichment pipeline in background
  async function scrapeAndEnrich(scrapePromise) {
    try {
      await scrapePromise;
    } catch (err) {
      log.error({ err }, `Scrape failed for ${yard.name}`);
    }
    try {
      const enrichStats = await enrichYard(yard.id);
      log.info({ yard: yard.name, ...enrichStats }, `Post-scrape enrichment complete for ${yard.name}`);
    } catch (err) {
      log.error({ err: err.message }, `Post-scrape enrichment failed for ${yard.name}`);
    }
  }

  if (yard.chain === 'LKQ') {
    const scraper = new LKQScraper();
    const location = scraper.locations.find(l => l.name === yard.name);
    if (location) {
      scrapeAndEnrich(scraper.scrapeLocation(location));
    }
  } else if (yard.chain === 'Foss') {
    const FossScraper = require('../scrapers/FossScraper');
    const scraper = new FossScraper();
    const location = scraper.locations.find(l => l.name === yard.name);
    if (location) {
      scrapeAndEnrich(scraper.scrapeLocation(location));
    }
  } else if (yard.chain === 'Pull-A-Part') {
    const PullAPartScraper = require('../scrapers/PullAPartScraper');
    const scraper = new PullAPartScraper();
    scrapeAndEnrich(scraper.scrapeYard(yard));
  } else if (yard.chain === 'Carolina PNP') {
    const CarolinaPickNPullScraper = require('../scrapers/CarolinaPickNPullScraper');
    const scraper = new CarolinaPickNPullScraper();
    scrapeAndEnrich(scraper.scrapeYard(yard));
  } else if (yard.chain === 'upullandsave') {
    const UPullAndSaveScraper = require('../scrapers/UPullAndSaveScraper');
    const scraper = new UPullAndSaveScraper();
    scrapeAndEnrich(scraper.scrapeYard(yard));
  } else if (yard.chain === 'chesterfield') {
    const ChesterfieldScraper = require('../scrapers/ChesterfieldScraper');
    const scraper = new ChesterfieldScraper();
    scrapeAndEnrich(scraper.scrapeYard(yard));
  } else if (yard.chain === 'pickapartva') {
    const PickAPartVAScraper = require('../scrapers/PickAPartVAScraper');
    const scraper = new PickAPartVAScraper();
    scrapeAndEnrich(scraper.scrapeYard(yard));
  }

  res.json({ message: `Scrape + enrichment started for ${yard.name}` });
});

// Get scrape status / last scrape info for all yards
router.get('/status', async (req, res) => {
  try {
    const yards = await database('yard')
      .select('id', 'name', 'chain', 'scrape_method', 'last_scraped', 'visit_frequency', 'flagged', 'flag_reason')
      .orderBy('visit_frequency', 'asc')
      .orderBy('distance_from_base', 'asc');

    // Get vehicle counts per yard
    const counts = await database('yard_vehicle')
      .where('active', true)
      .groupBy('yard_id')
      .select('yard_id')
      .count('* as vehicle_count');

    const countMap = {};
    counts.forEach(c => { countMap[c.yard_id] = parseInt(c.vehicle_count); });

    const result = yards.map(y => ({
      ...y,
      vehicle_count: countMap[y.id] || 0,
    }));

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message, stack: err.stack });
  }
});

// Scrape health dashboard
router.get('/scrape-health', async (req, res) => {
  try {
    const yards = await database('yard')
      .where('enabled', true)
      .where(function() { this.where('flagged', false).orWhereNull('flagged'); })
      .select('id', 'name', 'chain', 'last_scraped')
      .orderBy('name');

    const yardIds = yards.map(y => y.id);

    // Vehicle stats per yard
    const stats = await database('yard_vehicle')
      .whereIn('yard_id', yardIds)
      .where('active', true)
      .groupBy('yard_id')
      .select('yard_id')
      .count('* as total_active')
      .max('date_added as newest_date_added')
      .max({ newest_created_at: 'createdAt' });

    const statsMap = {};
    stats.forEach(s => { statsMap[s.yard_id] = s; });

    // New vehicles per yard from last scrape (within 1hr window of last_scraped)
    const newCounts = await Promise.all(yards.map(async (y) => {
      if (!y.last_scraped) return { yard_id: y.id, new_vehicles_last_scrape: 0 };
      const window = new Date(new Date(y.last_scraped).getTime() - 60 * 60 * 1000);
      const count = await database('yard_vehicle')
        .where('yard_id', y.id)
        .where('createdAt', '>=', window)
        .where('createdAt', '<=', y.last_scraped)
        .count('* as cnt')
        .first();
      return { yard_id: y.id, new_vehicles_last_scrape: parseInt(count.cnt) || 0 };
    }));
    const newMap = {};
    newCounts.forEach(n => { newMap[n.yard_id] = n.new_vehicles_last_scrape; });

    // Recent scrape_log entries (last 5 per yard)
    let logMap = {};
    try {
      const logs = await database('scrape_log')
        .whereIn('yard_id', yardIds)
        .orderBy('scraped_at', 'desc')
        .limit(yardIds.length * 5);
      for (const l of logs) {
        if (!logMap[l.yard_id]) logMap[l.yard_id] = [];
        if (logMap[l.yard_id].length < 5) logMap[l.yard_id].push(l);
      }
    } catch (e) { /* scrape_log may not exist yet */ }

    const result = yards.map(y => {
      const s = statsMap[y.id] || {};
      const hoursSince = y.last_scraped
        ? Math.round((Date.now() - new Date(y.last_scraped).getTime()) / 3600000 * 10) / 10
        : null;

      let status = 'unknown';
      if (!y.last_scraped || hoursSince > 30) status = 'critical';
      else if (hoursSince > 18) status = 'stale';
      else if ((newMap[y.id] || 0) === 0) status = 'warning';
      else status = 'healthy';

      return {
        id: y.id,
        name: y.name,
        chain: y.chain,
        last_scraped: y.last_scraped,
        hours_since_scrape: hoursSince,
        new_vehicles_last_scrape: newMap[y.id] || 0,
        total_active: parseInt(s.total_active) || 0,
        newest_date_added: s.newest_date_added,
        newest_created_at: s.newest_created_at,
        status,
        recent_logs: logMap[y.id] || [],
      };
    });

    const summary = {
      total: result.length,
      healthy: result.filter(r => r.status === 'healthy').length,
      warning: result.filter(r => r.status === 'warning').length,
      stale: result.filter(r => r.status === 'stale').length,
      critical: result.filter(r => r.status === 'critical').length,
    };

    res.json({ success: true, summary, yards: result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Log a yard visit with feedback
router.post('/:id/feedback', async (req, res) => {
  const { id } = req.params;
  const { puller_name, rating, notes } = req.body;
  const { v4: uuidv4 } = require('uuid');

  const yard = await database('yard').where('id', id).first();
  if (!yard) return res.status(404).json({ error: 'Yard not found' });

  await database('yard_visit_feedback').insert({
    id: uuidv4(),
    yard_id: id,
    puller_name,
    visit_date: new Date().toISOString().split('T')[0],
    rating,
    notes,
    createdAt: new Date(),
  });

  // Update last_visited and avg_rating on yard
  const feedbacks = await database('yard_visit_feedback')
    .where('yard_id', id)
    .whereNotNull('rating');

  const avgRating = feedbacks.reduce((sum, f) => sum + f.rating, 0) / feedbacks.length;

  await database('yard')
    .where('id', id)
    .update({ 
      last_visited: new Date(), 
      avg_rating: avgRating.toFixed(2),
      updatedAt: new Date() 
    });

  res.json({ message: 'Feedback recorded', avg_rating: avgRating.toFixed(2) });
});

module.exports = router;
