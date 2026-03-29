'use strict';

const router = require('express-promise-router')();
const FlywayService = require('../services/FlywayService');
const { database } = require('../database/database');

// List trips (optional ?status=active|planning|complete)
router.get('/trips', async (req, res) => {
  try {
    const trips = await FlywayService.getTrips(req.query.status || null);
    res.json({ success: true, trips });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Get single trip with yards
router.get('/trips/:id', async (req, res) => {
  try {
    const trip = await FlywayService.getTrip(req.params.id);
    if (!trip) return res.status(404).json({ success: false, error: 'Trip not found' });
    res.json({ success: true, ...trip });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Create trip
router.post('/trips', async (req, res) => {
  try {
    const { name, start_date, end_date, notes, yard_ids } = req.body;
    if (!name || !start_date || !end_date) {
      return res.status(400).json({ success: false, error: 'name, start_date, end_date required' });
    }
    const trip = await FlywayService.createTrip({ name, start_date, end_date, notes, yard_ids });
    res.status(201).json({ success: true, ...trip });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Update trip (status, name, dates, notes)
router.patch('/trips/:id', async (req, res) => {
  try {
    const trip = await FlywayService.updateTrip(req.params.id, req.body);
    res.json({ success: true, ...trip });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// Delete trip
router.delete('/trips/:id', async (req, res) => {
  try {
    await FlywayService.deleteTrip(req.params.id);
    res.json({ success: true, deleted: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Add yard to trip
router.post('/trips/:id/yards', async (req, res) => {
  try {
    const { yard_id } = req.body;
    const trip = await FlywayService.addYardToTrip(req.params.id, yard_id);
    res.json({ success: true, ...trip });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Remove yard from trip
router.delete('/trips/:tripId/yards/:yardId', async (req, res) => {
  try {
    const trip = await FlywayService.removeYardFromTrip(req.params.tripId, req.params.yardId);
    res.json({ success: true, ...trip });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Get Flyway attack list for a trip
router.get('/trips/:id/attack-list', async (req, res) => {
  try {
    const result = await FlywayService.getFlywayAttackList(req.params.id);
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Get active scrapable yards (for scraper consumption)
router.get('/active-yards', async (req, res) => {
  try {
    const yards = await FlywayService.getActiveScrapableYards();
    res.json(yards);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Get all yards available for trip selection
router.get('/available-yards', async (req, res) => {
  try {
    const yards = await database('yard')
      .orderBy('distance_from_base', 'asc')
      .select('id', 'name', 'chain', 'address', 'distance_from_base',
              'scrape_url', 'scrape_method', 'last_scraped', 'flagged', 'flag_reason');
    res.json({ success: true, yards });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
