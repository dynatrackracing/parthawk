'use strict';

const { log } = require('../lib/logger');
const { database } = require('../database/database');
const { getPlatformMatches } = require('../lib/platformMatch');

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
    const { byMakeModel: stockIdx, byPartNumber: stockPNs } = await this.buildStockIndex();

    const scored = vehicles.map(v =>
      this.scoreVehicle(v, inventoryIndex, salesIndex, stockIdx, {}, stockPNs)
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
   * Each entry stores an array of individual sale records with parsed year
   * ranges so that scoreVehicle can filter by whether the yard vehicle's
   * year falls within the sale's fitment range.
   *
   * Year range parsing:
   *   "2007-2008 Dodge Ram" → yearStart=2007, yearEnd=2008
   *   "Dodge Ram 2006 5.7L" → yearStart=2006, yearEnd=2006
   *   "2005-2010 Chrysler 300" → yearStart=2005, yearEnd=2010
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

        const model = this.extractModelFromTitle(title, make);
        if (!model) continue;

        const partType = detectPartType(title);
        const yearRange = this.extractYearRange(title);

        const key = `${make}|${model}`;
        if (!index[key]) {
          index[key] = { make, model, sales: [] };
        }
        index[key].sales.push({
          price,
          partType,
          yearStart: yearRange.start,
          yearEnd: yearRange.end,
          soldDate: sale.soldDate,
          title,
        });
      }
    } catch (err) {
      this.log.warn({ err: err.message }, 'buildSalesIndex: YourSale table not ready');
    }
    return index;
  }

  /**
   * Extract year or year range from a sale title.
   * Returns { start, end } where both are integers.
   *
   * Handles:
   *   "2007-2008 Dodge Ram"      → { start: 2007, end: 2008 }
   *   "Dodge Ram 2006 5.7L"      → { start: 2006, end: 2006 }
   *   "2005-2010 Chrysler 300"   → { start: 2005, end: 2010 }
   *   "2012, 2013 Honda Civic"   → { start: 2012, end: 2013 }
   *   "2012 2013 Honda Civic"    → { start: 2012, end: 2013 }
   */
  extractYearRange(title) {
    // Pattern 1: explicit range "YYYY-YYYY"
    const rangeMatch = title.match(/\b((?:19|20)\d{2})\s*[-–]\s*((?:19|20)\d{2})\b/);
    if (rangeMatch) {
      return { start: parseInt(rangeMatch[1]), end: parseInt(rangeMatch[2]) };
    }

    // Pattern 2: two years separated by comma or space "YYYY, YYYY" or "YYYY YYYY"
    const twoYearMatch = title.match(/\b((?:19|20)\d{2})\s*[,\s]\s*((?:19|20)\d{2})\b/);
    if (twoYearMatch) {
      const y1 = parseInt(twoYearMatch[1]);
      const y2 = parseInt(twoYearMatch[2]);
      // Only treat as range if years are close together (within 10 years)
      if (Math.abs(y2 - y1) <= 10) {
        return { start: Math.min(y1, y2), end: Math.max(y1, y2) };
      }
    }

    // Pattern 3: single year "YYYY"
    const singleMatch = title.match(/\b((?:19|20)\d{2})\b/);
    if (singleMatch) {
      const y = parseInt(singleMatch[1]);
      return { start: y, end: y };
    }

    // No year found
    return { start: 0, end: 0 };
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
   * Build stock indexes from YourListing:
   * 1. byMakeModel: keyed by "make|MODEL" — counts per make+model
   * 2. byPartNumber: keyed by normalized base part number — counts per PN
   */
  async buildStockIndex() {
    const byMakeModel = {};
    const byPartNumber = {};
    try {
      const listings = await database('YourListing')
        .where('listingStatus', 'Active')
        .whereNotNull('title')
        .select('title', 'sku', 'quantityAvailable');

      const { normalizePartNumber } = require('../lib/partNumberUtils');

      for (const listing of listings) {
        const qty = parseInt(listing.quantityAvailable) || 1;
        const title = listing.title || '';
        const titleLower = title.toLowerCase();

        // Index by make|model
        let make = null;
        for (const [alias, canonical] of Object.entries(MAKE_ALIASES)) {
          if (titleLower.includes(alias)) { make = canonical; break; }
        }
        if (make) {
          const model = this.extractModelFromTitle(title, make);
          if (model) {
            const key = `${make}|${model.toUpperCase()}`;
            byMakeModel[key] = (byMakeModel[key] || 0) + qty;
          }
        }

        // Index by part number (from SKU and title)
        if (listing.sku) {
          const base = normalizePartNumber(listing.sku);
          if (base && base.length >= 5) byPartNumber[base] = (byPartNumber[base] || 0) + qty;
        }
        // Extract PNs from title
        const chrysler = title.match(/\b(\d{8})[A-Z]{2}\b/);
        if (chrysler) byPartNumber[chrysler[1]] = (byPartNumber[chrysler[1]] || 0) + qty;
        const toyota = title.match(/\b(\d{5}-[A-Z0-9]{3,5})/);
        if (toyota) byPartNumber[toyota[1]] = (byPartNumber[toyota[1]] || 0) + qty;
        const ford = title.match(/\b([A-Z]{1,4}\d{1,2}[A-Z]-[A-Z0-9]{4,6})/);
        if (ford) byPartNumber[ford[1]] = (byPartNumber[ford[1]] || 0) + qty;
      }
    } catch (err) {
      this.log.warn({ err: err.message }, 'buildStockIndex: YourListing table not ready');
    }
    return { byMakeModel, byPartNumber };
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
  scoreVehicle(vehicle, inventoryIndex, salesIndex, stockIndex, platformIndex = {}, stockPartNumbers = {}) {
    const make = normalizeMake(vehicle.make);
    const model = (vehicle.model || '').trim();
    const year = parseInt(vehicle.year) || 0;
    const modelUpper = model.toUpperCase();

    // Find matching inventory parts (from Auto+Item tables — may be empty)
    let matchedParts = [];
    if (make && model && year) {
      matchedParts = this.findMatchedParts(make, model, year, inventoryIndex);
    }

    // Find matching sales from YourSale by make+model+year
    const salesDemand = { count: 0, avgPrice: 0, totalRevenue: 0, partTypes: {} };
    const alsoCheck = make ? (MAKE_ALSO_CHECK[make] || []) : [];
    const allMakes = [make, ...alsoCheck].filter(Boolean);

    // Collect all candidate salesIndex entries by make+model (exact + partial model)
    const candidateKeys = new Set();
    for (const m of allMakes) {
      const exactKey = `${m}|${modelUpper}`;
      if (salesIndex[exactKey]) candidateKeys.add(exactKey);
      // Partial model match (yard "RAM 1500" ↔ sale "Ram", or "300" ↔ "300C")
      for (const sKey of Object.keys(salesIndex)) {
        if (!sKey.startsWith(m + '|')) continue;
        const sModel = sKey.split('|')[1];
        if (sModel && (modelUpper.includes(sModel) || sModel.includes(modelUpper))) {
          candidateKeys.add(sKey);
        }
      }
    }

    // Platform cross-reference: add sibling make+model keys
    // e.g., Chrysler 300 → also match Dodge Charger, Dodge Challenger, Dodge Magnum
    const platformKey = `${make}|${modelUpper}`;
    const siblings = platformIndex[platformKey] || [];
    let platformSiblingNames = [];
    for (const sib of siblings) {
      // Only include siblings whose year range covers this vehicle
      if (year >= sib.yearStart && year <= sib.yearEnd) {
        const sibModel = sib.model.toUpperCase();
        const sibKey = `${sib.make}|${sibModel}`;
        if (salesIndex[sibKey]) candidateKeys.add(sibKey);
        // Also partial match siblings
        for (const sKey of Object.keys(salesIndex)) {
          if (!sKey.startsWith(sib.make + '|')) continue;
          const sModel = sKey.split('|')[1];
          if (sModel && (sibModel.includes(sModel) || sModel.includes(sibModel))) {
            candidateKeys.add(sKey);
          }
        }
        platformSiblingNames.push(`${sib.make} ${sib.model}`);
      }
    }

    // Filter each candidate's individual sales by year range
    for (const cKey of candidateKeys) {
      const entry = salesIndex[cKey];
      for (const sale of entry.sales) {
        // Year must fall within the sale's fitment range
        if (sale.yearStart > 0 && sale.yearEnd > 0) {
          if (year < sale.yearStart || year > sale.yearEnd) continue;
        }
        // Year matches — count this sale
        salesDemand.count++;
        salesDemand.totalRevenue += sale.price;
        salesDemand.avgPrice = salesDemand.totalRevenue / salesDemand.count;

        if (sale.partType) {
          if (!salesDemand.partTypes[sale.partType]) {
            salesDemand.partTypes[sale.partType] = { count: 0, totalPrice: 0, avgPrice: 0, titles: [] };
          }
          const pt = salesDemand.partTypes[sale.partType];
          pt.count++;
          pt.totalPrice += sale.price;
          pt.avgPrice = pt.totalPrice / pt.count;
          if (pt.titles.length < 3) pt.titles.push(sale.title);
        }
      }
    }

    // Current stock from YourListing — match by make+model, not just make
    let stock = 0;
    for (const m of allMakes) {
      const stockKey = `${m}|${modelUpper}`;
      stock += stockIndex[stockKey] || 0;
      // Also check partial model matches
      for (const [sk, sv] of Object.entries(stockIndex)) {
        if (!sk.startsWith(m + '|')) continue;
        const sModel = sk.split('|')[1];
        if (sModel !== modelUpper && (modelUpper.includes(sModel) || sModel.includes(modelUpper))) {
          stock += sv;
        }
      }
    }

    const partCount = matchedParts.length;
    const avgPrice = salesDemand.avgPrice > 0 ? salesDemand.avgPrice
      : (partCount > 0 ? matchedParts.reduce((sum, p) => sum + p.price, 0) / partCount : 0);

    // === BUILD PARTS LIST FIRST (needed for scoring) ===
    const parts = [];
    const seenTypes = new Set();
    const { normalizePartNumber } = require('../lib/partNumberUtils');

    // YourSale part types — real signals with YOUR sold prices
    for (const [partType, ptData] of Object.entries(salesDemand.partTypes)) {
      if (seenTypes.has(partType)) continue;
      seenTypes.add(partType);

      // Stock: check by part numbers extracted from sale titles, not by make alone
      let ptStock = 0;
      // Extract part numbers from the sale titles for this part type
      const salePartNums = new Set();
      for (const t of (ptData.titles || [])) {
        const chrysler = t.match(/\b(\d{8})[A-Z]{2}\b/);
        if (chrysler) salePartNums.add(chrysler[1]);
        const toyota = t.match(/\b(\d{5}-[A-Z0-9]{3,5})/);
        if (toyota) salePartNums.add(toyota[1]);
        const ford = t.match(/\b([A-Z]{1,4}\d{1,2}[A-Z]-[A-Z0-9]{4,6})/);
        if (ford) salePartNums.add(ford[1]);
      }
      // Check stock by part number match in stockPartNumbers index
      if (salePartNums.size > 0 && stockPartNumbers) {
        for (const spn of salePartNums) {
          ptStock += stockPartNumbers[spn] || 0;
        }
      }

      const verdict = ptData.count >= 3 ? 'PULL' : ptData.count >= 1 ? 'WATCH' : 'SKIP';
      parts.push({
        itemId: null, title: ptData.titles?.[0] || `${make} ${model} ${partType}`,
        category: null, partNumber: null, partType,
        price: Math.round(ptData.avgPrice), in_stock: ptStock,
        sold_90d: ptData.count, verdict,
        reason: `Sold ${ptData.count}x @ $${Math.round(ptData.avgPrice)} avg`,
        deadWarning: null,
      });
    }

    // Item-based parts — only if partType not already covered
    const seenBasePNs = new Set();
    for (const p of matchedParts) {
      if (!p.partType || seenTypes.has(p.partType)) continue;
      const basePn = p.partNumber ? normalizePartNumber(p.partNumber) : null;
      if (basePn && seenBasePNs.has(basePn)) continue;
      if (basePn) seenBasePNs.add(basePn);
      seenTypes.add(p.partType);

      // Stock: check by this specific part number
      let ptStock = 0;
      if (basePn && stockPartNumbers) ptStock = stockPartNumbers[basePn] || 0;

      parts.push({
        itemId: p.itemId, title: p.title, category: p.category,
        partNumber: p.partNumber, partType: p.partType,
        price: Math.round(p.price), in_stock: ptStock, sold_90d: 0,
        verdict: 'SKIP',
        reason: 'Competitor listed, check YourSale for demand',
        deadWarning: null,
      });
      if (parts.length >= 8) break;
    }

    // === FILTER by VIN-decoded drivetrain and engine type ===
    // Remove parts that don't fit this specific vehicle's configuration
    const vDrivetrain = (vehicle.drivetrain || '').toUpperCase();
    const vEngineType = (vehicle.engine_type || '').toUpperCase();

    const filteredParts = parts.filter(p => {
      const title = (p.title || '').toUpperCase();

      // Hybrid filter: don't show hybrid parts on gas vehicles
      if (vEngineType === 'GAS' || vEngineType === '') {
        if (title.includes('HYBRID') && !title.includes('NON-HYBRID') && !title.includes('NON HYBRID')) return false;
      }
      // Gas filter: don't show gas-only parts on hybrid/diesel vehicles
      if (vEngineType === 'HYBRID' || vEngineType === 'DIESEL') {
        // Only filter if part title explicitly says "GAS ONLY" — most parts fit both
      }
      // Diesel filter: don't show diesel parts on gas vehicles
      if (vEngineType === 'GAS' || vEngineType === '') {
        if (title.includes('DIESEL') || title.includes('CUMMINS') || title.includes('DURAMAX') || title.includes('POWERSTROKE')) return false;
      }

      // Drivetrain filter for ABS modules (these are drivetrain-specific)
      if (p.partType === 'ABS' && vDrivetrain) {
        if (vDrivetrain === '2WD' || vDrivetrain === 'FWD' || vDrivetrain === 'RWD') {
          if (title.includes('4WD') || title.includes('4X4') || title.includes('AWD')) return false;
        }
        if (vDrivetrain === '4WD' || vDrivetrain === 'AWD') {
          if (title.includes('2WD') || (title.includes('FWD') && !title.includes('4WD'))) return false;
        }
      }

      return true;
    });

    filteredParts.sort((a, b) => (b.sold_90d || 0) - (a.sold_90d || 0));

    // === TOTAL VALUE: sum of all FILTERED part prices ===
    const totalValue = filteredParts.reduce((sum, p) => sum + (p.price || 0), 0);

    // === SCORING: factors in part count AND total value ===
    let score = 0;
    const numPullableParts = filteredParts.filter(p => p.sold_90d > 0).length;

    if (salesDemand.count > 0) {
      // Volume: up to 30 from total sales across all part types
      const volumeScore = Math.min(30, salesDemand.count * 3);
      // Parts breadth: up to 25 from number of different sellable part types
      const breadthScore = Math.min(25, numPullableParts * 8);
      // Value: up to 25 from total pull value
      const valueScore = Math.min(25, Math.round(totalValue / 40));
      // Price: up to 20 from avg price per part
      const priceScore = Math.min(20, Math.round(salesDemand.avgPrice / 15));
      score = Math.min(100, volumeScore + breadthScore + valueScore + priceScore);

      // Stock penalty
      if (stock >= 5) score = Math.round(score * 0.5);
      else if (stock >= 3) score = Math.round(score * 0.7);
      else if (stock >= 1) score = Math.round(score * 0.9);
    } else if (partCount > 0) {
      score = Math.min(30, 10 + partCount * 3);
    } else if (make) {
      score = 5;
    }

    if (salesDemand.count > 0 && score < 15) score = 15;

    // Color based on TOTAL ESTIMATED VALUE, not score number
    let color = 'gray';
    if (totalValue >= 800) color = 'green';
    else if (totalValue >= 500) color = 'yellow';
    else if (totalValue >= 250) color = 'orange';
    else if (totalValue > 0) color = 'red';

    // Vehicle-level verdict based on total value
    let vehicle_verdict = 'SKIP';
    if (totalValue >= 800) vehicle_verdict = 'PULL';
    else if (totalValue >= 500) vehicle_verdict = 'WATCH';
    else if (totalValue >= 250) vehicle_verdict = 'CONSIDER';

    // Set per-part verdict based on individual part price
    for (const p of parts) {
      if (p.price >= 300) p.verdict = 'PULL';
      else if (p.price >= 200) p.verdict = 'WATCH';
      else if (p.price >= 100) p.verdict = 'CONSIDER';
      else p.verdict = 'SKIP';
    }

    return {
      id: vehicle.id, year: vehicle.year, make: vehicle.make, model: vehicle.model,
      trim: vehicle.trim, row_number: vehicle.row_number, color: vehicle.color,
      date_added: vehicle.date_added, last_seen: vehicle.last_seen, is_active: vehicle.active,
      vin: vehicle.vin || null,
      engine: vehicle.engine || null,
      engine_type: vehicle.engine_type || null,
      drivetrain: vehicle.drivetrain || null,
      trim_level: vehicle.trim_level || null,
      body_style: vehicle.body_style || null,
      stock_number: vehicle.stock_number || null,
      score, color_code: color, vehicle_verdict,
      est_value: totalValue,
      matched_parts: filteredParts.length,
      avg_part_price: Math.round(salesDemand.avgPrice || avgPrice),
      sales_count: salesDemand.count,
      platform_siblings: platformSiblingNames.length > 0 ? platformSiblingNames : null,
      parts: filteredParts,
    };
  }

  /**
   * Build platform sibling index from platform_group/platform_vehicle tables.
   * Returns a Map: "make|model" → [{ make, model, partTypes }]
   * This allows scoreVehicle to find platform siblings without async queries.
   */
  async buildPlatformIndex() {
    const index = {};
    try {
      const rows = await database.raw(`
        SELECT pv1.make as source_make, pv1.model as source_model,
               pv2.make as sibling_make, pv2.model as sibling_model,
               pg.year_start, pg.year_end, pg.platform,
               array_agg(DISTINCT psp.part_type) as part_types
        FROM platform_vehicle pv1
        JOIN platform_group pg ON pv1.platform_group_id = pg.id
        JOIN platform_vehicle pv2 ON pv2.platform_group_id = pg.id AND pv2.id != pv1.id
        JOIN platform_shared_part psp ON psp.platform_group_id = pg.id
        GROUP BY pv1.make, pv1.model, pv2.make, pv2.model, pg.year_start, pg.year_end, pg.platform
      `);

      for (const row of (rows.rows || rows)) {
        const key = `${row.source_make}|${row.source_model}`.toUpperCase();
        if (!index[key]) index[key] = [];
        index[key].push({
          make: row.sibling_make,
          model: row.sibling_model,
          yearStart: row.year_start,
          yearEnd: row.year_end,
          platform: row.platform,
          partTypes: row.part_types || [],
        });
      }
      this.log.info({ entries: Object.keys(index).length }, 'Platform index built');
    } catch (err) {
      // Tables may not exist yet
      this.log.debug({ err: err.message }, 'Platform index build skipped (tables may not exist)');
    }
    return index;
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
    const { byMakeModel: stockIndex, byPartNumber: stockPartNumbers } = await this.buildStockIndex();
    const platformIndex = await this.buildPlatformIndex();

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
        vQuery = vQuery.where('active', true);
      } else {
        vQuery = vQuery.where(function() {
          this.where('active', true)
            .orWhere('last_seen', '>=', retentionCutoff);
        });
      }

      const vehicles = await vQuery;

      if (vehicles.length === 0) continue;

      const scored = vehicles.map(v =>
        this.scoreVehicle(v, inventoryIndex, salesIndex, stockIndex, platformIndex, stockPartNumbers)
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
        hot_vehicles: scored.filter(v => v.color_code === 'green' || v.color_code === 'yellow').length,
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
