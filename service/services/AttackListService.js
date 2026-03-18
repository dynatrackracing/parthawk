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
   * Build sales index keyed by "make|model" from YourSale title parsing.
   *
   * Parses each sale title to extract make, model, and part type.
   * Groups by make|model so we can match against yard_vehicle (year, make, model).
   * Each entry includes per-part-type breakdowns with prices and counts.
   */
  async buildSalesIndex(cutoff) {
    const index = {};
    try {
      const sales = await database('YourSale')
        .where('soldDate', '>=', cutoff)
        .whereNotNull('title')
        .select('title', 'salePrice', 'soldDate');

      for (const sale of sales) {
        const title = (sale.title || '');
        const titleLower = title.toLowerCase();
        const price = parseFloat(sale.salePrice) || 0;

        // Extract make from title
        let make = null;
        for (const [alias, canonical] of Object.entries(MAKE_ALIASES)) {
          if (titleLower.includes(alias)) { make = canonical; break; }
        }
        if (!make) continue;

        // Extract model from title — find the word(s) after the make name
        const model = this.extractModelFromTitle(title, make);
        if (!model) continue;

        const partType = detectPartType(title);

        const key = `${make}|${model}`;
        if (!index[key]) {
          index[key] = {
            make, model,
            count: 0, totalRevenue: 0, avgPrice: 0,
            partTypes: {},
            firstSale: sale.soldDate,
            lastSale: sale.soldDate,
          };
        }
        const entry = index[key];
        entry.count++;
        entry.totalRevenue += price;
        entry.avgPrice = entry.totalRevenue / entry.count;
        if (sale.soldDate < entry.firstSale) entry.firstSale = sale.soldDate;
        if (sale.soldDate > entry.lastSale) entry.lastSale = sale.soldDate;

        // Track per-part-type
        if (partType) {
          if (!entry.partTypes[partType]) {
            entry.partTypes[partType] = { count: 0, totalPrice: 0, avgPrice: 0, titles: [] };
          }
          const pt = entry.partTypes[partType];
          pt.count++;
          pt.totalPrice += price;
          pt.avgPrice = pt.totalPrice / pt.count;
          if (pt.titles.length < 3) pt.titles.push(title);
        }
      }
    } catch (err) {
      this.log.warn({ err: err.message }, 'buildSalesIndex: YourSale table not ready');
    }
    return index;
  }

  /**
   * Extract model name from a sale title given the known make.
   * Handles patterns like:
   *   "Dodge Ram 1500 2012 5.7L ECU ECM PCM..."  → "Ram 1500"
   *   "Honda Civic 1.8L 2012-2013 ABS..."        → "Civic"
   *   "Chevrolet Silverado Sierra Tahoe 2005..."  → "Silverado"
   */
  extractModelFromTitle(title, make) {
    const titleUpper = title.toUpperCase();
    const makeUpper = make.toUpperCase();

    // Find make position in title
    const makeIdx = titleUpper.indexOf(makeUpper);
    if (makeIdx === -1) {
      // Try aliases
      for (const [alias, canonical] of Object.entries(MAKE_ALIASES)) {
        if (canonical === make && titleUpper.includes(alias.toUpperCase())) {
          return this.extractModelFromTitle(
            title.substring(titleUpper.indexOf(alias.toUpperCase()) + alias.length),
            ''
          );
        }
      }
      return null;
    }

    // Get text after make name
    const afterMake = title.substring(makeIdx + makeUpper.length).trim();

    // Take words until we hit a year (4 digits), engine spec (digit.digitL), or part keyword
    const words = afterMake.split(/\s+/);
    const modelWords = [];
    for (const word of words) {
      // Stop at year patterns, engine specs, or part type keywords
      if (/^\d{4}$/.test(word)) break;
      if (/^\d{4}-\d{4}$/.test(word)) break;
      if (/^\d+\.\d+[lL]$/.test(word)) break;
      if (/^(ECU|ECM|PCM|BCM|TCM|ABS|TIPM|OEM|NEW|USED|REMAN)$/i.test(word)) break;
      if (/^(Engine|Body|Control|Module|Anti|Fuse|Power|Brake|Amplifier|Radio|Cluster)$/i.test(word)) break;
      modelWords.push(word);
      // Most models are 1-2 words, max 3
      if (modelWords.length >= 3) break;
    }

    if (modelWords.length === 0) return null;
    return modelWords.join(' ').replace(/[^A-Za-z0-9 \-]/g, '').trim();
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
    const modelUpper = model.toUpperCase();

    // Find matching inventory parts (from Auto+Item tables — may be empty)
    let matchedParts = [];
    if (make && model && year) {
      matchedParts = this.findMatchedParts(make, model, year, inventoryIndex);
    }

    // Find matching sales from YourSale by make+model title match
    const salesDemand = { count: 0, avgPrice: 0, partTypes: {} };
    const alsoCheck = make ? (MAKE_ALSO_CHECK[make] || []) : [];
    const allMakes = [make, ...alsoCheck].filter(Boolean);

    for (const m of allMakes) {
      // Exact make+model match
      const key = `${m}|${modelUpper}`;
      if (salesIndex[key]) {
        salesDemand.count += salesIndex[key].count;
        salesDemand.avgPrice = salesIndex[key].avgPrice;
        Object.assign(salesDemand.partTypes, salesIndex[key].partTypes);
      }
      // Also try partial model match (e.g., yard has "RAM 1500", sales have "Ram")
      for (const [sKey, sVal] of Object.entries(salesIndex)) {
        if (sKey.startsWith(m + '|')) {
          const sModel = sKey.split('|')[1];
          if (sModel && modelUpper.includes(sModel) || sModel.includes(modelUpper)) {
            if (sKey !== key) { // avoid double-counting exact match
              salesDemand.count += sVal.count;
              if (sVal.avgPrice > salesDemand.avgPrice) salesDemand.avgPrice = sVal.avgPrice;
              for (const [pt, ptData] of Object.entries(sVal.partTypes)) {
                if (!salesDemand.partTypes[pt]) salesDemand.partTypes[pt] = { ...ptData };
                else {
                  salesDemand.partTypes[pt].count += ptData.count;
                  salesDemand.partTypes[pt].totalPrice += ptData.totalPrice;
                  salesDemand.partTypes[pt].avgPrice = salesDemand.partTypes[pt].totalPrice / salesDemand.partTypes[pt].count;
                }
              }
            }
          }
        }
      }
    }

    // Current stock from YourListing
    let stock = 0;
    for (const m of allMakes) {
      if (m) stock += stockIndex[m] || 0;
    }

    const partCount = matchedParts.length;
    const avgPrice = partCount > 0
      ? matchedParts.reduce((sum, p) => sum + p.price, 0) / partCount
      : salesDemand.avgPrice;

    // === SCORING ===
    // Primary signal: YourSale matches (count * avgPrice / stock)
    // Secondary signal: Item table matches (partCount * avgPrice)
    let score = 0;

    if (salesDemand.count > 0) {
      // Real sales data — strongest signal
      const rawScore = (salesDemand.count * salesDemand.avgPrice) / Math.max(stock + 1, 1);
      score = Math.min(100, Math.round(rawScore / 10));
      score = Math.max(score, 15); // floor: we've sold this make+model before
    } else if (partCount > 0) {
      // Inventory match but no YourSale history
      const inventorySignal = (partCount * avgPrice) / Math.max(stock + 1, 1);
      score = Math.min(60, Math.round(inventorySignal / 20));
      score = Math.max(score, 10);
    } else if (make) {
      // Recognized make, no data
      score = 5;
    }

    // Stock penalty
    if (stock >= 5) score = Math.round(score * 0.3);
    else if (stock >= 3) score = Math.round(score * 0.6);
    else if (stock >= 1) score = Math.round(score * 0.85);

    // Floor enforcement
    if ((partCount > 0 || salesDemand.count > 0) && score < 10) score = 10;

    // Vehicle color
    let color = 'gray';
    if (score >= 70) color = 'red';
    else if (score >= 45) color = 'yellow';

    // === BUILD PARTS LIST ===
    // Combine Item-based parts + YourSale part type breakdowns
    const parts = [];

    // From Item table (if any)
    for (const p of matchedParts.slice(0, 4)) {
      const partScore = avgPrice > 0 ? Math.round((p.price / avgPrice) * score) : score;
      const verdict = partScore >= 70 ? 'PULL' : partScore >= 45 ? 'WATCH' : 'SKIP';
      parts.push({
        itemId: p.itemId,
        title: p.title,
        category: p.category,
        partNumber: p.partNumber,
        partType: p.partType,
        price: Math.round(p.price),
        in_stock: p.quantity || 0,
        sold_90d: salesDemand.count,
        verdict,
        reason: verdict === 'PULL' ? 'High value, strong demand'
          : verdict === 'WATCH' ? 'Moderate value, check condition'
          : 'Low relative value',
        deadWarning: null,
      });
    }

    // From YourSale part type breakdowns — these are the real signals
    for (const [partType, ptData] of Object.entries(salesDemand.partTypes)) {
      // Skip if already covered by Item-based parts
      if (parts.some(p => p.partType === partType)) continue;
      const ptScore = score; // inherit vehicle score
      const verdict = ptScore >= 70 ? 'PULL' : ptScore >= 45 ? 'WATCH' : 'SKIP';
      parts.push({
        itemId: null,
        title: ptData.titles?.[0] || `${make} ${model} ${partType}`,
        category: null,
        partNumber: null,
        partType,
        price: Math.round(ptData.avgPrice),
        in_stock: 0,
        sold_90d: ptData.count,
        verdict,
        reason: `Sold ${ptData.count}x @ $${Math.round(ptData.avgPrice)} avg`,
        deadWarning: null,
      });
    }

    // Sort parts: highest sold count first
    parts.sort((a, b) => (b.sold_90d || 0) - (a.sold_90d || 0));

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
      est_value: Math.round(salesDemand.count > 0 ? salesDemand.avgPrice * Object.keys(salesDemand.partTypes).length : (partCount > 0 ? avgPrice * partCount : 0)),
      matched_parts: parts.length,
      avg_part_price: Math.round(salesDemand.avgPrice || avgPrice),
      sales_count: salesDemand.count,
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
