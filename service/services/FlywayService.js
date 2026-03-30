'use strict';

const { database } = require('../database/database');
const AttackListService = require('./AttackListService');
const { getCachedPrice, buildSearchQuery: buildMktQuery } = require('./MarketPricingService');

class FlywayService {

  // ============================================================
  // TRIP CRUD
  // ============================================================

  static async getTrips(status = null) {
    let query = database('flyway_trip').orderBy('start_date', 'desc');
    if (status) query = query.where({ status });
    const trips = await query;

    for (const trip of trips) {
      trip.yards = await database('flyway_trip_yard')
        .join('yard', 'yard.id', 'flyway_trip_yard.yard_id')
        .where('flyway_trip_yard.trip_id', trip.id)
        .select('yard.id', 'yard.name', 'yard.chain', 'yard.address',
                'yard.distance_from_base', 'yard.scrape_url', 'yard.scrape_method',
                'flyway_trip_yard.scrape_enabled', 'flyway_trip_yard.id as pivot_id');
      this.addGracePeriodInfo(trip);
    }
    return trips;
  }

  static async getTrip(id) {
    const trip = await database('flyway_trip').where({ id }).first();
    if (!trip) return null;

    trip.yards = await database('flyway_trip_yard')
      .join('yard', 'yard.id', 'flyway_trip_yard.yard_id')
      .where('flyway_trip_yard.trip_id', trip.id)
      .select('yard.id', 'yard.name', 'yard.chain', 'yard.address',
              'yard.distance_from_base', 'yard.scrape_url', 'yard.scrape_method',
              'flyway_trip_yard.scrape_enabled', 'flyway_trip_yard.id as pivot_id');
    this.addGracePeriodInfo(trip);
    return trip;
  }

  static async createTrip({ name, start_date, end_date, notes, yard_ids, trip_type }) {
    const [trip] = await database('flyway_trip')
      .insert({ name, start_date, end_date, notes, status: 'planning', trip_type: trip_type || 'road_trip' })
      .returning('*');

    if (yard_ids && yard_ids.length > 0) {
      const rows = yard_ids.map(yard_id => ({ trip_id: trip.id, yard_id }));
      await database('flyway_trip_yard').insert(rows);
    }

    return this.getTrip(trip.id);
  }

  static async updateTrip(id, updates) {
    const trip = await database('flyway_trip').where({ id }).first();
    if (!trip) throw new Error('Trip not found');

    if (updates.status === 'active') {
      const yards = await database('flyway_trip_yard').where({ trip_id: id });
      if (yards.length === 0) throw new Error('Cannot activate trip with no yards');
      // Reinstating from complete: clear completed_at
      if (trip.status === 'complete') {
        updates.completed_at = null;
      }
    }

    // Completing: stamp completed_at
    if (updates.status === 'complete' && trip.status !== 'complete') {
      updates.completed_at = new Date();
    }

    updates.updated_at = new Date();
    await database('flyway_trip').where({ id }).update(updates);
    return this.getTrip(id);
  }

  static async deleteTrip(id) {
    return database('flyway_trip').where({ id }).del();
  }

  static async addYardToTrip(tripId, yardId) {
    await database('flyway_trip_yard')
      .insert({ trip_id: tripId, yard_id: yardId })
      .onConflict(['trip_id', 'yard_id']).ignore();
    return this.getTrip(tripId);
  }

  static async removeYardFromTrip(tripId, yardId) {
    await database('flyway_trip_yard')
      .where({ trip_id: tripId, yard_id: yardId }).del();
    return this.getTrip(tripId);
  }

  // ============================================================
  // ACTIVE TRIP YARDS (for scraper consumption)
  // ============================================================

  static async getActiveScrapableYards() {
    const today = new Date().toISOString().split('T')[0];

    return database('flyway_trip_yard')
      .join('flyway_trip', 'flyway_trip.id', 'flyway_trip_yard.trip_id')
      .join('yard', 'yard.id', 'flyway_trip_yard.yard_id')
      .where('flyway_trip.status', 'active')
      .where('flyway_trip.start_date', '<=', today)
      .where('flyway_trip.end_date', '>=', today)
      .where('flyway_trip_yard.scrape_enabled', true)
      .whereNotNull('yard.scrape_url')
      .select('yard.*');
  }

  // ============================================================
  // FLYWAY ATTACK LIST (filtered + scored)
  // ============================================================

  static async getFlywayAttackList(tripId) {
    const trip = await this.getTrip(tripId);
    if (!trip) throw new Error('Trip not found');

    const yardIds = trip.yards.filter(y => y.scrape_enabled).map(y => y.id);
    if (yardIds.length === 0) return { trip, yards: [], generated_at: new Date().toISOString() };

    // Get vehicles from these yards
    const vehicles = await database('yard_vehicle')
      .whereIn('yard_id', yardIds)
      .where('active', true)
      .orderBy('date_added', 'desc');

    if (vehicles.length === 0) return { trip, yards: [], generated_at: new Date().toISOString() };

    // Build indexes using AttackListService instance
    const attackService = new AttackListService();
    const inventoryIndex = await attackService.buildInventoryIndex();
    const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
    const salesIndex = await attackService.buildSalesIndex(cutoff);
    const { byMakeModel: stockIndex, byPartNumber: stockPartNumbers } = await attackService.buildStockIndex();

    let platformIndex = {};
    try {
      platformIndex = await attackService.buildPlatformIndex();
    } catch (e) { /* platform tables may not exist */ }

    // Build mark index
    let markIndex = { byPN: new Map(), byTitle: new Set() };
    try {
      const marks = await database('the_mark').where('active', true).select('normalizedTitle', 'partNumber');
      for (const m of marks) {
        if (m.partNumber) markIndex.byPN.set(m.partNumber.toUpperCase(), true);
        if (m.normalizedTitle) markIndex.byTitle.add(m.normalizedTitle);
      }
    } catch (e) { /* the_mark may not exist */ }

    // Score floor tiered by trip distance
    const maxDistance = Math.max(...trip.yards.map(y => parseFloat(y.distance_from_base) || 0), 0);
    const SCORE_FLOOR = maxDistance >= 150 ? 1000 : 600;
    const CULT_FLOOR = Math.floor(SCORE_FLOOR * 0.5);
    const MAX_PER_YARD = 50;

    // Score all vehicles
    const allScored = [];
    for (const vehicle of vehicles) {
      try {
        const result = attackService.scoreVehicle(
          vehicle, inventoryIndex, salesIndex, stockIndex, platformIndex, stockPartNumbers, markIndex
        );

        // Market enrichment: same pipeline as Daily Feed on-demand parts
        const vYear = parseInt(vehicle.year) || 0;
        for (const p of (result.parts || [])) {
          try {
            const hasOurSales = (p.sold_90d || 0) > 0 && p.price > 0;
            const sq = buildMktQuery({
              title: p.title || '',
              make: result.make || vehicle.make,
              model: result.model || vehicle.model,
              year: vYear,
              partType: p.partType,
            });
            const cached = await getCachedPrice(sq.cacheKey);
            if (cached) {
              p.marketMedian = cached.median;
              p.marketCount = cached.count;
              p.marketVelocity = cached.velocity;
              p.marketCheckedAt = cached.checkedAt;
              // Use market median as display price when we lack our own sales
              if (!hasOurSales && cached.median > 0) {
                p.price = cached.median;
              }
            }
          } catch (e) { /* market enrichment optional */ }
        }

        // Flyway part filtering: exclude OTHER parts without proven sales
        const qualifiedParts = (result.parts || []).filter(p => {
          const pt = (p.partType || '').toUpperCase();
          if (pt && pt !== 'OTHER') return true;
          if ((p.sold_90d || 0) > 0) return true;
          if (p.isMarked) return true;
          return false;
        });
        const qualifiedValue = qualifiedParts.reduce((sum, p) => sum + (p.price || 0), 0);

        // Age decay
        const daysInYard = this.calculateDaysInYard(vehicle.date_added);
        const ageDecay = this.calculateAgeDecay(daysInYard);
        const decayedValue = Math.round(qualifiedValue * (1 - ageDecay));

        // Premium flags (includes DIESEL detection)
        const premiumFlags = this.getPremiumFlags(vehicle);

        // High-value parts: only identified types, not OTHER
        const highValueParts = qualifiedParts.filter(p => {
          const pt = (p.partType || '').toUpperCase();
          return (p.price || 0) >= 200 && pt !== 'OTHER';
        });

        allScored.push({
          ...result,
          parts: qualifiedParts,
          matched_parts: qualifiedParts.length,
          daysInYard,
          ageDecay: Math.round(ageDecay * 100),
          flywayValue: decayedValue,
          premiumFlags,
          highValueParts: highValueParts.length,
          hasHighValuePart: highValueParts.length > 0,
          isPremiumVehicle: premiumFlags.length > 0,
          _yardId: vehicle.yard_id,
          _vehicleId: vehicle.id,
          _scoreFloor: SCORE_FLOOR,
        });
      } catch (e) {
        // Skip vehicles that fail scoring
      }
    }

    // ── Two-pass filtering ──────────────────────────────────

    // Group by yard
    const byYard = {};
    for (const v of allScored) {
      if (!byYard[v._yardId]) byYard[v._yardId] = [];
      byYard[v._yardId].push(v);
    }

    // Build yard output
    const yards = [];
    for (const y of trip.yards) {
      if (!y.scrape_enabled) continue;
      const yardVehicles = byYard[y.id] || [];
      if (yardVehicles.length === 0) continue;

      // Sort by flyway value descending
      yardVehicles.sort((a, b) => (b.flywayValue || 0) - (a.flywayValue || 0));

      // Pass 1: Top vehicles above score floor OR with high-value identified parts
      const top = yardVehicles
        .filter(v => v.flywayValue >= SCORE_FLOOR || v.hasHighValuePart)
        .slice(0, MAX_PER_YARD);
      const topIds = new Set(top.map(v => v._vehicleId));

      // Pass 2: Guaranteed vehicles not already in top list
      const guaranteed = [];
      for (const v of yardVehicles) {
        if (topIds.has(v._vehicleId)) continue;
        if (v.flywayValue <= 0 && !v.hasHighValuePart) continue;

        const reason = this.getGuaranteedReason(v);
        if (reason) {
          v.isGuaranteedInclusion = true;
          v.guaranteedReason = reason;
          guaranteed.push(v);
        }
      }

      // Tag top vehicles
      for (const v of top) {
        v.isGuaranteedInclusion = false;
      }

      const combined = [...top, ...guaranteed];

      yards.push({
        yard: y,
        total_vehicles: combined.length,
        total_top: top.length,
        total_guaranteed: guaranteed.length,
        total_scored: yardVehicles.length,
        hot_vehicles: combined.filter(v => v.color_code === 'green' || v.color_code === 'yellow').length,
        est_total_value: combined.reduce((sum, v) => sum + (v.flywayValue || 0), 0),
        vehicles: combined,
      });
    }

    yards.sort((a, b) => b.est_total_value - a.est_total_value);

    return { trip, yards, generated_at: new Date().toISOString() };
  }

  // ============================================================
  // FLYWAY-SPECIFIC SCORING HELPERS
  // ============================================================

  static calculateDaysInYard(dateAdded) {
    if (!dateAdded) return 0;
    const added = new Date(dateAdded);
    return Math.floor((Date.now() - added.getTime()) / (1000 * 60 * 60 * 24));
  }

  static calculateAgeDecay(daysInYard) {
    // 0-14 days: no penalty (fresh)
    // 14-30 days: linear ramp 0% to 25%
    // 30-60 days: linear ramp 25% to 50%
    // 60-90 days: linear ramp 50% to 75%
    // 90+ days: capped at 75%
    if (daysInYard <= 14) return 0;
    if (daysInYard <= 30) return 0.25 * ((daysInYard - 14) / 16);
    if (daysInYard <= 60) return 0.25 + 0.25 * ((daysInYard - 30) / 30);
    if (daysInYard <= 90) return 0.50 + 0.25 * ((daysInYard - 60) / 30);
    return 0.75;
  }

  static getPremiumFlags(vehicle) {
    const flags = [];

    const tier = vehicle.trim_tier;
    if (tier === 'PERFORMANCE') flags.push('PERFORMANCE');
    if (tier === 'PREMIUM') flags.push('PREMIUM');

    if (vehicle.cult === true) flags.push('CULT');

    const trans = (vehicle.decoded_transmission || '').toUpperCase();
    if (trans.includes('MANUAL')) flags.push('MANUAL');
    if (trans === 'CHECK_MT') flags.push('MANUAL');

    // Diesel detection: boolean column OR engine_type field
    if (vehicle.diesel === true || (vehicle.engine_type || '').toUpperCase() === 'DIESEL') {
      flags.push('DIESEL');
    }

    const drive = (vehicle.decoded_drivetrain || vehicle.drivetrain || '').toUpperCase();
    if (drive.includes('4WD') || drive.includes('4X4')) flags.push('4WD');
    if (drive.includes('AWD')) flags.push('AWD');

    return flags;
  }

  /**
   * Determine if a vehicle qualifies for guaranteed inclusion (rare finds).
   * Returns the reason string or null if not guaranteed.
   */
  static getGuaranteedReason(v) {
    const flags = v.premiumFlags || [];
    if (flags.includes('MANUAL')) return 'MANUAL';
    if (flags.includes('DIESEL')) return 'DIESEL';
    if (flags.includes('4WD')) return '4WD';
    if (flags.includes('AWD')) return 'AWD';
    if (flags.includes('PERFORMANCE')) return 'PERFORMANCE';
    if (flags.includes('PREMIUM')) return 'PREMIUM';
    // Cult needs at least half the score floor
    if (flags.includes('CULT') && (v.flywayValue || 0) >= Math.floor((v._scoreFloor || 500) * 0.5)) return 'CULT';
    return null;
  }

  // ============================================================
  // GRACE PERIOD
  // ============================================================

  static addGracePeriodInfo(trip) {
    if (trip.status === 'complete' && trip.completed_at) {
      const hoursSinceComplete = (Date.now() - new Date(trip.completed_at).getTime()) / (1000 * 60 * 60);
      trip.gracePeriodRemaining = Math.max(0, Math.round((24 - hoursSinceComplete) * 10) / 10);
      trip.canReinstate = hoursSinceComplete <= 24;
    } else if (trip.status === 'complete') {
      trip.gracePeriodRemaining = 0;
      trip.canReinstate = false;
    }
  }

  // ============================================================
  // CLEANUP — deactivate road trip yard vehicles after grace period
  // ============================================================

  /**
   * Get core yard IDs — yards scraped daily by scrape-local.js regardless of Flyway.
   * These must NEVER have their vehicles deactivated.
   */
  static async getCoreYardIds() {
    // These match the LOCATIONS array in scrape-local.js (4 NC + 3 FL LKQ yards)
    const coreNames = [
      'LKQ Raleigh', 'LKQ Durham', 'LKQ Greensboro', 'LKQ East NC',
      'LKQ Tampa', 'LKQ Largo', 'LKQ Clearwater',
    ];
    const coreYards = await database('yard')
      .whereIn('name', coreNames)
      .select('id');
    return coreYards.map(y => y.id);
  }

  /**
   * Cleanup yard_vehicle records for completed trips past the 24-hour grace period.
   *
   * Rules:
   * 1. Only trips with status='complete' AND completed_at older than 24 hours
   * 2. Only trips not already cleaned up (cleaned_up = false or null)
   * 3. Skip core yards (scraped daily by scrape-local.js)
   * 4. Skip yards still referenced by another active trip
   * 5. Mark yard_vehicle records as active=false for qualifying yards
   */
  static async cleanupExpiredTripVehicles() {
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const expiredTrips = await database('flyway_trip')
      .where('status', 'complete')
      .whereNotNull('completed_at')
      .where('completed_at', '<', cutoff)
      .where(function() {
        this.whereNull('cleaned_up').orWhere('cleaned_up', false);
      })
      .select('id', 'name', 'completed_at');

    if (expiredTrips.length === 0) return 0;

    const coreYardIds = await this.getCoreYardIds();

    const activeYardIds = await database('flyway_trip_yard')
      .join('flyway_trip', 'flyway_trip.id', 'flyway_trip_yard.trip_id')
      .where('flyway_trip.status', 'active')
      .select('flyway_trip_yard.yard_id')
      .then(rows => rows.map(r => r.yard_id));

    const protectedYardIds = new Set([...coreYardIds, ...activeYardIds]);

    let totalDeactivated = 0;

    for (const trip of expiredTrips) {
      const tripYardIds = await database('flyway_trip_yard')
        .where('trip_id', trip.id)
        .select('yard_id')
        .then(rows => rows.map(r => r.yard_id));

      const yardsToClean = tripYardIds.filter(id => !protectedYardIds.has(id));

      if (yardsToClean.length > 0) {
        const deactivated = await database('yard_vehicle')
          .whereIn('yard_id', yardsToClean)
          .where('active', true)
          .update({ active: false, updatedAt: new Date() });

        totalDeactivated += deactivated;
      }

      await database('flyway_trip')
        .where({ id: trip.id })
        .update({ cleaned_up: true, updated_at: new Date() });
    }

    return totalDeactivated;
  }

  // ============================================================
  // AUTO-COMPLETE TRIPS
  // ============================================================

  static async autoCompleteExpiredTrips() {
    const today = new Date().toISOString().split('T')[0];
    const now = new Date();
    const count = await database('flyway_trip')
      .where('status', 'active')
      .where('end_date', '<', today)
      .update({ status: 'complete', completed_at: now, updated_at: now });
    return count;
  }
}

module.exports = FlywayService;
