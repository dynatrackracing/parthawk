'use strict';

const { log } = require('../lib/logger');
const { database } = require('../database/database');
const { raw } = require('objection');

/**
 * AttackListService - Scores yard vehicles by pull value
 * 
 * Score = (Demand × AvgPrice) / ActiveStock
 * 
 * Demand: how many times this year/make/model/part combo sold in your history
 * AvgPrice: average sale price from your history
 * ActiveStock: how many you currently have listed (from YourListing)
 * 
 * Score 80-100 = Pull every time (RED)
 * Score 60-79  = Pull if price is right (YELLOW)  
 * Score 40-59  = Caution (GRAY)
 * Score 0-39   = Skip
 */

// High value parts to look for on each vehicle
// Based on spec section 1.1 part mix: ECMs, ABS, BCM/TCM, fuse boxes
const PART_TARGETS = [
  { type: 'ECM',        keywords: ['ECM', 'ECU', 'PCM', 'engine control'],           avgPull: 35, baseValue: 180 },
  { type: 'BCM',        keywords: ['BCM', 'body control'],                            avgPull: 25, baseValue: 120 },
  { type: 'TCM',        keywords: ['TCM', 'TCU', 'transmission control'],             avgPull: 25, baseValue: 130 },
  { type: 'ABS',        keywords: ['ABS', 'anti lock', 'brake pump', 'brake module'], avgPull: 20, baseValue: 110 },
  { type: 'TIPM',       keywords: ['TIPM', 'fuse box', 'junction', 'relay box'],      avgPull: 20, baseValue: 95  },
  { type: 'Amplifier',  keywords: ['amp', 'amplifier', 'bose', 'harman', 'alpine', 'b&o', 'bang'], avgPull: 15, baseValue: 85 },
  { type: 'Cluster',    keywords: ['cluster', 'speedometer', 'instrument panel'],     avgPull: 20, baseValue: 75 },
  { type: 'Radio',      keywords: ['radio', 'head unit', 'infotainment', 'sync'],     avgPull: 15, baseValue: 65 },
];

class AttackListService {
  constructor() {
    this.log = log.child({ class: 'AttackListService' }, true);
  }

  /**
   * Generate attack list for a specific yard
   * Returns scored vehicles sorted by pull value
   */
  async getAttackList(yardId, options = {}) {
    const { daysBack = 90, limit = 50 } = options;

    this.log.info({ yardId, daysBack }, 'Generating attack list');

    // Get vehicles at this yard
    const vehicles = await database('yard_vehicle')
      .where('yard_id', yardId)
      .where('active', true)
      .orderBy('date_added', 'desc')
      .limit(200);

    if (!vehicles.length) {
      return { vehicles: [], scored_at: new Date().toISOString(), total: 0 };
    }

    // Get your sales history for the past N days
    const cutoff = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000);
    const salesHistory = await this.getSalesHistory(cutoff);

    // Get current stock from YourListing
    const currentStock = await this.getCurrentStock();

    // Score each vehicle
    const scored = vehicles.map(v => this.scoreVehicle(v, salesHistory, currentStock));

    // Sort by score descending
    scored.sort((a, b) => b.score - a.score);

    return {
      vehicles: scored.slice(0, limit),
      scored_at: new Date().toISOString(),
      total: scored.length,
      yard_id: yardId,
    };
  }

  /**
   * Get your sales history grouped by make/model/part type
   */
  async getSalesHistory(cutoff) {
    const sales = await database('YourSale')
      .where('soldDate', '>=', cutoff)
      .whereNotNull('title')
      .select('title', 'salePrice', 'soldDate');

    // Build a lookup: "make|model|partType" -> { count, totalRevenue, avgPrice }
    const history = {};

    for (const sale of sales) {
      const title = (sale.title || '').toLowerCase();
      
      // Extract year/make/model from title
      const yearMatch = title.match(/\b(19|20)\d{2}\b/);
      const year = yearMatch ? yearMatch[0] : null;

      // Detect part type
      let partType = null;
      for (const part of PART_TARGETS) {
        if (part.keywords.some(k => title.includes(k.toLowerCase()))) {
          partType = part.type;
          break;
        }
      }

      if (!partType) continue;

      // Extract make from common makes
      const makes = ['dodge', 'chrysler', 'jeep', 'ram', 'ford', 'chevy', 'chevrolet', 'gmc', 
                     'toyota', 'honda', 'nissan', 'bmw', 'mercedes', 'mazda', 'kia', 'hyundai',
                     'subaru', 'mitsubishi', 'infiniti', 'lexus', 'acura', 'cadillac', 'buick',
                     'lincoln', 'volvo', 'audi', 'volkswagen', 'vw', 'mini', 'pontiac', 'saturn'];
      
      let make = null;
      for (const m of makes) {
        if (title.includes(m)) { make = m; break; }
      }

      if (!make) continue;

      const key = `${make}|${partType}`;
      if (!history[key]) {
        history[key] = { count: 0, totalRevenue: 0, avgPrice: 0, make, partType };
      }
      history[key].count++;
      history[key].totalRevenue += parseFloat(sale.salePrice) || 0;
      history[key].avgPrice = history[key].totalRevenue / history[key].count;
    }

    return history;
  }

  /**
   * Get current active listings count by make/partType
   */
  async getCurrentStock() {
    const hasListings = await database.schema.hasTable('YourListing');
    if (!hasListings) return {};

    const listings = await database('YourListing')
      .where('listingStatus', 'Active')
      .whereNotNull('title')
      .select('title', 'quantityAvailable');

    const stock = {};
    for (const listing of listings) {
      const title = (listing.title || '').toLowerCase();
      
      let partType = null;
      for (const part of PART_TARGETS) {
        if (part.keywords.some(k => title.includes(k.toLowerCase()))) {
          partType = part.type;
          break;
        }
      }
      if (!partType) continue;

      const makes = ['dodge', 'chrysler', 'jeep', 'ram', 'ford', 'chevy', 'chevrolet', 'gmc',
                     'toyota', 'honda', 'nissan', 'bmw', 'mercedes', 'mazda', 'kia', 'hyundai',
                     'subaru', 'mitsubishi', 'infiniti', 'lexus', 'acura', 'cadillac', 'buick',
                     'lincoln', 'volvo', 'audi', 'volkswagen', 'vw', 'mini', 'pontiac', 'saturn'];
      
      let make = null;
      for (const m of makes) {
        if (title.includes(m)) { make = m; break; }
      }
      if (!make) continue;

      const key = `${make}|${partType}`;
      stock[key] = (stock[key] || 0) + (listing.quantityAvailable || 1);
    }

    return stock;
  }

  /**
   * Score a single vehicle
   */
  scoreVehicle(vehicle, salesHistory, currentStock) {
    const make = (vehicle.make || '').toLowerCase();
    const model = (vehicle.model || '').toLowerCase();
    const year = parseInt(vehicle.year) || 0;

    const parts = [];
    let totalEstValue = 0;
    let topScore = 0;

    for (const partTarget of PART_TARGETS) {
      const key = `${make}|${partTarget.type}`;
      const history = salesHistory[key];
      const stock = currentStock[key] || 0;

      // Demand score: based on your sell history
      const demandCount = history ? history.count : 0;
      const avgPrice = history ? history.avgPrice : partTarget.baseValue;

      // Market score formula from spec:
      // Score = (Units sold 90d × avg price) / active listings
      // Normalize to 0-100
      let score = 0;
      if (demandCount > 0) {
        const rawScore = (demandCount * avgPrice) / Math.max(stock + 1, 1);
        score = Math.min(100, Math.round(rawScore / 20)); // normalize
      } else {
        // No history — use base value as signal, low score
        score = Math.min(30, Math.round(partTarget.baseValue / 20));
      }

      // Stock penalty — if we have 5+ already, reduce score significantly
      if (stock >= 5) score = Math.round(score * 0.3);
      else if (stock >= 3) score = Math.round(score * 0.6);
      else if (stock >= 1) score = Math.round(score * 0.85);

      if (score > 0) {
        parts.push({
          type: partTarget.type,
          score,
          demand_90d: demandCount,
          avg_price: Math.round(avgPrice),
          in_stock: stock,
          verdict: score >= 70 ? 'PULL' : score >= 45 ? 'WATCH' : 'SKIP',
        });
        totalEstValue += score >= 45 ? avgPrice : 0;
        topScore = Math.max(topScore, score);
      }
    }

    // Sort parts by score
    parts.sort((a, b) => b.score - a.score);

    // Vehicle level color
    let color = 'gray';
    if (topScore >= 70) color = 'red';
    else if (topScore >= 45) color = 'yellow';

    return {
      id: vehicle.id,
      year: vehicle.year,
      make: vehicle.make,
      model: vehicle.model,
      trim: vehicle.trim,
      row_number: vehicle.row_number,
      color: vehicle.color,
      date_added: vehicle.date_added,
      score: topScore,
      color_code: color,
      est_value: Math.round(totalEstValue),
      parts: parts.slice(0, 6), // top 6 parts
    };
  }

  /**
   * Get attack list summary across all yards
   */
  async getAllYardsAttackList(options = {}) {
    const yards = await database('yard')
      .where('enabled', true)
      .where('flagged', false)
      .orderBy('distance_from_base', 'asc');

    const results = [];
    for (const yard of yards) {
      const count = await database('yard_vehicle')
        .where('yard_id', yard.id)
        .where('active', true)
        .count('* as total')
        .first();

      if (parseInt(count.total) === 0) continue;

      const list = await this.getAttackList(yard.id, options);
      const topVehicles = list.vehicles.filter(v => v.color_code !== 'gray').slice(0, 3);

      results.push({
        yard: {
          id: yard.id,
          name: yard.name,
          chain: yard.chain,
          distance_from_base: yard.distance_from_base,
          visit_frequency: yard.visit_frequency,
          last_scraped: yard.last_scraped,
        },
        total_vehicles: parseInt(count.total),
        hot_vehicles: topVehicles.length,
        top_score: list.vehicles[0]?.score || 0,
        est_total_value: topVehicles.reduce((sum, v) => sum + v.est_value, 0),
        top_vehicles: topVehicles,
      });
    }

    // Sort yards by top score
    results.sort((a, b) => b.top_score - a.top_score);
    return results;
  }
}

module.exports = AttackListService;
