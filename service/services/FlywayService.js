'use strict';

const { database } = require('../database/database');
const AttackListService = require('./AttackListService');

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
    return trip;
  }

  static async createTrip({ name, start_date, end_date, notes, yard_ids }) {
    const [trip] = await database('flyway_trip')
      .insert({ name, start_date, end_date, notes, status: 'planning' })
      .returning('*');

    if (yard_ids && yard_ids.length > 0) {
      const rows = yard_ids.map(yard_id => ({ trip_id: trip.id, yard_id }));
      await database('flyway_trip_yard').insert(rows);
    }

    return this.getTrip(trip.id);
  }

  static async updateTrip(id, updates) {
    if (updates.status === 'active') {
      const trip = await database('flyway_trip').where({ id }).first();
      if (!trip) throw new Error('Trip not found');
      const yards = await database('flyway_trip_yard').where({ trip_id: id });
      if (yards.length === 0) throw new Error('Cannot activate trip with no yards');
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

    // Group vehicles by yard for output
    const yardMap = {};
    for (const y of trip.yards) {
      if (!y.scrape_enabled) continue;
      yardMap[y.id] = { yard: y, vehicles: [] };
    }

    // Score each vehicle
    for (const vehicle of vehicles) {
      try {
        const result = attackService.scoreVehicle(
          vehicle, inventoryIndex, salesIndex, stockIndex, platformIndex, stockPartNumbers, markIndex
        );

        // Apply Flyway age decay
        const daysInYard = this.calculateDaysInYard(vehicle.date_added);
        const ageDecay = this.calculateAgeDecay(daysInYard);
        const decayedValue = Math.round((result.est_value || 0) * (1 - ageDecay));

        // Premium flags
        const premiumFlags = this.getPremiumFlags(vehicle);

        // High-value individual parts ($200+)
        const highValueParts = (result.parts || []).filter(p => (p.price || 0) >= 200);

        const flywayResult = {
          ...result,
          daysInYard,
          ageDecay: Math.round(ageDecay * 100),
          flywayValue: decayedValue,
          premiumFlags,
          highValueParts: highValueParts.length,
          hasHighValuePart: highValueParts.length > 0,
          isPremiumVehicle: premiumFlags.length > 0,
        };

        // Filter: minimum $400 flyway value OR has high-value part OR is premium
        if (decayedValue >= 400 || highValueParts.length > 0 || premiumFlags.length > 0) {
          if (yardMap[vehicle.yard_id]) {
            yardMap[vehicle.yard_id].vehicles.push(flywayResult);
          }
        }
      } catch (e) {
        // Skip vehicles that fail scoring
      }
    }

    // Sort vehicles within each yard: premium first, then by flyway value
    const yards = [];
    for (const entry of Object.values(yardMap)) {
      entry.vehicles.sort((a, b) => {
        if (a.isPremiumVehicle && !b.isPremiumVehicle) return -1;
        if (!a.isPremiumVehicle && b.isPremiumVehicle) return 1;
        return (b.flywayValue || 0) - (a.flywayValue || 0);
      });

      yards.push({
        yard: entry.yard,
        total_vehicles: entry.vehicles.length,
        hot_vehicles: entry.vehicles.filter(v => v.color_code === 'green' || v.color_code === 'yellow').length,
        est_total_value: entry.vehicles.reduce((sum, v) => sum + (v.flywayValue || 0), 0),
        vehicles: entry.vehicles,
      });
    }

    // Sort yards by total value descending
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

    const drive = (vehicle.decoded_drivetrain || vehicle.drivetrain || '').toUpperCase();
    if (drive.includes('4WD') || drive.includes('4X4')) flags.push('4WD');
    if (drive.includes('AWD')) flags.push('AWD');

    return flags;
  }

  // ============================================================
  // AUTO-COMPLETE TRIPS
  // ============================================================

  static async autoCompleteExpiredTrips() {
    const today = new Date().toISOString().split('T')[0];
    const count = await database('flyway_trip')
      .where('status', 'active')
      .where('end_date', '<', today)
      .update({ status: 'complete', updated_at: new Date() });
    return count;
  }
}

module.exports = FlywayService;
