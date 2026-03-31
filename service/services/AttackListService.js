'use strict';

const { log } = require('../lib/logger');
const { database } = require('../database/database');
const { getPlatformMatches } = require('../lib/platformMatch');
const { extractPartNumbers: piExtractPNs, vehicleYearMatchesPart: piYearMatch, modelMatches: piModelMatches, parseYearRange: piParseYearRange, stripRevisionSuffix: piStripSuffix } = require('../utils/partIntelligence');
const { getPartScoreMultiplier } = require('../config/trim-tier-config');
const TrimTierService = require('./TrimTierService');
const { resolvePricesBatch } = require('../lib/priceResolver');

let _inventoryIndexCache = null;
let _inventoryIndexCacheTime = 0;
let _validationCache = null;
let _validationCacheTime = 0;
let _salesIndexCache = null;
let _salesIndexCacheTime = 0;
let _stockIndexCache = null;
let _stockIndexCacheTime = 0;
const INDEX_CACHE_TTL = 10 * 60 * 1000;

function isExcludedPart(title) {
  const t = title.toUpperCase();
  const excluded = [
    /\bENGINE ASSEMBLY\b/, /\bMOTOR ASSEMBLY\b/, /\bLONG BLOCK\b/, /\bSHORT BLOCK\b/,
    /\bCOMPLETE ENGINE\b/, /\bCRATE ENGINE\b/, /\bREMAN ENGINE\b/,
    /\bTRANSMISSION ASSEMBLY\b/, /\bTRANSAXLE ASSEMBLY\b/, /\bCOMPLETE TRANSMISSION\b/,
    /\bREMAN TRANSMISSION\b/,
    /\bPISTON\b/, /\bCRANKSHAFT\b/, /\bCONNECTING ROD\b/, /\bHEAD GASKET\b/,
    /\bOIL PAN\b/, /\bTIMING CHAIN\b/, /\bTIMING BELT\b/, /\bENGINE BLOCK\b/,
    /\bCYLINDER HEAD\b/, /\bROCKER ARM\b/, /\bLIFTER\b/, /\bPUSHROD\b/,
    /\bOIL PUMP\b/, /\bFLYWHEEL\b/, /\bFLEXPLATE\b/,
    /\bFENDER\b/, /\bBUMPER COVER\b/, /\bHOOD PANEL\b/, /\bDOOR SHELL\b/,
    /\bQUARTER PANEL\b/, /\bROCKER PANEL\b/, /\bBED SIDE\b/, /\bTRUCK BED\b/,
    /\bTRANSFER CASE\b/, /\bXFER CASE\b/, /\bSTEERING RACK\b/, /\bSTEERING GEAR\b/
  ];
  return excluded.some(rx => rx.test(t));
}

// Part types that require EXACT year matching (no ±1 tolerance)
// These are PN-specific electronic modules — a 2013 TIPM is NOT a 2014 TIPM
const PN_EXACT_YEAR_TYPES = new Set([
  'ECM', 'PCM', 'ECU', 'BCM', 'TIPM', 'ABS', 'TCM', 'TCU',
  'FUSE', 'JUNCTION', 'AMPLIFIER', 'AMP', 'RADIO', 'CLUSTER',
  'INSTRUMENT', 'SPEEDOMETER', 'THROTTLE'
]);

function partRequiresExactYear(title) {
  const upper = (title || '').toUpperCase();
  for (const type of PN_EXACT_YEAR_TYPES) {
    if (upper.includes(type)) return true;
  }
  return false;
}

// Conservative sell-price estimates by part type.
// Based on DynaTrack actual sold averages — used when market cache has no data.
// NEVER fall back to Item.price (frozen competitor/programmed listing prices).
const CONSERVATIVE_SELL_ESTIMATES = {
  'ECM': 175, 'BCM': 125, 'TCM': 150, 'ABS': 200,
  'TIPM': 140, 'CLUSTER': 110, 'RADIO': 100, 'AMP': 130,
  'THROTTLE': 130, 'STEERING': 190, 'REGULATOR': 60,
  'MIRROR': 110, 'SUNROOF': 160, 'FUEL_MODULE': 90,
  'OTHER': 100,
};

function cleanNHTSATrim(raw) {
  if (!raw) return null;
  let t = raw.trim();
  if (!t || t.length === 0) return null;

  // --- Junk codes: return null ---
  const JUNK_EXACT = new Set([
    'nfa','nfb','nfc','cma','std','sa','hev','phev',
    'n/a','na','unknown','standard','unspecified','base',
    'styleside','flareside','stepside','sportside',
    'crew','crew cab','regular cab','extended cab','supercab','supercrew','double cab','quad cab','king cab','access cab',
    'middle level','middle-low level','high level','low level',
    'middle grade','middle-low grade','high grade','low grade',
    'xdrive','sdrive','4matic','quattro','awd','fwd','rwd','4x4','4x2','2wd','4wd',
    'leather','cloth','premium cloth',
    'f-series','f series',
    'jetta','jetta, s',
  ]);
  if (JUNK_EXACT.has(t.toLowerCase())) return null;

  // --- Strip parenthetical NHTSA descriptors: "GLS(Middle grade)" → "GLS" ---
  t = t.replace(/\s*\([^)]*\)\s*/g, '').trim();

  // --- Strip engine descriptors NHTSA stuffs into trim: "EX V-6 W/LEA" → "EX W/LEA" ---
  t = t.replace(/\b[VIL][\-\s]?\d\b/gi, '').trim();           // V-6, V6, I4, L4, V-8
  t = t.replace(/\b\d\.\d[A-Z]?\s*(L|LITER)?\b/gi, '').trim(); // 3.5L, 2.4, 5.0L

  // --- Normalize leather/navigation/entertainment shorthand ---
  t = t.replace(/\bW\/LEA(THER)?\b/gi, '-L').trim();    // W/LEA → -L suffix
  t = t.replace(/\bWITH\s+LEATHER\b/gi, '-L').trim();   // WITH LEATHER → -L
  t = t.replace(/\bW\/NAV(I|IGATION)?\b/gi, '').trim(); // W/NAV → strip
  t = t.replace(/\bW\/RES\b/gi, '').trim();              // W/RES → strip (rear entertainment)
  t = t.replace(/\bWITH\s+RES\b/gi, '').trim();         // WITH RES → strip
  t = t.replace(/\bWITH\s+NAV(IGATION)?\b/gi, '').trim();

  // --- Collapse spacing artifacts: "EX -L" → "EX-L" ---
  t = t.replace(/\s+\-/g, '-').replace(/\-\s+/g, '-').replace(/\s+/g, ' ').trim();

  // --- Handle comma-separated NHTSA lists: "LE,CE" → pick premium ---
  if (/,/.test(t)) {
    const parts = t.split(',').map(p => p.trim()).filter(p => p.length > 0);
    if (parts.length > 0) {
      const premiumKeywords = ['limited','platinum','denali','laramie','overland','ltz','premier',
        'titanium','sel','srt','gt','sport','touring','ex-l','exl','technology','premium',
        'luxury','performance','navigation','navi'];
      const premium = parts.find(p => premiumKeywords.some(k => p.toLowerCase().includes(k)));
      t = premium || parts[0];
    }
  }

  // --- Handle slash-separated NHTSA lists: "SE / SE NAVI / Limited" → pick premium ---
  if (/\s*\/\s*/.test(t) && t.includes('/')) {
    const parts = t.split('/').map(p => p.trim()).filter(p => p.length > 0);
    if (parts.length > 1) {
      const premiumKeywords = ['limited','platinum','denali','laramie','overland','ltz','premier',
        'titanium','sel','srt','gt','sport','touring','ex-l','exl','technology','premium',
        'luxury','performance','navigation','navi'];
      const premium = parts.find(p => premiumKeywords.some(k => p.toLowerCase().includes(k)));
      t = premium || parts[parts.length - 1];
    }
  }

  // --- Normalize common NHTSA verbose patterns ---
  const NORMALIZATIONS = [
    [/^ex[\s\-]*l$/i, 'EX-L'],
    [/^ex\s+with\s+leather$/i, 'EX-L'],
    [/^ex\s+with\s+navigation$/i, 'EX-L'],
    [/^lt\s*\(?\s*1lt\s*\)?$/i, '1LT'],
    [/^lt\s*\(?\s*2lt\s*\)?$/i, '2LT'],
    [/^lt\s*\(?\s*3lt\s*\)?$/i, '3LT'],
    [/^ls\s*\(?\s*1ls\s*\)?$/i, 'LS'],
    [/^gls\s*popular$/i, 'GLS'],
    [/^gls\s*preferred$/i, 'GLS'],
    [/^gl\s*popular$/i, 'GL'],
    [/^gl\s*preferred$/i, 'GL'],
  ];
  for (const [pattern, replacement] of NORMALIZATIONS) {
    if (pattern.test(t)) {
      t = replacement;
      break;
    }
  }

  // --- Mercedes/BMW/Lexus/Infiniti model numbers as trim → null ---
  if (/^[A-Z]{0,3}\d{2,3}[A-Z]?$/i.test(t)) return null;  // C300, E320, 350, ES350, M35
  if (/^\d\.\d[a-z]{1,2}$/i.test(t)) return null;          // 3.0si, 4.4i, 2.5i

  // --- Too long = NHTSA garbage ---
  if (t.length > 30) return null;
  // --- Too short (single char or empty after stripping) ---
  if (t.length < 2) return null;

  return t;
}

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
  // TCM/TCU must come BEFORE ECM — "Transmission Control Module" != ECM
  if (t.includes('TCM') || t.includes('TCU') || t.includes('TRANSMISSION CONTROL')) return 'TCM';
  if (t.includes('BCM') || t.includes('BODY CONTROL')) return 'BCM';
  if (t.includes('ECM') || t.includes('ECU') || t.includes('PCM') || t.includes('ENGINE CONTROL') || t.includes('ENGINE COMPUTER')) return 'ECM';
  if (t.includes('ABS') || t.includes('ANTI LOCK') || t.includes('ANTI-LOCK') || t.includes('BRAKE MODULE')) return 'ABS';
  if (t.includes('TIPM') || t.includes('FUSE BOX') || t.includes('JUNCTION') || t.includes('RELAY BOX') || t.includes('IPDM')) return 'TIPM';
  if (t.includes('AMPLIFIER') || t.includes('BOSE') || t.includes('HARMAN') || t.includes('ALPINE') || t.includes('JBL')) return 'AMP';
  if (t.includes('CLUSTER') || t.includes('SPEEDOMETER') || t.includes('INSTRUMENT') || t.includes('GAUGE')) return 'CLUSTER';
  if (t.includes('RADIO') || t.includes('HEAD UNIT') || t.includes('INFOTAINMENT') || t.includes('STEREO')) return 'RADIO';
  if (t.includes('THROTTLE')) return 'THROTTLE';
  if (t.includes('STEERING') || t.includes('EPS')) return 'STEERING';
  if (t.includes('TRANSFER CASE') || t.includes('XFER CASE')) return null; // never pull these
  if (t.includes('WINDOW') && t.includes('REGULATOR')) return 'REGULATOR';
  if (t.includes('MIRROR')) return 'MIRROR';
  if (t.includes('SUNROOF') || t.includes('MOONROOF') || t.includes('MOON ROOF') || t.includes('SUN ROOF')) return 'SUNROOF';
  if (t.includes('FUEL PUMP DRIVER') || t.includes('FUEL PUMP MODULE') || t.includes('FUEL PUMP CONTROL')) return 'FUEL_MODULE';
  return null;
}

/**
 * Clean up stored engine strings for display.
 * "2.671000L" → "2.7L", "3.211864544L" → "3.2L", "2.2L 170cyl" → "2.2L"
 */
function formatEngineDisplay(engine) {
  if (!engine) return null;
  let e = engine.replace(/\s*\d{2,3}cyl/i, '').trim();
  // Round raw NHTSA decimals: "2.671000L" → "2.7L"
  e = e.replace(/(\d+\.\d+)L/i, (match, num) => {
    return parseFloat(num).toFixed(1) + 'L';
  });
  // Strip trailing horsepower numbers NHTSA appends: "1.6L 106." → "1.6L"
  e = e.replace(/\s+\d{2,3}\.?\s*$/, '').trim();
  return e || null;
}

/**
 * Recency weight for a sale based on how recently it sold.
 * Last 30 days = 1.0, 30-90 days = 0.75, 90-180 days = 0.5, older = 0.25
 */
function recencyWeight(soldDate) {
  if (!soldDate) return 0.25;
  const daysAgo = Math.floor((Date.now() - new Date(soldDate).getTime()) / 86400000);
  if (daysAgo <= 30) return 1.0;
  if (daysAgo <= 90) return 0.75;
  if (daysAgo <= 180) return 0.5;
  return 0.25;
}

/**
 * Calculate recency-weighted average price from an array of {price, soldDate}.
 */
function weightedAvgPrice(sales) {
  if (!sales || sales.length === 0) return 0;
  let weightedSum = 0, weightSum = 0;
  for (const s of sales) {
    const w = recencyWeight(s.soldDate);
    weightedSum += (s.price || 0) * w;
    weightSum += w;
  }
  return weightSum > 0 ? Math.round(weightedSum / weightSum) : 0;
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
    // Sort: highest single part value first, then total value as tiebreaker
    scored.sort((a, b) => {
      const maxDiff = (b.max_part_value || 0) - (a.max_part_value || 0);
      if (maxDiff !== 0) return maxDiff;
      return b.est_value - a.est_value;
    });

    // Enrich with cached market data (async context — safe to await here)
    try {
      const { getCachedPrice, buildSearchQuery: buildMktQuery } = require('./MarketPricingService');
      for (const vehicle of scored) {
        if (!vehicle.parts) continue;
        const vYear = parseInt(vehicle.year) || 0;
        for (const p of vehicle.parts) {
          // Build cache key SAME WAY as MarketPricingService.buildSearchQuery
          const sq = buildMktQuery({
            title: p.title || '',
            make: vehicle.make,
            model: vehicle.model,
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
      }
    } catch (e) { /* market data optional */ }

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
    const _now = Date.now();
    if (_inventoryIndexCache && (_now - _inventoryIndexCacheTime) < INDEX_CACHE_TTL) {
      return _inventoryIndexCache;
    }
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
          'Item.quantity', 'Item.seller', 'Item.isRepair'
        );

      // Pre-load cache prices to overlay on frozen Item.price
      const allPNs = rows.map(r => r.manufacturerPartNumber).filter(Boolean);
      const itemPriceMap = new Map();
      for (const r of rows) { if (r.manufacturerPartNumber) itemPriceMap.set(r.manufacturerPartNumber, parseFloat(r.price) || 0); }
      const cacheIndex = await resolvePricesBatch(allPNs, { itemPrices: itemPriceMap });

      for (const row of rows) {
        const key = `${row.make.toLowerCase()}|${row.model.toLowerCase()}|${row.year}`;
        if (!index[key]) {
          index[key] = { items: [], count: 0, totalValue: 0, avgPrice: 0 };
        }
        const entry = index[key];
        if (!entry.items.some(i => i.itemId === row.itemId)) {
          const isRebuild = row.seller === 'pro-rebuild' || row.isRepair === true;
          // Use cache price when available; NEVER fall back to Item.price (frozen listing data)
          const resolved = row.manufacturerPartNumber ? cacheIndex.get(row.manufacturerPartNumber) : null;
          let effectivePrice, priceSource;
          if (resolved && resolved.price > 0 && resolved.source !== 'none') {
            effectivePrice = resolved.price;
            priceSource = resolved.source; // 'market_cache'
          } else {
            // Conservative sell estimate by part type — replaces stale Item.price fallback
            const pt = detectPartType(row.title + ' ' + (row.categoryTitle || '')) || 'OTHER';
            effectivePrice = CONSERVATIVE_SELL_ESTIMATES[pt] || CONSERVATIVE_SELL_ESTIMATES['OTHER'];
            priceSource = 'estimate';
          }
          entry.items.push({
            itemId: row.itemId,
            title: row.title,
            price: effectivePrice,
            priceSource,
            category: row.categoryTitle,
            partNumber: row.manufacturerPartNumber,
            partNumberBase: row.manufacturerPartNumber,
            quantity: parseInt(row.quantity) || 1,
            partType: detectPartType(row.title + ' ' + (row.categoryTitle || '')) || 'OTHER',
            seller: row.seller || null,
            isRebuild,
          });
          entry.count++;
          if (!isRebuild) {
            entry.totalValue += effectivePrice;
            entry.avgPrice = entry.count > 0 ? entry.totalValue / entry.count : 0;
          }
        }
      }
    } catch (err) {
      this.log.warn({ err: err.message }, 'buildInventoryIndex: tables not ready');
    }
    _inventoryIndexCache = index;
    _inventoryIndexCacheTime = Date.now();
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
    const _now = Date.now();
    if (_salesIndexCache && (_now - _salesIndexCacheTime) < INDEX_CACHE_TTL) {
      return _salesIndexCache;
    }
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

        const partType = detectPartType(title) || 'OTHER';
        const yearRange = this.extractYearRange(title);

        const key = `${make.toLowerCase()}|${model.toLowerCase()}`;
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
    _salesIndexCache = index;
    _salesIndexCacheTime = Date.now();
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
    const _now = Date.now();
    if (_stockIndexCache && (_now - _stockIndexCacheTime) < INDEX_CACHE_TTL) {
      return _stockIndexCache;
    }
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
            const key = `${make.toLowerCase()}|${model.toLowerCase()}`;
            byMakeModel[key] = (byMakeModel[key] || 0) + qty;
          }
        }

        // Index by part number (from SKU and title)
        if (listing.sku) {
          const base = normalizePartNumber(listing.sku);
          if (base && base.length >= 5) byPartNumber[base] = (byPartNumber[base] || 0) + qty;
        }
        // Extract PNs from title using shared partIntelligence
        const pns = piExtractPNs(title);
        for (const pn of pns) {
          byPartNumber[pn.normalized] = (byPartNumber[pn.normalized] || 0) + qty;
          if (pn.base !== pn.normalized) byPartNumber[pn.base] = (byPartNumber[pn.base] || 0) + qty;
        }
      }
    } catch (err) {
      this.log.warn({ err: err.message }, 'buildStockIndex: YourListing table not ready');
    }
    _stockIndexCache = { byMakeModel, byPartNumber };
    _stockIndexCacheTime = Date.now();
    return { byMakeModel, byPartNumber };
  }

  /**
   * Find matching inventory parts for a vehicle across all compatible makes.
   */
  findMatchedParts(make, model, year, inventoryIndex, vehicleEngine) {
    let matchedParts = [];
    const alsoCheck = MAKE_ALSO_CHECK[make] || [];
    const allMakes = [make, ...alsoCheck];

    // Collect candidate items from ±1 year in inventory index
    const candidates = [];
    for (const m of allMakes) {
      for (let y = year - 1; y <= year + 1; y++) {
        const key = `${m.toLowerCase()}|${model.toLowerCase()}|${y}`;
        const match = inventoryIndex[key];
        if (match) {
          for (const item of match.items) {
            if (!candidates.some(p => p.itemId === item.itemId)) candidates.push(item);
          }
        }
      }
    }

    // Word-boundary model match with ±1 year if no exact hits
    // "Grand Cherokee" must NOT match "Cherokee" — require exact word boundary
    // TODO: migrate to partIntelligence.modelMatches() for consistency
    if (candidates.length === 0) {
      const modelNorm = model.toLowerCase().replace(/[-]/g, ' ').trim();
      const modelRe = new RegExp('\\b' + modelNorm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i');
      for (const [key, entry] of Object.entries(inventoryIndex)) {
        const [iMake, iModel, iYear] = key.split('|');
        const iYearNum = parseInt(iYear);
        if (iYearNum < year - 1 || iYearNum > year + 1) continue;
        if (!allMakes.map(m => m.toLowerCase()).includes(iMake)) continue;
        const iModelNorm = iModel.replace(/[-]/g, ' ').trim();
        // One-directional: exact match OR vehicle model appears in inventory model
        // Cherokee (inventory) must NOT match Grand Cherokee (vehicle)
        if (modelNorm === iModelNorm || modelRe.test(iModelNorm)) {
          for (const item of entry.items) {
            if (!candidates.some(p => p.itemId === item.itemId)) candidates.push(item);
          }
        }
      }
    }

    // VALIDATE each candidate: check title for year range and engine compatibility
    for (const item of candidates) {
      const title = (item.title || '').toUpperCase();

      // Year filtering: PN-specific parts require EXACT year match.
      // Generational parts (mirrors, handles, trim) get ±1 tolerance.
      const pns = piExtractPNs(item.title || '');
      const hasPn = pns.length > 0;
      const needsExactYear = hasPn || partRequiresExactYear(item.title || '');
      const range = piParseYearRange(item.title || '');

      if (needsExactYear) {
        // PN parts: strict year match only, no tolerance
        if (!range) continue; // No year in title + has PN = can't confirm year, skip
        if (year < range.start || year > range.end) continue;
      } else {
        // Generational parts: allow ±1 year tolerance
        if (range) {
          if (year < range.start - 1 || year > range.end + 1) continue;
        }
        // No year in title for non-PN part — allow (generic/generational)
      }

      // Engine displacement check — if both vehicle and part specify displacement, they must match
      if (vehicleEngine) {
        const vDispMatch = vehicleEngine.toUpperCase().match(/(\d+\.\d)/);
        const pDispMatch = title.match(/(\d+\.\d)L/);
        if (vDispMatch && pDispMatch && vDispMatch[1] !== pDispMatch[1]) continue;
      }

      // Title-based model sanity check: catch bad Auto table links
      // If the part title names a DIFFERENT model than the vehicle, skip it
      const vehicleModelUpper = model.toUpperCase();
      if (title.includes('CHEROKEE') && !title.includes('GRAND CHEROKEE') && vehicleModelUpper.includes('GRAND CHEROKEE')) continue;
      if (title.includes('GRAND CHEROKEE') && !vehicleModelUpper.includes('GRAND CHEROKEE') && vehicleModelUpper.includes('CHEROKEE')) continue;
      if (title.includes('CARAVAN') && !title.includes('GRAND CARAVAN') && vehicleModelUpper.includes('GRAND CARAVAN')) continue;
      if (title.includes('TRANSIT') && !title.includes('TRANSIT CONNECT') && vehicleModelUpper.includes('TRANSIT CONNECT')) continue;
      if (title.includes('TRANSIT CONNECT') && !vehicleModelUpper.includes('TRANSIT CONNECT') && vehicleModelUpper.includes('TRANSIT')) continue;

      matchedParts.push(item);
    }

    return matchedParts;
  }

  /**
   * Score a single yard vehicle. Returns enriched vehicle object with per-part verdicts.
   */
  scoreVehicle(vehicle, inventoryIndex, salesIndex, stockIndex, platformIndex = {}, stockPartNumbers = {}, markIndex = { byPN: new Map(), byTitle: new Set() }) {
    const make = normalizeMake(vehicle.make);
    const model = (vehicle.model || '').trim();
    const year = parseInt(vehicle.year) || 0;
    const modelLower = model.toLowerCase();

    // Find matching inventory parts (from Auto+Item tables — may be empty)
    let matchedParts = [];
    if (make && model && year) {
      matchedParts = this.findMatchedParts(make, model, year, inventoryIndex, vehicle.engine);
    }

    // Find matching sales from YourSale by make+model+year
    const salesDemand = { count: 0, avgPrice: 0, totalRevenue: 0, partTypes: {} };
    const alsoCheck = make ? (MAKE_ALSO_CHECK[make] || []) : [];
    const allMakes = [make, ...alsoCheck].filter(Boolean);

    // Collect all candidate salesIndex entries by make+model (exact + partial model)
    const candidateKeys = new Set();
    for (const m of allMakes) {
      const exactKey = `${m.toLowerCase()}|${modelLower}`;
      if (salesIndex[exactKey]) candidateKeys.add(exactKey);
      // One-directional model match: vehicle model must appear in sale model.
      // "Grand Cherokee" (vehicle) matches "Grand Cherokee" (sale) — yes.
      // "Cherokee" (sale) must NOT match "Grand Cherokee" (vehicle) — removed reverse check.
      for (const sKey of Object.keys(salesIndex)) {
        if (!sKey.startsWith(m.toLowerCase() + '|')) continue;
        const sModel = sKey.split('|')[1];
        if (sModel && piModelMatches(sModel, model)) {
          candidateKeys.add(sKey);
        }
      }
    }

    // Platform cross-reference: add sibling make+model keys
    // e.g., Chrysler 300 → also match Dodge Charger, Dodge Challenger, Dodge Magnum
    const platformKey = `${make}|${model}`.toUpperCase();
    const siblings = platformIndex[platformKey] || [];
    let platformSiblingNames = [];
    for (const sib of siblings) {
      // Only include siblings whose year range covers this vehicle
      if (year >= sib.yearStart && year <= sib.yearEnd) {
        const sibModelLower = sib.model.toLowerCase();
        const sibKey = `${sib.make.toLowerCase()}|${sibModelLower}`;
        if (salesIndex[sibKey]) candidateKeys.add(sibKey);
        // Also word-boundary match siblings
        const sibRe = new RegExp('\\b' + sibModelLower.replace(/[-]/g, ' ').replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i');
        for (const sKey of Object.keys(salesIndex)) {
          if (!sKey.startsWith(sib.make.toLowerCase() + '|')) continue;
          const sModel = sKey.split('|')[1];
          if (sModel && sibRe.test(sModel.replace(/[-]/g, ' '))) {
            candidateKeys.add(sKey);
          }
        }
        platformSiblingNames.push(`${sib.make} ${sib.model}`);
      }
    }

    // Filter each candidate's individual sales by year range
    // PN-specific parts: strict year match. Generational parts: ±1 tolerance.
    const allMatchedSales = [];
    for (const cKey of candidateKeys) {
      const entry = salesIndex[cKey];
      for (const sale of entry.sales) {
        const saleHasPn = piExtractPNs(sale.title || '').length > 0;
        const saleNeedsExactYear = saleHasPn || partRequiresExactYear(sale.title || '');

        if (sale.yearStart > 0 && sale.yearEnd > 0) {
          if (saleNeedsExactYear) {
            // PN parts: strict year match, no tolerance
            if (year < sale.yearStart || year > sale.yearEnd) continue;
          } else {
            // Generational parts: ±1 tolerance
            if (year < sale.yearStart - 1 || year > sale.yearEnd + 1) continue;
          }
        } else {
          // No year in sale title
          if (saleNeedsExactYear) {
            continue; // PN part with no year = can't confirm, skip
          }
          // Generational part with no year — skip for old vehicles
          const currentYear = new Date().getFullYear();
          if (year < currentYear - 15) continue;
        }
        // Year matches — count this sale
        salesDemand.count++;
        salesDemand.totalRevenue += sale.price;
        allMatchedSales.push(sale);

        if (sale.partType) {
          if (!salesDemand.partTypes[sale.partType]) {
            salesDemand.partTypes[sale.partType] = { count: 0, sales: [], titles: [] };
          }
          const pt = salesDemand.partTypes[sale.partType];
          pt.count++;
          pt.sales.push({ price: sale.price, soldDate: sale.soldDate });
          if (pt.titles.length < 3) pt.titles.push(sale.title);
        }
      }
    }
    // Recency-weighted avg across all matched sales
    salesDemand.avgPrice = weightedAvgPrice(allMatchedSales.map(s => ({ price: s.price, soldDate: s.soldDate })));

    // Current stock from YourListing — match by make+model, not just make
    let stock = 0;
    for (const m of allMakes) {
      const stockKey = `${m.toLowerCase()}|${modelLower}`;
      stock += stockIndex[stockKey] || 0;
      // Also check word-boundary model matches (F-150 = F150, NOT Cherokee = Grand Cherokee)
      const stockModelRe = new RegExp('\\b' + modelLower.replace(/[-]/g, ' ').replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i');
      for (const [sk, sv] of Object.entries(stockIndex)) {
        if (!sk.startsWith(m.toLowerCase() + '|')) continue;
        const sModel = sk.split('|')[1];
        if (sModel !== modelLower && stockModelRe.test(sModel.replace(/[-]/g, ' '))) {
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

      // Stock: check by part numbers extracted from sale titles
      // Try exact PN first, fall back to base ONLY if exact returns 0
      // Never sum both — base includes exact, so summing double counts
      let ptStock = 0;
      const exactPNs = [];
      const basePNs = [];
      for (const t of (ptData.titles || [])) {
        const pns = piExtractPNs(t);
        for (const pn of pns) {
          exactPNs.push(pn.normalized);
          if (pn.base !== pn.normalized) basePNs.push(pn.base);
        }
      }
      if (stockPartNumbers) {
        // Try exact normalized PNs first
        for (const pn of exactPNs) {
          if (stockPartNumbers[pn]) { ptStock = stockPartNumbers[pn]; break; }
        }
        // Only fall back to base if exact found nothing
        if (ptStock === 0) {
          for (const pn of basePNs) {
            if (stockPartNumbers[pn]) { ptStock = stockPartNumbers[pn]; break; }
          }
        }
      }

      // Recency-weighted avg price for this part type
      const ptWeightedAvg = weightedAvgPrice(ptData.sales);
      const verdict = ptWeightedAvg >= 250 ? 'GREAT' : ptWeightedAvg >= 150 ? 'GOOD' : ptWeightedAvg >= 100 ? 'FAIR' : 'POOR';
      // Find most recent sale date for this part type
      const lastSold = ptData.sales.reduce((latest, s) => {
        if (!s.soldDate) return latest;
        return (!latest || new Date(s.soldDate) > new Date(latest)) ? s.soldDate : latest;
      }, null);
      parts.push({
        itemId: null, title: ptData.titles?.[0] || `${make} ${model} ${partType}`,
        category: null, partNumber: null, partType,
        price: ptWeightedAvg, priceSource: 'sold', in_stock: ptStock,
        sold_90d: ptData.count, verdict, lastSoldDate: lastSold,
        reason: `Sold ${ptData.count}x @ $${ptWeightedAvg} avg (recency-weighted)`,
        deadWarning: null,
      });
    }

    // Item-based parts — dedup by base part number, separate rebuild
    const mergedByBase = {};  // basePn → merged entry
    const rebuildParts = [];

    for (const p of matchedParts) {
      if (isExcludedPart(p.title || '')) continue;
      const basePn = p.partNumber ? normalizePartNumber(p.partNumber) : null;

      if (p.isRebuild) {
        // Group rebuild parts by partType+seller
        const rbKey = `_rb_${p.partType}_${p.seller || 'pro-rebuild'}`;
        if (mergedByBase[rbKey]) {
          const rb = mergedByBase[rbKey];
          rb._count++;
          if (p.price < rb._minPrice) rb._minPrice = p.price;
          if (p.price > rb._maxPrice) rb._maxPrice = p.price;
        } else {
          mergedByBase[rbKey] = {
            partType: p.partType, seller: p.seller || 'pro-rebuild',
            _count: 1, _minPrice: p.price, _maxPrice: p.price,
          };
        }
        continue;
      }

      // Skip if this partType was already covered by YourSale data
      if (seenTypes.has(p.partType) && !basePn) continue;

      const key = basePn || (p.partType + '_noPN_' + p.itemId);

      if (mergedByBase[key]) {
        // Merge: keep higher price, combine part numbers and types
        const existing = mergedByBase[key];
        if (p.price > existing._rawPrice) {
          existing._rawPrice = p.price;
          existing.price = Math.round(p.price);
          existing.priceSource = p.priceSource || 'estimate';
          existing.title = p.title;
          existing.itemId = p.itemId;
        }
        if (p.partNumber && !existing._allPNs.includes(p.partNumber)) {
          existing._allPNs.push(p.partNumber);
          existing.partNumber = existing._allPNs.join(' / ');
        }
        if (p.partType && !existing._allTypes.includes(p.partType)) {
          existing._allTypes.push(p.partType);
          existing.partType = existing._allTypes.join('/');
        }
      } else {
        // New entry
        let ptStock = 0;
        if (basePn && stockPartNumbers) ptStock = stockPartNumbers[basePn] || 0;
        mergedByBase[key] = {
          itemId: p.itemId, title: p.title, category: p.category,
          partNumber: p.partNumber, partType: p.partType,
          price: Math.round(p.price), priceSource: p.priceSource || 'estimate',
          in_stock: ptStock, sold_90d: 0,
          verdict: 'SKIP', seller: p.seller || null,
          reason: 'Competitor listed, check YourSale for demand',
          isRebuild: false, deadWarning: null,
          _rawPrice: p.price,
          _allPNs: p.partNumber ? [p.partNumber] : [],
          _allTypes: p.partType ? [p.partType] : [],
        };
      }
    }

    // Add merged parts to parts array (skip types already covered by YourSale)
    for (const [key, entry] of Object.entries(mergedByBase)) {
      if (!entry || key.startsWith('_rb_')) continue;
      // Skip if ALL part types in this merged entry are already covered
      const types = entry._allTypes || [entry.partType];
      if (types.every(t => seenTypes.has(t))) continue;
      for (const t of types) seenTypes.add(t);
      // Clean internal fields
      delete entry._rawPrice;
      delete entry._allPNs;
      delete entry._allTypes;
      parts.push(entry);
      if (parts.length >= 8) break;
    }

    // === FILTER by VIN-decoded drivetrain and engine type ===
    // Remove parts that don't fit this specific vehicle's configuration
    const vDrivetrain = (vehicle.drivetrain || '').toUpperCase();
    const vEngineType = (vehicle.engine_type || '').toUpperCase();

    const vEngine = (vehicle.engine || '').toUpperCase();

    const filteredParts = parts.filter(p => {
      const title = (p.title || '').toUpperCase();
      const pt = (p.partType || '').toUpperCase();

      // 1. EXCLUDE transfer case — never pull these
      if (pt.includes('XFER') || pt.includes('TRANSFER') || title.includes('TRANSFER CASE') || title.includes('XFER CASE')) return false;

      // 2. YEAR RANGE CHECK — if title has a year range, vehicle must fit within it
      if (year > 0) {
        // Match "02-03", "2002-2003", "00-02", "1999-2001" patterns
        const rangeMatch = title.match(/\b((?:19|20)?\d{2})\s*[-–]\s*((?:19|20)?\d{2})\b/);
        if (rangeMatch) {
          let y1 = parseInt(rangeMatch[1]), y2 = parseInt(rangeMatch[2]);
          // Convert 2-digit years: 02 → 2002, 99 → 1999
          if (y1 < 100) y1 += y1 >= 70 ? 1900 : 2000;
          if (y2 < 100) y2 += y2 >= 70 ? 1900 : 2000;
          if (y1 > y2) { const tmp = y1; y1 = y2; y2 = tmp; }
          // Vehicle year must fall within the part's year range
          if (year < y1 || year > y2) return false;
        }
        // Single year in title with no range — must match within ±1
        const singleYears = title.match(/\b((?:19|20)\d{2})\b/g);
        if (singleYears && singleYears.length === 1 && !rangeMatch) {
          const partYear = parseInt(singleYears[0]);
          if (Math.abs(year - partYear) > 1) return false;
        }
      }

      // Fuel type filters
      if (vEngineType === 'GAS' || vEngineType === '') {
        if (title.includes('HYBRID') && !title.includes('NON-HYBRID') && !title.includes('NON HYBRID')) return false;
        if (title.includes('DIESEL') || title.includes('CUMMINS') || title.includes('DURAMAX') || title.includes('POWERSTROKE')) return false;
      }

      // Drivetrain filter
      if (vDrivetrain) {
        if (vDrivetrain === '2WD' || vDrivetrain === 'FWD' || vDrivetrain === 'RWD') {
          if (title.includes('4WD') || title.includes('4X4') || title.includes('AWD')) return false;
        }
        if (vDrivetrain === '4WD' || vDrivetrain === 'AWD') {
          if (title.includes('2WD') || (title.includes('FWD') && !title.includes('4WD'))) return false;
        }
      }

      // Engine displacement mismatch — if both have a specific size, they must match
      if (vEngine) {
        // Extract displacement from vehicle: "4.6L V8" → "4.6"
        const vDispMatch = vEngine.match(/(\d+\.\d)L/);
        if (vDispMatch) {
          const vDisp = vDispMatch[1]; // e.g. "4.6"
          // Extract displacement from part title: "5.4L" → "5.4"
          const pDispMatch = title.match(/(\d+\.\d)L/);
          if (pDispMatch) {
            const pDisp = pDispMatch[1]; // e.g. "5.4"
            // Both have specific displacements and they don't match → exclude
            if (vDisp !== pDisp) return false;
          }
          // No displacement in title → could fit multiple engines → include
        }
      }

      return true;
    });

    filteredParts.sort((a, b) => (b.sold_90d || 0) - (a.sold_90d || 0));

    // === TRIM INTELLIGENCE: adjust trim-dependent part scores ===
    const vehicleTrim = cleanNHTSATrim(vehicle.decoded_trim) || cleanNHTSATrim(vehicle.trim_level) || vehicle.trim || null;
    for (const p of filteredParts) {
      const trimResult = getPartScoreMultiplier(make, vehicleTrim, p.partType);
      p.trimMultiplier = trimResult.multiplier;
      p.trimNote = trimResult.reason;
      if (trimResult.badge) p.trimBadge = trimResult.badge;
      if (trimResult.multiplier < 1.0 && p.price) {
        p.originalPrice = p.price;
        p.price = Math.round(p.price * trimResult.multiplier);
      }
    }

    // === MARK BOOST: parts matching the_mark get +15 bonus ===
    for (const p of filteredParts) {
      const pnUpper = (p.partNumber || '').toUpperCase();
      const pnBase = (p.partNumberBase || pnUpper).toUpperCase();
      if ((pnBase && markIndex.byPN.has(pnBase)) || (pnUpper && markIndex.byPN.has(pnUpper))) {
        p.isMarked = true;
      }
    }

    // === TOTAL VALUE: sum of all FILTERED part prices (trim-adjusted) ===
    const totalValue = filteredParts.reduce((sum, p) => sum + (p.price || 0), 0);

    // Market data enrichment happens in getAttackList() after scoring (async context)

    // === SCORING: driven primarily by total dollar value ===
    let score = 0;

    if (totalValue >= 1000) score = 90 + Math.min(10, Math.round((totalValue - 1000) / 100));
    else if (totalValue >= 800) score = 80 + Math.round((totalValue - 800) / 22);
    else if (totalValue >= 600) score = 70 + Math.round((totalValue - 600) / 22);
    else if (totalValue >= 400) score = 60 + Math.round((totalValue - 400) / 22);
    else if (totalValue >= 250) score = 50 + Math.round((totalValue - 250) / 17);
    else if (totalValue >= 150) score = 40 + Math.round((totalValue - 150) / 11);
    else if (totalValue > 0) score = 20 + Math.round(totalValue / 8);
    else score = 5;

    // Bonus: extra parts beyond 1
    score += Math.min(15, (filteredParts.length - 1) * 3);
    // Bonus: any part sold 2+ times in 90d
    if (filteredParts.some(p => (p.sold_90d || 0) >= 2)) score += 5;
    // Bonus: any part on The Mark want list
    if (filteredParts.some(p => p.isMarked)) score += 15;
    // Bonus: fresh arrival (today)
    if (vehicle.date_added) {
      const addedDate = new Date(vehicle.date_added);
      const daysSinceAdded = Math.floor((Date.now() - addedDate.getTime()) / 86400000);
      if (daysSinceAdded <= 1) score += 5;
    }

    score = Math.min(100, score);

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
    for (const p of filteredParts) {
      if (p.price >= 250) p.verdict = 'GREAT';
      else if (p.price >= 150) p.verdict = 'GOOD';
      else if (p.price >= 100) p.verdict = 'FAIR';
      else p.verdict = 'POOR';
    }

    return {
      id: vehicle.id, year: vehicle.year, make: vehicle.make, model: vehicle.model,
      trim: vehicle.trim, row_number: vehicle.row_number, color: vehicle.color,
      date_added: vehicle.date_added, last_seen: vehicle.last_seen, is_active: vehicle.active,
      vin: vehicle.vin || null,
      engine: formatEngineDisplay(vehicle.engine),
      engine_type: vehicle.engine_type || null,
      drivetrain: vehicle.drivetrain || null,
      trim_level: vehicle.trim_level || null,
      body_style: vehicle.body_style || null,
      stock_number: vehicle.stock_number || null,
      decoded_trim: vehicle.decoded_trim || null,
      decoded_transmission: vehicle.decoded_transmission || null,
      trim_tier: vehicle.trim_tier || null,
      audio_brand: vehicle.audio_brand || null,
      expected_parts: vehicle.expected_parts || null,
      cult: vehicle.cult === true,
      diesel: vehicle.diesel || false,
      trimBadge: vehicle.trim_tier ? {
        tier: vehicle.trim_tier,
        label: vehicle.trim_tier === 'PERFORMANCE' ? 'PERFORMANCE' : vehicle.trim_tier === 'PREMIUM' ? 'PREMIUM TRIM' : vehicle.trim_tier === 'BASE' ? 'BASE TRIM' : 'CHECK TRIM',
        color: vehicle.trim_tier === 'PERFORMANCE' ? 'blue' : vehicle.trim_tier === 'PREMIUM' ? 'green' : vehicle.trim_tier === 'BASE' ? 'gray' : 'yellow',
        decodedTrim: cleanNHTSATrim(vehicle.decoded_trim) || cleanNHTSATrim(vehicle.trim_level),
      } : null,
      score, color_code: color, vehicle_verdict,
      est_value: totalValue,
      max_part_value: filteredParts.length > 0 ? Math.max(...filteredParts.map(p => p.price || 0)) : 0,
      matched_parts: filteredParts.length,
      avg_part_price: Math.round(salesDemand.avgPrice || avgPrice),
      sales_count: salesDemand.count,
      platform_siblings: platformSiblingNames.length > 0 ? platformSiblingNames : null,
      parts: filteredParts,
      rebuild_parts: (() => {
        // Build grouped rebuild parts from mergedByBase _rb_ entries
        for (const [k, rb] of Object.entries(mergedByBase)) {
          if (!k.startsWith('_rb_') || !rb) continue;
          const priceStr = rb._minPrice === rb._maxPrice ? `$${Math.round(rb._minPrice)}` : `$${Math.round(rb._minPrice)}-$${Math.round(rb._maxPrice)}`;
          rebuildParts.push({
            partType: rb.partType, seller: rb.seller, price: Math.round(rb._maxPrice),
            priceRange: priceStr, count: rb._count, isRebuild: true, verdict: 'REBUILD',
          });
        }
        return rebuildParts.length > 0 ? rebuildParts : null;
      })(),
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
   * Score an array of manually-parsed vehicles (not from DB).
   * Uses the same indexes and scoreVehicle() as the regular attack list.
   */
  async scoreManualVehicles(vehicles, options = {}) {
    const { daysBack = 90 } = options;
    const inventoryIndex = await this.buildInventoryIndex();
    const cutoff = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000);
    const salesIndex = await this.buildSalesIndex(cutoff);
    const { byMakeModel: stockIndex, byPartNumber: stockPartNumbers } = await this.buildStockIndex();
    const platformIndex = await this.buildPlatformIndex();

    const scored = vehicles.map(v =>
      this.scoreVehicle(v, inventoryIndex, salesIndex, stockIndex, platformIndex, stockPartNumbers)
    );

    scored.sort((a, b) => {
      const maxDiff = (b.max_part_value || 0) - (a.max_part_value || 0);
      if (maxDiff !== 0) return maxDiff;
      return b.est_value - a.est_value;
    });

    return scored;
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

    // Build mark index from the_mark for score boosting
    let markIndex = { byPN: new Map(), byTitle: new Set() };
    try {
      const marks = await database('the_mark').where('active', true).select('normalizedTitle', 'partNumber');
      for (const m of marks) {
        if (m.partNumber) markIndex.byPN.set(m.partNumber.toUpperCase(), true);
        if (m.normalizedTitle) markIndex.byTitle.add(m.normalizedTitle);
      }
    } catch (e) { /* the_mark may not exist */ }

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

      // Server-side last_seen filter for lazy-load time ranges
      if (options.lastSeenSince) {
        vQuery = vQuery.where('last_seen', '>=', new Date(options.lastSeenSince));
      }

      const vehicles = await vQuery;

      if (vehicles.length === 0) continue;

      const scored = vehicles.map(v =>
        this.scoreVehicle(v, inventoryIndex, salesIndex, stockIndex, platformIndex, stockPartNumbers, markIndex)
      );
      // Sort: active first, then highest single part value, then total value
      scored.sort((a, b) => {
        if (a.is_active !== b.is_active) return a.is_active ? -1 : 1;
        const maxDiff = (b.max_part_value || 0) - (a.max_part_value || 0);
        if (maxDiff !== 0) return maxDiff;
        return b.est_value - a.est_value;
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

    // Enrich expected_parts with validation verdicts for premium/performance vehicles
    const validations = await this.loadValidationCache();
    for (const yard of results) {
      for (const v of yard.vehicles) {
        v.validated_suggestions = this.enrichSuggestions(v.make, v.expected_parts, v.audio_brand, validations);
      }
    }

    return results;
  }

  /**
   * Load trim_value_validation cache (refreshes every 10 minutes).
   */
  async loadValidationCache() {
    if (_validationCache && Date.now() - _validationCacheTime < INDEX_CACHE_TTL) return _validationCache;
    try {
      const rows = await database('trim_value_validation').select('*');
      // Index by make (lowercased) for fast lookup
      const index = {};
      for (const r of rows) {
        const key = r.make.toLowerCase();
        if (!index[key]) index[key] = [];
        index[key].push(r);
      }
      _validationCache = index;
      _validationCacheTime = Date.now();
    } catch (e) {
      _validationCache = {};
      _validationCacheTime = Date.now();
    }
    return _validationCache;
  }

  /**
   * Enrich expected_parts suggestions with validation verdicts and deltas.
   * Filters to sellable scope only (amps, modules, cameras, sensors, clusters, radios).
   */
  enrichSuggestions(make, expectedParts, audioBrand, validationIndex) {
    if (!expectedParts) return null;

    const parts = expectedParts.split(',').map(p => p.trim()).filter(Boolean);
    if (parts.length === 0) return null;

    const makeLower = (make || '').toLowerCase();
    const makeValidations = validationIndex[makeLower] || [];

    // Sellable keywords — only show parts pullers actually pull
    const SELLABLE_RE = /\bamp\b|amplifier|stereo|audio|sound|ecm|pcm|bcm|tcm|abs|tipm|camera|around view|blind spot|park assist|parking sensor|cluster|virtual cockpit|digital cockpit|live cockpit|uconnect|sync\b|entune|mylink|mbux|comand|idrive|cue\b|head unit|\bnav\b|navigation/i;

    const enriched = [];
    for (const suggestion of parts) {
      if (!SELLABLE_RE.test(suggestion)) continue;

      // Try to find a matching validation
      let validation = null;

      for (const v of makeValidations) {
        // Match by keyword in suggestion text
        if (suggestion.toLowerCase().includes(v.premium_keyword.toLowerCase())) {
          validation = v;
          break;
        }
      }

      // Special case: if audio_brand is set and suggestion includes "amp", match by audio brand
      if (!validation && audioBrand && /amp/i.test(suggestion)) {
        for (const v of makeValidations) {
          if (v.part_type === 'amp' && audioBrand.toLowerCase().includes(v.premium_keyword.toLowerCase())) {
            validation = v;
            break;
          }
        }
      }

      // Special case: nav suggestions
      if (!validation && /\bnav\b/i.test(suggestion)) {
        for (const v of makeValidations) {
          if (v.part_type === 'nav_radio') {
            validation = v;
            break;
          }
        }
      }

      if (validation) {
        enriched.push({
          suggestion,
          verdict: validation.verdict,
          delta: parseFloat(validation.delta),
          premium_avg: parseFloat(validation.premium_avg_price),
          base_avg: parseFloat(validation.base_avg_price),
        });
      } else {
        enriched.push({ suggestion, verdict: 'UNVALIDATED' });
      }
    }

    if (enriched.length === 0) return null;

    // Sort: CONFIRMED first, then WORTH_IT, UNVALIDATED, MARGINAL, NO_PREMIUM last
    const VERDICT_ORDER = { CONFIRMED: 0, WORTH_IT: 1, UNVALIDATED: 2, MARGINAL: 3, NO_PREMIUM: 4 };
    enriched.sort((a, b) => (VERDICT_ORDER[a.verdict] || 9) - (VERDICT_ORDER[b.verdict] || 9));

    return enriched;
  }
}

module.exports = AttackListService;
