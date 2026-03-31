'use strict';

const router = require('express-promise-router')();
const FlywayService = require('../services/FlywayService');
const AttackListService = require('../services/AttackListService');
const DeadInventoryService = require('../services/DeadInventoryService');
const { database } = require('../database/database');
const { log } = require('../lib/logger');

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
    const { name, start_date, end_date, notes, yard_ids, trip_type } = req.body;
    if (!name || !start_date || !end_date) {
      return res.status(400).json({ success: false, error: 'name, start_date, end_date required' });
    }
    const trip = await FlywayService.createTrip({ name, start_date, end_date, notes, yard_ids, trip_type });
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

// Reinstate a completed trip (within 24-hour grace period)
router.post('/trips/:id/reinstate', async (req, res) => {
  try {
    const trip = await FlywayService.getTrip(req.params.id);
    if (!trip) return res.status(404).json({ success: false, error: 'Trip not found' });

    if (trip.status !== 'complete') {
      return res.status(400).json({ success: false, error: 'Only completed trips can be reinstated' });
    }

    if (trip.completed_at) {
      const hoursSinceComplete = (Date.now() - new Date(trip.completed_at).getTime()) / (1000 * 60 * 60);
      if (hoursSinceComplete > 24) {
        return res.status(400).json({ success: false, error: 'Grace period expired. Trip was completed over 24 hours ago.' });
      }
    } else {
      return res.status(400).json({ success: false, error: 'Trip has no completion timestamp. Cannot reinstate.' });
    }

    const updated = await FlywayService.updateTrip(req.params.id, { status: 'active' });
    res.json({ success: true, ...updated });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Dry-run preview: show what cleanup would deactivate
router.get('/cleanup-preview', async (req, res) => {
  try {
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const expiredTrips = await database('flyway_trip')
      .where('status', 'complete')
      .whereNotNull('completed_at')
      .where('completed_at', '<', cutoff)
      .where(function() {
        this.whereNull('cleaned_up').orWhere('cleaned_up', false);
      })
      .select('id', 'name', 'completed_at');

    const coreYardIds = await FlywayService.getCoreYardIds();

    const activeYardIds = await database('flyway_trip_yard')
      .join('flyway_trip', 'flyway_trip.id', 'flyway_trip_yard.trip_id')
      .where('flyway_trip.status', 'active')
      .select('flyway_trip_yard.yard_id')
      .then(rows => rows.map(r => r.yard_id));

    const protectedYardIds = new Set([...coreYardIds, ...activeYardIds]);

    const preview = [];
    for (const trip of expiredTrips) {
      const tripYardIds = await database('flyway_trip_yard')
        .where('trip_id', trip.id)
        .select('yard_id')
        .then(rows => rows.map(r => r.yard_id));

      const yardsToClean = tripYardIds.filter(id => !protectedYardIds.has(id));

      let vehicleCount = 0;
      if (yardsToClean.length > 0) {
        const result = await database('yard_vehicle')
          .whereIn('yard_id', yardsToClean)
          .where('active', true)
          .count('id as count')
          .first();
        vehicleCount = parseInt(result.count);
      }

      const yardNames = await database('yard')
        .whereIn('id', yardsToClean)
        .select('id', 'name', 'chain');

      preview.push({
        trip: trip.name,
        completed_at: trip.completed_at,
        yardsToClean: yardNames,
        yardsProtected: tripYardIds.filter(id => protectedYardIds.has(id)).length,
        vehiclesToDeactivate: vehicleCount,
      });
    }

    res.json({
      coreYardIds,
      activeYardIdsProtected: [...new Set(activeYardIds)],
      trips: preview,
    });
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

// Load parts for a single vehicle on-demand (matches Daily Feed expand behavior)
router.get('/vehicle/:vehicleId/parts', async (req, res) => {
  try {
    const { vehicleId } = req.params;
    const service = new AttackListService();

    const vehicle = await database('yard_vehicle').where('id', vehicleId).first();
    if (!vehicle) return res.status(404).json({ success: false, error: 'Vehicle not found' });

    const inventoryIndex = await service.buildInventoryIndex();
    const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
    const salesIndex = await service.buildSalesIndex(cutoff);
    const { byMakeModel: stockIndex, byPartNumber: stockPartNumbers } = await service.buildStockIndex();
    const platformIndex = await service.buildPlatformIndex();

    // Enrich with reference transmission if NHTSA didn't provide one
    if (!vehicle.decoded_transmission && vehicle.year && vehicle.make && vehicle.model) {
      try {
        const TrimTierService = require('../services/TrimTierService');
        const trimName = vehicle.decoded_trim || vehicle.trim_level || vehicle.trim || null;
        const engine = vehicle.decoded_engine || vehicle.engine || null;
        const refResult = await TrimTierService.lookup(
          parseInt(vehicle.year) || 0,
          vehicle.make, vehicle.model, trimName, engine,
          null, vehicle.decoded_drivetrain || vehicle.drivetrain || null
        );
        if (refResult && refResult.transmission) {
          vehicle.decoded_transmission = refResult.transmission;
        }
      } catch (e) { /* reference lookup optional */ }
    }

    const scored = service.scoreVehicle(vehicle, inventoryIndex, salesIndex, stockIndex, platformIndex, stockPartNumbers);

    // Enrich with dead inventory warnings
    const deadService = new DeadInventoryService();
    for (const part of (scored.parts || [])) {
      if (part.partNumber) {
        try {
          const warning = await deadService.getWarning(part.partNumber);
          if (warning) part.deadWarning = warning;
        } catch (e) { /* ignore */ }
      }
    }

    // Enrich with cached market data — same as Daily Feed
    try {
      const { getCachedPrice, buildSearchQuery: buildMktQuery } = require('../services/MarketPricingService');
      const vYear = parseInt(vehicle.year) || 0;
      for (const p of (scored.parts || [])) {
        const sq = buildMktQuery({
          title: p.title || '',
          make: scored.make || vehicle.make,
          model: scored.model || vehicle.model,
          year: vYear,
          partType: p.partType,
        });
        const cached = await getCachedPrice(sq.cacheKey);
        if (cached) {
          p.marketMedian = cached.median;
          p.marketCount = cached.count;
          p.marketVelocity = cached.velocity;
          p.marketCheckedAt = cached.checkedAt;
        }
      }
    } catch (e) {
      log.warn({ err: e.message }, 'Flyway market enrichment failed');
    }

    res.json({
      success: true,
      id: vehicleId,
      parts: scored.parts || [],
      rebuild_parts: scored.rebuild_parts || null,
      platform_siblings: scored.platform_siblings || null,
    });
  } catch (err) {
    log.error({ err }, 'Error loading flyway vehicle parts');
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

// Trigger manual scrape for all yards in a trip (non-LKQ only)
router.post('/trips/:id/scrape', async (req, res) => {
  try {
    const trip = await FlywayService.getTrip(req.params.id);
    if (!trip) return res.status(404).json({ success: false, error: 'Trip not found' });
    if (trip.status !== 'active') return res.status(400).json({ success: false, error: 'Trip must be active to scrape' });

    const FlywayScrapeRunner = require('../lib/FlywayScrapeRunner');
    const runner = new FlywayScrapeRunner();
    runner.work().catch(err => console.error('[Flyway] Manual scrape error:', err.message));

    res.json({
      success: true,
      message: 'Flyway scrape started in background. Non-LKQ yards will be scraped. Refresh in a few minutes.',
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Get scrape status for a trip's yards
router.get('/trips/:id/scrape-status', async (req, res) => {
  try {
    const trip = await FlywayService.getTrip(req.params.id);
    if (!trip) return res.status(404).json({ success: false, error: 'Trip not found' });

    const yardIds = trip.yards.map(y => y.id);
    const yards = await database('yard')
      .whereIn('id', yardIds)
      .select('id', 'name', 'chain', 'scrape_method', 'last_scraped');

    const counts = await database('yard_vehicle')
      .whereIn('yard_id', yardIds)
      .where('active', true)
      .groupBy('yard_id')
      .select('yard_id')
      .count('id as vehicle_count');

    const countMap = {};
    counts.forEach(c => { countMap[c.yard_id] = parseInt(c.vehicle_count); });

    const status = yards.map(y => ({
      id: y.id,
      name: y.name,
      chain: y.chain,
      scrape_method: y.scrape_method,
      last_scraped: y.last_scraped,
      vehicle_count: countMap[y.id] || 0,
      scrape_type: (y.scrape_method || '').toLowerCase() === 'lkq' ? 'local' :
                   (y.scrape_method || '').toLowerCase() === 'manual' || (y.scrape_method || '').toLowerCase() === 'none' ? 'manual' : 'server',
      needs_scrape: !y.last_scraped || (Date.now() - new Date(y.last_scraped).getTime()) > 24 * 60 * 60 * 1000,
    }));

    res.json({ success: true, status });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
