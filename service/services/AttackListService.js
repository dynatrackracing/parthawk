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
 *
 * Floor: score >= 10 if Item table has matching parts, even without sales history.
 */

// Make aliases: map common variants to the canonical name used in the Auto table.
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
const MAKE_ALSO_CHECK = {
  'Ram':   ['Dodge'],
  'Dodge': ['Ram'],
};

/**
 * Normalize a make name to canonical Auto-table form. Case-insensitive.
 */
function normalizeMake(make) {
  if (!make) return null;
  const lower = make.toLowerCase().trim();
  return MAKE_ALIASES[lower] || null;
}

/**
 * Detect part type from an item title/category for chip display.
 */
function detectPartType(title) {
  const t = (title || '').toUpperCase();
  if (t.includes('ECM') || t.includes('ECU') || t.includes('PCM') || t.includes('ENGINE CONTROL')) return 'ECM';
  if (t.includes('BCM') || t.includes('BODY CONTROL')) return 'BCM';
  if (t.includes('TCM') || t.includes('TCU') || t.includes('TRANSMISSION CONTROL')) return 'TCM';
  if (t.includes('ABS') || t.includes('ANTI LOCK') || t.includes('BRAKE MODULE')) return 'ABS';
  if (t.includes('TIPM') || t.includes('FUSE BOX') || t.includes('JUNCTION') || t.includes('RELAY BOX')) return 'TIPM';
  if (t.includes('AMPLIFIER') || t.includes('BOSE') || t.includes('HARMAN') || t.includes('ALPINE')) return 'AMP';
  if (t.includes('CLUSTER') || t.includes('SPEEDOMETER') || t.includes('INSTRUMENT')) return 'CLUSTER';
  if (t.includes('RADIO') || t.includes('HEAD UNIT') || t.includes('INFOTAINMENT')) return 'RADIO';
  if (t.includes('WINDOW') && t.includes('REGULATOR')) return 'REGULATOR';
  return null;
}

class AttackListService {
  constructor() {
    this.log = log.child({ class: 'AttackListService' }, true);
  }

  /**
   * Generate attack list for a specific yard.
   * Returns ALL scored vehicles sorted by score descending.
   */
  async getAttackList(yardId, options = {}) {
    const { daysBack = 90, limit = 200 } = options;

    this.log.info({ yardId, daysBack }, 'Generating attack list');

    const vehicles = await database('yard_vehicle')
      .where('yard_id', yardId)
      .where('active', true)
      .orderBy('date_added', 'desc')
      .limit(limit);

    if (!vehicles.length) {
      return { vehicles: [], scored_at: new Date().toISOString(), total: 0 };
    }

    const inventoryIndex = await this.buildInventoryIndex();
    const cutoff = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000);
    const salesIndex = await this.buildSalesIndex(cutoff);
    const stockIndex = await this.buildStockIndex();

    const scored = vehicles.map(v =>
      this.scoreVehicle(v, inventoryIndex, salesIndex, stockIndex)
    );
    scored.sort((a, b) => b.score - a.score);

    return {
      vehicles: scored,
      scored_at: new Date().toISOString(),
      total: scored.length,
      yard_id: yardId,
    };
  }

  /**
   * Build inventory index keyed by "make|model|year".
   */
  async buildInventoryIndex() {
    const index = {};
    try {
      const rows = await database('Auto')
        .join('AutoItemCompatibility', 'Auto.id', 'AutoItemCompatibility.autoId')
        .join('Item', 'AutoItemCompatibility.itemId', 'Item.id')
        .where('Item.price', '>', 0)
        .select(
          'Auto.year', 'Auto.make', 'Auto.model',
          'Item.id as itemId', 'Item.title', 'Item.price',
          'Item.categoryTitle', 'Item.manufacturerPartNumber',
          'Item.quantity'
        );

      for (const row of rows) {
        const key = `${row.make}|${row.model}|${row.year}`;
        if (!index[key]) {
          index[key] = { items: [], count: 0, totalValue: 0, avgPrice: 0 };
        }
        const entry = index[key];
        if (!entry.items.some(i => i.itemId === row.itemId)) {
          entry.items.push({
            itemId: row.itemId,
            title: row.title,
            price: parseFloat(row.price) || 0,
            category: row.categoryTitle,
            partNumber: row.manufacturerPartNumber,
            quantity: parseInt(row.quantity) || 1,
            partType: detectPartType(row.title + ' ' + (row.categoryTitle || '')),
          });
          entry.count++;
          entry.totalValue += parseFloat(row.price) || 0;
          entry.avgPrice = entry.totalValue / entry.count;
        }
      }
    } catch (err) {
      this.log.warn({ err: err.message }, 'buildInventoryIndex: tables not ready');
    }
    return index;
  }

  /**
   * Build sales index keyed by normalized make.
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
   * Build stock index keyed by normalized make.
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
   * Find matching inventory parts for a vehicle across all compatible makes.
   */
  findMatchedParts(make, model, year, inventoryIndex) {
    let matchedParts = [];
    const alsoCheck = MAKE_ALSO_CHECK[make] || [];
    const allMakes = [make, ...alsoCheck];

    // Exact match first
    for (const m of allMakes) {
      const key = `${m}|${model}|${year}`;
      const match = inventoryIndex[key];
      if (match) {
        for (const item of match.items) {
          if (!matchedParts.some(p => p.itemId === item.itemId)) {
            matchedParts.push(item);
          }
        }
      }
    }

    // Fuzzy model match if no exact hits
    if (matchedParts.length === 0) {
      const modelLower = model.toLowerCase();
      for (const [key, entry] of Object.entries(inventoryIndex)) {
        const [iMake, iModel, iYear] = key.split('|');
        if (parseInt(iYear) !== year) continue;
        if (!allMakes.includes(iMake)) continue;

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

    return matchedParts;
  }

  /**
   * Score a single yard vehicle. Returns enriched vehicle object with per-part verdicts.
   */
  scoreVehicle(vehicle, inventoryIndex, salesIndex, stockIndex) {
    const make = normalizeMake(vehicle.make);
    const model = (vehicle.model || '').trim();
    const year = parseInt(vehicle.year) || 0;

    // Find matching inventory parts
    let matchedParts = [];
    if (make && model && year) {
      matchedParts = this.findMatchedParts(make, model, year, inventoryIndex);
    }

    const partCount = matchedParts.length;
    const avgPrice = partCount > 0
      ? matchedParts.reduce((sum, p) => sum + p.price, 0) / partCount
      : 0;

    // Get sales demand for this make
    const salesDemand = { count: 0, avgPrice: 0 };
    const alsoCheck = make ? (MAKE_ALSO_CHECK[make] || []) : [];
    for (const m of [make, ...alsoCheck]) {
      if (m && salesIndex[m]) {
        salesDemand.count += salesIndex[m].count;
        salesDemand.avgPrice = salesIndex[m].avgPrice; // use last match's avg
      }
    }

    // Current stock
    let stock = 0;
    for (const m of [make, ...alsoCheck]) {
      if (m) stock += stockIndex[m] || 0;
    }

    // Scoring per spec: (units sold 90d × avg price) / active listings
    // Floor at 10 when Item table has matching parts (Task 3 requirement)
    let score = 0;

    if (partCount > 0 && salesDemand.count > 0) {
      // Full signal: inventory + sales
      const rawScore = (salesDemand.count * avgPrice) / Math.max(stock + 1, 1);
      score = Math.min(100, Math.round(rawScore / 15));
      score = Math.max(score, 10); // floor
    } else if (partCount > 0) {
      // Inventory match but no sales history — floor at 10, scale by part value
      const inventorySignal = (partCount * avgPrice) / Math.max(stock + 1, 1);
      score = Math.min(60, Math.round(inventorySignal / 20));
      score = Math.max(score, 10); // floor: never gray if we have matching parts
    } else if (salesDemand.count > 0) {
      // No inventory match but sales history exists
      const rawScore = (salesDemand.count * salesDemand.avgPrice) / Math.max(stock + 1, 1);
      score = Math.min(70, Math.round(rawScore / 20));
    } else if (make) {
      // Recognized make, no data — base score
      score = 5;
    }

    // Stock penalty
    if (stock >= 5) score = Math.round(score * 0.3);
    else if (stock >= 3) score = Math.round(score * 0.6);
    else if (stock >= 1) score = Math.round(score * 0.85);

    // Floor enforcement after penalty
    if (partCount > 0 && score < 10) score = 10;

    // Vehicle color
    let color = 'gray';
    if (score >= 70) color = 'red';
    else if (score >= 45) color = 'yellow';

    // Build per-part detail with verdicts and dead inventory warnings
    const parts = matchedParts.slice(0, 8).map(p => {
      // Per-part score based on price relative to avg
      const partScore = avgPrice > 0 ? Math.round((p.price / avgPrice) * score) : score;
      const verdict = partScore >= 70 ? 'PULL' : partScore >= 45 ? 'WATCH' : 'SKIP';
      const reason = verdict === 'PULL' ? 'High value, strong demand'
        : verdict === 'WATCH' ? 'Moderate value, check condition'
        : salesDemand.count === 0 ? 'No sales history yet' : 'Low relative value';

      return {
        itemId: p.itemId,
        title: p.title,
        category: p.category,
        partNumber: p.partNumber,
        partType: p.partType,
        price: Math.round(p.price),
        in_stock: p.quantity || 0,
        sold_90d: salesDemand.count,
        verdict,
        reason,
        // Dead inventory warning checked async in route handler
        deadWarning: null,
      };
    });

    return {
      id: vehicle.id,
      year: vehicle.year,
      make: vehicle.make,
      model: vehicle.model,
      trim: vehicle.trim,
      row_number: vehicle.row_number,
      color: vehicle.color,
      date_added: vehicle.date_added,
      last_seen: vehicle.last_seen,
      is_active: vehicle.active,
      score,
      color_code: color,
      est_value: Math.round(partCount > 0 ? avgPrice * partCount : 0),
      matched_parts: partCount,
      avg_part_price: Math.round(avgPrice),
      parts,
    };
  }

  /**
   * Get attack list across all yards. Returns ALL vehicles per yard (not just top 5).
   */
  async getAllYardsAttackList(options = {}) {
    const yards = await database('yard')
      .where('enabled', true)
      .where(function() {
        this.where('flagged', false).orWhereNull('flagged');
      })
      .orderBy('distance_from_base', 'asc');

    const inventoryIndex = await this.buildInventoryIndex();
    const cutoff = new Date(Date.now() - (options.daysBack || 90) * 24 * 60 * 60 * 1000);
    const salesIndex = await this.buildSalesIndex(cutoff);
    const stockIndex = await this.buildStockIndex();

    // 7-day retention: show vehicles last seen within 7 days
    const retentionCutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const activeOnly = options.activeOnly === true;

    const results = [];
    for (const yard of yards) {
      let vQuery = database('yard_vehicle')
        .where('yard_id', yard.id)
        .orderBy('date_added', 'desc')
        .limit(500);

      if (activeOnly) {
        // Only vehicles confirmed in latest scrape
        vQuery = vQuery.where('active', true);
      } else {
        // All vehicles seen within 7 days (active OR recently gone)
        vQuery = vQuery.where(function() {
          this.where('active', true)
            .orWhere('last_seen', '>=', retentionCutoff);
        });
      }

      const vehicles = await vQuery;

      if (vehicles.length === 0) continue;

      const scored = vehicles.map(v =>
        this.scoreVehicle(v, inventoryIndex, salesIndex, stockIndex)
      );
      // Sort: active vehicles first, then by score descending
      scored.sort((a, b) => {
        if (a.is_active !== b.is_active) return a.is_active ? -1 : 1;
        return b.score - a.score;
      });

      results.push({
        yard: {
          id: yard.id,
          name: yard.name,
          chain: yard.chain,
          distance_from_base: yard.distance_from_base,
          visit_frequency: yard.visit_frequency,
          last_scraped: yard.last_scraped,
        },
        total_vehicles: vehicles.length,
        hot_vehicles: scored.filter(v => v.color_code !== 'gray').length,
        top_score: scored[0]?.score || 0,
        est_total_value: scored.reduce((sum, v) => sum + v.est_value, 0),
        vehicles: scored, // ALL vehicles, not just top 5
      });
    }

    results.sort((a, b) => b.top_score - a.top_score);
    return results;
  }
}

module.exports = AttackListService;
