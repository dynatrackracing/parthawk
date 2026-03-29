'use strict';

const { log } = require('../lib/logger');
const router = require('express-promise-router')();
const LKQScraper = require('../scrapers/LKQScraper');
const { database } = require('../database/database');

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

  if (yard.chain === 'LKQ') {
    const scraper = new LKQScraper();
    const location = scraper.locations.find(l => l.name === yard.name);
    if (location) {
      scraper.scrapeLocation(location).catch(err => {
        log.error({ err }, `Scrape failed for ${yard.name}`);
      });
    }
  } else if (yard.chain === 'Foss') {
    const FossScraper = require('../scrapers/FossScraper');
    const scraper = new FossScraper();
    const location = scraper.locations.find(l => l.name === yard.name);
    if (location) {
      scraper.scrapeLocation(location).catch(err => {
        log.error({ err }, `Foss scrape failed for ${yard.name}`);
      });
    }
  } else if (yard.chain === 'Pull-A-Part') {
    const PullAPartScraper = require('../scrapers/PullAPartScraper');
    const scraper = new PullAPartScraper();
    scraper.scrapeYard(yard).catch(err => {
      log.error({ err }, `Pull-A-Part scrape failed for ${yard.name}`);
    });
  } else if (yard.chain === 'Carolina PNP') {
    const CarolinaPickNPullScraper = require('../scrapers/CarolinaPickNPullScraper');
    const scraper = new CarolinaPickNPullScraper();
    scraper.scrapeYard(yard).catch(err => {
      log.error({ err }, `Carolina PNP scrape failed for ${yard.name}`);
    });
  } else if (yard.chain === 'upullandsave') {
    const UPullAndSaveScraper = require('../scrapers/UPullAndSaveScraper');
    const scraper = new UPullAndSaveScraper();
    scraper.scrapeYard(yard).catch(err => {
      log.error({ err }, `U Pull & Save scrape failed for ${yard.name}`);
    });
  } else if (yard.chain === 'chesterfield') {
    const ChesterfieldScraper = require('../scrapers/ChesterfieldScraper');
    const scraper = new ChesterfieldScraper();
    scraper.scrapeYard(yard).catch(err => {
      log.error({ err }, `Chesterfield scrape failed for ${yard.name}`);
    });
  }

  res.json({ message: `Scrape started for ${yard.name}` });
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
