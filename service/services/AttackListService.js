'use strict';

const { log } = require('../lib/logger');
const { database } = require('../database/database');

/**
 * AttackListService - Scores yard vehicles by pull value
 *
 * Matches scraped yard vehicles (year/make/model) against the Auto table
 * to find compatible Items in inventory. Scores each vehicle by:
 *   - How many matching parts we have in inventory (Item table via AutoItemCompatibility)
 *   - Average price of those parts
 *   - Recent sales history (YourSale)
 *   - Current active stock (YourListing)
 *
 * Score 80-100 = Pull every time (RED)
 * Score 60-79  = Pull if price is right (YELLOW)
 * Score 0-59   = Low demand / no history (GRAY)
 */

// Make aliases: map common variants to the canonical name used in the Auto table.
// Auto table uses title-case eBay taxonomy names (see service/lib/constants.js).
const MAKE_ALIASES = {
  'chevy':         'Chevrolet',
  'chevrolet':     'Chevrolet',
  'dodge':         'Dodge',
  'ram':           'Ram',
  'chrysler':      'Chrysler',
  'jeep':          'Jeep',
  'ford':          'Ford',
  'gmc':           'GMC',
  'toyota':        'Toyota',
  'honda':         'Honda',
  'nissan':        'Nissan',
  'bmw':           'BMW',
  'mercedes':      'Mercedes-Benz',
  'mercedes-benz': 'Mercedes-Benz',
  'mazda':         'Mazda',
  'kia':           'Kia',
  'hyundai':       'Hyundai',
  'subaru':        'Subaru',
  'mitsubishi':    'Mitsubishi',
  'infiniti':      'Infiniti',
  'lexus':         'Lexus',
  'acura':         'Acura',
  'cadillac':      'Cadillac',
  'buick':         'Buick',
  'lincoln':       'Lincoln',
  'volvo':         'Volvo',
  'audi':          'Audi',
  'volkswagen':    'Volkswagen',
  'vw':            'Volkswagen',
  'mini':          'Mini',
  'pontiac':       'Pontiac',
  'saturn':        'Saturn',
  'mercury':       'Mercury',
  'scion':         'Scion',
  'land rover':    'Land Rover',
  'porsche':       'Porsche',
  'jaguar':        'Jaguar',
  'saab':          'Saab',
};

// Secondary alias: makes that should ALSO match each other for demand.
// e.g. a Ram 1500 in the yard should match Dodge Ram parts in inventory.
const MAKE_ALSO_CHECK = {
  'Ram':   ['Dodge'],
  'Dodge': ['Ram'],
};

/**
 * Normalize a make name from any source (LKQ, CSV, etc.) to the
 * canonical Auto-table form. Case-insensitive, alias-aware.
 */
function normalizeMake(make) {
  if (!make) return null;
  const lower = make.toLowerCase().trim();
  return MAKE_ALIASES[lower] || null;
}

class AttackListService {
  constructor() {
    this.log = log.child({ class: 'AttackListService' }, true);
  }

  /**
   * Generate attack list for a specific yard.
   * Returns scored vehicles sorted by pull value.
   */
  async getAttackList(yardId, options = {}) {
    const { daysBack = 90, limit = 50 } = options;

    this.log.info({ yardId, daysBack }, 'Generating attack list');

    // Get active vehicles at this yard
    const vehicles = await database('yard_vehicle')
      .where('yard_id', yardId)
      .where('active', true)
      .orderBy('date_added', 'desc')
      .limit(200);

    if (!vehicles.length) {
      return { vehicles: [], scored_at: new Date().toISOString(), total: 0 };
    }

    // Build inventory index: what parts do we have for each year/make/model?
    const inventoryIndex = await this.buildInventoryIndex();

    // Get recent sales from YourSale for extra demand signal
    const cutoff = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000);
    const salesIndex = await this.buildSalesIndex(cutoff);

    // Get current active listing counts
    const stockIndex = await this.buildStockIndex();

    // Score each vehicle
    const scored = vehicles.map(v =>
      this.scoreVehicle(v, inventoryIndex, salesIndex, stockIndex)
    );

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
   * Build an index of inventory parts keyed by "make|model|year".
   * Uses Auto + AutoItemCompatibility + Item tables for structured matching.
   *
   * Returns: { "Dodge|Ram 1500|2017": { items: [...], count, avgPrice, totalValue } }
   */
  async buildInventoryIndex() {
    const index = {};

    try {
      // Join Auto -> AutoItemCompatibility -> Item to get parts with fitment data
      const rows = await database('Auto')
        .join('AutoItemCompatibility', 'Auto.id', 'AutoItemCompatibility.autoId')
        .join('Item', 'AutoItemCompatibility.itemId', 'Item.id')
        .where('Item.price', '>', 0)
        .select(
          'Auto.year',
          'Auto.make',
          'Auto.model',
          'Item.id as itemId',
          'Item.title',
          'Item.price',
          'Item.categoryTitle',
          'Item.manufacturerPartNumber'
        );

      for (const row of rows) {
        const key = `${row.make}|${row.model}|${row.year}`;
        if (!index[key]) {
          index[key] = { items: [], count: 0, totalValue: 0, avgPrice: 0 };
        }
        const entry = index[key];
        // Deduplicate by item ID
        if (!entry.items.some(i => i.itemId === row.itemId)) {
          entry.items.push({
            itemId: row.itemId,
            title: row.title,
            price: parseFloat(row.price) || 0,
            category: row.categoryTitle,
            partNumber: row.manufacturerPartNumber,
          });
          entry.count++;
          entry.totalValue += parseFloat(row.price) || 0;
          entry.avgPrice = entry.totalValue / entry.count;
        }
      }
    } catch (err) {
      // Tables may not exist yet — return empty index, scoring still works
      this.log.warn({ err: err.message }, 'buildInventoryIndex: tables not ready');
    }

    return index;
  }

  /**
   * Build a sales demand index from YourSale (eBay CSV/API) keyed by normalized make.
   * Returns: { "Dodge": { count, totalRevenue, avgPrice } }
   */
  async buildSalesIndex(cutoff) {
    const index = {};

    try {
      const sales = await database('YourSale')
        .where('soldDate', '>=', cutoff)
        .whereNotNull('title')
        .select('title', 'salePrice');

      for (const sale of sales) {
        const title = (sale.title || '').toLowerCase();

        let make = null;
        for (const [alias, canonical] of Object.entries(MAKE_ALIASES)) {
          if (title.includes(alias)) { make = canonical; break; }
        }
        if (!make) continue;

        if (!index[make]) {
          index[make] = { count: 0, totalRevenue: 0, avgPrice: 0 };
        }
        index[make].count++;
        index[make].totalRevenue += parseFloat(sale.salePrice) || 0;
        index[make].avgPrice = index[make].totalRevenue / index[make].count;
      }
    } catch (err) {
      this.log.warn({ err: err.message }, 'buildSalesIndex: YourSale table not ready');
    }

    return index;
  }

  /**
   * Build a stock index from YourListing keyed by normalized make.
   * Returns: { "Dodge": totalQuantity }
   */
  async buildStockIndex() {
    const index = {};

    try {
      const listings = await database('YourListing')
        .where('listingStatus', 'Active')
        .whereNotNull('title')
        .select('title', 'quantityAvailable');

      for (const listing of listings) {
        const title = (listing.title || '').toLowerCase();

        let make = null;
        for (const [alias, canonical] of Object.entries(MAKE_ALIASES)) {
          if (title.includes(alias)) { make = canonical; break; }
        }
        if (!make) continue;

        index[make] = (index[make] || 0) + (listing.quantityAvailable || 1);
      }
    } catch (err) {
      this.log.warn({ err: err.message }, 'buildStockIndex: YourListing table not ready');
    }

    return index;
  }

  /**
   * Score a single yard vehicle against inventory, sales, and stock data.
   */
  scoreVehicle(vehicle, inventoryIndex, salesIndex, stockIndex) {
    const make = normalizeMake(vehicle.make);
    const model = (vehicle.model || '').trim();
    const year = parseInt(vehicle.year) || 0;

    // Find matching inventory parts via structured Auto fitment
    let matchedParts = [];
    if (make && model && year) {
      // Try exact make match
      const exactKey = `${make}|${model}|${year}`;
      const exactMatch = inventoryIndex[exactKey];
      if (exactMatch) {
        matchedParts = exactMatch.items;
      }

      // Also check alias makes (e.g. Ram <-> Dodge)
      const alsoCheck = MAKE_ALSO_CHECK[make] || [];
      for (const altMake of alsoCheck) {
        const altKey = `${altMake}|${model}|${year}`;
        const altMatch = inventoryIndex[altKey];
        if (altMatch) {
          for (const item of altMatch.items) {
            if (!matchedParts.some(p => p.itemId === item.itemId)) {
              matchedParts.push(item);
            }
          }
        }
      }

      // Fuzzy model match: try matching with model as substring
      // e.g. yard has "Ram 1500", Auto table has "1500" or "Ram 1500"
      if (matchedParts.length === 0) {
        const modelLower = model.toLowerCase();
        for (const [key, entry] of Object.entries(inventoryIndex)) {
          const [iMake, iModel, iYear] = key.split('|');
          if (parseInt(iYear) !== year) continue;

          // Check if makes are compatible
          const makesMatch = iMake === make || (alsoCheck.includes(iMake));
          if (!makesMatch) continue;

          // Fuzzy model: either contains the other
          const iModelLower = iModel.toLowerCase();
          if (iModelLower.includes(modelLower) || modelLower.includes(iModelLower)) {
            for (const item of entry.items) {
              if (!matchedParts.some(p => p.itemId === item.itemId)) {
                matchedParts.push(item);
              }
            }
          }
        }
      }
    }

    const partCount = matchedParts.length;
    const avgPrice = partCount > 0
      ? matchedParts.reduce((sum, p) => sum + p.price, 0) / partCount
      : 0;

    // Get sales demand for this make (from YourSale)
    const salesDemand = (make && salesIndex[make]) || { count: 0, avgPrice: 0 };

    // Also check alias makes for sales
    const alsoCheck = make ? (MAKE_ALSO_CHECK[make] || []) : [];
    for (const altMake of alsoCheck) {
      if (salesIndex[altMake]) {
        salesDemand.count += salesIndex[altMake].count;
      }
    }

    // Current stock for this make
    let stock = (make && stockIndex[make]) || 0;
    for (const altMake of alsoCheck) {
      stock += stockIndex[altMake] || 0;
    }

    // Scoring: combine inventory match strength + sales demand
    let score = 0;

    if (partCount > 0) {
      // We have parts in inventory that fit this vehicle
      // Base score from inventory: more parts + higher prices = higher score
      const inventorySignal = (partCount * avgPrice) / Math.max(stock + 1, 1);
      score = Math.min(100, Math.round(inventorySignal / 15));

      // Boost from recent sales demand
      if (salesDemand.count > 0) {
        const demandBoost = Math.min(20, Math.round(salesDemand.count / 2));
        score = Math.min(100, score + demandBoost);
      }
    } else if (salesDemand.count > 0) {
      // No inventory match but we have sales history for this make
      const rawScore = (salesDemand.count * salesDemand.avgPrice) / Math.max(stock + 1, 1);
      score = Math.min(70, Math.round(rawScore / 20));
    } else if (make) {
      // No inventory match, no sales — base score from make recognition
      score = 15;
    }

    // Stock penalty
    if (stock >= 5) score = Math.round(score * 0.3);
    else if (stock >= 3) score = Math.round(score * 0.6);
    else if (stock >= 1) score = Math.round(score * 0.85);

    // Vehicle level color
    let color = 'gray';
    if (score >= 70) color = 'red';
    else if (score >= 45) color = 'yellow';

    // Build parts summary (top 6 matched items)
    const partsDisplay = matchedParts.slice(0, 6).map(p => ({
      title: p.title,
      category: p.category,
      partNumber: p.partNumber,
      price: Math.round(p.price),
    }));

    return {
      id: vehicle.id,
      year: vehicle.year,
      make: vehicle.make,
      model: vehicle.model,
      trim: vehicle.trim,
      row_number: vehicle.row_number,
      color: vehicle.color,
      date_added: vehicle.date_added,
      score,
      color_code: color,
      est_value: Math.round(partCount > 0 ? avgPrice * partCount : 0),
      matched_parts: partCount,
      avg_part_price: Math.round(avgPrice),
      parts: partsDisplay,
    };
  }

  /**
   * Get attack list summary across all yards.
   */
  async getAllYardsAttackList(options = {}) {
    const yards = await database('yard')
      .where('enabled', true)
      .where('flagged', false)
      .orderBy('distance_from_base', 'asc');

    // Build indexes once, shared across all yards
    const inventoryIndex = await this.buildInventoryIndex();
    const cutoff = new Date(Date.now() - (options.daysBack || 90) * 24 * 60 * 60 * 1000);
    const salesIndex = await this.buildSalesIndex(cutoff);
    const stockIndex = await this.buildStockIndex();

    const results = [];
    for (const yard of yards) {
      const count = await database('yard_vehicle')
        .where('yard_id', yard.id)
        .where('active', true)
        .count('* as total')
        .first();

      if (parseInt(count.total) === 0) continue;

      // Get vehicles and score them using shared indexes
      const vehicles = await database('yard_vehicle')
        .where('yard_id', yard.id)
        .where('active', true)
        .orderBy('date_added', 'desc')
        .limit(200);

      const scored = vehicles.map(v =>
        this.scoreVehicle(v, inventoryIndex, salesIndex, stockIndex)
      );
      scored.sort((a, b) => b.score - a.score);

      const topVehicles = scored.slice(0, 5);

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
        hot_vehicles: topVehicles.filter(v => v.color_code !== 'gray').length,
        top_score: scored[0]?.score || 0,
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
