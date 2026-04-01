# DARKHAWK CODE SNAPSHOT
Generated: Wed Apr  1 10:19:49 EDT 2026

## FILE: service/services/AttackListService.js
```javascript
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
    // Bonus: fresh arrival (within 2 days by date_added or createdAt)
    const arrivalDate = vehicle.date_added || vehicle.createdAt;
    if (arrivalDate) {
      const daysSinceAdded = Math.floor((Date.now() - new Date(arrivalDate).getTime()) / 86400000);
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
      date_added: vehicle.date_added, createdAt: vehicle.createdAt, last_seen: vehicle.last_seen, is_active: vehicle.active,
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

    // Compute show_base per part_type: true when ANY validation for this make+part_type has base_avg >= 100
    const showBaseByPartType = {};
    for (const v of makeValidations) {
      const pt = v.part_type;
      if (!showBaseByPartType[pt] && parseFloat(v.base_avg_price) >= 100) {
        showBaseByPartType[pt] = { show: true, base_avg: parseFloat(v.base_avg_price) };
      }
    }

    // Attach show_base and base_avg_price to each enriched entry
    for (const e of enriched) {
      // Determine the part_type for this suggestion
      let pt = null;
      if (/amp/i.test(e.suggestion)) pt = 'amp';
      else if (/\bnav\b|navigation/i.test(e.suggestion)) pt = 'nav_radio';
      else if (/360|surround|around.?view/i.test(e.suggestion) && /camera/i.test(e.suggestion)) pt = '360_camera';
      else if (/camera/i.test(e.suggestion)) pt = 'backup_camera';
      else if (/cluster|virtual cockpit|digital cockpit/i.test(e.suggestion)) pt = 'digital_cluster';

      if (pt && showBaseByPartType[pt]) {
        e.show_base = true;
        e.base_avg_price = showBaseByPartType[pt].base_avg;
        e.part_type_key = pt;
      }
    }

    // Sort: highest premium_avg_price first
    enriched.sort((a, b) => (b.premium_avg || 0) - (a.premium_avg || 0));

    return enriched;
  }
}

module.exports = AttackListService;
```
---
## FILE: service/services/MarketPricingService.js
```javascript
'use strict';

/**
 * MarketPricingService — Batch market pricing for DAILY FEED parts.
 *
 * Takes matched parts, deduplicates by PN, checks cache, scrapes
 * eBay sold comps for uncached parts, stores in market_demand_cache.
 *
 * Primary scraper: PriceCheckServiceV2 (axios+cheerio, no Chromium).
 * Fallback: PriceCheckService V1 (Playwright) if V2 returns 0 results.
 */

const { log } = require('../lib/logger');
const { database } = require('../database/database');
const { extractPartNumbers } = require('../utils/partIntelligence');
const priceCheckV2 = require('./PriceCheckServiceV2');

// V1 Playwright fallback — may not be available on all environments
let priceCheckV1 = null;
try {
  priceCheckV1 = require('./PriceCheckService');
} catch (e) {
  log.info('[MarketPricing] PriceCheckService V1 (Playwright) not available, V2-only mode');
}

const CACHE_TTL_HOURS = 2160; // 90 days

/**
 * Build optimal search query for a part.
 * TIER 1: Part number (most specific). TIER 2: Year+make+model+partType.
 */
function buildSearchQuery(part) {
  const pns = extractPartNumbers(part.title || '');

  // TIER 1: Part number search
  if (pns.length > 0) {
    const pn = pns[0];
    return {
      query: pn.raw, // raw format with dashes: "9L34-2C405-A"
      method: 'PART_NUMBER',
      cacheKey: pn.base, // normalized base for cache dedup
    };
  }

  // TIER 2: Specific keywords
  const parts = [];
  if (part.year) parts.push(String(part.year));
  if (part.make) parts.push(part.make);
  if (part.model) parts.push(part.model);
  if (part.partType) parts.push(part.partType);

  const query = parts.join(' ');
  const cacheKey = parts.map(p => (p || '').toUpperCase()).join('|');

  return { query, method: 'KEYWORD', cacheKey };
}

/**
 * Check market_demand_cache for recent data.
 */
async function getCachedPrice(cacheKey) {
  try {
    const row = await database('market_demand_cache')
      .where('part_number_base', cacheKey)
      .whereRaw(`last_updated > NOW() - INTERVAL '${CACHE_TTL_HOURS} hours'`)
      .first();

    if (row) {
      const price = parseFloat(row.ebay_avg_price) || 0;
      const count = parseInt(row.ebay_sold_90d) || 0;
      if (price === 0 && count === 0) return null; // Empty cache entry
      return {
        median: price,
        avg: price,
        count: count,
        velocity: count / 13,
        cached: true,
        checkedAt: row.last_updated,
      };
    }
  } catch (err) {
    log.warn({ err: err.message }, '[MarketPricing] Cache read error');
  }
  return null;
}

/**
 * Store result in market_demand_cache.
 */
async function cachePrice(cacheKey, part, result) {
  try {
    // Table columns: id, part_number_base, ebay_sold_90d, ebay_avg_price,
    // ebay_active_listings, market_score, last_updated, createdAt
    await database.raw(`
      INSERT INTO market_demand_cache
        (id, part_number_base, ebay_avg_price, ebay_sold_90d,
         last_updated, "createdAt")
      VALUES (
        gen_random_uuid(), ?, ?, ?,
        NOW(), NOW()
      )
      ON CONFLICT (part_number_base)
      DO UPDATE SET
        ebay_avg_price = EXCLUDED.ebay_avg_price,
        ebay_sold_90d = EXCLUDED.ebay_sold_90d,
        last_updated = NOW()
    `, [
      cacheKey,
      result.median || result.avg || 0,
      result.count || 0,
    ]);
  } catch (err) {
    log.warn({ err: err.message, cacheKey }, '[MarketPricing] Cache write error');
  }
}

/**
 * Scrape sold comps for a single search query.
 * Primary: V2 (axios+cheerio). Fallback: V1 (Playwright) if V2 gets 0 results.
 * Returns { count, avg, median, min, max, salesPerWeek }.
 */
async function scrapeComps(searchQuery) {
  // Try V2 first (lightweight, no Chromium)
  try {
    const v2Result = await priceCheckV2.check(searchQuery, 0);
    if (v2Result && v2Result.metrics && v2Result.metrics.count > 0) {
      return {
        count: v2Result.metrics.count,
        avg: v2Result.metrics.avg,
        median: v2Result.metrics.median,
        min: v2Result.metrics.min,
        max: v2Result.metrics.max,
        salesPerWeek: v2Result.metrics.salesPerWeek,
      };
    }
  } catch (err) {
    log.debug({ err: err.message, query: searchQuery }, '[MarketPricing] V2 scrape failed');
  }

  // Fallback to V1 (Playwright) if available and V2 returned nothing
  if (priceCheckV1) {
    try {
      const items = await priceCheckV1.scrapeSoldItems(searchQuery);
      if (items && items.length > 0) {
        const metrics = priceCheckV1.calculateMetrics(items, 0);
        return metrics;
      }
    } catch (err) {
      log.debug({ err: err.message, query: searchQuery }, '[MarketPricing] V1 fallback failed');
    }
  }

  return null;
}

/**
 * Run market pricing for a single query (for the test route).
 */
async function singlePriceCheck(query) {
  // Check cache first
  const cached = await getCachedPrice(query.toUpperCase().replace(/[\s\-\.]/g, ''));
  if (cached) return { ...cached, query, source: 'cache' };

  // Scrape
  const comps = await scrapeComps(query);
  if (!comps || comps.count === 0) {
    return { count: 0, query, source: 'scrape', message: 'No sold comps found' };
  }

  // Cache it
  const pns = extractPartNumbers(query);
  const cacheKey = pns.length > 0 ? pns[0].base : query.toUpperCase().replace(/[\s\-\.]/g, '');
  await cachePrice(cacheKey, { make: null, model: null, partType: null }, comps);

  return {
    median: comps.median,
    avg: comps.avg,
    min: comps.min,
    max: comps.max,
    count: comps.count,
    salesPerWeek: comps.salesPerWeek,
    query,
    source: 'scrape',
  };
}

/**
 * Run market pricing for a batch of parts.
 * Deduplicates, checks cache, scrapes uncached, stores results.
 */
async function batchPriceCheck(parts) {
  const results = new Map();

  // Step 1: Build queries and dedup
  const queries = new Map(); // cacheKey → { query, method, part }
  for (const part of parts) {
    const sq = buildSearchQuery(part);
    if (!queries.has(sq.cacheKey)) {
      queries.set(sq.cacheKey, { ...sq, part });
    }
  }

  log.info({ total: parts.length, unique: queries.size }, '[MarketPricing] Batch start');

  // Step 2: Check cache
  const uncached = [];
  for (const [cacheKey, queryInfo] of queries) {
    const cached = await getCachedPrice(cacheKey);
    if (cached) {
      results.set(cacheKey, cached);
    } else {
      uncached.push({ cacheKey, ...queryInfo });
    }
  }

  log.info({ cached: results.size, toScrape: uncached.length }, '[MarketPricing] Cache check done');

  // Step 3: Scrape uncached (with rate limiting)
  let scraped = 0, failed = 0;
  for (const item of uncached) {
    try {
      const comps = await scrapeComps(item.query);
      if (comps && comps.count > 0) {
        const result = {
          median: comps.median,
          avg: comps.avg,
          min: comps.min,
          max: comps.max,
          count: comps.count,
          velocity: comps.salesPerWeek || (comps.count / 13),
          method: item.method,
          query: item.query,
          checkedAt: new Date(),
        };
        results.set(item.cacheKey, result);
        await cachePrice(item.cacheKey, item.part, result);
        scraped++;
      }

      // Rate limit: 2-3 second delay
      await new Promise(r => setTimeout(r, 2000 + Math.random() * 1000));
    } catch (err) {
      log.warn({ err: err.message, query: item.query }, '[MarketPricing] Scrape failed');
      failed++;
    }
  }

  log.info({ scraped, failed, totalResults: results.size }, '[MarketPricing] Batch complete');
  return results;
}

/**
 * Full pricing pass: score all yard vehicles, collect matched parts, batch price them.
 */
async function runPricingPass() {
  log.info('[MarketPricing] Starting full pricing pass');
  const AttackListService = require('./AttackListService');
  const service = new AttackListService();

  try {
    const allResults = await service.getAllYardsAttackList({ daysBack: 90 });
    const parts = [];
    for (const yard of allResults) {
      for (const v of (yard.vehicles || [])) {
        for (const p of (v.parts || [])) {
          if (p.partType && p.price > 50) {
            parts.push({
              title: p.title,
              make: v.make,
              model: v.model,
              year: parseInt(v.year),
              partType: p.partType,
            });
          }
        }
      }
    }

    if (parts.length === 0) {
      log.info('[MarketPricing] No parts to price');
      return { parts: 0, results: 0 };
    }

    log.info({ partCount: parts.length }, '[MarketPricing] Collected parts, starting batch');
    const results = await batchPriceCheck(parts);
    log.info({ partCount: parts.length, results: results.size }, '[MarketPricing] Pricing pass complete');
    return { parts: parts.length, results: results.size };
  } catch (err) {
    log.error({ err: err.message }, '[MarketPricing] Pricing pass failed');
    throw err;
  }
}

module.exports = { buildSearchQuery, batchPriceCheck, getCachedPrice, cachePrice, scrapeComps, singlePriceCheck, runPricingPass };
```
---
## FILE: service/services/TrimTierService.js
```javascript
'use strict';

const { database } = require('../database/database');

const TIER_MAP = {
  1: { tier: 'BASE', multiplier: 0.0 },
  2: { tier: 'CHECK', multiplier: 0.5 },
  3: { tier: 'PREMIUM', multiplier: 1.0 },
  4: { tier: 'PERFORMANCE', multiplier: 1.3 },
};

// Make aliases: Dodge ↔ Ram, Chevy ↔ Chevrolet, Mercedes ↔ Mercedes-Benz
const MAKE_ALIASES = {
  'chevrolet': ['chevy'],
  'chevy': ['chevrolet'],
  'mercedes-benz': ['mercedes'],
  'mercedes': ['mercedes-benz'],
  'dodge': ['ram'],
  'ram': ['dodge'],
};

function getMakeVariants(make) {
  const norm = (make || '').trim().toLowerCase();
  const aliases = MAKE_ALIASES[norm] || [];
  return [norm, ...aliases];
}

// Model normalization: strip body codes, normalize common names
const MODEL_NORMALIZATIONS = {
  'CRV': 'CR-V', 'HRV': 'HR-V', 'RAV 4': 'RAV4',
  'F150': 'F-150', 'F250': 'F-250', 'F350': 'F-350',
  'E350': 'E-350', 'E450': 'E-450',
  'CX5': 'CX-5', 'CX9': 'CX-9', 'CX3': 'CX-3',
  'MX5': 'MX-5',
};

function cleanModelForLookup(model, make) {
  if (!model) return model;
  let clean = model.trim();

  // Strip Dodge/RAM/Chrysler/Jeep body codes (DS1, DS6, DJ7, etc.)
  if (/dodge|ram|chrysler|jeep/i.test(make || '')) {
    clean = clean.replace(/\b[A-Z]{2}\d\b/gi, '');
  }

  // BMW: convert model numbers to series names (328I → 3 Series, X5 XDRIVE35I → X5)
  if (/bmw/i.test(make || '')) {
    const bmwSeriesMap = [
      { pattern: /\b3[0-9]{2}[A-Z]*\b/i, series: '3 Series' },
      { pattern: /\bM3\b/i, series: '3 Series' },
      { pattern: /\b5[0-9]{2}[A-Z]*\b/i, series: '5 Series' },
      { pattern: /\bM5\b/i, series: '5 Series' },
      { pattern: /\b4[0-9]{2}[A-Z]*\b/i, series: '4 Series' },
      { pattern: /\bM4\b/i, series: '4 Series' },
      { pattern: /\b7[0-9]{2}[A-Z]*\b/i, series: '7 Series' },
      { pattern: /\b2[0-9]{2}[A-Z]*\b/i, series: '2 Series' },
      { pattern: /\bM2\b/i, series: '2 Series' },
      { pattern: /\b6[0-9]{2}[A-Z]*\b/i, series: '6 Series' },
      { pattern: /\bM6\b/i, series: '6 Series' },
      { pattern: /\b8[0-9]{2}[A-Z]*\b/i, series: '8 Series' },
      { pattern: /\bM8\b/i, series: '8 Series' },
    ];
    let matched = false;
    for (const { pattern, series } of bmwSeriesMap) {
      if (pattern.test(clean)) { clean = series; matched = true; break; }
    }
    if (!matched) {
      // X models: strip xDrive/sDrive suffixes — "X5 XDRIVE35I" → "X5"
      clean = clean.replace(/\b(X[1-7])\s*[A-Z]*DRIVE\d*[A-Z]*/i, '$1');
      // Strip standalone 2-letter option codes (keep real models)
      const realModels = new Set(['X1','X2','X3','X4','X5','X6','X7','Z3','Z4','I3','I4','I5','I7','I8']);
      clean = clean.replace(/\b([A-Z]{2})\b/gi, (m, code) => realModels.has(code.toUpperCase()) ? code : '');
    }
  }

  // Mercedes-Benz: convert model numbers to class names (C300 → C-Class, ML350 → ML)
  if (/mercedes/i.test(make || '')) {
    const mbSeriesMap = [
      { pattern: /\bC\s*\d{2,3}\b/i, series: 'C-Class' },
      { pattern: /\bE\s*\d{2,3}\b/i, series: 'E-Class' },
      { pattern: /\bS\s*\d{2,3}\b/i, series: 'S-Class' },
      { pattern: /\bGLS\s*\d{2,3}\b/i, series: 'GLS' },
      { pattern: /\bGLE\s*\d{2,3}\b/i, series: 'GLE' },
      { pattern: /\bGLC\s*\d{2,3}\b/i, series: 'GLC' },
      { pattern: /\bGLA\s*\d{2,3}\b/i, series: 'GLA' },
      { pattern: /\bCLA\s*\d{2,3}\b/i, series: 'CLA' },
      { pattern: /\bGL[A-Z]*\s*\d{2,3}\b/i, series: 'GLE' },
      { pattern: /\bML\s*\d{2,3}\b/i, series: 'ML' },
    ];
    for (const { pattern, series } of mbSeriesMap) {
      if (pattern.test(clean)) { clean = series; break; }
    }
  }

  // Lexus: ES350 → ES, RX300 → RX, IS250 → IS, GX470 → GX, NX200T → NX
  if (/lexus/i.test(make || '')) {
    clean = clean.replace(/\b([A-Z]{2,3})\s*\d{2,3}[A-Z]?\b/gi, (m, prefix) => prefix.toUpperCase());
  }

  // Infiniti: M35 → M, FX35 → FX, QX56 → QX
  if (/infiniti/i.test(make || '')) {
    clean = clean.replace(/\b([A-Z]{1,2})\s*\d{2,3}\b/gi, (m, prefix) => prefix.toUpperCase());
  }

  // Chrysler 300 — ensure "300C" normalizes to "300" for reference lookup
  if (/chrysler/i.test(make || '')) {
    clean = clean.replace(/\b300[A-Z]?\b/gi, '300');
  }

  // Ford F-250/F-350 SUPER DUTY → F-250/F-350
  clean = clean.replace(/\bSUPER\s*DUTY\b/gi, '').trim();

  // Ford E-series: E-150, E-250, E-350, ECONOLINE → E-Series
  clean = clean.replace(/\bE[\-\s]?(150|250|350)\s*(ECONOLINE|VAN)?\b/gi, 'E-Series');
  clean = clean.replace(/\bECONOLINE\b/gi, 'E-Series');

  // Express 1500/2500/3500 → Express
  clean = clean.replace(/\bEXPRESS\s*\d{4}\b/gi, 'Express');

  // Acura model cleanup — strip trailing generation numbers
  if (/acura/i.test(make || '')) {
    clean = clean.replace(/\b(RDX|MDX|TLX|ILX|TSX|TL|RSX|RL|CL|CDX)\s*\d+\b/gi, (m, model) => model.toUpperCase());
  }

  // Suburban 1500/2500 → Suburban (LKQ adds the tonnage)
  clean = clean.replace(/\bSUBURBAN\s+1500\b/gi, 'Suburban');
  clean = clean.replace(/\bSUBURBAN\s+2500\b/gi, 'Suburban');

  // Yukon XL 1500 → Yukon XL
  clean = clean.replace(/\bYUKON\s+XL\s+1500\b/gi, 'Yukon XL');

  // Avalanche 1500 → Avalanche
  clean = clean.replace(/\bAVALANCHE\s+1500\b/gi, 'Avalanche');

  // Mazda: LKQ stores model as just "3" or "6" but reference uses "Mazda3" or "Mazda6"
  if (/mazda/i.test(make || '')) {
    clean = clean.replace(/^3$/i, 'Mazda3');
    clean = clean.replace(/^6$/i, 'Mazda6');
    clean = clean.replace(/^5$/i, 'Mazda5');
    clean = clean.replace(/^CX-?5$/i, 'CX-5');
    clean = clean.replace(/^CX-?9$/i, 'CX-9');
  }

  // Strip NHTSA trim lists stuffed into model names ("CAMRY LE/SE/XLE" → "CAMRY")
  clean = clean.replace(/\s+(LE|SE|XLE|XSE|LX|EX|LT|LS|SL|SV|SR|DX|SXT|SLT|XLT|SEL|Limited|Sport|Base|Premium|Luxury|Touring)(\/[A-Za-z]+)*\s*$/i, '');
  clean = clean.replace(/\s+[A-Z]{1,4}(\/[A-Z]{1,4}){2,}\s*$/i, '');
  clean = clean.replace(/\b(NFA|NFB|NFC|CMA)\b/gi, '');

  // Normalize common model name variations
  for (const [from, to] of Object.entries(MODEL_NORMALIZATIONS)) {
    clean = clean.replace(new RegExp('\\b' + from + '\\b', 'gi'), to);
  }

  // Remove duplicate consecutive words ("350 350" → "350")
  clean = clean.replace(/\b(\w+)\s+\1\b/gi, '$1');

  // Clean leftover punctuation and whitespace
  clean = clean.replace(/,\s*,/g, ',').replace(/^[,\s]+|[,\s]+$/g, '').replace(/\s{2,}/g, ' ').trim();

  return clean;
}

function formatResult(match, engineInferred, cultOverride) {
  const tierInfo = TIER_MAP[match.tier] || TIER_MAP[2];
  return {
    tierString: tierInfo.tier,
    multiplier: tierInfo.multiplier,
    audioBrand: match.audio_brand || null,
    expectedParts: match.expected_parts || null,
    cult: cultOverride !== undefined ? cultOverride : (match.cult === true),
    diesel: match.diesel || false,
    transmission: match.transmission || null,
    topEngine: match.top_engine || null,
    notes: match.notes || null,
    tierNum: match.tier,
    trimName: match.trim,
    engineInferred: engineInferred || false,
    engineConfident: false,
  };
}

/**
 * Lookup a vehicle's trim tier from trim_tier_reference.
 * Fuzzy trim matching: exact → starts-with → first-word → engine inference.
 * Supports make aliases (Dodge↔Ram, Chevy↔Chevrolet), model normalization,
 * and ±1 year tolerance.
 */
async function lookup(year, make, model, trimName, engineDisplacement, transmission, drivetrain) {
  if (!make || !model) return null;

  // Diesel detection from engine string — catches cases where reference entry lacks diesel flag
  function applyDiesel(result) {
    if (!result) return result;
    if (engineDisplacement && /diesel|cummins|duramax|power.?stroke|tdi|cdi|ecodiesel|crd/i.test(engineDisplacement)) {
      result.diesel = true;
    }
    return result;
  }

  try {
    const makeVariants = getMakeVariants(make);
    const modelCleaned = cleanModelForLookup(model, make);
    const modelNorm = (modelCleaned || '').toLowerCase();
    const yearNum = parseInt(year) || 0;

    // Handle Dodge/Ram model naming: "RAM 1500" → try both "Ram 1500" and "1500"
    const modelVariants = [modelNorm];
    if (/^ram\s+/i.test(modelNorm)) modelVariants.push(modelNorm.replace(/^ram\s+/i, ''));
    if (makeVariants.includes('ram') && !modelNorm.startsWith('ram')) modelVariants.push('ram ' + modelNorm);

    // Build base query with make aliases + model variants + year range
    const baseQuery = () => database('trim_tier_reference')
      .whereRaw('LOWER(make) IN (' + makeVariants.map(() => '?').join(',') + ')', makeVariants)
      .whereRaw('LOWER(model) IN (' + modelVariants.map(() => '?').join(',') + ')', modelVariants)
      .where('gen_start', '<=', yearNum || 9999)
      .where('gen_end', '>=', yearNum || 0);

    // Year-tolerant fallback query (±1 year)
    const tolerantQuery = () => database('trim_tier_reference')
      .whereRaw('LOWER(make) IN (' + makeVariants.map(() => '?').join(',') + ')', makeVariants)
      .whereRaw('LOWER(model) IN (' + modelVariants.map(() => '?').join(',') + ')', modelVariants)
      .where('gen_start', '<=', yearNum + 1)
      .where('gen_end', '>=', yearNum - 1);

    // BMW: the model number IS the trim identity (325i, 528i, M3, etc.)
    if (/bmw/i.test(make) && !trimName && model) {
      const originalModel = model.toUpperCase().trim();
      const mCarMatch = originalModel.match(/\b(M[2-8])\b/);
      const numericMatch = originalModel.match(/\b([1-8]\d{2})[A-Z]*/);
      if (mCarMatch) {
        trimName = mCarMatch[1];
      } else if (numericMatch) {
        trimName = numericMatch[1] + 'i';
      }
    }

    // Mercedes: model number is the trim identity (C300, E350, etc.)
    if (/mercedes/i.test(make) && !trimName && model) {
      const originalModel = model.toUpperCase().trim();
      const mbMatch = originalModel.match(/\b([A-Z]{1,3}\s*\d{2,3})\b/);
      if (mbMatch) {
        trimName = mbMatch[1].replace(/\s+/g, '');
      }
    }

    // Get all candidates for cult checks
    let candidates = await baseQuery().select('*');
    if (candidates.length === 0) {
      // Year tolerance fallback
      candidates = await tolerantQuery().select('*');
    }

    if (candidates.length === 0) return null;

    const allCult = candidates.every(c => c.cult === true);

    // === TRIM MATCHING ===
    let match = null;

    if (trimName) {
      const trimLower = trimName.toLowerCase().trim();

      // 1. Exact trim match
      match = candidates.find(c => (c.trim || '').toLowerCase() === trimLower) || null;

      // 2. Starts-with match
      if (!match) {
        match = candidates
          .filter(c => trimLower.startsWith((c.trim || '').toLowerCase()))
          .sort((a, b) => (b.trim || '').length - (a.trim || '').length)[0] || null;
      }

      // 3. First-word match
      if (!match) {
        const firstWord = trimLower.split(/\s+/)[0];
        if (firstWord && firstWord.length >= 2) {
          match = candidates.find(c => (c.trim || '').toLowerCase() === firstWord) || null;
        }
      }
    }

    if (match) {
      // Cult: matched entry is cult, OR the entire model is cult
      const isCult = match.cult === true || allCult;
      return applyDiesel(formatResult(match, false, isCult));
    }

    // === ENGINE-BASED INFERENCE ===
    if (engineDisplacement) {
      const engineNum = (engineDisplacement || '').replace(/[^0-9.]/g, '');
      if (engineNum && engineNum.length >= 2) {
        const engineMatches = candidates.filter(c => {
          if (!c.top_engine) return false;
          const refNum = c.top_engine.replace(/[^0-9.]/g, '');
          if (!refNum || refNum.length < 2) return false;
          return refNum.startsWith(engineNum) || engineNum.startsWith(refNum);
        });

        // Transmission-based filtering when ambiguous
        if (transmission && engineMatches.length > 1) {
          const isManual = /manual/i.test(transmission);
          const isDCT = /dual.clutch|dct|dsg|sst|pdk/i.test(transmission);
          if (isManual || isDCT) {
            const isTruck = /1500|2500|3500|f-?150|f-?250|f-?350|silverado|sierra|tundra|tacoma|ranger|colorado|frontier|titan/i.test(modelNorm || '');
            if (!isTruck || isDCT) {
              // Manual on cars or DCT anywhere biases toward sport/performance
              const sportFiltered = engineMatches.filter(c => c.tier >= 3);
              if (sportFiltered.length > 0) {
                engineMatches.splice(0, engineMatches.length, ...sportFiltered);
              }
            }
          }
        }

        if (engineMatches.length > 0) {
          const tiers = [...new Set(engineMatches.map(c => c.tier))];
          // Cult: inferred entry is cult, OR entire model is cult
          const inferredCult = (entry) => entry.cult === true || allCult;

          if (tiers.length === 1) {
            const best = engineMatches.reduce((a, b) => a.tier < b.tier ? a : b);
            const result = formatResult(best, true, inferredCult(best));
            result.engineConfident = true;
            return applyDiesel(result);
          } else {
            const conservative = engineMatches.reduce((a, b) => a.tier < b.tier ? a : b);
            const result = formatResult(conservative, true, inferredCult(conservative));
            result.engineConfident = false;
            return applyDiesel(result);
          }
        }
      }
    }

    // === ENGINE CONTRADICTION: engine provided but matched nothing ===
    // If we had engine data and it didn't match any candidate's top_engine,
    // don't fall through to "best case" — that would give PERFORMANCE to a base vehicle
    if (engineDisplacement && !trimName) {
      const engineNum = (engineDisplacement || '').replace(/[^0-9.]/g, '');
      if (engineNum && engineNum.length >= 2) {
        const anyEngineMatch = candidates.some(c => {
          if (!c.top_engine) return false;
          const refNum = c.top_engine.replace(/[^0-9.]/g, '');
          if (!refNum || refNum.length < 2) return false;
          return refNum.startsWith(engineNum) || engineNum.startsWith(refNum);
        });
        if (!anyEngineMatch) {
          // Engine doesn't match any known trim — only return if entire model is cult
          if (allCult) {
            const lowest = candidates.reduce((a, b) => a.tier < b.tier ? a : b);
            return applyDiesel(formatResult(lowest, false, true));
          }
          return null; // No match — don't guess
        }
      }
    }

    // === NO TRIM, NO ENGINE MATCH — check if entire model is cult ===
    if (allCult) {
      const lowest = candidates.reduce((a, b) => a.tier < b.tier ? a : b);
      return applyDiesel(formatResult(lowest, false, true));
    }

    // Return lowest-tier reference (conservative) without cult
    if (!trimName) {
      const lowest = candidates.reduce((a, b) => a.tier < b.tier ? a : b);
      return applyDiesel(formatResult(lowest, false, false));
    }

    return null;
  } catch (e) {
    return null;
  }
}

module.exports = { lookup, cleanModelForLookup, getMakeVariants };
```
---
## FILE: service/services/StaleInventoryService.js
```javascript
'use strict';

const { log } = require('../lib/logger');
const { database } = require('../database/database');
const axios = require('axios');
const xml2js = require('xml2js');

/**
 * StaleInventoryService — Automated price reductions via TradingAPI
 *
 * Schedule per spec:
 *   60 days:  -10% reduction
 *   90 days:  -15% reduction (from current, not original)
 *   120 days: -20% reduction
 *   180 days: -25% reduction
 *   270 days: -30% reduction, flag for review
 *
 * Programmed listings follow slower schedule (no auto-discount against unprogrammed comps).
 * Programmed schedule:
 *   90 days:  -5%
 *   180 days: -10%
 *   270 days: -15%, flag for review
 *
 * No comps available = hold and flag, do not reduce.
 * Ended listings logged to dead_inventory.
 */

const STANDARD_SCHEDULE = [
  { days: 60,  reductionPct: 0.10, tier: '60' },
  { days: 90,  reductionPct: 0.15, tier: '90' },
  { days: 120, reductionPct: 0.20, tier: '120' },
  { days: 180, reductionPct: 0.25, tier: '180' },
  { days: 270, reductionPct: 0.30, tier: '270' },
];

const PROGRAMMED_SCHEDULE = [
  { days: 90,  reductionPct: 0.05, tier: '90p' },
  { days: 180, reductionPct: 0.10, tier: '180p' },
  { days: 270, reductionPct: 0.15, tier: '270p' },
];

class StaleInventoryService {
  constructor() {
    this.log = log.child({ class: 'StaleInventoryService' }, true);
    this.tradingApiUrl = 'https://api.ebay.com/ws/api.dll';
  }

  /**
   * Scan all active listings and apply price reductions where due.
   * Returns summary of actions taken.
   */
  async runAutomation() {
    this.log.info('Running stale inventory automation');

    let listings;
    try {
      listings = await database('YourListing')
        .where('listingStatus', 'Active')
        .whereNotNull('startTime')
        .select('*');
    } catch (err) {
      this.log.error({ err: err.message }, 'Could not query YourListing');
      return { scanned: 0, actioned: 0, errors: 0 };
    }

    const now = new Date();
    let actioned = 0, skipped = 0, errors = 0;

    for (const listing of listings) {
      const daysListed = Math.floor((now - new Date(listing.startTime)) / 86400000);
      const isProgrammed = !!listing.isProgrammed || this.detectProgrammed(listing.title);
      const schedule = isProgrammed ? PROGRAMMED_SCHEDULE : STANDARD_SCHEDULE;

      // Find the applicable tier (highest days threshold the listing exceeds)
      let applicableTier = null;
      for (const tier of schedule) {
        if (daysListed >= tier.days) applicableTier = tier;
      }
      if (!applicableTier) continue; // Not stale enough

      // Check if we already actioned this tier
      try {
        const existing = await database('stale_inventory_action')
          .where('ebay_item_id', listing.ebayItemId)
          .where('tier', applicableTier.tier)
          .where('executed', true)
          .first();
        if (existing) { skipped++; continue; }
      } catch (e) { /* table may not exist */ }

      // Check if comps exist before reducing
      const hasComps = await this.checkCompsExist(listing);
      if (!hasComps) {
        // No comps = hold and flag
        this.log.info({ ebayItemId: listing.ebayItemId, title: listing.title },
          'No comps found — holding price');
        try {
          await database('stale_inventory_action').insert({
            ebay_item_id: listing.ebayItemId,
            listing_id: listing.id,
            title: listing.title,
            action_type: 'hold_no_comps',
            old_price: parseFloat(listing.currentPrice),
            days_listed: daysListed,
            tier: applicableTier.tier,
            programmed_listing: isProgrammed,
            executed: true,
            executed_at: new Date(),
            notes: 'No comparable sold items found — holding price',
            createdAt: new Date(),
          });
        } catch (e) { /* ignore */ }
        continue;
      }

      // Calculate new price
      const currentPrice = parseFloat(listing.currentPrice);
      const newPrice = Math.round(currentPrice * (1 - applicableTier.reductionPct) * 100) / 100;
      const minFloor = 9.99; // Never go below $9.99
      const finalPrice = Math.max(newPrice, minFloor);

      // Execute price change via TradingAPI
      let executed = false;
      let executionError = null;
      try {
        await this.revisePrice(listing.ebayItemId, finalPrice);
        executed = true;
        actioned++;

        // Update local record
        await database('YourListing')
          .where('id', listing.id)
          .update({ currentPrice: finalPrice, updatedAt: new Date() });
      } catch (err) {
        executionError = err.message;
        errors++;
        this.log.warn({ err: err.message, ebayItemId: listing.ebayItemId },
          'Price revision failed');
      }

      // Log the action
      try {
        await database('stale_inventory_action').insert({
          ebay_item_id: listing.ebayItemId,
          listing_id: listing.id,
          title: listing.title,
          action_type: 'price_reduction',
          old_price: currentPrice,
          new_price: finalPrice,
          days_listed: daysListed,
          tier: applicableTier.tier,
          programmed_listing: isProgrammed,
          executed,
          execution_error: executionError,
          executed_at: executed ? new Date() : null,
          notes: `${applicableTier.reductionPct * 100}% reduction at ${daysListed} days`,
          createdAt: new Date(),
        });
      } catch (e) {
        this.log.warn({ err: e.message }, 'stale_inventory_action insert failed');
      }
    }

    this.log.info({ scanned: listings.length, actioned, skipped, errors },
      'Stale inventory automation complete');
    return { scanned: listings.length, actioned, skipped, errors };
  }

  /**
   * Detect if a listing is a programmed/flashed part from its title.
   * Programmed listings get price protection — never auto-discounted against unprogrammed comps.
   */
  detectProgrammed(title) {
    if (!title) return false;
    const t = title.toUpperCase();
    return t.includes('PROGRAMMED') || t.includes('FLASHED') ||
           t.includes('VIN-SPECIFIC') || t.includes('CODED TO') ||
           t.includes('VIN PROGRAMMED') || t.includes('PLUG AND PLAY');
  }

  /**
   * Check if comparable sold items exist for this listing.
   */
  async checkCompsExist(listing) {
    try {
      const partNumber = listing.sku;
      if (partNumber) {
        const cache = await database('market_demand_cache')
          .where('part_number_base', partNumber)
          .first();
        if (cache && parseInt(cache.ebay_sold_90d) > 0) return true;
      }

      // Fallback: check YourSale for similar titles
      const titleWords = (listing.title || '').split(' ').filter(w => w.length > 3).slice(0, 3);
      if (titleWords.length > 0) {
        const pattern = '%' + titleWords.join('%') + '%';
        const sale = await database('YourSale')
          .whereRaw('UPPER(title) LIKE UPPER(?)', [pattern])
          .first();
        if (sale) return true;
      }
    } catch (e) { /* tables may not exist */ }
    return false;
  }

  /**
   * Revise listing price on eBay via TradingAPI ReviseItem call.
   */
  async revisePrice(ebayItemId, newPrice) {
    const token = process.env.TRADING_API_TOKEN;
    if (!token) throw new Error('TRADING_API_TOKEN not configured');

    const xml = `<?xml version='1.0' encoding='utf-8'?>
<ReviseItemRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  <RequesterCredentials>
    <eBayAuthToken>${token}</eBayAuthToken>
  </RequesterCredentials>
  <Item>
    <ItemID>${ebayItemId}</ItemID>
    <StartPrice>${newPrice.toFixed(2)}</StartPrice>
  </Item>
</ReviseItemRequest>`;

    const response = await axios({
      method: 'POST',
      url: this.tradingApiUrl,
      headers: {
        'X-EBAY-API-COMPATIBILITY-LEVEL': '837',
        'X-EBAY-API-DEV-NAME': process.env.TRADING_API_DEV_NAME,
        'X-EBAY-API-APP-NAME': process.env.TRADING_API_APP_NAME,
        'X-EBAY-API-CERT-NAME': process.env.TRADING_API_CERT_NAME,
        'X-EBAY-API-SITEID': '0',
        'X-EBAY-API-CALL-NAME': 'ReviseItem',
        'Content-Type': 'text/xml',
      },
      data: xml,
      timeout: 15000,
    });

    const parsed = await xml2js.parseStringPromise(response.data);
    const ack = parsed?.ReviseItemResponse?.Ack?.[0];
    if (ack !== 'Success' && ack !== 'Warning') {
      const errorMsg = parsed?.ReviseItemResponse?.Errors?.[0]?.LongMessage?.[0] || 'Unknown error';
      throw new Error(`eBay ReviseItem failed: ${errorMsg}`);
    }
  }
}

module.exports = StaleInventoryService;
```
---
## FILE: service/services/DeadInventoryService.js
```javascript
'use strict';

const { log } = require('../lib/logger');
const SoldItem = require('../models/SoldItem');
const YourSale = require('../models/YourSale');
const YourListing = require('../models/YourListing');
const Item = require('../models/Item');
const { raw } = require('objection');
const { database } = require('../database/database');
const { normalizePartNumber } = require('../lib/partNumberUtils');

/**
 * DeadInventoryService - Identifies stale listings that need action
 * Based on days listed, market demand, and competition
 */
class DeadInventoryService {
  constructor() {
    this.log = log.child({ class: 'DeadInventoryService' }, true);
  }

  /**
   * Get dead inventory listings
   * @param {Object} options
   * @param {number} options.daysThreshold - Days threshold for "dead" (default: 90)
   * @param {boolean} options.includeMarketData - Include market demand data
   * @param {number} options.limit - Number of results per page (default: 50)
   * @param {number} options.page - Page number (default: 1)
   */
  async getDeadInventory({ daysThreshold = 90, includeMarketData = true, limit = 50, page = 1 } = {}) {
    this.log.info({ daysThreshold, includeMarketData, limit, page }, 'Getting dead inventory');

    const now = new Date();
    const cutoffDate = new Date(now - daysThreshold * 24 * 60 * 60 * 1000);

    // Filter by date in SQL for performance - get count and paginated results
    const [countResult, listings] = await Promise.all([
      YourListing.query()
        .where('listingStatus', 'Active')
        .where('startTime', '<', cutoffDate)
        .count('* as total')
        .first(),
      YourListing.query()
        .where('listingStatus', 'Active')
        .where('startTime', '<', cutoffDate)
        .orderBy('startTime', 'asc')
        .limit(limit)
        .offset((page - 1) * limit),
    ]);

    const total = parseInt(countResult?.total || 0);
    const totalPages = Math.ceil(total / limit);

    if (listings.length === 0) {
      return { deadInventory: [], total: 0, totalPages: 1 };
    }

    // Build simple recommendations based on days listed (skip expensive market data matching for speed)
    const deadInventory = listings.map(listing => {
      const startDate = new Date(listing.startTime);
      const daysListed = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
      const currentPrice = parseFloat(listing.currentPrice);

      // Simple recommendation based on age
      let recommendation, suggestedAction, reasoning;
      if (daysListed >= 180) {
        recommendation = 'DEEP DISCOUNT';
        suggestedAction = `Reduce to $${Math.max(10, currentPrice * 0.5).toFixed(2)} or relist`;
        reasoning = 'Listed over 6 months - aggressive action needed';
      } else if (daysListed >= 120) {
        recommendation = 'RELIST';
        suggestedAction = 'End and relist to refresh search ranking';
        reasoning = 'Listing is stale - relisting may improve visibility';
      } else if (daysListed >= 90) {
        recommendation = 'REDUCE PRICE';
        suggestedAction = `Consider reducing by 10-15%`;
        reasoning = 'Listed over 90 days - price reduction may help';
      } else {
        recommendation = 'HOLD';
        suggestedAction = 'Monitor for another 30 days';
        reasoning = 'Not yet stale enough for action';
      }

      return {
        id: listing.id,
        ebayItemId: listing.ebayItemId,
        title: listing.title,
        sku: listing.sku,
        daysListed,
        currentPrice: currentPrice?.toFixed(2),
        recommendation,
        suggestedAction,
        reasoning,
        viewItemUrl: listing.viewItemUrl,
        // These would require expensive matching - skip for now
        marketSalesLast90Days: null,
        marketAvgPrice: null,
        competitorCount: null,
      };
    });

    // Sort by days listed (oldest first) since we can't do severity sorting without market data
    deadInventory.sort((a, b) => b.daysListed - a.daysListed);

    this.log.info({ deadInventoryCount: total, page, totalPages }, 'Found dead inventory');
    return {
      deadInventory,
      total,
      totalPages,
    };
  }

  /**
   * Get market demand data from sold items (last 90 days)
   */
  async getMarketDemandData() {
    const cutoffDate = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);

    const results = await SoldItem.query()
      .select(
        'title',
        raw('COUNT(*) as "soldCount"'),
        raw('AVG("soldPrice") as "avgPrice"')
      )
      .where('soldDate', '>=', cutoffDate)
      .groupBy('title');

    const demandMap = {};
    for (const row of results) {
      const key = this.normalizeTitle(row.title);
      demandMap[key] = {
        soldCount: parseInt(row.soldCount, 10),
        avgPrice: parseFloat(row.avgPrice),
      };
    }
    return demandMap;
  }

  /**
   * Get competitor data from Item table
   */
  async getCompetitorData() {
    const results = await Item.query()
      .select(
        'title',
        raw('COUNT(DISTINCT seller) as "competitorCount"'),
        raw('MIN(price) as "minPrice"'),
        raw('AVG(price) as "avgPrice"')
      )
      .groupBy('title');

    const competitorMap = {};
    for (const row of results) {
      const key = this.normalizeTitle(row.title);
      competitorMap[key] = {
        competitorCount: parseInt(row.competitorCount, 10),
        minPrice: parseFloat(row.minPrice),
        avgPrice: parseFloat(row.avgPrice),
      };
    }
    return competitorMap;
  }

  /**
   * Normalize title for matching
   */
  normalizeTitle(title) {
    if (!title) return '';
    return title
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Find best matching key in a map
   */
  findBestMatch(title, map) {
    const normalizedTitle = this.normalizeTitle(title);
    const words = normalizedTitle.split(' ').filter(w => w.length > 2);

    let bestMatch = null;
    let bestScore = 0;

    for (const key of Object.keys(map)) {
      const keyWords = key.split(' ').filter(w => w.length > 2);
      let matchCount = 0;
      for (const word of words) {
        if (keyWords.includes(word)) {
          matchCount++;
        }
      }
      const score = matchCount / Math.max(words.length, keyWords.length);
      if (score > bestScore && score > 0.3) {
        bestScore = score;
        bestMatch = key;
      }
    }

    return bestMatch;
  }

  /**
   * Analyze a dead listing
   */
  analyzeDeadListing({ listing, marketData, competitorData, now }) {
    const startDate = new Date(listing.startTime);
    const daysListed = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
    const currentPrice = parseFloat(listing.currentPrice);

    // Find market data
    const marketKey = this.findBestMatch(listing.title, marketData);
    const market = marketKey ? marketData[marketKey] : null;

    // Find competitor data
    const competitorKey = this.findBestMatch(listing.title, competitorData);
    const competitor = competitorKey ? competitorData[competitorKey] : null;

    // Calculate market sales in last 90 days
    const marketSalesLast90Days = market?.soldCount || 0;
    const marketAvgPrice = market?.avgPrice;

    // Get competitor count
    const competitorCount = competitor?.competitorCount || 0;
    const competitorMinPrice = competitor?.minPrice;
    const competitorAvgPrice = competitor?.avgPrice;

    // Determine recommendation and action
    let recommendation;
    let suggestedAction;
    let reasoning;

    if (marketSalesLast90Days === 0) {
      // No market demand at all
      recommendation = 'SCRAP';
      suggestedAction = 'Consider scrapping or donating';
      reasoning = 'No market sales in 90 days - extremely low demand';
    } else if (marketSalesLast90Days < 3) {
      // Very low demand
      if (daysListed > 180) {
        recommendation = 'SCRAP';
        suggestedAction = 'Scrap or deep discount to $' + Math.max(10, currentPrice * 0.3).toFixed(2);
        reasoning = 'Very low demand and listed over 180 days';
      } else {
        recommendation = 'DEEP DISCOUNT';
        suggestedAction = 'Reduce to $' + Math.max(10, currentPrice * 0.5).toFixed(2);
        reasoning = 'Low market demand - aggressive pricing needed';
      }
    } else if (currentPrice > (marketAvgPrice || 0) * 1.3) {
      // Overpriced
      const suggestedPrice = marketAvgPrice ? Math.floor(marketAvgPrice * 0.95) + 0.99 : currentPrice * 0.8;
      recommendation = 'REDUCE PRICE';
      suggestedAction = 'Reduce to $' + suggestedPrice.toFixed(2);
      reasoning = 'Priced significantly above market average';
    } else if (competitorMinPrice && currentPrice > competitorMinPrice * 1.2) {
      // Undercut by competitors
      const suggestedPrice = Math.floor(competitorMinPrice * 1.05) + 0.99;
      recommendation = 'REDUCE PRICE';
      suggestedAction = 'Match or beat competitor at $' + suggestedPrice.toFixed(2);
      reasoning = 'Competitors are pricing lower';
    } else if (daysListed > 180) {
      // Listed too long, some demand exists
      recommendation = 'RELIST';
      suggestedAction = 'End and relist to refresh search ranking';
      reasoning = 'Listing is stale - relisting may improve visibility';
    } else {
      // Some hope - moderate action
      recommendation = 'HOLD';
      suggestedAction = 'Monitor for another 30 days';
      reasoning = 'Market demand exists - price may be ok';
    }

    return {
      ebayItemId: listing.ebayItemId,
      title: listing.title,
      sku: listing.sku,
      daysListed,
      currentPrice: currentPrice?.toFixed(2),
      marketSalesLast90Days,
      marketAvgPrice: marketAvgPrice?.toFixed(2),
      competitorCount,
      competitorMinPrice: competitorMinPrice?.toFixed(2),
      competitorAvgPrice: competitorAvgPrice?.toFixed(2),
      recommendation,
      suggestedAction,
      reasoning,
      viewItemUrl: listing.viewItemUrl,
    };
  }

  /**
   * Scan for dead inventory and log to dead_inventory table.
   * Items listed > 60 days with no sale in YourSale.
   */
  async scanAndLog() {
    this.log.info('Running dead inventory scan-and-log');
    const STALE_DAYS = 60;
    const cutoff = new Date(Date.now() - STALE_DAYS * 24 * 60 * 60 * 1000);

    let items;
    try {
      items = await database('Item')
        .where('createdAt', '<', cutoff)
        .whereNotNull('manufacturerPartNumber')
        .select('id', 'title', 'price', 'manufacturerPartNumber', 'partNumberBase', 'createdAt');
    } catch (err) {
      this.log.warn({ err: err.message }, 'scanAndLog: Item query failed');
      return { scanned: 0, flagged: 0 };
    }

    let flagged = 0;
    for (const item of items) {
      const base = item.partNumberBase || normalizePartNumber(item.manufacturerPartNumber);
      const daysListed = Math.floor((Date.now() - new Date(item.createdAt).getTime()) / 86400000);

      // Check if sold
      let soldCount = 0;
      try {
        const sales = await database('YourSale')
          .whereRaw('UPPER(title) LIKE ?', ['%' + (base || '').toUpperCase() + '%'])
          .count('* as cnt').first();
        soldCount = parseInt(sales?.cnt) || 0;
      } catch (e) { /* table may not exist */ }

      if (soldCount > 0) continue;

      // Failure reason
      let failureReason = 'unknown';
      const itemPrice = parseFloat(item.price) || 0;
      let marketAvg = 0;
      try {
        const cache = await database('market_demand_cache')
          .where('part_number_base', base).first();
        if (cache) marketAvg = parseFloat(cache.ebay_avg_price) || 0;
      } catch (e) { /* table may not exist */ }

      if (marketAvg > 0 && itemPrice > marketAvg * 1.2) failureReason = 'overpriced';
      else if (marketAvg > 0) failureReason = 'low_demand';

      // Skip duplicates
      try {
        const existing = await database('dead_inventory')
          .where('part_number_exact', item.manufacturerPartNumber).first();
        if (existing) continue;
      } catch (e) { /* table may not exist */ }

      try {
        await database('dead_inventory').insert({
          part_number_exact: item.manufacturerPartNumber,
          part_number_base: base,
          description: item.title,
          days_listed: daysListed,
          final_price: itemPrice,
          market_avg_at_time: marketAvg || null,
          price_vs_market: marketAvg > 0 ? Math.round((itemPrice / marketAvg) * 100) / 100 : null,
          failure_reason: failureReason,
          sold: false,
          createdAt: new Date(),
        });
        flagged++;
      } catch (err) {
        this.log.warn({ err: err.message }, 'dead_inventory insert failed');
      }
    }

    this.log.info({ scanned: items.length, flagged }, 'Dead inventory scan complete');
    return { scanned: items.length, flagged };
  }

  /**
   * Check if a part number has a dead inventory warning.
   * Returns warning object or null.
   */
  async getWarning(partNumber) {
    if (!partNumber) return null;
    const base = normalizePartNumber(partNumber);
    try {
      const record = await database('dead_inventory')
        .where('part_number_base', base)
        .orderBy('createdAt', 'desc').first();
      if (!record) return null;
      return {
        daysListed: record.days_listed,
        failureReason: record.failure_reason,
        finalPrice: record.final_price,
        marketAvg: record.market_avg_at_time,
      };
    } catch (e) { return null; }
  }
}

module.exports = DeadInventoryService;
```
---
## FILE: service/services/RestockService.js
```javascript
'use strict';

const { log } = require('../lib/logger');
const { database } = require('../database/database');
const { normalizePartNumber } = require('../lib/partNumberUtils');

/**
 * RestockService — Identifies parts that need restocking
 *
 * Rule: sold >= 2x active stock in 90 days = restock flag.
 * Checks both stores. Recent 30 days weighted heavier.
 * Days-to-sell as tiebreaker.
 */
class RestockService {
  constructor() {
    this.log = log.child({ class: 'RestockService' }, true);
  }

  /**
   * Scan and flag parts that need restocking.
   */
  async scanAndFlag() {
    this.log.info('Running restock scan');

    const cutoff90 = new Date(Date.now() - 90 * 86400000);
    const cutoff30 = new Date(Date.now() - 30 * 86400000);

    // Get sold items grouped by SKU/part number (last 90 days)
    let sales90, sales30;
    try {
      sales90 = await database('YourSale')
        .where('soldDate', '>=', cutoff90)
        .whereNotNull('sku')
        .where('sku', '!=', '')
        .select('sku', 'title', 'salePrice', 'soldDate', 'store');
    } catch (e) {
      this.log.warn({ err: e.message }, 'Could not query YourSale');
      return { scanned: 0, flagged: 0 };
    }

    // Group by normalized part number
    const salesByPart = {};
    for (const sale of sales90) {
      const base = normalizePartNumber(sale.sku);
      if (!base) continue;

      if (!salesByPart[base]) {
        salesByPart[base] = { title: sale.title, sold90: 0, sold30: 0, totalRevenue: 0, dates: [], stores: new Set() };
      }
      salesByPart[base].sold90++;
      salesByPart[base].totalRevenue += parseFloat(sale.salePrice) || 0;
      salesByPart[base].dates.push(new Date(sale.soldDate));
      salesByPart[base].stores.add(sale.store || 'dynatrack');

      if (new Date(sale.soldDate) >= cutoff30) {
        salesByPart[base].sold30++;
      }
    }

    // Get active stock counts
    let activeStock = {};
    try {
      const listings = await database('YourListing')
        .where('listingStatus', 'Active')
        .whereNotNull('sku')
        .select('sku', 'quantityAvailable', 'store');

      for (const listing of listings) {
        const base = normalizePartNumber(listing.sku);
        if (!base) continue;
        activeStock[base] = (activeStock[base] || 0) + (parseInt(listing.quantityAvailable) || 1);
      }
    } catch (e) {
      this.log.warn({ err: e.message }, 'Could not query YourListing for stock');
    }

    // Flag parts where sold >= 2x active stock
    let flagged = 0;
    for (const [base, data] of Object.entries(salesByPart)) {
      const stock = activeStock[base] || 0;

      // sold >= 2x active stock in 90 days = restock flag
      if (data.sold90 < 2 * Math.max(stock, 1)) continue;

      // Calculate avg days to sell (if we have date data)
      const avgDaysToSell = data.dates.length > 1
        ? Math.round((data.dates[data.dates.length - 1] - data.dates[0]) / data.dates.length / 86400000)
        : null;

      const avgPrice = data.sold90 > 0 ? Math.round(data.totalRevenue / data.sold90 * 100) / 100 : 0;

      // Restock score: weight recent 30d sales heavier
      // Score = (sold30 * 2 + sold90) * avgPrice / max(stock, 1)
      const restockScore = Math.round(((data.sold30 * 2 + data.sold90) * avgPrice / Math.max(stock, 1)) * 100) / 100;

      // Upsert restock flag
      try {
        const existing = await database('restock_flag')
          .where('part_number_base', base)
          .first();

        const record = {
          part_number_base: base,
          title: data.title,
          sold_90d: data.sold90,
          sold_30d: data.sold30,
          active_stock: stock,
          avg_sold_price: avgPrice,
          avg_days_to_sell: avgDaysToSell,
          restock_score: restockScore,
          store: data.stores.size > 1 ? 'all' : [...data.stores][0] || 'dynatrack',
          last_checked: new Date(),
        };

        if (existing) {
          await database('restock_flag').where('id', existing.id).update(record);
        } else {
          record.createdAt = new Date();
          await database('restock_flag').insert(record);
        }
        flagged++;
      } catch (err) {
        this.log.warn({ err: err.message, base }, 'restock_flag upsert failed');
      }
    }

    this.log.info({ scanned: Object.keys(salesByPart).length, flagged }, 'Restock scan complete');
    return { scanned: Object.keys(salesByPart).length, flagged };
  }

  /**
   * Get all active restock flags, sorted by score.
   */
  async getFlags({ acknowledged = false, limit = 50 } = {}) {
    try {
      let query = database('restock_flag');
      if (!acknowledged) query = query.where('acknowledged', false);
      return await query.orderBy('restock_score', 'desc').limit(limit);
    } catch (e) { return []; }
  }

  /**
   * Acknowledge a restock flag (puller saw it).
   */
  async acknowledge(id) {
    try {
      await database('restock_flag').where('id', id).update({ acknowledged: true });
      return { success: true };
    } catch (e) { return { success: false, error: e.message }; }
  }
}

module.exports = RestockService;
```
---
## FILE: service/services/CompetitorMonitorService.js
```javascript
'use strict';

const { log } = require('../lib/logger');
const { database } = require('../database/database');
const { normalizePartNumber } = require('../lib/partNumberUtils');

/**
 * CompetitorMonitorService — Watch competitors and generate alerts
 *
 * Advisory only — no auto-match.
 * Alerts when:
 * - We are significantly underpriced vs market
 * - A competitor drops out of a category (opportunity)
 * - A competitor undercuts us significantly
 */
class CompetitorMonitorService {
  constructor() {
    this.log = log.child({ class: 'CompetitorMonitorService' }, true);
  }

  /**
   * Run competitor monitoring scan.
   * Compares our listings against competitor prices and market data.
   */
  async scan() {
    this.log.info('Running competitor price monitoring');

    let ourListings, competitorItems;
    try {
      ourListings = await database('YourListing')
        .where('listingStatus', 'Active')
        .whereNotNull('sku')
        .select('id', 'ebayItemId', 'title', 'sku', 'currentPrice', 'store');
    } catch (e) { return { scanned: 0, alerts: 0 }; }

    try {
      competitorItems = await database('Item')
        .whereNotNull('manufacturerPartNumber')
        .select('title', 'price', 'seller', 'manufacturerPartNumber');
    } catch (e) { competitorItems = []; }

    // Build competitor price index by normalized part number
    const compIndex = {};
    for (const item of competitorItems) {
      const base = normalizePartNumber(item.manufacturerPartNumber);
      if (!base) continue;
      if (!compIndex[base]) compIndex[base] = [];
      compIndex[base].push({
        seller: item.seller,
        price: parseFloat(item.price) || 0,
        title: item.title,
      });
    }

    // Get market data
    let marketIndex = {};
    try {
      const cacheRows = await database('market_demand_cache').select('*');
      for (const row of cacheRows) {
        marketIndex[row.part_number_base] = {
          avgPrice: parseFloat(row.ebay_avg_price) || 0,
          sold90d: parseInt(row.ebay_sold_90d) || 0,
        };
      }
    } catch (e) { /* ignore */ }

    let alertCount = 0;
    for (const listing of ourListings) {
      const base = normalizePartNumber(listing.sku);
      if (!base) continue;

      const ourPrice = parseFloat(listing.currentPrice) || 0;
      const competitors = compIndex[base] || [];
      const market = marketIndex[base];

      // Check: are we significantly underpriced?
      if (market && market.avgPrice > 0 && ourPrice < market.avgPrice * 0.75) {
        await this.createAlert({
          competitorSeller: null,
          partNumberBase: base,
          title: listing.title,
          alertType: 'underpriced',
          ourPrice,
          competitorPrice: null,
          marketAvg: market.avgPrice,
          recommendation: `Our price $${ourPrice.toFixed(2)} is ${Math.round((1 - ourPrice / market.avgPrice) * 100)}% below market avg $${market.avgPrice.toFixed(2)}. Consider raising.`,
        });
        alertCount++;
      }

      // Check: competitor undercuts us significantly
      for (const comp of competitors) {
        if (comp.price > 0 && comp.price < ourPrice * 0.70) {
          await this.createAlert({
            competitorSeller: comp.seller,
            partNumberBase: base,
            title: listing.title,
            alertType: 'competitor_undercut',
            ourPrice,
            competitorPrice: comp.price,
            marketAvg: market?.avgPrice || null,
            recommendation: `${comp.seller} lists at $${comp.price.toFixed(2)} vs our $${ourPrice.toFixed(2)}. Advisory — review pricing.`,
          });
          alertCount++;
          break; // One alert per listing per scan
        }
      }
    }

    // Check for competitors dropping out of categories we sell in
    // (This detects when competitor_count drops to 0 for a part we stock)
    // Assumption: this would require historical data; for now we flag when
    // we have no competition on a high-demand part

    this.log.info({ scanned: ourListings.length, alerts: alertCount },
      'Competitor monitoring complete');
    return { scanned: ourListings.length, alerts: alertCount };
  }

  async createAlert({ competitorSeller, partNumberBase, title, alertType, ourPrice, competitorPrice, marketAvg, recommendation }) {
    try {
      // Skip duplicate alerts (same type + part in last 7 days)
      const cutoff = new Date(Date.now() - 7 * 86400000);
      const existing = await database('competitor_alert')
        .where('part_number_base', partNumberBase)
        .where('alert_type', alertType)
        .where('createdAt', '>', cutoff)
        .first();
      if (existing) return;

      await database('competitor_alert').insert({
        competitor_seller: competitorSeller,
        part_number_base: partNumberBase,
        title,
        alert_type: alertType,
        our_price: ourPrice,
        competitor_price: competitorPrice,
        market_avg: marketAvg,
        recommendation,
        dismissed: false,
        createdAt: new Date(),
      });
    } catch (err) {
      this.log.warn({ err: err.message }, 'competitor_alert insert failed');
    }
  }

  /**
   * Get active (undismissed) alerts.
   */
  async getAlerts({ limit = 50, dismissed = false } = {}) {
    try {
      return await database('competitor_alert')
        .where('dismissed', dismissed)
        .orderBy('createdAt', 'desc')
        .limit(limit);
    } catch (e) { return []; }
  }

  /**
   * Dismiss an alert.
   */
  async dismiss(id) {
    try {
      await database('competitor_alert').where('id', id).update({ dismissed: true });
      return { success: true };
    } catch (e) { return { success: false, error: e.message }; }
  }
}

module.exports = CompetitorMonitorService;
```
---
## FILE: service/services/ScoutAlertService.js
```javascript
'use strict';

const { database } = require('../database/database');
const { log } = require('../lib/logger');
const { parseTitle, matchPartToSales, loadModelsFromDB } = require('../utils/partMatcher');
const { modelMatches: piModelMatches, parseYearRange: piParseYear } = require('../utils/partIntelligence');

// Known automotive makes for title parsing
const KNOWN_MAKES = [
  'Acura','Audi','BMW','Buick','Cadillac','Chevrolet','Chrysler','Dodge','Fiat','Ford',
  'Genesis','GMC','Honda','Hummer','Hyundai','Infiniti','Isuzu','Jaguar','Jeep','Kia',
  'Land Rover','Lexus','Lincoln','Mazda','Mercedes-Benz','Mercedes','Mercury','Mini',
  'Mitsubishi','Nissan','Oldsmobile','Pontiac','Porsche','Ram','Saab','Saturn','Scion',
  'Subaru','Suzuki','Toyota','Volkswagen','Volvo',
];
const MAKE_ALIASES = {
  'chevy': 'Chevrolet', 'vw': 'Volkswagen', 'merc': 'Mercury',
  'mercedes benz': 'Mercedes-Benz', 'land rover': 'Land Rover',
};

async function generateAlerts() {
  const startTime = Date.now();
  log.info('Generating scout alerts...');

  // Ensure models are loaded from Auto table before parsing
  await loadModelsFromDB();

  // 1. Get all active yard vehicles (include id for mark matching)
  const vehicles = await database('yard_vehicle')
    .join('yard', 'yard.id', 'yard_vehicle.yard_id')
    .where('yard_vehicle.active', true)
    .where('yard.enabled', true)
    .select(
      'yard_vehicle.id as yard_vehicle_id',
      'yard_vehicle.year', 'yard_vehicle.make', 'yard_vehicle.model',
      'yard_vehicle.color', 'yard_vehicle.row_number', 'yard_vehicle.date_added',
      'yard_vehicle.engine', 'yard_vehicle.drivetrain', 'yard_vehicle.trim_level',
      'yard_vehicle.decoded_trim', 'yard_vehicle.decoded_engine',
      'yard.name as yard_name'
    );

  if (vehicles.length === 0) {
    log.info('No active yard vehicles — skipping alert generation');
    await saveMeta();
    return { alerts: 0 };
  }

  // 2. Gather parts we need from all sources
  const partsToMatch = [];

  // SCOUR STREAM — manual want list
  const wantList = await database('restock_want_list').where({ active: true });
  for (const item of wantList) {
    const parsed = parseTitle(item.title);
    if (parsed && (parsed.make || parsed.models.length > 0)) {
      const sales = await matchPartToSales(item.title);
      partsToMatch.push({
        source: 'hunters_perch',
        title: item.title,
        value: sales.avgPrice,
        make: parsed.make,
        models: parsed.models,
        yearStart: parsed.yearStart,
        yearEnd: parsed.yearEnd,
      });
    }
  }

  // THE QUARRY — recently sold items with low/no stock
  try {
    const bonePileSales = await database('YourSale')
      .where('soldDate', '>=', database.raw("NOW() - INTERVAL '60 days'"))
      .whereNotNull('title')
      .whereRaw('"salePrice"::numeric >= 50')
      .select('title', 'salePrice');

    const seen = new Map();
    for (const sale of bonePileSales) {
      const parsed = parseTitle(sale.title);
      if (!parsed || parsed.models.length === 0) continue;
      const key = (parsed.make || '') + '|' + (parsed.models[0] || '') + '|' + sale.title.substring(0, 40);
      if (!seen.has(key)) {
        seen.set(key, {
          source: 'bone_pile',
          title: sale.title,
          value: Math.round(parseFloat(sale.salePrice) || 0),
          make: parsed.make,
          models: parsed.models,
          yearStart: parsed.yearStart,
          yearEnd: parsed.yearEnd,
        });
      }
    }
    for (const part of seen.values()) partsToMatch.push(part);
  } catch (e) {
    log.warn({ err: e.message }, 'Failed to load bone pile data');
  }

  // THE MARK — active marks from Hunters Perch (highest priority)
  let markAlerts = [];
  try {
    const activeMarks = await database('the_mark').where('active', true);
    if (activeMarks.length > 0) {
      markAlerts = matchMarksAgainstVehicles(activeMarks, vehicles);
      log.info({ markCount: activeMarks.length, alertsGenerated: markAlerts.length }, 'Mark matching complete');
    }
  } catch (e) {
    log.warn({ err: e.message }, 'Failed to load marks for alert generation');
  }

  // 3. Match want list / quarry parts against yard vehicles
  const alerts = [];
  for (const part of partsToMatch) {
    for (const v of vehicles) {
      const match = scoreMatch(part, v);
      if (match.confidence) {
        alerts.push({
          source: part.source,
          source_title: part.title,
          part_value: part.value,
          yard_name: v.yard_name,
          vehicle_year: v.year,
          vehicle_make: v.make,
          vehicle_model: v.model,
          vehicle_color: v.color,
          row: v.row_number || null,
          confidence: match.confidence,
          notes: match.notes || null,
          vehicle_set_date: v.date_added,
        });
      }
    }
  }

  // Add mark alerts
  for (const ma of markAlerts) {
    alerts.push(ma.alert);
  }

  // 4. Delete old alerts (preserve OVERSTOCK source) and insert new ones
  await database('scout_alerts').whereNot('source', 'OVERSTOCK').del();
  for (let i = 0; i < alerts.length; i += 50) {
    await database('scout_alerts').insert(alerts.slice(i, i + 50));
  }

  // 5. Update the_mark with match data
  for (const ma of markAlerts) {
    try {
      await database('the_mark').where('id', ma.markId).update({
        match_confidence: ma.confidence,
        matched_yard_vehicle_id: ma.yardVehicleId,
        matched_at: new Date(),
        updatedAt: new Date(),
      });
    } catch (e) {
      // Column may not exist yet if migration hasn't run
    }
  }

  await saveMeta();

  const elapsed = Date.now() - startTime;
  log.info({ alertCount: alerts.length, markAlerts: markAlerts.length, partsChecked: partsToMatch.length, vehiclesInYards: vehicles.length, elapsed }, 'Scout alerts generated');
  return { alerts: alerts.length, markAlerts: markAlerts.length, partsChecked: partsToMatch.length, vehicles: vehicles.length, elapsed };
}

/**
 * Match active marks against yard vehicles with confidence scoring.
 * Returns array of { markId, yardVehicleId, confidence, alert }
 */
function matchMarksAgainstVehicles(marks, vehicles) {
  const results = [];
  const seen = new Set(); // dedup: markId + yardVehicleId

  for (const mark of marks) {
    const parsed = parseMarkTitle(mark.originalTitle);
    if (!parsed.make || parsed.models.length === 0) continue;

    for (const v of vehicles) {
      const dedupeKey = mark.id + ':' + v.yard_vehicle_id;
      if (seen.has(dedupeKey)) continue;

      const match = scoreMarkMatch(parsed, v, mark);
      if (!match.confidence) continue;

      seen.add(dedupeKey);
      results.push({
        markId: mark.id,
        yardVehicleId: v.yard_vehicle_id,
        confidence: match.confidence,
        alert: {
          source: 'PERCH',
          source_title: mark.originalTitle,
          part_value: mark.medianPrice || null,
          yard_name: v.yard_name,
          vehicle_year: v.year,
          vehicle_make: v.make,
          vehicle_model: v.model,
          vehicle_color: v.color,
          row: v.row_number || null,
          confidence: match.confidence,
          notes: match.notes || null,
          vehicle_set_date: v.date_added,
        },
      });
      // Only keep the first (best) match per mark per yard
      break;
    }
  }

  return results;
}

/**
 * Parse a mark's original title to extract year, make, model, engine, part type.
 * Mark titles come from competitor eBay sold items, e.g.:
 *   "2019 Jeep Grand Cherokee OEM Body Control Module BCM 68366989AC"
 *   "2017-2020 Ford F-150 3.5L EcoBoost Engine Control Module ECM"
 */
function parseMarkTitle(title) {
  if (!title) return { make: null, models: [], yearStart: null, yearEnd: null, engine: null };

  // Use existing parseTitle from partMatcher for year/make/model extraction
  const parsed = parseTitle(title);
  if (!parsed) return { make: null, models: [], yearStart: null, yearEnd: null, engine: null };

  // Extract engine pattern from title
  const engineMatch = title.match(/\b(\d\.\d)[\s-]?[lL]?\b/);
  const engineStr = engineMatch ? engineMatch[1] + 'L' : null;

  // Also check for named engines
  const titleLower = title.toLowerCase();
  let engineName = null;
  if (/hemi/.test(titleLower)) engineName = 'HEMI';
  else if (/ecoboost/.test(titleLower)) engineName = 'EcoBoost';
  else if (/coyote/.test(titleLower)) engineName = 'Coyote';
  else if (/pentastar/.test(titleLower)) engineName = 'Pentastar';

  return {
    make: parsed.make,
    models: parsed.models,
    yearStart: parsed.yearStart,
    yearEnd: parsed.yearEnd,
    engine: engineStr,
    engineName: engineName,
  };
}

/**
 * Score a mark against a yard vehicle.
 * HIGH: year+make+model+engine match
 * MEDIUM: year+make+model match, engine unknown or mismatch
 * null: no signal (make/model/year don't match)
 */
function scoreMarkMatch(parsed, vehicle, mark) {
  const vMake = (vehicle.make || '').toLowerCase();
  const vModel = (vehicle.model || '').toLowerCase();
  const vYear = parseInt(vehicle.year) || 0;

  // RULE 1: Make must match (exact, case-insensitive)
  if (!parsed.make) return {};
  const pMake = parsed.make.toLowerCase();
  if (vMake !== pMake && !vMake.includes(pMake) && !pMake.includes(vMake)) return {};

  // RULE 2: Model must match (word-boundary — Cherokee ≠ Grand Cherokee)
  if (parsed.models.length === 0) return {};
  let modelMatch = false;
  for (const m of parsed.models) {
    const mLower = m.toLowerCase();
    const re = new RegExp('\\b' + mLower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b');
    if (re.test(vModel) || re.test(vMake + ' ' + vModel)) {
      modelMatch = true;
      break;
    }
  }
  if (!modelMatch) return {};

  // RULE 3: Year must be within range
  if (parsed.yearStart && parsed.yearEnd && vYear > 0) {
    if (vYear < parsed.yearStart || vYear > parsed.yearEnd) return {};
  }

  // RULE 4: Engine matching
  const vEngine = (vehicle.decoded_engine || vehicle.engine || '').toLowerCase();
  const hasVehicleEngine = vEngine && vEngine !== 'n/a' && vEngine.length > 1;
  const hasMarkEngine = parsed.engine || parsed.engineName;

  let engineMatch = false;
  if (hasMarkEngine && hasVehicleEngine) {
    if (parsed.engine) {
      // Displacement match: "3.5L" in "3.5L V6"
      engineMatch = vEngine.includes(parsed.engine.toLowerCase());
    }
    if (!engineMatch && parsed.engineName) {
      engineMatch = vEngine.includes(parsed.engineName.toLowerCase());
    }
  }

  // Score confidence
  const notes = [];
  let confidence;

  if (hasMarkEngine && hasVehicleEngine && engineMatch) {
    confidence = 'high';
  } else if (hasMarkEngine && hasVehicleEngine && !engineMatch) {
    // Engine mismatch — still MEDIUM because the part might fit
    confidence = 'medium';
    notes.push('Engine mismatch — verify fitment');
  } else if (hasMarkEngine && !hasVehicleEngine) {
    // Vehicle engine unknown — include but note
    confidence = 'medium';
    notes.push('Verify engine at yard');
  } else {
    // Mark has no engine spec — year+make+model is enough for HIGH
    confidence = 'high';
  }

  // Trim bonus: if yard vehicle has decoded_trim, note it
  if (vehicle.decoded_trim) {
    notes.push('Trim: ' + vehicle.decoded_trim);
  }

  // Add part info from mark
  if (mark.partType) {
    notes.push('Part: ' + mark.partType);
  }

  return { confidence, notes: notes.length > 0 ? notes.join('; ') : null };
}

function scoreMatch(part, vehicle) {
  const vMake = (vehicle.make || '').toLowerCase();
  const vModel = (vehicle.model || '').toLowerCase();
  const vYear = parseInt(vehicle.year) || 0;

  // RULE 1: Make must match
  const makeMatch = part.make && vMake.includes(part.make.toLowerCase());
  if (!makeMatch) return {};

  // RULE 2: Model MUST match. No "no specific model" alerts.
  if (part.models.length === 0) return {};

  let modelMatch = false;
  for (const m of part.models) {
    const mLower = m.toLowerCase();
    const re = new RegExp('\\b' + mLower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b');
    if (re.test(vModel) || re.test(vMake + ' ' + vModel)) {
      modelMatch = true;
      break;
    }
  }
  if (!modelMatch) return {};

  // RULE 3: Year must be WITHIN range.
  if (part.yearStart && part.yearEnd && vYear > 0) {
    if (vYear < part.yearStart || vYear > part.yearEnd) return {};
  }
  const hasYearRange = part.yearStart && part.yearEnd;
  const yearVerified = hasYearRange && vYear >= part.yearStart && vYear <= part.yearEnd;

  // RULE 4: Confidence based on what we can confirm
  let confidence;
  const notes = [];
  const titleLower = (part.title || '').toLowerCase();
  const needsEngineVerify = /v8|5\.7|hemi|v6|3\.5|3\.8|2\.3|2\.7|4\.7/.test(titleLower);
  const needsDriveVerify = /4x4|awd|4wd|fwd/.test(titleLower);
  const needsTrimVerify = /type.?s|sport|limited|touring|ss\b|hybrid/i.test(titleLower);

  if (yearVerified || !hasYearRange) {
    if (needsEngineVerify && !vehicle.engine) {
      confidence = 'medium'; notes.push('Verify engine at yard');
    } else if (needsDriveVerify && !vehicle.drivetrain) {
      confidence = 'medium'; notes.push('Verify drivetrain at yard');
    } else if (needsTrimVerify && !vehicle.trim_level) {
      confidence = 'medium'; notes.push('Verify trim/hybrid at yard');
    } else {
      confidence = 'high';
    }
    if (!hasYearRange) notes.push('No year range specified — verify fitment');
  } else {
    return {};
  }

  return { confidence, notes: notes.length > 0 ? notes.join('; ') : null };
}

async function saveMeta() {
  const now = new Date().toISOString();
  try {
    await database('scout_alerts_meta').insert({ key: 'last_generated', value: now })
      .onConflict('key').merge();
  } catch (e) {
    await database('scout_alerts_meta').where('key', 'last_generated').del();
    await database('scout_alerts_meta').insert({ key: 'last_generated', value: now });
  }
}

module.exports = { generateAlerts };
```
---
## FILE: service/services/LifecycleService.js
```javascript
'use strict';

const { log } = require('../lib/logger');
const { database } = require('../database/database');

// Part type detection matching AttackListService pattern
const TYPE_PATTERNS = [
  { re: /\b(TCM|TCU|TRANSMISSION\s*CONTROL)\b/i, type: 'TCM' },
  { re: /\b(BCM|BODY\s*CONTROL)\b/i, type: 'BCM' },
  { re: /\b(ECM|ECU|PCM|ENGINE\s*CONTROL|ENGINE\s*COMPUTER)\b/i, type: 'ECM' },
  { re: /\b(ABS|ANTI.?LOCK|BRAKE\s*MODULE)\b/i, type: 'ABS' },
  { re: /\b(TIPM|FUSE\s*BOX|JUNCTION|IPDM)\b/i, type: 'TIPM' },
  { re: /\b(AMP|AMPLIFIER|BOSE|HARMAN|JBL)\b/i, type: 'AMP' },
  { re: /\b(CLUSTER|SPEEDOMETER|INSTRUMENT)\b/i, type: 'CLUSTER' },
  { re: /\b(RADIO|HEAD\s*UNIT|INFOTAINMENT|STEREO)\b/i, type: 'RADIO' },
  { re: /\b(THROTTLE\s*BODY)\b/i, type: 'THROTTLE' },
  { re: /\b(STEERING|EPS)\b/i, type: 'STEERING' },
  { re: /\b(MIRROR)\b/i, type: 'MIRROR' },
  { re: /\b(WINDOW.*(MOTOR|REGULATOR))\b/i, type: 'REGULATOR' },
  { re: /\b(ALTERNATOR)\b/i, type: 'ALTERNATOR' },
  { re: /\b(STARTER)\b/i, type: 'STARTER' },
  { re: /\b(CAMERA|BACKUP\s*CAM)\b/i, type: 'CAMERA' },
  { re: /\b(BLOWER\s*MOTOR)\b/i, type: 'BLOWER' },
  { re: /\b(HVAC|CLIMATE|HEATER)\s*(CONTROL|MODULE)?\b/i, type: 'HVAC' },
];

function detectType(title) {
  if (!title) return 'OTHER';
  for (const { re, type } of TYPE_PATTERNS) { if (re.test(title)) return type; }
  return 'OTHER';
}

const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const DAY_NAMES = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];

class LifecycleService {
  constructor() {
    this.log = log.child({ class: 'LifecycleService' }, true);
  }

  // ── 4a: Lifecycle Analytics ──

  async getLifecycleMetrics({ daysBack = 365 } = {}) {
    const cutoff = new Date(Date.now() - daysBack * 86400000);

    // Get all sales with listing startTime for time-to-sell
    const sales = await database('YourSale')
      .leftJoin('YourListing', 'YourSale.ebayItemId', 'YourListing.ebayItemId')
      .where('YourSale.soldDate', '>=', cutoff)
      .select(
        'YourSale.title', 'YourSale.salePrice', 'YourSale.soldDate',
        'YourSale.ebayItemId', 'YourListing.startTime', 'YourListing.currentPrice'
      );

    // Get returns for return rate
    let returnMap = new Map();
    try {
      const returns = await database('return_intake')
        .select('ebay_item_id', 'condition_grade');
      for (const r of returns) returnMap.set(r.ebay_item_id, r);
    } catch (e) {}

    // Get stale actions for price decay
    let staleMap = new Map();
    try {
      const actions = await database('stale_inventory_action')
        .where('executed', true)
        .select('ebay_item_id', 'old_price', 'new_price');
      for (const a of actions) staleMap.set(a.ebay_item_id, a);
    } catch (e) {}

    // Group by part type
    const typeMap = {};
    for (const sale of sales) {
      const pt = detectType(sale.title);
      if (pt === 'OTHER') continue;

      if (!typeMap[pt]) {
        typeMap[pt] = { salesCount: 0, totalRevenue: 0, prices: [], daysToSell: [], decays: [], returnCount: 0 };
      }
      const t = typeMap[pt];
      const price = parseFloat(sale.salePrice) || 0;
      t.salesCount++;
      t.totalRevenue += price;
      t.prices.push(price);

      // Time to sell
      if (sale.startTime && sale.soldDate) {
        const days = Math.floor((new Date(sale.soldDate) - new Date(sale.startTime)) / 86400000);
        if (days >= 0 && days < 1000) t.daysToSell.push(days);
      }

      // Price decay
      const stale = staleMap.get(sale.ebayItemId);
      if (stale) {
        const oldP = parseFloat(stale.old_price) || 0;
        if (oldP > 0) t.decays.push(((oldP - price) / oldP) * 100);
      }

      // Return
      if (returnMap.has(sale.ebayItemId)) t.returnCount++;
    }

    // Build result
    const partTypes = Object.entries(typeMap).map(([pt, t]) => {
      const sorted = t.daysToSell.slice().sort((a, b) => a - b);
      const median = sorted.length > 0
        ? (sorted.length % 2 === 0 ? (sorted[sorted.length/2-1] + sorted[sorted.length/2]) / 2 : sorted[Math.floor(sorted.length/2)])
        : null;

      return {
        partType: pt,
        salesCount: t.salesCount,
        totalRevenue: Math.round(t.totalRevenue),
        avgPrice: t.salesCount > 0 ? Math.round(t.totalRevenue / t.salesCount) : 0,
        avgDaysToSell: sorted.length > 0 ? Math.round(sorted.reduce((a, b) => a + b, 0) / sorted.length) : null,
        medianDaysToSell: median !== null ? Math.round(median) : null,
        avgDecayPercent: t.decays.length > 0 ? Math.round(t.decays.reduce((a, b) => a + b, 0) / t.decays.length * 10) / 10 : 0,
        returnRate: t.salesCount > 0 ? Math.round((t.returnCount / t.salesCount) * 1000) / 10 : 0,
        returnCount: t.returnCount,
        velocity: median !== null ? (median < 14 ? 'fast' : median > 90 ? 'slow' : 'normal') : 'unknown',
      };
    }).sort((a, b) => b.totalRevenue - a.totalRevenue);

    const totalRevenue = partTypes.reduce((s, p) => s + p.totalRevenue, 0);
    const totalSales = partTypes.reduce((s, p) => s + p.salesCount, 0);
    const allDays = Object.values(typeMap).flatMap(t => t.daysToSell);
    const avgDaysAll = allDays.length > 0 ? Math.round(allDays.reduce((a, b) => a + b, 0) / allDays.length) : null;

    return {
      partTypes,
      totals: { totalRevenue, totalSales, avgDaysToSell: avgDaysAll, periodDays: daysBack },
      generatedAt: new Date().toISOString(),
    };
  }

  // ── 4b: Seasonal Intelligence ──

  async getSeasonalPatterns({ yearsBack = 2 } = {}) {
    const cutoff = new Date(Date.now() - yearsBack * 365 * 86400000);

    // Monthly aggregation
    const monthlyRows = await database.raw(`
      SELECT EXTRACT(MONTH FROM "soldDate")::int as month,
             COUNT(*) as sales,
             SUM("salePrice"::numeric) as revenue,
             AVG("salePrice"::numeric) as avg_price,
             COUNT(DISTINCT EXTRACT(YEAR FROM "soldDate")) as year_count
      FROM "YourSale" WHERE "soldDate" >= ? AND "soldDate" IS NOT NULL
      GROUP BY EXTRACT(MONTH FROM "soldDate")
      ORDER BY month
    `, [cutoff]);

    const avgSalesAll = monthlyRows.rows.length > 0
      ? monthlyRows.rows.reduce((s, r) => s + parseInt(r.sales), 0) / monthlyRows.rows.length
      : 1;

    // Ensure all 12 months present
    const monthMap = {};
    for (let i = 1; i <= 12; i++) monthMap[i] = { month: i, name: MONTH_NAMES[i-1], avgSales: 0, avgRevenue: 0, avgPrice: 0, vsAverage: '0%' };
    for (const r of monthlyRows.rows) {
      const yc = parseInt(r.year_count) || 1;
      const avg = Math.round(parseInt(r.sales) / yc);
      const pct = Math.round(((avg - avgSalesAll / (monthlyRows.rows.length > 0 ? 1 : 1)) / (avgSalesAll / (monthlyRows.rows.length > 0 ? 1 : 1))) * 100);
      monthMap[r.month] = {
        month: r.month, name: MONTH_NAMES[r.month - 1],
        avgSales: avg,
        avgRevenue: Math.round(parseFloat(r.revenue) / yc),
        avgPrice: Math.round(parseFloat(r.avg_price)),
        vsAverage: (pct >= 0 ? '+' : '') + pct + '%',
      };
    }
    const monthly = Object.values(monthMap);

    // Part type seasonal peaks (top 10 part types)
    const ptSeasonalRows = await database.raw(`
      SELECT title, EXTRACT(MONTH FROM "soldDate")::int as month, COUNT(*) as cnt
      FROM "YourSale" WHERE "soldDate" >= ? AND "soldDate" IS NOT NULL
      GROUP BY title, EXTRACT(MONTH FROM "soldDate")
    `, [cutoff]);

    // Group by detected part type + month
    const ptMonths = {};
    for (const r of ptSeasonalRows.rows) {
      const pt = detectType(r.title);
      if (pt === 'OTHER') continue;
      if (!ptMonths[pt]) ptMonths[pt] = {};
      ptMonths[pt][r.month] = (ptMonths[pt][r.month] || 0) + parseInt(r.cnt);
    }

    const partTypeSeasons = Object.entries(ptMonths)
      .map(([pt, months]) => {
        const entries = Object.entries(months).map(([m, c]) => ({ month: parseInt(m), count: c }));
        if (entries.length < 2) return null;
        const avg = entries.reduce((s, e) => s + e.count, 0) / entries.length;
        const peak = entries.reduce((a, b) => b.count > a.count ? b : a);
        const slow = entries.reduce((a, b) => b.count < a.count ? b : a);
        return {
          partType: pt,
          peakMonth: MONTH_NAMES[peak.month - 1],
          peakVsAvg: avg > 0 ? '+' + Math.round(((peak.count - avg) / avg) * 100) + '%' : '—',
          slowMonth: MONTH_NAMES[slow.month - 1],
          slowVsAvg: avg > 0 ? Math.round(((slow.count - avg) / avg) * 100) + '%' : '—',
          totalSales: entries.reduce((s, e) => s + e.count, 0),
        };
      })
      .filter(Boolean)
      .sort((a, b) => b.totalSales - a.totalSales)
      .slice(0, 10);

    // Day of week
    const dowRows = await database.raw(`
      SELECT EXTRACT(DOW FROM "soldDate")::int as dow, COUNT(*) as sales,
             COUNT(DISTINCT DATE_TRUNC('week', "soldDate")) as week_count
      FROM "YourSale" WHERE "soldDate" >= ? AND "soldDate" IS NOT NULL
      GROUP BY EXTRACT(DOW FROM "soldDate") ORDER BY dow
    `, [cutoff]);

    const dayMap = {};
    for (let i = 0; i < 7; i++) dayMap[i] = { day: i, name: DAY_NAMES[i], avgSales: 0 };
    for (const r of dowRows.rows) {
      const wc = parseInt(r.week_count) || 1;
      dayMap[r.dow] = { day: r.dow, name: DAY_NAMES[r.dow], avgSales: Math.round(parseInt(r.sales) / wc * 10) / 10 };
    }
    const dayOfWeek = Object.values(dayMap);

    // Quarterly trends
    const qRows = await database.raw(`
      SELECT EXTRACT(YEAR FROM "soldDate")::int as yr,
             EXTRACT(QUARTER FROM "soldDate")::int as qtr,
             COUNT(*) as sales,
             SUM("salePrice"::numeric) as revenue
      FROM "YourSale" WHERE "soldDate" >= ? AND "soldDate" IS NOT NULL
      GROUP BY EXTRACT(YEAR FROM "soldDate"), EXTRACT(QUARTER FROM "soldDate")
      ORDER BY yr, qtr
    `, [cutoff]);

    const quarterly = qRows.rows.map((r, i) => {
      const prev = i > 0 ? qRows.rows[i - 1] : null;
      const prevYear = qRows.rows.find(x => x.yr === r.yr - 1 && x.qtr === r.qtr);
      return {
        quarter: `Q${r.qtr} ${r.yr}`,
        sales: parseInt(r.sales),
        revenue: Math.round(parseFloat(r.revenue)),
        vsLastQuarter: prev ? ((parseInt(r.sales) - parseInt(prev.sales)) >= 0 ? '+' : '') + Math.round(((parseInt(r.sales) - parseInt(prev.sales)) / parseInt(prev.sales)) * 100) + '%' : '—',
        vsLastYear: prevYear ? ((parseInt(r.sales) - parseInt(prevYear.sales)) >= 0 ? '+' : '') + Math.round(((parseInt(r.sales) - parseInt(prevYear.sales)) / parseInt(prevYear.sales)) * 100) + '%' : '—',
      };
    });

    return { monthly, partTypeSeasons, dayOfWeek, quarterly, generatedAt: new Date().toISOString() };
  }
}

module.exports = LifecycleService;
```
---
## FILE: service/services/LearningsService.js
```javascript
'use strict';

const { log } = require('../lib/logger');
const { database } = require('../database/database');

/**
 * LearningsService — aggregates actionable patterns from dead inventory,
 * returns, and stale price reduction outcomes.
 */
class LearningsService {
  constructor() {
    this.log = log.child({ class: 'LearningsService' }, true);
  }

  async getLearnings() {
    const [deadPatterns, returnPatterns, staleOutcomes] = await Promise.all([
      this.getDeadPatterns(),
      this.getReturnPatterns(),
      this.getStaleOutcomes(),
    ]);

    return {
      deadPatterns,
      returnPatterns,
      staleOutcomes,
      generatedAt: new Date().toISOString(),
    };
  }

  async getDeadPatterns() {
    try {
      const rows = await database('dead_inventory')
        .select('part_number_base')
        .select(database.raw('COUNT(*) as death_count'))
        .select(database.raw('array_agg(DISTINCT failure_reason) as reasons'))
        .select(database.raw('MAX("createdAt") as last_death'))
        .groupBy('part_number_base')
        .havingRaw('COUNT(*) >= 2')
        .orderByRaw('COUNT(*) DESC')
        .limit(50);

      // Enrich with part name from Item table + vehicle from Auto/AIC
      const enriched = [];
      for (const r of rows) {
        let partName = null;
        let yearStart = null;
        let yearEnd = null;
        let make = null;
        let model = null;

        try {
          // 1. Look up Item by manufacturerPartNumber (case-insensitive)
          const item = await database('Item')
            .whereRaw('LOWER("manufacturerPartNumber") = ?', [r.part_number_base.toLowerCase()])
            .select('id', 'title')
            .first();

          if (item) {
            partName = item.title;

            // 2. Get vehicle fitment via AutoItemCompatibility → Auto
            const autos = await database('AutoItemCompatibility as aic')
              .join('Auto as a', 'a.id', 'aic.autoId')
              .where('aic.itemId', item.id)
              .select('a.year', 'a.make', 'a.model')
              .orderBy('a.year', 'asc');

            if (autos.length > 0) {
              yearStart = autos[0].year;
              yearEnd = autos[autos.length - 1].year;
              // Use the most common make/model across matches
              const makeModelCounts = {};
              for (const a of autos) {
                const key = `${a.make}|${a.model}`;
                makeModelCounts[key] = (makeModelCounts[key] || 0) + 1;
              }
              const topMakeModel = Object.entries(makeModelCounts)
                .sort((a, b) => b[1] - a[1])[0][0];
              [make, model] = topMakeModel.split('|');
            }
          }

          // Fallback: try dead_inventory's own description/vehicle_application fields
          if (!partName) {
            const diRow = await database('dead_inventory')
              .where('part_number_base', r.part_number_base)
              .whereNotNull('description')
              .select('description', 'vehicle_application')
              .first();
            if (diRow) {
              partName = diRow.description || null;
              if (!make && diRow.vehicle_application) {
                const m = diRow.vehicle_application.match(/\b((?:19|20)\d{2})\s+(\w+)\s+(\w[\w\s-]*)/i);
                if (m) {
                  yearStart = parseInt(m[1]);
                  yearEnd = yearStart;
                  make = m[2];
                  model = m[3].trim();
                }
              }
            }
          }
        } catch (e) {
          // enrichment failed, continue with nulls
        }

        enriched.push({
          partNumberBase: r.part_number_base,
          deathCount: parseInt(r.death_count),
          reasons: (r.reasons || []).filter(Boolean),
          lastDeath: r.last_death,
          partName,
          yearStart,
          yearEnd,
          make,
          model,
        });
      }
      return enriched;
    } catch (e) {
      return [];
    }
  }

  async getReturnPatterns() {
    try {
      const byGrade = await database('return_intake')
        .select('condition_grade')
        .count('* as count')
        .groupBy('condition_grade')
        .orderByRaw('COUNT(*) DESC');

      const repeatOffenders = await database('return_intake')
        .select('title', 'part_number')
        .count('* as return_count')
        .groupBy('title', 'part_number')
        .havingRaw('COUNT(*) >= 2')
        .orderByRaw('COUNT(*) DESC')
        .limit(20);

      const totalReturns = byGrade.reduce((sum, r) => sum + parseInt(r.count), 0);

      return {
        totalReturns,
        byGrade: byGrade.map(r => ({ grade: r.condition_grade, count: parseInt(r.count) })),
        repeatOffenders: repeatOffenders.map(r => ({
          title: r.title,
          partNumber: r.part_number,
          returnCount: parseInt(r.return_count),
        })),
      };
    } catch (e) {
      return { totalReturns: 0, byGrade: [], repeatOffenders: [] };
    }
  }

  async getStaleOutcomes() {
    try {
      const actions = await database('stale_inventory_action')
        .where('executed', true)
        .where('action_type', 'price_reduction')
        .select('ebay_item_id', 'old_price', 'new_price', 'executed_at');

      if (actions.length === 0) {
        return { totalActions: 0, successRate: 0, avgReductionPercent: 0, avgDaysToSellAfterReduction: null };
      }

      let successes = 0;
      let totalReductionPct = 0;
      let totalDaysToSell = 0;
      let sellCount = 0;

      for (const action of actions) {
        const oldPrice = parseFloat(action.old_price) || 0;
        const newPrice = parseFloat(action.new_price) || 0;
        if (oldPrice > 0) {
          totalReductionPct += ((oldPrice - newPrice) / oldPrice) * 100;
        }

        // Check if a YourSale record exists after the reduction
        try {
          const sale = await database('YourSale')
            .where('ebayItemId', action.ebay_item_id)
            .where('soldDate', '>', action.executed_at)
            .first();
          if (sale) {
            successes++;
            const daysToSell = Math.floor((new Date(sale.soldDate) - new Date(action.executed_at)) / 86400000);
            totalDaysToSell += daysToSell;
            sellCount++;
          }
        } catch (e) { /* skip */ }
      }

      return {
        totalActions: actions.length,
        successRate: actions.length > 0 ? Math.round((successes / actions.length) * 100) : 0,
        avgReductionPercent: actions.length > 0 ? Math.round(totalReductionPct / actions.length) : 0,
        avgDaysToSellAfterReduction: sellCount > 0 ? Math.round(totalDaysToSell / sellCount) : null,
      };
    } catch (e) {
      return { totalActions: 0, successRate: 0, avgReductionPercent: 0, avgDaysToSellAfterReduction: null };
    }
  }
}

module.exports = LearningsService;
```
---
## FILE: service/services/PhoenixService.js
```javascript
'use strict';

const { database } = require('../database/database');

// ── Part type extraction ──────────────────────────────────

const PART_TYPE_PATTERNS = [
  { pattern: /\b(ECM|ECU|PCM|Engine\s*(?:Control|Computer)\s*Module)\b/i, type: 'ECM' },
  { pattern: /\b(BCM|Body\s*Control\s*Module)\b/i, type: 'BCM' },
  { pattern: /\b(TCM|Transmission\s*Control\s*Module)\b/i, type: 'TCM' },
  { pattern: /\b(ABS|Anti[- ]?Lock\s*Brake)\b/i, type: 'ABS' },
  { pattern: /\b(TIPM|Totally?\s*Integrated\s*Power\s*Module)\b/i, type: 'TIPM' },
  { pattern: /\b(Fuse\s*Box|Power\s*Distribution|Junction\s*Box)\b/i, type: 'FUSE BOX' },
  { pattern: /\bAmplifier\b/i, type: 'AMPLIFIER' },
  { pattern: /\b(Radio|Head\s*Unit|Stereo|CD\s*Player|Navigation)\b/i, type: 'RADIO' },
  { pattern: /\b(Cluster|Instrument\s*Cluster|Speedometer)\b/i, type: 'CLUSTER' },
  { pattern: /\b(Throttle\s*Body)\b/i, type: 'THROTTLE BODY' },
  { pattern: /\b(Steering\s*(?:Control\s*)?Module|EPS\s*Module)\b/i, type: 'STEERING MODULE' },
  { pattern: /\b(HVAC\s*(?:Control\s*)?Module|Climate\s*Control)\b/i, type: 'HVAC MODULE' },
  { pattern: /\b(Airbag\s*Module|SRS\s*Module|Restraint)\b/i, type: 'AIRBAG MODULE' },
  { pattern: /\b(Transfer\s*Case\s*(?:Control\s*)?Module)\b/i, type: 'TRANSFER CASE MODULE' },
  { pattern: /\b(Liftgate\s*Module|Tailgate\s*Module)\b/i, type: 'LIFTGATE MODULE' },
  { pattern: /\b(Camera|Backup\s*Camera|Rear\s*View)\b/i, type: 'CAMERA' },
  { pattern: /\b(Blind\s*Spot|BSM)\b/i, type: 'BLIND SPOT' },
  { pattern: /\b(Parking\s*Sensor|Park\s*Assist)\b/i, type: 'PARKING SENSOR' },
  { pattern: /\b(Key\s*Fob|Keyless|Smart\s*Key|Remote)\b/i, type: 'KEY FOB' },
  { pattern: /\b(Turbo|Turbocharger)\b/i, type: 'TURBO' },
  { pattern: /\b(Alternator)\b/i, type: 'ALTERNATOR' },
  { pattern: /\b(Starter|Starter\s*Motor)\b/i, type: 'STARTER' },
  { pattern: /\b(AC\s*Compressor|A\/C\s*Compressor)\b/i, type: 'AC COMPRESSOR' },
  { pattern: /\b(Intake\s*Manifold)\b/i, type: 'INTAKE MANIFOLD' },
  { pattern: /\b(Fuel\s*Injector)\b/i, type: 'FUEL INJECTOR' },
  { pattern: /\b(Ignition\s*Coil|Coil\s*Pack)\b/i, type: 'IGNITION COIL' },
  { pattern: /\b(Window\s*Motor|Window\s*Regulator)\b/i, type: 'WINDOW MOTOR' },
  { pattern: /\b(Door\s*Lock\s*Actuator)\b/i, type: 'DOOR LOCK' },
  { pattern: /\b(Wiper\s*Motor)\b/i, type: 'WIPER MOTOR' },
  { pattern: /\b(Blower\s*Motor)\b/i, type: 'BLOWER MOTOR' },
  { pattern: /\b(Seat\s*Module|Seat\s*(?:Control\s*)?Module)\b/i, type: 'SEAT MODULE' },
];

function extractPartTypeFromTitle(title) {
  if (!title) return 'OTHER';
  for (const { pattern, type } of PART_TYPE_PATTERNS) {
    if (pattern.test(title)) return type;
  }
  return 'OTHER';
}

// ── Make/Model extraction for fallback grouping ──────────

const KNOWN_MAKES = ['FORD','CHEVROLET','CHEVY','DODGE','RAM','CHRYSLER','JEEP','TOYOTA','HONDA','NISSAN','HYUNDAI','KIA','SUBARU','MAZDA','MITSUBISHI','BMW','MERCEDES','AUDI','VOLKSWAGEN','VOLVO','MINI','PORSCHE','LEXUS','ACURA','INFINITI','GENESIS','CADILLAC','BUICK','GMC','LINCOLN','PONTIAC','SATURN','JAGUAR','FIAT','SCION','SUZUKI'];
const STOP_WORDS = new Set(['OEM','GENUINE','PROGRAMMED','REBUILT','PLUG','PLAY','ASSEMBLY','MODULE','UNIT','REMAN','NEW','USED','TESTED','ENGINE','CONTROL','COMPUTER','ELECTRONIC','ANTI','LOCK','BRAKE','PUMP','FUSE','POWER','BOX','BODY','TRANSMISSION','ECU','ECM','PCM','BCM','TCM','ABS','TIPM','SRS','HVAC','INSTRUMENT','CLUSTER','SPEEDOMETER','RADIO','HEAD','STEREO','AMPLIFIER','THROTTLE','INTAKE','ALTERNATOR','STARTER','TURBO','CAMERA','SENSOR','WORKING','FAST','FREE','SHIPPING']);

function extractMakeModelFromTitle(title) {
  if (!title) return { make: null, model: null };
  const upper = title.toUpperCase();
  let make = null;
  for (const m of KNOWN_MAKES) {
    if (upper.includes(m)) { make = m; break; }
  }
  if (!make) return { make: null, model: null };

  const afterMake = upper.substring(upper.indexOf(make) + make.length).trim();
  const words = afterMake.replace(/[^A-Z0-9\s]/g, '').split(/\s+/);
  const modelWords = [];
  for (const w of words) {
    if (!w || w.length < 2 || /^\d{4}$/.test(w) || STOP_WORDS.has(w)) continue;
    modelWords.push(w);
    if (modelWords.length >= 2) break;
  }
  return { make, model: modelWords.join(' ') || null };
}

// ── Seller name mapping ───────────────────────────────────
// Item.seller uses 'pro-rebuild', SoldItemSeller uses 'prorebuild'
function getItemSellerVariants(soldItemName) {
  const variants = [soldItemName];
  if (!soldItemName.includes('-')) variants.push(soldItemName.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase());
  // prorebuild → pro-rebuild
  if (soldItemName === 'prorebuild') variants.push('pro-rebuild');
  // pro-rebuild → prorebuild
  if (soldItemName === 'pro-rebuild') variants.push('prorebuild');
  return [...new Set(variants)];
}

// ── Scoring ───────────────────────────────────────────────

function calcPhoenixScore(salesCount, avgPrice, marketSold90d) {
  // Velocity (35pts) — from SoldItem
  let velocity = salesCount >= 10 ? 35 : salesCount >= 7 ? 28 : salesCount >= 5 ? 21 : salesCount >= 3 ? 14 : salesCount >= 2 ? 8 : salesCount >= 1 ? 4 : 0;

  // Revenue (25pts)
  const totalRevenue = salesCount * avgPrice;
  let revenue = totalRevenue >= 2000 ? 25 : totalRevenue >= 1000 ? 20 : totalRevenue >= 500 ? 15 : totalRevenue >= 200 ? 10 : totalRevenue > 0 ? 5 : 0;

  // Price sweet spot (20pts) — use whatever price we have
  let priceSpot = 0;
  if (avgPrice > 0) {
    priceSpot = avgPrice >= 150 && avgPrice <= 400 ? 20 : avgPrice >= 100 && avgPrice < 150 ? 16 : avgPrice > 400 && avgPrice <= 600 ? 14 : avgPrice >= 50 && avgPrice < 100 ? 10 : avgPrice > 600 ? 6 : 2;
  }

  // Market demand (20pts) — from market_demand_cache
  let market = 0;
  if (marketSold90d > 0) {
    market = marketSold90d >= 50 ? 20 : marketSold90d >= 30 ? 16 : marketSold90d >= 15 ? 12 : marketSold90d >= 5 ? 8 : 4;
  }

  return { total: velocity + revenue + priceSpot + market, velocity, revenue, priceSpot, market };
}

// ── Service ───────────────────────────────────────────────

class PhoenixService {

  async getRebuildSellers() {
    const rows = await database.raw(`
      SELECT name, enabled, "itemsScraped", "lastScrapedAt", "createdAt"
      FROM "SoldItemSeller" WHERE type = 'rebuild' ORDER BY "itemsScraped" DESC
    `);
    return rows.rows;
  }

  async addRebuildSeller(sellerName) {
    const name = (sellerName || '').trim().toLowerCase();
    if (!name) throw new Error('Seller name is required');
    await database.raw(`
      INSERT INTO "SoldItemSeller" (name, enabled, type, "createdAt", "updatedAt")
      VALUES (?, true, 'rebuild', NOW(), NOW())
      ON CONFLICT (name) DO UPDATE SET type = 'rebuild', enabled = true, "updatedAt" = NOW()
    `, [name]);
    return database('SoldItemSeller').where({ name }).first();
  }

  async removeRebuildSeller(sellerName) {
    const name = (sellerName || '').trim().toLowerCase();
    const updated = await database('SoldItemSeller')
      .where({ name, type: 'rebuild' })
      .update({ type: 'competitor', updatedAt: new Date() });
    return updated > 0 ? { removed: true } : { removed: false, reason: 'not found' };
  }

  async getPhoenixStats({ days = 180, seller = null }) {
    const sellers = await this.getRebuildSellers();
    const enabledNames = sellers.filter(s => s.enabled).map(s => s.name);
    if (enabledNames.length === 0) return { totalGroups: 0, totalSales: 0, totalRevenue: 0, avgPrice: 0, topPartType: null, topMake: null, sellers: [], catalogItems: 0, itemsWithFitment: 0, itemsWithPartNumber: 0, marketCacheHits: 0 };

    // Catalog stats from Item table
    const itemSellerNames = [];
    for (const n of enabledNames) itemSellerNames.push(...getItemSellerVariants(n));
    const catalogCount = await database('Item').whereIn('seller', itemSellerNames).count('id as cnt').first();
    const fitmentCount = await database('Item as i').join('AutoItemCompatibility as aic', 'aic.itemId', 'i.id').whereIn('i.seller', itemSellerNames).countDistinct('i.id as cnt').first();
    const pnCount = await database('Item').whereIn('seller', itemSellerNames).whereNotNull('partNumberBase').countDistinct('partNumberBase as cnt').first();

    // Sales stats from SoldItem
    const names = seller && enabledNames.includes(seller) ? [seller] : enabledNames;
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const items = await database('SoldItem').whereIn('seller', names).where('soldDate', '>=', cutoff).select('title', 'soldPrice');

    let totalRevenue = 0;
    const partTypeCounts = {};
    for (const item of items) {
      totalRevenue += parseFloat(item.soldPrice) || 0;
      const pt = extractPartTypeFromTitle(item.title);
      partTypeCounts[pt] = (partTypeCounts[pt] || 0) + 1;
    }
    const topPartType = Object.entries(partTypeCounts).sort((a, b) => b[1] - a[1])[0];

    return {
      totalGroups: 0,
      totalSales: items.length,
      totalRevenue: Math.round(totalRevenue * 100) / 100,
      avgPrice: items.length > 0 ? Math.round((totalRevenue / items.length) * 100) / 100 : 0,
      topPartType: topPartType ? topPartType[0] : null,
      sellers: enabledNames,
      catalogItems: parseInt(catalogCount.cnt) || 0,
      itemsWithFitment: parseInt(fitmentCount.cnt) || 0,
      itemsWithPartNumber: parseInt(pnCount.cnt) || 0,
      marketCacheHits: 0,
    };
  }

  async getPhoenixList({ days = 180, limit = 100, seller = null }) {
    const sellers = await this.getRebuildSellers();
    const enabledNames = sellers.filter(s => s.enabled).map(s => s.name);
    if (enabledNames.length === 0) return [];

    // ── Layer 1: Item catalog with fitment ──
    const itemSellerNames = [];
    for (const n of enabledNames) itemSellerNames.push(...getItemSellerVariants(n));

    const catalogRows = await database('Item as i')
      .join('AutoItemCompatibility as aic', 'aic.itemId', 'i.id')
      .join('Auto as a', 'a.id', 'aic.autoId')
      .whereIn('i.seller', itemSellerNames)
      .select('i.id as itemId', 'i.title', 'i.price', 'i.partNumberBase',
              'i.manufacturerPartNumber', 'i.categoryTitle', 'i.pictureUrl',
              'a.year', 'a.make', 'a.model', 'a.trim', 'a.engine');

    // Group by partNumberBase (primary) or title-based fallback
    const groups = new Map();

    for (const row of catalogRows) {
      const partType = extractPartTypeFromTitle(row.title || row.categoryTitle || '');
      const pnBase = row.partNumberBase || null;
      const groupKey = pnBase || (partType + '|' + (row.make || 'UNK').toUpperCase() + '|' + (row.model || 'UNK').toUpperCase());
      const groupType = pnBase ? 'part_number' : 'title_match';

      if (!groups.has(groupKey)) {
        groups.set(groupKey, {
          groupKey, groupType, partNumberBase: pnBase,
          manufacturerPartNumber: row.manufacturerPartNumber || null,
          partType, fitment: [], fitmentSet: new Set(),
          makes: new Set(), models: new Set(), years: [],
          catalogCount: 0, catalogItemIds: new Set(),
          catalogImage: null, sampleTitles: [],
          listingPrice: null,
          // Sales (filled in Layer 2)
          salesCount: 0, soldPrices: [], lastSoldDate: null, soldSellers: new Set(), sellerCounts: {},
          // Market (filled in Layer 3)
          marketAvgPrice: null, marketSold90d: 0, marketScore: null,
        });
      }

      const g = groups.get(groupKey);
      if (!g.catalogItemIds.has(row.itemId)) {
        g.catalogItemIds.add(row.itemId);
        g.catalogCount++;
        if (!g.catalogImage && row.pictureUrl) g.catalogImage = row.pictureUrl;
        if (g.sampleTitles.length < 3 && row.title) g.sampleTitles.push(row.title);
        if (!g.listingPrice && row.price) g.listingPrice = parseFloat(row.price);
        if (!g.manufacturerPartNumber && row.manufacturerPartNumber) g.manufacturerPartNumber = row.manufacturerPartNumber;
      }

      // Fitment dedup
      const fitKey = `${row.year}|${(row.make || '').toUpperCase()}|${(row.model || '').toUpperCase()}|${row.engine || ''}`;
      if (!g.fitmentSet.has(fitKey)) {
        g.fitmentSet.add(fitKey);
        g.fitment.push({ year: row.year, make: row.make, model: row.model, trim: row.trim, engine: row.engine });
        if (row.make) g.makes.add(row.make);
        if (row.model) g.models.add(row.model);
        if (row.year) g.years.push(row.year);
      }
    }

    // ── Layer 2: SoldItem velocity ──
    const soldNames = seller && enabledNames.includes(seller) ? [seller] : enabledNames;
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const soldItems = await database('SoldItem')
      .whereIn('seller', soldNames)
      .where('soldDate', '>=', cutoff)
      .orderBy('soldDate', 'desc')
      .select('title', 'soldPrice', 'soldDate', 'seller');

    // Match sold items to catalog groups by PN in title
    const pnBaseSet = new Map(); // pnBase → groupKey
    for (const [key, g] of groups) {
      if (g.partNumberBase) pnBaseSet.set(g.partNumberBase.toUpperCase(), key);
    }

    for (const sold of soldItems) {
      const title = (sold.title || '').toUpperCase();
      let matched = false;

      // Try to match by partNumberBase appearing in the title
      for (const [pn, gKey] of pnBaseSet) {
        if (title.includes(pn) || title.includes(pn.replace(/-/g, ''))) {
          const g = groups.get(gKey);
          g.salesCount++;
          g.soldPrices.push(parseFloat(sold.soldPrice) || 0);
          if (!g.lastSoldDate) g.lastSoldDate = sold.soldDate;
          g.soldSellers.add(sold.seller);
          g.sellerCounts[sold.seller] = (g.sellerCounts[sold.seller] || 0) + 1;
          matched = true;
          break;
        }
      }

      // Fallback: create standalone group from SoldItem title
      // Use partType + make + model for granular grouping (not just partType + seller)
      if (!matched) {
        const pt = extractPartTypeFromTitle(sold.title);
        if (pt !== 'OTHER') {
          const { make, model } = extractMakeModelFromTitle(sold.title);
          // Include make/model when available for granular groups; fall back to seller-only
          const fallbackKey = make
            ? 'SOLD|' + pt + '|' + make + '|' + (model || 'UNK')
            : 'SOLD|' + pt + '|' + sold.seller;
          if (!groups.has(fallbackKey)) {
            groups.set(fallbackKey, {
              groupKey: fallbackKey, groupType: 'sold_only', partNumberBase: null,
              manufacturerPartNumber: null, partType: pt,
              fitment: [], fitmentSet: new Set(),
              makes: make ? new Set([make]) : new Set(),
              models: model ? new Set([model]) : new Set(),
              years: [],
              catalogCount: 0, catalogItemIds: new Set(), catalogImage: null,
              sampleTitles: [sold.title], listingPrice: null,
              salesCount: 0, soldPrices: [], lastSoldDate: null, soldSellers: new Set(), sellerCounts: {},
              marketAvgPrice: null, marketSold90d: 0, marketScore: null,
            });
          }
          const g = groups.get(fallbackKey);
          g.salesCount++;
          g.soldPrices.push(parseFloat(sold.soldPrice) || 0);
          if (!g.lastSoldDate) g.lastSoldDate = sold.soldDate;
          g.soldSellers.add(sold.seller);
          g.sellerCounts[sold.seller] = (g.sellerCounts[sold.seller] || 0) + 1;
          if (g.sampleTitles.length < 3) g.sampleTitles.push(sold.title);
          if (make) g.makes.add(make);
          if (model) g.models.add(model);
        }
      }
    }

    // ── Layer 3: market_demand_cache (keyed by real part numbers) ──
    // Collect partNumberBase values from groups that have them
    const pnToGroups = new Map(); // partNumberBase → [groupKey, ...]
    for (const [gKey, g] of groups) {
      if (g.partNumberBase) {
        const pn = g.partNumberBase;
        if (!pnToGroups.has(pn)) pnToGroups.set(pn, []);
        pnToGroups.get(pn).push(gKey);
      }
    }

    if (pnToGroups.size > 0) {
      try {
        const marketRows = await database('market_demand_cache')
          .whereIn('part_number_base', [...pnToGroups.keys()])
          .select('part_number_base', 'ebay_avg_price', 'ebay_sold_90d', 'ebay_median_price', 'market_score');

        for (const mr of marketRows) {
          const gKeys = pnToGroups.get(mr.part_number_base) || [];
          for (const gKey of gKeys) {
            const g = groups.get(gKey);
            if (g && !g.marketAvgPrice) {
              g.marketAvgPrice = parseFloat(mr.ebay_median_price || mr.ebay_avg_price) || null;
              g.marketSold90d = parseInt(mr.ebay_sold_90d) || 0;
              g.marketScore = mr.market_score ? parseInt(mr.market_score) : null;
            }
          }
        }
      } catch (e) { /* market cache may not exist */ }
    }

    // ── Score and format ──
    const results = [];
    for (const g of groups.values()) {
      const avgSoldPrice = g.soldPrices.length > 0
        ? Math.round((g.soldPrices.reduce((a, b) => a + b, 0) / g.soldPrices.length) * 100) / 100
        : 0;
      const bestPrice = g.marketAvgPrice || avgSoldPrice || g.listingPrice || 0;
      const score = calcPhoenixScore(g.salesCount, avgSoldPrice, g.marketSold90d);

      // Skip groups with no signal at all
      if (score.total === 0 && g.catalogCount === 0) continue;

      const yearsSorted = g.years.length > 0 ? [...new Set(g.years)].sort() : [];
      const yearRange = yearsSorted.length > 0
        ? (yearsSorted[0] === yearsSorted[yearsSorted.length - 1] ? `${yearsSorted[0]}` : `${yearsSorted[0]}-${yearsSorted[yearsSorted.length - 1]}`)
        : null;

      const makesArr = [...g.makes];
      const modelsArr = [...g.models];
      const fitmentSummary = makesArr.length > 0
        ? makesArr[0] + (modelsArr.length > 0 ? ' ' + modelsArr[0] : '') + (yearRange ? ' ' + yearRange : '')
        : null;

      results.push({
        groupKey: g.groupKey,
        groupType: g.groupType,
        partNumberBase: g.partNumberBase,
        manufacturerPartNumber: g.manufacturerPartNumber,
        partType: g.partType,
        fitment: g.fitment.slice(0, 10),
        fitmentSummary,
        makes: makesArr,
        models: modelsArr,
        yearRange,
        catalogCount: g.catalogCount,
        catalogImage: g.catalogImage,
        sampleTitles: g.sampleTitles,
        salesCount: g.salesCount,
        avgSoldPrice,
        minSoldPrice: g.soldPrices.length > 0 ? Math.min(...g.soldPrices) : null,
        maxSoldPrice: g.soldPrices.length > 0 ? Math.max(...g.soldPrices) : null,
        totalRevenue: Math.round(g.salesCount * avgSoldPrice * 100) / 100,
        lastSoldDate: g.lastSoldDate,
        soldSellers: [...g.soldSellers],
        sellerBreakdown: g.sellerCounts,
        marketAvgPrice: g.marketAvgPrice,
        marketSold90d: g.marketSold90d,
        marketScore: g.marketScore,
        bestPrice: bestPrice,
        phoenixScore: score.total,
        scoreBreakdown: score,
      });
    }

    results.sort((a, b) => b.phoenixScore - a.phoenixScore || (b.marketSold90d || 0) - (a.marketSold90d || 0) || b.catalogCount - a.catalogCount);
    return results.slice(0, limit);
  }
}

module.exports = PhoenixService;
```
---
## FILE: service/services/FlywayService.js
```javascript
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

    // Build indexes using AttackListService instance — same as Daily Feed
    const attackService = new AttackListService();
    const inventoryIndex = await attackService.buildInventoryIndex();
    const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
    const salesIndex = await attackService.buildSalesIndex(cutoff);
    const { byMakeModel: stockIndex, byPartNumber: stockPartNumbers } = await attackService.buildStockIndex();

    let platformIndex = {};
    try {
      platformIndex = await attackService.buildPlatformIndex();
    } catch (e) { /* platform tables may not exist */ }

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
    const MAX_PER_YARD = 50;

    // Score all vehicles — identical to Daily Feed's scoreVehicle, no post-processing
    const allScored = [];
    for (const vehicle of vehicles) {
      try {
        const result = attackService.scoreVehicle(
          vehicle, inventoryIndex, salesIndex, stockIndex, platformIndex, stockPartNumbers, markIndex
        );

        const daysInYard = this.calculateDaysInYard(vehicle.date_added);
        const premiumFlags = this.getPremiumFlags(vehicle);

        allScored.push({
          ...result,
          daysInYard,
          premiumFlags,
          isPremiumVehicle: premiumFlags.length > 0,
          _yardId: vehicle.yard_id,
          _vehicleId: vehicle.id,
        });
      } catch (e) {
        // Skip vehicles that fail scoring
      }
    }

    // ── Two-pass filtering: top 50 + rare finds ────────────

    const byYard = {};
    for (const v of allScored) {
      if (!byYard[v._yardId]) byYard[v._yardId] = [];
      byYard[v._yardId].push(v);
    }

    const yards = [];
    for (const y of trip.yards) {
      if (!y.scrape_enabled) continue;
      const yardVehicles = byYard[y.id] || [];
      if (yardVehicles.length === 0) continue;

      // Sort: score DESC, then date_added DESC (fresh arrivals surface first at same score)
      yardVehicles.sort((a, b) => {
        const scoreDiff = (b.score || 0) - (a.score || 0);
        if (scoreDiff !== 0) return scoreDiff;
        return new Date(b.date_added || 0) - new Date(a.date_added || 0);
      });

      // Pass 1: Top vehicles above score floor
      const top = yardVehicles
        .filter(v => (v.est_value || 0) >= SCORE_FLOOR)
        .slice(0, MAX_PER_YARD);
      const topIds = new Set(top.map(v => v._vehicleId));

      // Pass 2: Guaranteed vehicles (rare finds) not already in top list
      const guaranteed = [];
      for (const v of yardVehicles) {
        if (topIds.has(v._vehicleId)) continue;
        if ((v.est_value || 0) <= 0) continue;
        const reason = this.getGuaranteedReason(v);
        if (reason) {
          v.isGuaranteedInclusion = true;
          v.guaranteedReason = reason;
          guaranteed.push(v);
        }
      }

      for (const v of top) {
        v.isGuaranteedInclusion = false;
      }

      const combined = [...top, ...guaranteed];

      // Slim mode: strip parts, create part_chips — same as Daily Feed route
      for (const vehicle of combined) {
        vehicle.part_chips = (vehicle.parts || []).slice(0, 4).map(p => ({
          partType: p.partType, price: p.price, verdict: p.verdict, priceSource: p.priceSource,
        }));
        delete vehicle.parts;
        delete vehicle.rebuild_parts;
        delete vehicle.platform_siblings;
      }

      yards.push({
        yard: y,
        total_vehicles: combined.length,
        total_top: top.length,
        total_guaranteed: guaranteed.length,
        total_scored: yardVehicles.length,
        hot_vehicles: combined.filter(v => v.color_code === 'green' || v.color_code === 'yellow').length,
        est_total_value: combined.reduce((sum, v) => sum + (v.est_value || 0), 0),
        vehicles: combined,
      });
    }

    yards.sort((a, b) => b.est_total_value - a.est_total_value);

    return { trip, yards, generated_at: new Date().toISOString() };
  }

  // ============================================================
  // FLYWAY-SPECIFIC HELPERS
  // ============================================================

  static calculateDaysInYard(dateAdded) {
    if (!dateAdded) return 0;
    const added = new Date(dateAdded);
    return Math.floor((Date.now() - added.getTime()) / (1000 * 60 * 60 * 24));
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
   *
   * Always include: PERFORMANCE, DIESEL, MANUAL, 4x4+MT combo
   * With threshold (score > 50): PREMIUM, CULT
   * Plain 4WD/AWD without manual does NOT qualify (too common)
   */
  static getGuaranteedReason(v) {
    const flags = v.premiumFlags || [];
    const isManual = flags.includes('MANUAL');
    const is4x4 = flags.includes('4WD') || flags.includes('AWD');

    if (flags.includes('PERFORMANCE')) return 'PERFORMANCE';
    if (flags.includes('DIESEL')) return 'DIESEL';
    if (is4x4 && isManual) return '4x4+MT';
    if (isManual) return 'MANUAL';
    if (flags.includes('PREMIUM') && (v.score || 0) > 50) return 'PREMIUM';
    if (flags.includes('CULT') && (v.score || 0) > 50) return 'CULT';
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
```
---
## FILE: service/services/InstantResearchService.js
```javascript
'use strict';

const { log } = require('../lib/logger');
const { database } = require('../database/database');
const { extractPartNumbers } = require('../utils/partIntelligence');

const TYPE_RE = {
  ECM: /\b(ecm|pcm|ecu|engine\s*control|engine\s*computer)\b/i,
  TCM: /\b(tcm|tcu|transmission\s*control)\b/i,
  BCM: /\b(bcm|body\s*control)\b/i,
  ABS: /\b(abs|anti.?lock|brake\s*pump|brake\s*module)\b/i,
  TIPM: /\b(tipm|fuse\s*box|junction|fuse\s*relay|ipdm|power\s*distribution)\b/i,
  AMP: /\b(amp|amplifier|bose|harman|alpine|jbl|infinity)\b/i,
  CLUSTER: /\b(cluster|speedometer|gauge|instrument)\b/i,
  RADIO: /\b(radio|head\s*unit|infotainment|stereo|receiver|navigation)\b/i,
  THROTTLE: /\b(throttle\s*body)\b/i,
  STEERING: /\b(steering\s*(module|control)|eps\s*module|power\s*steering)\b/i,
  HVAC: /\b(hvac|climate\s*control|heater\s*control|a\/c\s*control)\b/i,
  AIRBAG: /\b(airbag|srs)\s*(module|sensor)?\b/i,
  CAMERA: /\b(camera|backup\s*cam)\b/i,
  MIRROR: /\b(mirror)\b/i,
  REGULATOR: /\b(window\s*(motor|regulator))\b/i,
  ALTERNATOR: /\b(alternator)\b/i,
  STARTER: /\b(starter)\b/i,
  BLOWER: /\b(blower\s*motor)\b/i,
  SENSOR: /\b(blind\s*spot|parking\s*sensor|park\s*assist)\b/i,
  LIFTGATE: /\b(liftgate|tailgate)\s*(module|motor|control)\b/i,
};

const ENGINE_SPECIFIC = new Set(['ECM', 'PCM', 'TCM', 'THROTTLE']);

function detectPartType(title) {
  if (!title) return null;
  for (const [type, re] of Object.entries(TYPE_RE)) {
    if (re.test(title)) return type;
  }
  return null;
}

function getBadge(price) {
  if (price >= 250) return 'GREAT';
  if (price >= 150) return 'GOOD';
  if (price >= 100) return 'FAIR';
  return 'POOR';
}

/**
 * Extract displacement number from messy engine strings.
 * "5.7L V8 HEMI" → "5.7", "3.5L V6 DOHC 24V" → "3.5", "2.0L Turbo" → "2.0"
 */
function normalizeEngine(eng) {
  if (!eng) return null;
  const m = eng.match(/(\d+\.\d)/);
  return m ? m[1] : null;
}

class InstantResearchService {
  constructor() {
    this.log = log.child({ class: 'InstantResearchService' }, true);
  }

  async researchVehicle({ year, make, model, engine, drivetrain, refresh = false }) {
    const cacheKey = `${year}|${make}|${model}|${engine || 'any'}`.toLowerCase();

    // Check cache (24h) unless refresh requested
    if (!refresh) {
      try {
        const cached = await database('instant_research_cache')
          .where('vehicle_key', cacheKey)
          .whereRaw("last_updated > NOW() - INTERVAL '24 hours'")
          .first();
        if (cached && cached.results) {
          const r = typeof cached.results === 'string' ? JSON.parse(cached.results) : cached.results;
          return { ...r, cached: true };
        }
      } catch (e) { /* cache miss */ }
    }

    // Step 1: Find matching parts via Auto+AIC+Item
    let query = database('Auto')
      .join('AutoItemCompatibility', 'Auto.id', 'AutoItemCompatibility.autoId')
      .join('Item', 'AutoItemCompatibility.itemId', 'Item.id')
      .where('Auto.year', year)
      .whereRaw('UPPER("Auto"."make") = UPPER(?)', [make])
      .where('Item.price', '>', 0)
      .select('Item.title', 'Item.manufacturerPartNumber', 'Item.id as itemId',
              'Item.price', 'Item.partNumberBase', 'Item.seller',
              'Auto.engine as autoEngine', 'Auto.model as autoModel');

    // Word-boundary model match (Cherokee ≠ Grand Cherokee)
    query = query.whereRaw(
      "UPPER(REPLACE(REPLACE(\"Auto\".\"model\", '-', ''), ' ', '')) = UPPER(REPLACE(REPLACE(?, '-', ''), ' ', ''))",
      [model]
    );

    // Engine filter — normalize displacement for fuzzy matching
    const engineDisp = normalizeEngine(engine);
    if (engineDisp) {
      query = query.where(function() {
        this.whereRaw('"Auto"."engine" LIKE ?', [`%${engineDisp}%`])
          .orWhereNull('Auto.engine')
          .orWhere('Auto.engine', '')
          .orWhere('Auto.engine', 'N/A');
      });
    }

    const items = await query.limit(300);
    this.log.info({ year, make, model, engine, itemCount: items.length }, 'Parts found via Auto+AIC');

    // Step 2: Group by part type and deduplicate by partNumberBase
    const partMap = new Map(); // partNumberBase → part data
    for (const item of items) {
      const partType = detectPartType(item.title);
      if (!partType) continue;

      const pns = extractPartNumbers(item.title || '');
      const pnBase = (pns.length > 0 ? pns[0].base : null) || item.partNumberBase || null;
      const key = pnBase || `${partType}_${item.itemId}`;

      if (!partMap.has(key)) {
        partMap.set(key, {
          partType,
          partNumberBase: pnBase,
          title: item.title,
          itemId: item.itemId,
          itemPrice: parseFloat(item.price) || 0,
          seller: item.seller,
          autoEngine: item.autoEngine,
        });
      }
    }

    // Step 3: Get year ranges per part number (batch)
    let yearRangeMap = new Map();
    const pnBases = [...partMap.values()].map(p => p.partNumberBase).filter(Boolean);
    if (pnBases.length > 0) {
      try {
        const yearRanges = await database('Auto')
          .join('AutoItemCompatibility', 'Auto.id', 'AutoItemCompatibility.autoId')
          .join('Item', 'AutoItemCompatibility.itemId', 'Item.id')
          .whereRaw('UPPER("Auto"."make") = UPPER(?)', [make])
          .whereIn('Item.partNumberBase', pnBases)
          .select('Item.partNumberBase')
          .min('Auto.year as minYear')
          .max('Auto.year as maxYear')
          .groupBy('Item.partNumberBase');
        for (const r of yearRanges) {
          yearRangeMap.set(r.partNumberBase, { min: r.minYear, max: r.maxYear });
        }
      } catch (e) {}
    }

    // Step 4: Enrich each part with demand, stock, market, mark status
    // Load all enrichment data in batch
    const allPNs = [...partMap.values()].map(p => p.partNumberBase).filter(Boolean);

    // Batch: market_demand_cache
    let marketMap = new Map();
    if (allPNs.length > 0) {
      try {
        const cached = await database('market_demand_cache')
          .whereIn('part_number_base', allPNs)
          .select('part_number_base', 'ebay_avg_price', 'ebay_sold_90d', 'ebay_median_price', 'market_score');
        for (const c of cached) marketMap.set(c.part_number_base, c);
      } catch (e) {}
    }

    // Batch: the_mark
    let markPNs = new Set();
    try {
      const marks = await database('the_mark').where('active', true).select('partNumber');
      for (const m of marks) { if (m.partNumber) markPNs.add(m.partNumber.toUpperCase()); }
    } catch (e) {}

    // Per-part enrichment
    const enrichedParts = [];
    for (const [key, part] of partMap) {
      // YOUR DEMAND — YourSale
      let yourDemand = { salesCount: 0, avgPrice: 0, lastSoldDate: null, totalRevenue: 0 };
      try {
        const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
        let salesQuery;
        if (part.partNumberBase) {
          salesQuery = database('YourSale')
            .where('soldDate', '>=', cutoff)
            .where('title', 'ilike', `%${part.partNumberBase}%`);
        } else {
          salesQuery = database('YourSale')
            .where('soldDate', '>=', cutoff)
            .where('title', 'ilike', `%${make}%`)
            .where('title', 'ilike', `%${part.partType}%`);
        }
        const sales = await salesQuery.select('salePrice', 'soldDate').limit(50);
        if (sales.length > 0) {
          yourDemand.salesCount = sales.length;
          yourDemand.totalRevenue = sales.reduce((s, r) => s + (parseFloat(r.salePrice) || 0), 0);
          yourDemand.avgPrice = Math.round(yourDemand.totalRevenue / sales.length);
          yourDemand.lastSoldDate = sales.sort((a, b) => new Date(b.soldDate) - new Date(a.soldDate))[0].soldDate;
        }
      } catch (e) {}

      // YOUR STOCK — YourListing
      let yourStock = { count: 0, prices: [] };
      try {
        let stockQuery;
        if (part.partNumberBase) {
          stockQuery = database('YourListing')
            .where('listingStatus', 'Active')
            .where(function() {
              this.where('title', 'ilike', `%${part.partNumberBase}%`)
                .orWhere('sku', 'ilike', `%${part.partNumberBase}%`);
            });
        } else {
          stockQuery = database('YourListing')
            .where('listingStatus', 'Active')
            .where('title', 'ilike', `%${make}%`)
            .where('title', 'ilike', `%${part.partType}%`);
        }
        const listings = await stockQuery.select('currentPrice').limit(20);
        yourStock.count = listings.length;
        yourStock.prices = listings.map(l => parseFloat(l.currentPrice)).filter(p => p > 0);
      } catch (e) {}

      // MARKET DATA — market_demand_cache
      let market = { source: 'none', message: 'No market data available' };
      const cached = part.partNumberBase ? marketMap.get(part.partNumberBase) : null;
      if (cached && parseFloat(cached.ebay_avg_price) > 0) {
        market = {
          source: 'cache',
          avgPrice: parseFloat(cached.ebay_avg_price),
          soldCount90d: parseInt(cached.ebay_sold_90d) || 0,
          medianPrice: parseFloat(cached.ebay_median_price) || parseFloat(cached.ebay_avg_price),
          score: parseFloat(cached.market_score) || 0,
        };
      }

      // MARK STATUS
      const isMarked = part.partNumberBase ? markPNs.has(part.partNumberBase.toUpperCase()) : false;

      // SCORING
      const bestPrice = market.source === 'cache' ? market.avgPrice
        : yourDemand.avgPrice > 0 ? yourDemand.avgPrice
        : part.itemPrice;

      let score = 0;
      // Demand (max 35)
      if (yourDemand.salesCount >= 5) score += 35;
      else if (yourDemand.salesCount >= 3) score += 25;
      else if (yourDemand.salesCount >= 1) score += 15;
      else if (market.soldCount90d >= 10) score += 20;
      else if (market.soldCount90d >= 3) score += 10;
      // Price (max 25)
      if (bestPrice >= 300) score += 25;
      else if (bestPrice >= 200) score += 20;
      else if (bestPrice >= 150) score += 15;
      else if (bestPrice >= 100) score += 10;
      // Supply penalty
      if (yourStock.count >= 3) score -= 10;
      // Mark boost
      if (isMarked) score += 15;
      score = Math.max(0, Math.min(100, score));

      // Year range for this part
      const yr = part.partNumberBase ? yearRangeMap.get(part.partNumberBase) : null;

      enrichedParts.push({
        partType: part.partType,
        partNumberBase: part.partNumberBase,
        title: part.title,
        itemId: part.itemId,
        score,
        badge: getBadge(bestPrice),
        isMarked,
        yourDemand,
        yourStock,
        market,
        referencePrice: part.itemPrice > 0 ? part.itemPrice : null,
        yearRange: yr || null,
      });
    }

    // Sort by score desc
    enrichedParts.sort((a, b) => b.score - a.score);

    const result = {
      vehicle: { year, make, model, engine, drivetrain: drivetrain || null },
      totalParts: enrichedParts.length,
      totalEstimatedValue: enrichedParts.reduce((s, p) => {
        const price = p.market.source === 'cache' ? p.market.avgPrice : p.yourDemand.avgPrice || p.referencePrice || 0;
        return s + price;
      }, 0),
      parts: enrichedParts,
      researchedAt: new Date().toISOString(),
      dataSource: 'database',
    };

    // Cache result
    try {
      await database.raw(`
        INSERT INTO instant_research_cache (vehicle_key, vehicle_display, results, last_updated)
        VALUES (?, ?, ?::jsonb, NOW())
        ON CONFLICT (vehicle_key) DO UPDATE SET results = EXCLUDED.results, last_updated = NOW()
      `, [cacheKey, `${year} ${make} ${model}${engine ? ' ' + engine : ''}`, JSON.stringify(result)]);
    } catch (e) { /* cache write optional */ }

    return { ...result, cached: false };
  }
}

module.exports = InstantResearchService;
```
---
## FILE: service/services/PriceCheckService.js
```javascript
'use strict';

const path = require('path');
// Use default Playwright browser path (system-installed) — don't override to .pw-browsers
const { chromium } = require('playwright-extra');
const stealth = require('puppeteer-extra-plugin-stealth');
chromium.use(stealth());

const { buildSearchQuery } = require('../scripts/smart-query-builder');
const { filterRelevantItems } = require('../scripts/relevance-scorer');
const PriceCheck = require('../models/PriceCheck');
const { extractPartNumbers } = require('../utils/partIntelligence');
const { database } = require('../database/database');

// Persistent browser + page — launch once, reuse across all requests
let _browser = null;
let _page = null;

async function getPage() {
  if (_page && !_page.isClosed()) {
    return _page;
  }
  if (!_browser || !_browser.isConnected()) {
    _browser = await chromium.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
      ],
    });
    _browser.on('disconnected', () => { _browser = null; _page = null; });
  }
  const context = await _browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 720 },
  });
  _page = await context.newPage();
  return _page;
}

class PriceCheckService {
  /**
   * Check price for a listing, using cache if available
   */
  async checkPrice(listingId, title, currentPrice, forceRefresh = false) {
    // Check cache first (unless force refresh)
    if (!forceRefresh && listingId) {
      const cached = await PriceCheck.getRecent(listingId);
      if (cached) {
        return {
          cached: true,
          checkedAt: cached.checkedAt,
          ...this.formatResult(cached),
        };
      }
    }

    // Run the pipeline
    const result = await this.runPipeline(title, currentPrice);

    // Save to PriceCheck table
    if (listingId) {
      await PriceCheck.saveCheck(listingId, title, currentPrice, result);
    }

    // Also update market_demand_cache if we have a part number and valid metrics
    if (result.metrics && result.metrics.count > 0) {
      try {
        const pns = extractPartNumbers(title);
        if (pns.length > 0) {
          const basePn = pns[0].base;
          const m = result.metrics;
          // UPSERT — only overwrite if existing data is >3 days stale (fresher data wins)
          await database.raw(`
            INSERT INTO market_demand_cache
              (id, part_number_base, ebay_avg_price, ebay_sold_90d, ebay_median_price,
               ebay_min_price, ebay_max_price, sales_per_week, source, search_query, last_updated, "createdAt")
            VALUES (gen_random_uuid(), ?, ?, ?, ?, ?, ?, ?, 'price_check', ?, NOW(), NOW())
            ON CONFLICT (part_number_base) DO UPDATE SET
              ebay_avg_price = CASE WHEN market_demand_cache.last_updated < NOW() - INTERVAL '3 days' THEN EXCLUDED.ebay_avg_price ELSE market_demand_cache.ebay_avg_price END,
              ebay_sold_90d = CASE WHEN market_demand_cache.last_updated < NOW() - INTERVAL '3 days' THEN EXCLUDED.ebay_sold_90d ELSE market_demand_cache.ebay_sold_90d END,
              ebay_median_price = CASE WHEN market_demand_cache.last_updated < NOW() - INTERVAL '3 days' THEN EXCLUDED.ebay_median_price ELSE market_demand_cache.ebay_median_price END,
              ebay_min_price = CASE WHEN market_demand_cache.last_updated < NOW() - INTERVAL '3 days' THEN EXCLUDED.ebay_min_price ELSE market_demand_cache.ebay_min_price END,
              ebay_max_price = CASE WHEN market_demand_cache.last_updated < NOW() - INTERVAL '3 days' THEN EXCLUDED.ebay_max_price ELSE market_demand_cache.ebay_max_price END,
              sales_per_week = CASE WHEN market_demand_cache.last_updated < NOW() - INTERVAL '3 days' THEN EXCLUDED.sales_per_week ELSE market_demand_cache.sales_per_week END,
              source = CASE WHEN market_demand_cache.last_updated < NOW() - INTERVAL '3 days' THEN 'price_check' ELSE market_demand_cache.source END,
              search_query = CASE WHEN market_demand_cache.last_updated < NOW() - INTERVAL '3 days' THEN EXCLUDED.search_query ELSE market_demand_cache.search_query END,
              last_updated = CASE WHEN market_demand_cache.last_updated < NOW() - INTERVAL '3 days' THEN NOW() ELSE market_demand_cache.last_updated END
          `, [basePn, m.avg, m.count, m.median, m.min, m.max, m.salesPerWeek, result.searchQuery]);
          // Snapshot for price history
          try {
            await database('PriceSnapshot').insert({
              id: database.raw('gen_random_uuid()'),
              part_number_base: basePn,
              soldCount: m.count,
              soldPriceAvg: m.avg,
              soldPriceMedian: m.median,
              ebay_median_price: m.median,
              ebay_min_price: m.min,
              ebay_max_price: m.max,
              source: 'price_check',
              snapshot_date: new Date(),
            });
          } catch (snapErr) { /* snapshot is supplementary */ }
        }
      } catch (cacheErr) {
        // Don't fail the price check for a cache write error
      }
    }

    return {
      cached: false,
      checkedAt: new Date(),
      ...result,
    };
  }

  /**
   * Run the full price check pipeline
   */
  async runPipeline(title, yourPrice) {
    // 1. Build search query
    const queryResult = buildSearchQuery(title);
    const searchQuery = queryResult.query;
    const parts = queryResult.parts;

    // 2. Scrape sold items
    const scrapedItems = await this.scrapeSoldItems(searchQuery);

    // 3. Filter for relevance — SKIP if this was a PN search
    let filtered;
    if (queryResult.pnSearch) {
      filtered = { items: scrapedItems, total: scrapedItems.length, relevant: scrapedItems.length, filtered: 0 };
    } else {
      const ourItem = {
        title,
        make: parts.make,
        model: parts.model,
        years: parts.years,
        partType: parts.partType,
      };
      filtered = filterRelevantItems(ourItem, scrapedItems);
    }

    // 4. Calculate metrics
    const metrics = this.calculateMetrics(filtered.items, yourPrice);

    // 5. Get top comps
    const topComps = filtered.items.slice(0, 5).map(item => ({
      title: item.title,
      price: item.price,
      soldDate: item.soldDate,
      score: item.relevance?.score,
    }));

    return {
      searchQuery,
      parts,
      metrics,
      topComps,
      totalScraped: scrapedItems.length,
      relevantCount: filtered.relevant,
      avgScore: filtered.avgScore,
    };
  }

  /**
   * Scrape sold items from eBay using a persistent page to minimize memory.
   * If the page crashes, reset and retry once.
   */
  async scrapeSoldItems(searchQuery) {
    try {
      return await this._doScrape(searchQuery);
    } catch (err) {
      // Page/browser crashed — reset everything and retry
      _page = null;
      if (_browser) {
        try { await _browser.close(); } catch (e) {}
        _browser = null;
      }
      return this._doScrape(searchQuery);
    }
  }

  async _doScrape(searchQuery) {
    const page = await getPage();
    const url = `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(searchQuery)}&_sacat=6030&LH_Sold=1&LH_Complete=1&_sop=13&_ipg=60`;

    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(2000);
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(1000);

    return page.evaluate(() => {
      const results = [];
      const seen = new Set();
      const priceEls = document.querySelectorAll('.s-card__price');

      priceEls.forEach((priceEl) => {
        try {
          let card = priceEl.parentElement?.parentElement?.parentElement?.parentElement?.parentElement;
          if (!card) return;

          const innerText = card.innerText?.replace(/\s+/g, ' ')?.trim() || '';
          const priceText = priceEl?.textContent?.trim() || '';

          if (innerText.includes('Shop on eBay')) return;

          const soldMatch = innerText.match(/Sold\s+(\w+\s+\d+,?\s*\d*)/i);
          if (!soldMatch) return;

          let title = innerText.replace(/^.*?Sold\s+\w+\s+\d+,?\s*\d*\s*/i, '');
          title = title.replace(/\$[\d,.]+.*$/, '').trim();
          title = title.replace(/\(For:.*$/i, '').trim();

          const cleanPrice = priceText.replace('to', ' ').split(' ')[0];
          const price = parseFloat(cleanPrice.replace(/[^0-9.]/g, ''));
          if (isNaN(price) || price <= 0) return;

          const key = title.substring(0, 50) + price;
          if (seen.has(key)) return;
          seen.add(key);

          results.push({ title, price, soldDate: soldMatch[1] });
        } catch (e) {}
      });

      return results;
    });
  }

  /**
   * Calculate pricing metrics
   */
  calculateMetrics(items, yourPrice) {
    if (items.length === 0) {
      return { count: 0, message: 'No comparable items found' };
    }

    const prices = items.map(i => i.price).sort((a, b) => a - b);
    const count = prices.length;
    const sum = prices.reduce((a, b) => a + b, 0);
    const avg = sum / count;
    const median = count % 2 === 0
      ? (prices[count / 2 - 1] + prices[count / 2]) / 2
      : prices[Math.floor(count / 2)];
    const min = prices[0];
    const max = prices[prices.length - 1];
    const salesPerWeek = (count / 60) * 7;
    const priceDiff = yourPrice - median;
    const priceDiffPercent = (priceDiff / median) * 100;

    let verdict;
    if (priceDiffPercent > 30) verdict = 'OVERPRICED';
    else if (priceDiffPercent > 10) verdict = 'SLIGHTLY HIGH';
    else if (priceDiffPercent < -20) verdict = 'UNDERPRICED';
    else if (priceDiffPercent < -5) verdict = 'GOOD VALUE';
    else verdict = 'MARKET PRICE';

    return { count, avg, median, min, max, salesPerWeek, priceDiffPercent, verdict };
  }

  /**
   * Format cached result to match pipeline output
   */
  formatResult(cached) {
    return {
      searchQuery: cached.searchQuery,
      parts: {
        partType: cached.partType,
        make: cached.make,
        model: cached.model,
        years: cached.years,
      },
      metrics: {
        count: cached.compCount,
        median: parseFloat(cached.marketMedian),
        min: parseFloat(cached.marketMin),
        max: parseFloat(cached.marketMax),
        avg: parseFloat(cached.marketAvg),
        salesPerWeek: parseFloat(cached.salesPerWeek),
        priceDiffPercent: parseFloat(cached.priceDiffPercent),
        verdict: cached.verdict,
      },
      topComps: typeof cached.topComps === 'string' ? JSON.parse(cached.topComps) : cached.topComps,
      yourPrice: parseFloat(cached.yourPrice),
    };
  }
}

module.exports = new PriceCheckService();
```
---
## FILE: service/services/ItemLookupService.js
```javascript
'use strict';

const { log } = require('../lib/logger');
const { Model } = require('objection/lib/model/Model');
const Auto = require('../models/Auto');
const _ = require('lodash');
const Item = require('../models/Item');
const { itemCreateSchema } = require('../lib/schemas/itemSchema');
const Joi = require('@hapi/joi');
const { v4: uuidv4 } = require('uuid');
const AutoService = require('./AutoService');
const CacheManager = require('../middleware/CacheManager');
const { normalizePartNumber } = require('../lib/partNumberUtils');

const CUSTOM_EBAY_ID = 'custom';
const CUSTOM_CATEGORY_ID = '0';
const CUSTOM_CATEGORY_TITLE = 'custom';
const CUSTOM_SELLER = 'dynatrack';

class ItemLookupService {
  constructor(args) {
    this.log = log.child({ class: 'ItemLookupService' }, true);
    this.cacheManager = new CacheManager();
    this.user = args ? args.user : null;
  }

  getItemsForAutoKey({ year, make, model, trim, engine }) {
    return `item_getItemsForAuto_${year}_${make}_${model}_${trim}_${engine}`;
  }

  async getItemsForAuto({ year, make, model, trim, engine }, { trx = Model.knex() } = {}) {
    const key = this.getItemsForAutoKey({ year, make, model, trim, engine });

    return this.cacheManager.get(key, async () => {

      let statement = Auto.query().select('year', 'make', 'model', 'trim', 'engine')
        .withGraphFetched('itemCompatibilities(selectPrice)')
        .modifiers({
          selectPrice(builder) {
            builder.where('price', '>', '80');
          }
        });
        

      this.scopeAutoStatement(statement, { year, make, model, trim, engine });

      const response = await statement;

      const setArr = [];
      response.forEach((res) => {
        setArr.push(...res.itemCompatibilities);
      });
      let unique = _.uniqBy(setArr, 'id');

      if(!this.user.canSeePrice){
        unique = unique.map(item => _.omit(item, 'price'));
      }

      return {
        count: unique.size,
        response: unique,
      }
    });
  }

  async getAutosForItem({ partNumber }) {
    let statement = Item.query().select().where('manufacturerPartNumber', partNumber).withGraphFetched('autoCompatibilities');

    const response = await statement;

    return { count: response[0].autoCompatibilities.length, response };
  }

  async getLatestItems({ count }) {
    let statement = Item.query().select().orderBy('createdAt').limit(count);

    const response = await statement;

    return response;
  }

  async getItemById({ id }) {
    const columns = ['id', 'pictureUrl', 'title', 'manufacturerPartNumber', 'categoryTitle', 'price', 'isRepair', 'salesEase', 'difficulty', 'notes', 'createdAt'];
    if(this.user.canSeePrice) columns.push('price');

    const statement = Item.query().select(...columns).where('id', id).withGraphFetched('autoCompatibilities');

    let response = await statement;

    return response;
  }

  scopeAutoStatement(statement, { year, make, model, trim, engine }) {
    if (year) {
      const y = parseInt(year);
      if (!isNaN(y)) {
        statement.whereRaw('"year"::int >= ? AND "year"::int <= ?', [y - 1, y + 1]);
      } else {
        statement.where('year', year);
      }
    }
    if (make) {
      statement.where('make', make);
    }
    if (model) {
      statement.where('model', 'like', `%${model}%`);
    }
    if (trim) {
      statement.where('trim', 'like', `%${trim}%`);
    }
    if (engine) {
      statement.where('engine', 'like', `%${engine}%`);
    }
  }

  async update({ body }) {
    this.log.debug({ body }, 'Updating item');

    const { auto } = body;

    const autoService = new AutoService();

    const autoCompatibilities = await autoService.getOrCreateAutos({ autos: auto });

    body.autoCompatibilities = autoCompatibilities;
    if (body.manufacturerPartNumber) {
      body.partNumberBase = normalizePartNumber(body.manufacturerPartNumber);
    }

    delete body.auto;

    const response = await Item.query().upsertGraphAndFetch(body, {
      relate: true
    });

    this.log.debug({ id: response.id }, 'Item successfully updated');

    this.log.debug({ id: response.id }, 'Clearing cache now that item has been updated');
    this.cacheManager.del(autoService.getDistinctKey({}));
    this.clearCachePostUpdate(auto);

    return response;
  }

  clearCachePostUpdate(auto) {
    this.log.debug('Creating list of cache keys to clear based on item update');
    let cacheClearer = new Set();
    auto.forEach((auto) => {
      cacheClearer.add(auto.year).add(auto.make).add(auto.model);
    });

    this.cacheManager.delContains(Array.from(cacheClearer));
  }

  async createItem({ body }) {
    this.log.debug({ body }, 'Creating new item');

    // get the auto items
    const { auto } = body;

    const autoService = new AutoService();

    const autoCompatibilities = await autoService.getOrCreateAutos({ autos: auto });

    // create new item
    const newItem = {
      id: uuidv4(),
      ebayId: `${CUSTOM_EBAY_ID}-${uuidv4()}`,
      price: body.price,
      title: body.title,
      categoryId: CUSTOM_CATEGORY_ID,
      categoryTitle: body.categoryTitle || CUSTOM_CATEGORY_TITLE,
      seller: CUSTOM_SELLER,
      processed: true,
      difficulty: body.difficulty,
      salesEase: body.salesEase,
      notes: body.notes,
      pictureUrl: body.pictureUrl,
      manufacturerPartNumber: body.manufacturerPartNumber,
      partNumberBase: normalizePartNumber(body.manufacturerPartNumber),
      autoCompatibilities,
    };

    delete body.auto;

    Joi.attempt(body, itemCreateSchema.required());

    const response = await Item.query().insertGraphAndFetch(newItem, {
      relate: true
    });

    this.log.debug({ response }, 'item successfully created');

    this.log.debug({ id: response.id }, 'Clearing cache now that item has been created');
    this.cacheManager.del(autoService.getDistinctKey({}));
    this.clearCachePostUpdate(auto);

    return response;
  }

  async searchItems({ constraints }) {
    this.log.debug(constraints, 'searching for items');

    const { title, seller, categoryTitle, manufacturerPartNumber } = constraints;

    const columns = ['id', 'pictureUrl', 'title', 'manufacturerPartNumber', 'categoryTitle'];
    if(this.user.canSeePrice) columns.push('price');

    const statement = Item.query().select(...columns);

    if (title) {
      statement.whereRaw('title ILIKE ?', [`%${title}%`]);
    }
    if (seller) {
      statement.whereRaw('seller ILIKE ?', [`%${seller}%`]);
    }
    if (categoryTitle) {
      statement.whereRaw('"Item"."categoryTitle" ILIKE ?', [`%${categoryTitle}%`]);
    }
    if (manufacturerPartNumber) {
      statement.whereRaw('"Item"."manufacturerPartNumber" ILIKE ?', [`%${manufacturerPartNumber}%`]);
    }

    const response = await statement;

    return response;
  }

  async deleteItemById({ id }) {
    this.log.debug({ id }, 'deleting item by id');

    const response = await Item.query().where('id', id).del();

    return response;
  }

  async getFilter({ field }) {
    const response = await Item.query().distinct(field).orderBy(field, 'ASC');

    return response.map(i => i[field]);
  }
}

module.exports = ItemLookupService;```
---
## FILE: service/services/COGSService.js
```javascript
'use strict';

const { database } = require('../database/database');
const { getCogsReference, DEFAULT_MARKET_VALUES } = require('../config/yard-cogs-reference');

/**
 * COGSService - True cost of goods calculation
 *
 * COGS = parts cost + gate fee. NO TAX, NO MILEAGE.
 * Puller sees: target spend (30%), ceiling (35%), live blended %, per-part colors.
 */
class COGSService {

  static async getYardProfile(yardId) {
    const yard = await database('yard').where('id', yardId).first();
    if (!yard) throw new Error('Yard not found');

    const entryFee = parseFloat(yard.entry_fee) || 0;
    const cogsRef = getCogsReference(yard.chain);

    return {
      id: yard.id,
      name: yard.name,
      chain: yard.chain,
      entryFee,
      fixedOverhead: entryFee,
      cogsReference: cogsRef,
      defaultMarketValues: DEFAULT_MARKET_VALUES,
    };
  }

  static async calculateGateMax(yardId, plannedParts) {
    const yard = await database('yard').where('id', yardId).first();
    if (!yard) throw new Error('Yard not found');

    const entryFee = parseFloat(yard.entry_fee) || 0;
    const fixedOverhead = entryFee;

    const totalMarketValue = plannedParts.reduce((sum, p) => sum + (p.marketValue || 0), 0);
    const totalCogs = plannedParts.reduce((sum, p) => sum + (p.cogs || 0), 0);

    const targetTotal = totalMarketValue * 0.30;
    const targetPartSpend = targetTotal - fixedOverhead;
    const ceilingTotal = totalMarketValue * 0.35;
    const ceilingPartSpend = ceilingTotal - fixedOverhead;

    const currentTotal = totalCogs + fixedOverhead;
    const blendedCogs = totalMarketValue > 0 ? (currentTotal / totalMarketValue) * 100 : 0;

    let status;
    if (ceilingPartSpend <= 0) status = 'leave';
    else if (blendedCogs <= 25) status = 'excellent';
    else if (blendedCogs <= 35) status = 'acceptable';
    else status = 'leave';

    return {
      yardName: yard.name,
      totalMarketValue: Math.round(totalMarketValue),
      fixedOverhead: Math.round(fixedOverhead * 100) / 100,
      entryFee,
      maxPartSpend: Math.max(0, Math.round(targetPartSpend)),
      ceilingPartSpend: Math.max(0, Math.round(ceilingPartSpend)),
      currentCogs: Math.round(totalCogs),
      currentTotal: Math.round(currentTotal),
      blendedCogs: Math.round(blendedCogs * 10) / 10,
      status,
    };
  }

  static async calculateSession(session) {
    const { yardId, parts, totalPaid } = session;
    const yard = await database('yard').where('id', yardId).first();
    if (!yard) throw new Error('Yard not found');

    const entryFee = parseFloat(yard.entry_fee) || 0;
    const totalTrueCost = totalPaid + entryFee;
    const totalMarketValue = parts.reduce((sum, p) => sum + (p.marketValue || 0), 0);
    const blendedCogsRate = totalMarketValue > 0 ? (totalTrueCost / totalMarketValue) * 100 : 0;

    const allocatedParts = parts.map(part => {
      const share = totalMarketValue > 0 ? part.marketValue / totalMarketValue : 0;
      const allocated = totalTrueCost * share;
      const rate = part.marketValue > 0 ? (allocated / part.marketValue) * 100 : 0;
      return { ...part, allocatedCost: Math.round(allocated * 100) / 100, cogsRate: Math.round(rate * 10) / 10,
        verdict: rate <= 25 ? 'excellent' : rate <= 35 ? 'acceptable' : 'over_limit' };
    });

    return {
      session: { totalPaid, entryFee,
        totalTrueCost: Math.round(totalTrueCost * 100) / 100, totalMarketValue,
        blendedCogsRate: Math.round(blendedCogsRate * 10) / 10,
        verdict: blendedCogsRate <= 25 ? 'excellent' : blendedCogsRate <= 35 ? 'acceptable' : 'over_limit',
        yardName: yard.name },
      parts: allocatedParts,
    };
  }
}

module.exports = COGSService;
```
---
## FILE: service/services/PartLocationService.js
```javascript
'use strict';

const { log } = require('../lib/logger');
const { database } = require('../database/database');

// Part types eligible for automated research
const RESEARCH_PART_TYPES = [
  'ECM', 'PCM', 'BCM', 'TIPM', 'fuse box', 'TCM', 'ABS module', 'amplifier',
  'transfer case module', 'HVAC module', 'airbag module',
  'parking sensor module', 'blind spot module', 'camera module',
  'liftgate module', 'steering module',
];

// Minimum vehicle year for research triggers
const MIN_RESEARCH_YEAR = 2014;

// Once this many pullers confirm, field data wins — stop researching
const CONFIRMED_THRESHOLD = 3;

// Pre-populated tip for window regulator motors
const WINDOW_REG_TIP = 'Window regulator motors can be tested in the yard with the battery from an impact gun.';

class PartLocationService {
  constructor() {
    this.log = log.child({ class: 'PartLocationService' }, true);
  }

  /**
   * Look up part location. If eligible and no record exists, trigger research.
   * Returns the location record or null.
   */
  async getLocation({ partType, year, make, model, trim, bodyStyle }) {
    // Check for existing record
    const existing = await this.findRecord({ partType, year, make, model, trim, bodyStyle });
    if (existing) return existing;

    // Check trigger conditions before spending API tokens
    if (!this.shouldResearch({ partType, year })) {
      return null;
    }

    // No record and triggers met — research it
    try {
      const researched = await this.researchLocation({ partType, year, make, model, trim, bodyStyle });
      return researched;
    } catch (err) {
      this.log.error({ err, partType, year, make, model }, 'Research failed');
      return null;
    }
  }

  /**
   * Find an existing part_location record for this combination.
   * Matches on year range (year_start <= year <= year_end).
   */
  async findRecord({ partType, year, make, model, trim, bodyStyle }) {
    const normalizedType = partType.toUpperCase().trim();
    const normalizedMake = (make || '').trim();
    const normalizedModel = (model || '').trim();

    let query = database('part_location')
      .whereRaw('UPPER(part_type) = ?', [normalizedType])
      .whereRaw('UPPER(make) = ?', [normalizedMake.toUpperCase()])
      .whereRaw('UPPER(model) = ?', [normalizedModel.toUpperCase()])
      .where('year_start', '<=', year)
      .where('year_end', '>=', year);

    if (trim) {
      query = query.where(function() {
        this.whereRaw('UPPER(trim) = ?', [trim.toUpperCase()])
          .orWhereNull('trim');
      });
    }

    if (bodyStyle) {
      query = query.where(function() {
        this.whereRaw('UPPER(body_style) = ?', [bodyStyle.toUpperCase()])
          .orWhereNull('body_style');
      });
    }

    // Prefer most specific match (with trim/body_style over without)
    const records = await query.orderByRaw(
      'CASE WHEN trim IS NOT NULL THEN 0 ELSE 1 END, CASE WHEN body_style IS NOT NULL THEN 0 ELSE 1 END'
    );

    if (records.length === 0) return null;

    const record = records[0];

    // Attach window regulator tip if applicable
    if (normalizedType.includes('WINDOW') && normalizedType.includes('REGULATOR')) {
      record.hazards = record.hazards
        ? `${record.hazards}\n${WINDOW_REG_TIP}`
        : WINDOW_REG_TIP;
    }

    return record;
  }

  /**
   * Check all trigger conditions for research.
   */
  shouldResearch({ partType, year }) {
    const yearNum = parseInt(year) || 0;
    if (yearNum < MIN_RESEARCH_YEAR) return false;

    const normalizedType = (partType || '').toUpperCase().trim();
    const eligible = RESEARCH_PART_TYPES.some(t =>
      normalizedType.includes(t.toUpperCase())
    );
    if (!eligible) return false;

    return true;
  }

  /**
   * Call Claude API with web_search tool to research part location.
   */
  async researchLocation({ partType, year, make, model, trim, bodyStyle }) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      this.log.warn('ANTHROPIC_API_KEY not set — skipping research');
      return null;
    }

    const Anthropic = require('@anthropic-ai/sdk');
    const client = new Anthropic({ apiKey });

    const vehicleDesc = [year, make, model, trim, bodyStyle].filter(Boolean).join(' ');

    const response = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 3 }],
      messages: [{
        role: 'user',
        content: `You are an automotive parts location expert. Find the exact location and removal procedure for the ${partType} on a ${vehicleDesc}.

Search priority:
1. OEM service manual diagrams and procedures
2. NHTSA Technical Service Bulletins (TSBs)
3. Automotive repair forums (JustAnswer, 2CarPros, model-specific forums)

Return a JSON object with these exact fields:
{
  "location_text": "Where on the vehicle this part is located (be specific: behind glove box, under hood driver side, etc.)",
  "removal_steps": ["Step 1...", "Step 2...", "Step 3..."],
  "tools": "Tools needed (e.g., 10mm socket, T20 Torx, trim removal tool)",
  "hazards": "Any safety warnings or things that can go wrong",
  "avg_pull_minutes": estimated_minutes_as_integer
}

Return ONLY the JSON object, no other text.`
      }],
    });

    // Extract text from response (may have tool use blocks mixed in)
    let resultText = '';
    for (const block of response.content) {
      if (block.type === 'text') {
        resultText += block.text;
      }
    }

    // Parse JSON from response
    const jsonMatch = resultText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      this.log.warn({ resultText }, 'Could not parse JSON from research response');
      return null;
    }

    let parsed;
    try {
      parsed = JSON.parse(jsonMatch[0]);
    } catch (err) {
      this.log.warn({ err: err.message, resultText }, 'Invalid JSON from research');
      return null;
    }

    // Store in database
    const record = {
      part_type: partType,
      year_start: parseInt(year),
      year_end: parseInt(year),
      make,
      model,
      trim: trim || null,
      body_style: bodyStyle || null,
      location_text: parsed.location_text || null,
      removal_steps: JSON.stringify(parsed.removal_steps || []),
      tools: parsed.tools || null,
      hazards: parsed.hazards || null,
      avg_pull_minutes: parseInt(parsed.avg_pull_minutes) || null,
      confirmed_count: 0,
      confidence: 'researched',
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const inserted = await database('part_location').insert(record).returning('*');
    this.log.info({ partType, year, make, model }, 'Part location researched and stored');

    return inserted[0] || record;
  }

  /**
   * Record field confirmation from a puller.
   * Increments confirmed_count. At threshold, promotes to high_confidence.
   */
  async confirmLocation(id, { locationText, removalSteps, tools, hazards, avgPullMinutes }) {
    const record = await database('part_location').where('id', id).first();
    if (!record) return null;

    const newCount = (record.confirmed_count || 0) + 1;
    const updates = {
      confirmed_count: newCount,
      updatedAt: new Date(),
    };

    // Promote confidence based on count
    if (newCount >= CONFIRMED_THRESHOLD) {
      updates.confidence = 'high_confidence';
    } else if (record.confidence === 'researched') {
      updates.confidence = 'field_confirmed';
    }

    // If puller provided updated data, merge it in
    // Never overwrite high_confidence with researched data, but field data always applies
    if (locationText) updates.location_text = locationText;
    if (removalSteps) updates.removal_steps = JSON.stringify(removalSteps);
    if (tools) updates.tools = tools;
    if (hazards) updates.hazards = hazards;
    if (avgPullMinutes) updates.avg_pull_minutes = avgPullMinutes;

    await database('part_location').where('id', id).update(updates);

    return { ...record, ...updates };
  }

  /**
   * Flag a location as wrong. Resets to researched with count 0.
   */
  async flagWrong(id) {
    const record = await database('part_location').where('id', id).first();
    if (!record) return null;

    await database('part_location').where('id', id).update({
      confidence: 'researched',
      confirmed_count: 0,
      updatedAt: new Date(),
    });

    return { ...record, confidence: 'researched', confirmed_count: 0 };
  }
}

module.exports = PartLocationService;
```
---
## FILE: service/lib/priceResolver.js
```javascript
'use strict';

const { database } = require('../database/database');

/**
 * Resolve the best available price for a part number.
 * Priority: market_demand_cache (fresh) > PriceCheck > Item.price (frozen reference)
 *
 * Freshness: fresh = <30d, aging = 30-60d, stale = 60-90d, expired = >90d (treated as missing)
 */

function getFreshness(updatedAt) {
  if (!updatedAt) return 'frozen';
  const daysAgo = Math.floor((Date.now() - new Date(updatedAt).getTime()) / 86400000);
  if (daysAgo <= 30) return 'fresh';
  if (daysAgo <= 60) return 'aging';
  if (daysAgo <= 90) return 'stale';
  return 'expired';
}

/**
 * Batch resolve prices for multiple part numbers in minimal queries.
 * @param {string[]} partNumbers - array of partNumberBase values
 * @param {Object} options
 * @param {Map} options.cacheIndex - pre-loaded cache data (optional)
 * @param {Map} options.itemPrices - Map of partNumberBase -> Item.price (optional)
 * @returns {Map<string, {price, source, freshness, details}>}
 */
async function resolvePricesBatch(partNumbers, options = {}) {
  const results = new Map();
  if (!partNumbers || partNumbers.length === 0) return results;

  const unique = [...new Set(partNumbers.filter(Boolean))];

  // Step 1: market_demand_cache (best source)
  let cacheMap = options.cacheIndex || new Map();
  if (!options.cacheIndex && unique.length > 0) {
    try {
      const rows = await database('market_demand_cache')
        .whereIn('part_number_base', unique)
        .select('part_number_base', 'ebay_avg_price', 'ebay_median_price', 'ebay_sold_90d',
                'ebay_min_price', 'ebay_max_price', 'market_score', 'last_updated');
      for (const r of rows) cacheMap.set(r.part_number_base, r);
    } catch (e) { /* table may not exist */ }
  }

  const remaining = [];
  for (const pn of unique) {
    const cached = cacheMap.get(pn);
    if (cached) {
      const price = parseFloat(cached.ebay_avg_price) || 0;
      const freshness = getFreshness(cached.last_updated);
      if (price > 0 && freshness !== 'expired') {
        results.set(pn, {
          price,
          source: 'market_cache',
          freshness,
          details: {
            median: parseFloat(cached.ebay_median_price) || price,
            min: parseFloat(cached.ebay_min_price) || null,
            max: parseFloat(cached.ebay_max_price) || null,
            soldCount: parseInt(cached.ebay_sold_90d) || 0,
            updatedAt: cached.last_updated,
          },
        });
        continue;
      }
    }
    remaining.push(pn);
  }

  // Step 2: PriceCheck (per-listing checks, match by partNumberBase in title/searchQuery)
  // This is expensive per-PN, so skip in batch mode — the cache is the primary source
  // PriceCheck data feeds INTO market_demand_cache via Phase 1c, so cache covers this

  // Step 3: Item.price (frozen reference)
  for (const pn of remaining) {
    const itemPrice = options.itemPrices ? options.itemPrices.get(pn) : null;
    if (itemPrice && itemPrice > 0) {
      results.set(pn, {
        price: itemPrice,
        source: 'item_reference',
        freshness: 'frozen',
        details: { warning: 'Price from frozen Item table — may be outdated' },
      });
    } else {
      results.set(pn, {
        price: null,
        source: 'none',
        freshness: null,
        details: { warning: 'No pricing data available' },
      });
    }
  }

  return results;
}

/**
 * Resolve price for a single part number.
 */
async function resolvePrice(partNumberBase, options = {}) {
  if (!partNumberBase) {
    return { price: options.itemPrice || null, source: options.itemPrice ? 'item_reference' : 'none', freshness: options.itemPrice ? 'frozen' : null, details: {} };
  }
  const batch = await resolvePricesBatch([partNumberBase], options);
  return batch.get(partNumberBase) || { price: null, source: 'none', freshness: null, details: {} };
}

module.exports = { resolvePrice, resolvePricesBatch, getFreshness };
```
---
## FILE: service/lib/platformMatch.js
```javascript
/**
 * platformMatch.js — Platform Cross-Reference Engine for PartHawk
 * 
 * Resolves the problem: "2006 Chrysler 300 at yard should match Dodge Charger ECM sales"
 * 
 * Usage:
 *   const { getPlatformMatches, getExpandedSalesQuery } = require('./platformMatch');
 *   
 *   // Get all platform siblings for a yard vehicle
 *   const matches = await getPlatformMatches(pool, 'Chrysler', '300', 2006);
 *   // Returns: [{ make: 'Dodge', model: 'Charger', part_types: ['ECM','BCM','ABS',...] }, ...]
 *   
 *   // Get expanded SQL WHERE clause for YourSale matching
 *   const clause = await getExpandedSalesQuery(pool, 'Chrysler', '300', 2006);
 *   // Returns SQL that matches 300 + Charger + Challenger + Magnum titles
 */

const MODEL_ALIASES = {
  // Chrysler
  '300': ['300', '300c', '300s', '300 touring', '300 limited'],
  'Charger': ['Charger'],
  'Challenger': ['Challenger'],
  'Grand Cherokee': ['Grand Cherokee'],
  'Commander': ['Commander'],
  'Liberty': ['Liberty'],
  'Nitro': ['Nitro'],
  'Wrangler': ['Wrangler'],
  'Cherokee': ['Cherokee'],
  'Avenger': ['Avenger'],
  'Sebring': ['Sebring'],
  '200': ['200'],
  'Grand Caravan': ['Grand Caravan', 'Caravan'],
  'Town & Country': ['Town & Country', 'Town and Country', 'T&C'],
  'Pacifica': ['Pacifica'],
  'PT Cruiser': ['PT Cruiser'],
  'Dart': ['Dart'],
  'Caliber': ['Caliber'],
  'Journey': ['Journey'],
  'Durango': ['Durango'],
  'Magnum': ['Magnum'],
  
  // Ram (handles Dodge Ram vs Ram brand split 2010)
  '1500': ['1500', 'Ram 1500'],
  '2500': ['2500', 'Ram 2500'],
  '3500': ['3500', 'Ram 3500'],
  'Ram 1500': ['Ram 1500', '1500'],
  'Ram 2500': ['Ram 2500', '2500'],
  'Ram 3500': ['Ram 3500', '3500'],
  
  // GM
  'Silverado': ['Silverado'],
  'Sierra': ['Sierra'],
  'Tahoe': ['Tahoe'],
  'Yukon': ['Yukon'],
  'Suburban': ['Suburban'],
  'Escalade': ['Escalade'],
  'Traverse': ['Traverse'],
  'Acadia': ['Acadia'],
  'Enclave': ['Enclave'],
  'Trailblazer': ['Trailblazer'],
  'Envoy': ['Envoy'],
  'Equinox': ['Equinox'],
  'Terrain': ['Terrain'],
  'Express': ['Express'],
  'Savana': ['Savana'],
  'Impala': ['Impala'],
  
  // Ford
  'Edge': ['Edge'],
  'MKX': ['MKX'],
  'Explorer': ['Explorer'],
  'Taurus': ['Taurus'],
  'Flex': ['Flex'],
  'MKT': ['MKT'],
  'F-250': ['F-250', 'F250', 'Super Duty'],
  'F-350': ['F-350', 'F350', 'Super Duty'],
  'Excursion': ['Excursion'],
  'Escape': ['Escape'],
  'Mariner': ['Mariner'],
  'Tribute': ['Tribute'],
  'Fusion': ['Fusion'],
  
  // Japanese
  'Tundra': ['Tundra'],
  'Sequoia': ['Sequoia'],
  'Tucson': ['Tucson'],
  'Sportage': ['Sportage'],
  'Sonata': ['Sonata'],
  'Optima': ['Optima'],
  'Elantra': ['Elantra'],
  'Forte': ['Forte'],
  '350Z': ['350Z'],
  'G35': ['G35'],
  'Frontier': ['Frontier'],
  'Xterra': ['Xterra'],
  'Pathfinder': ['Pathfinder'],
  'CR-V': ['CR-V', 'CRV'],
  'Civic': ['Civic'],
  
  // VW
  'Jetta': ['Jetta'],
  'Golf': ['Golf'],
  'Passat': ['Passat'],
};

// Make aliases: LKQ scraper says "CHRYSLER" but sales say "Chrysler" or "Dodge"
const MAKE_ALIASES = {
  'CHRYSLER': ['Chrysler'],
  'DODGE': ['Dodge'],
  'JEEP': ['Jeep'],
  'RAM': ['Ram', 'Dodge'],  // Ram brand started 2010, before that it's Dodge Ram
  'CHEVROLET': ['Chevrolet', 'Chevy'],
  'CHEVY': ['Chevrolet', 'Chevy'],
  'GMC': ['GMC'],
  'FORD': ['Ford'],
  'LINCOLN': ['Lincoln'],
  'MERCURY': ['Mercury'],
  'TOYOTA': ['Toyota'],
  'LEXUS': ['Lexus'],
  'HONDA': ['Honda'],
  'ACURA': ['Acura'],
  'NISSAN': ['Nissan'],
  'INFINITI': ['Infiniti'],
  'HYUNDAI': ['Hyundai'],
  'KIA': ['Kia'],
  'MAZDA': ['Mazda'],
  'VOLKSWAGEN': ['Volkswagen', 'VW'],
  'BMW': ['BMW'],
  'MERCEDES-BENZ': ['Mercedes-Benz', 'Mercedes'],
  'SUBARU': ['Subaru'],
  'MITSUBISHI': ['Mitsubishi'],
  'VOLVO': ['Volvo'],
  'AUDI': ['Audi'],
};

/**
 * Get all platform-sibling vehicles for a given make/model/year.
 * Accepts either a Knex instance (database) or a pg pool.
 * @returns Array of { make, model, part_types[], platform_name, notes }
 */
async function getPlatformMatches(db, make, model, year) {
  const query = `
    SELECT DISTINCT
      pv2.make, pv2.model,
      array_agg(DISTINCT psp.part_type) as part_types,
      pg.platform as platform_name,
      pg.notes
    FROM platform_vehicle pv1
    JOIN platform_group pg ON pv1.platform_group_id = pg.id
    JOIN platform_vehicle pv2 ON pv2.platform_group_id = pg.id AND pv2.id != pv1.id
    JOIN platform_shared_part psp ON psp.platform_group_id = pg.id
    WHERE LOWER(pv1.make) = LOWER(?)
      AND LOWER(pv1.model) = LOWER(?)
      AND ? BETWEEN pg.year_start AND pg.year_end
    GROUP BY pv2.make, pv2.model, pg.platform, pg.notes
  `;

  try {
    // Support both Knex (db.raw) and pg pool (db.query)
    if (db.raw) {
      const result = await db.raw(query, [make, model, year]);
      return result.rows || result;
    } else {
      const result = await db.query(query, [make, model, year]);
      return result.rows;
    }
  } catch (err) {
    // Tables may not exist yet — return empty silently
    return [];
  }
}

/**
 * Build expanded ILIKE conditions for YourSale title matching
 * Includes the original vehicle + all platform siblings
 * 
 * @returns { conditions: string[], params: string[] } for use in WHERE clause
 */
async function getExpandedSalesQuery(db, make, model, year) {
  // Start with the original vehicle
  const makeAliases = MAKE_ALIASES[make.toUpperCase()] || [make];
  const modelAliases = MODEL_ALIASES[model] || [model];

  let allVehicles = [{ make, model, makeAliases, modelAliases }];

  // Get platform siblings
  const siblings = await getPlatformMatches(db, make, model, year);
  for (const sib of siblings) {
    const sibMakeAliases = MAKE_ALIASES[sib.make.toUpperCase()] || [sib.make];
    const sibModelAliases = MODEL_ALIASES[sib.model] || [sib.model];
    allVehicles.push({
      make: sib.make,
      model: sib.model,
      makeAliases: sibMakeAliases,
      modelAliases: sibModelAliases,
    });
  }
  
  // Build ILIKE conditions
  let conditions = [];
  let params = [];
  let paramIdx = 1;
  
  for (const veh of allVehicles) {
    for (const mk of veh.makeAliases) {
      for (const mdl of veh.modelAliases) {
        conditions.push(`(title ILIKE $${paramIdx} AND title ILIKE $${paramIdx + 1})`);
        params.push(`%${mk}%`, `%${mdl}%`);
        paramIdx += 2;
      }
    }
  }
  
  return { conditions, params };
}

/**
 * Enhanced scoring: adjust score based on platform data
 * If a vehicle at the yard has platform siblings with strong sales, boost its score
 */
function applyPlatformBonus(baseScore, platformMatches, salesData) {
  if (!platformMatches || platformMatches.length === 0) return baseScore;
  
  // Calculate total sibling sales volume
  let siblingRevenue = 0;
  let siblingUnits = 0;
  
  for (const match of platformMatches) {
    const key = `${match.make}|${match.model}`;
    if (salesData[key]) {
      siblingRevenue += salesData[key].revenue || 0;
      siblingUnits += salesData[key].units || 0;
    }
  }
  
  // Bonus: up to 20% boost based on sibling sales
  if (siblingUnits > 0) {
    const bonus = Math.min(0.20, siblingUnits * 0.01);
    return Math.round(baseScore * (1 + bonus));
  }
  
  return baseScore;
}

/**
 * Normalize make names from yard scraper to match sales data
 */
function normalizeMake(yardMake) {
  if (!yardMake) return yardMake;
  const upper = yardMake.toUpperCase().trim();
  const aliases = MAKE_ALIASES[upper];
  return aliases ? aliases[0] : yardMake;
}

/**
 * Normalize model names — strip common suffixes and standardize
 */
function normalizeModel(model) {
  if (!model) return model;
  return model
    .replace(/\s+(Base|S|SE|LE|XLE|SXT|SLT|LT|LS|XL|XLT|Limited|Sport|Touring|Premium)\s*$/i, '')
    .trim();
}

module.exports = {
  getPlatformMatches,
  getExpandedSalesQuery,
  applyPlatformBonus,
  normalizeMake,
  normalizeModel,
  MAKE_ALIASES,
  MODEL_ALIASES,
};
```
---
## FILE: service/routes/attack-list.js
```javascript
'use strict';

const { log } = require('../lib/logger');
const router = require('express-promise-router')();
const AttackListService = require('../services/AttackListService');
const DeadInventoryService = require('../services/DeadInventoryService');
const { database } = require('../database/database');
const { v4: uuidv4 } = require('uuid');

/**
 * GET /attack-list
 * Get attack list across all yards — sorted by opportunity.
 * By default returns SLIM vehicles (no parts/rebuild_parts) to keep payload under 200KB.
 * Parts are loaded on-demand via GET /attack-list/vehicle/:id/parts.
 * Pass ?full=true to get the old behavior (large payload with all parts).
 */
router.get('/', async (req, res) => {
  try {
    const { days = 90, activeOnly, full, since } = req.query;
    const service = new AttackListService();
    const results = await service.getAllYardsAttackList({
      daysBack: parseInt(days),
      activeOnly: activeOnly === 'true',
      lastSeenSince: since || null,
    });

    // Load active scout alerts and index by vehicle make+model+year+yard
    let alertsByVehicle = {};
    try {
      const alerts = await database('scout_alerts')
        .where(function() { this.where('claimed', false).orWhereNull('claimed'); })
        .select('id', 'source', 'source_title', 'part_value', 'confidence', 'yard_name',
                'vehicle_year', 'vehicle_make', 'vehicle_model');
      for (const a of alerts) {
        const key = [a.vehicle_year, (a.vehicle_make || '').toLowerCase(), (a.vehicle_model || '').toLowerCase(), (a.yard_name || '').toLowerCase()].join('|');
        if (!alertsByVehicle[key]) alertsByVehicle[key] = [];
        alertsByVehicle[key].push({
          id: a.id,
          source: a.source,
          title: a.source_title,
          value: a.part_value,
          confidence: a.confidence,
        });
      }
    } catch (e) { /* scout_alerts may not exist */ }

    // Attach alert badges to vehicles
    for (const yard of results) {
      for (const vehicle of (yard.vehicles || [])) {
        const key = [vehicle.year, (vehicle.make || '').toLowerCase(), (vehicle.model || '').toLowerCase(), (yard.yard_name || '').toLowerCase()].join('|');
        const va = alertsByVehicle[key];
        if (va && va.length > 0) {
          // Separate mark alerts (highest priority) from stream alerts
          vehicle.alertBadges = va.sort((a, b) => {
            if (a.source === 'PERCH' && b.source !== 'PERCH') return -1;
            if (a.source !== 'PERCH' && b.source === 'PERCH') return 1;
            return 0;
          });
        }
      }
    }

    // Strip parts arrays for slim mode (default) — huge memory savings on mobile
    if (full !== 'true') {
      for (const yard of results) {
        for (const vehicle of (yard.vehicles || [])) {
          // Keep only chip-display data: part type + price for each part
          vehicle.part_chips = (vehicle.parts || []).slice(0, 4).map(p => ({
            partType: p.partType, price: p.price, verdict: p.verdict, priceSource: p.priceSource,
          }));
          delete vehicle.parts;
          delete vehicle.rebuild_parts;
          delete vehicle.platform_siblings;
        }
      }
    } else {
      // Full mode: enrich with dead inventory warnings
      const deadService = new DeadInventoryService();
      for (const yard of results) {
        for (const vehicle of (yard.vehicles || [])) {
          for (const part of (vehicle.parts || [])) {
            if (part.partNumber) {
              try {
                const warning = await deadService.getWarning(part.partNumber);
                if (warning) part.deadWarning = warning;
              } catch (e) { /* ignore */ }
            }
          }
        }
      }
    }

    res.json({
      success: true,
      generated_at: new Date().toISOString(),
      yards: results,
    });
  } catch (err) {
    log.error({ err }, 'Error generating attack list');
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /attack-list/vehicle/:id/parts
 * Load parts for a single vehicle on-demand (when user taps to expand).
 */
router.get('/vehicle/:id/parts', async (req, res) => {
  try {
    const { id } = req.params;
    const service = new AttackListService();

    // Find the vehicle in the DB
    const vehicle = await database('yard_vehicle').where('id', id).first();
    if (!vehicle) return res.status(404).json({ success: false, error: 'Vehicle not found' });

    // Build indexes and score just this one vehicle
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

    // Enrich with cached market data
    let marketHits = 0, marketMisses = 0;
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
          marketHits++;
        } else {
          marketMisses++;
        }
      }
      log.info({ vehicleId: id, parts: (scored.parts || []).length, marketHits, marketMisses }, 'Market enrichment for vehicle parts');
    } catch (e) {
      log.warn({ err: e.message }, 'Market enrichment failed');
    }

    // Enrich expected_parts with validation verdicts
    const validations = await service.loadValidationCache();
    const validatedSuggestions = service.enrichSuggestions(
      vehicle.make, vehicle.expected_parts, vehicle.audio_brand, validations
    );

    res.json({
      success: true,
      id,
      parts: scored.parts || [],
      rebuild_parts: scored.rebuild_parts || null,
      platform_siblings: scored.platform_siblings || null,
      validated_suggestions: validatedSuggestions,
    });
  } catch (err) {
    log.error({ err }, 'Error loading vehicle parts');
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /attack-list/yard/:yardId
 * Get full attack list for a specific yard
 */
router.get('/yard/:yardId', async (req, res) => {
  try {
    const { yardId } = req.params;
    const { days = 90, limit = 100 } = req.query;

    const yard = await database('yard').where('id', yardId).first();
    if (!yard) return res.status(404).json({ error: 'Yard not found' });

    const service = new AttackListService();
    const list = await service.getAttackList(yardId, { 
      daysBack: parseInt(days),
      limit: parseInt(limit),
    });

    res.json({
      success: true,
      yard: {
        id: yard.id,
        name: yard.name,
        chain: yard.chain,
        distance_from_base: yard.distance_from_base,
        last_scraped: yard.last_scraped,
      },
      ...list,
    });
  } catch (err) {
    log.error({ err }, 'Error generating yard attack list');
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /attack-list/summary
 * Quick summary — which yards have the most opportunity today
 */
router.get('/summary', async (req, res) => {
  try {
    const service = new AttackListService();
    const results = await service.getAllYardsAttackList({ daysBack: 90 });

    const summary = results.map(r => ({
      yard: r.yard.name,
      distance: r.yard.distance_from_base,
      vehicles_on_lot: r.total_vehicles,
      hot_vehicles: r.hot_vehicles,
      top_score: r.top_score,
      est_value: r.est_total_value,
      last_scraped: r.yard.last_scraped,
      visit_priority: r.top_score >= 80 ? '🟢 GO TODAY' : r.top_score >= 60 ? '🟡 CONSIDER' : '⬜ SKIP',
    }));

    res.json({ success: true, summary, generated_at: new Date().toISOString() });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /attack-list/log-pull
 * Log a part as pulled. Auto-creates pull_session if needed.
 * Body: { vehicleId, itemId, yardId? }
 */
router.post('/log-pull', async (req, res) => {
  try {
    const { vehicleId, itemId } = req.body;

    // Find the yard for this vehicle
    let yardId = req.body.yardId;
    if (!yardId && vehicleId) {
      try {
        const vehicle = await database('yard_vehicle').where('id', vehicleId).first();
        if (vehicle) yardId = vehicle.yard_id;
      } catch (e) { /* ignore */ }
    }

    // Auto-create or find today's pull session for this yard
    let sessionId = null;
    if (yardId) {
      try {
        const today = new Date().toISOString().slice(0, 10);
        let session = await database('pull_session')
          .where('yard_id', yardId)
          .where('date', today)
          .first();

        if (!session) {
          const { v4: uuidv4 } = require('uuid');
          const inserted = await database('pull_session').insert({
            id: uuidv4(),
            yard_id: yardId,
            date: today,
            createdAt: new Date(),
            updatedAt: new Date(),
          }).returning('id');
          sessionId = inserted[0]?.id || inserted[0];
        } else {
          sessionId = session.id;
        }
      } catch (e) {
        log.warn({ err: e.message }, 'pull_session create failed');
      }
    }

    res.json({ success: true, sessionId });
  } catch (err) {
    log.error({ err }, 'Error logging pull');
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /attack-list/visit-feedback
 * Log yard visit feedback after a session.
 * Body: { yardId, rating (1-5), notes?, pullerName? }
 */
router.post('/visit-feedback', async (req, res) => {
  try {
    const { yardId, rating, notes, pullerName } = req.body;
    if (!yardId || !rating) return res.status(400).json({ error: 'yardId and rating required' });

    const { v4: uuidv4 } = require('uuid');
    await database('yard_visit_feedback').insert({
      id: uuidv4(),
      yard_id: yardId,
      puller_name: pullerName || null,
      visit_date: new Date().toISOString().slice(0, 10),
      rating: parseInt(rating),
      notes: notes || null,
      createdAt: new Date(),
    });

    res.json({ success: true });
  } catch (err) {
    log.error({ err }, 'Error saving visit feedback');
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /attack-list/last-visit/:yardId
 * Get most recent visit feedback for a yard.
 */
router.get('/last-visit/:yardId', async (req, res) => {
  try {
    const { yardId } = req.params;
    const visit = await database('yard_visit_feedback')
      .where('yard_id', yardId)
      .orderBy('visit_date', 'desc')
      .first();

    if (!visit) return res.json({ success: true, found: false });

    const daysAgo = Math.floor((Date.now() - new Date(visit.visit_date).getTime()) / 86400000);
    res.json({
      success: true,
      found: true,
      visit: {
        daysAgo,
        rating: visit.rating,
        notes: visit.notes,
        pullerName: visit.puller_name,
        date: visit.visit_date,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /attack-list/manual
 * Parse raw text into vehicles, score them through the same engine.
 * Body: { text: "2009 Dodge Ram 1500 Silver\n09 RAM 1500\n..." }
 */
router.post('/manual', async (req, res) => {
  try {
    const { text } = req.body;
    if (!text || typeof text !== 'string') {
      return res.status(400).json({ success: false, error: 'text is required' });
    }

    const lines = text.split(/\n/).map(l => l.trim());
    if (lines.filter(l => l).length === 0) {
      return res.status(400).json({ success: false, error: 'No vehicles found in input' });
    }

    // Multi-line parsing: group metadata lines with their vehicle header
    const metaRe = /^(color|vin|section|stock|available|row|space|mileage|odometer|engine|trim|drive|trans|status|date|location|notes?)\s*[:#]/i;
    const vehicles_raw = [];
    let currentBlock = [];

    for (const line of lines) {
      if (!line) {
        // Blank line — flush current block
        if (currentBlock.length > 0) { vehicles_raw.push(currentBlock); currentBlock = []; }
        continue;
      }
      if (metaRe.test(line) && currentBlock.length > 0) {
        // Metadata line — append to current block
        currentBlock.push(line);
      } else if (/\b(?:19|20)\d{2}\b/.test(line) || /^\d{2}\s+[A-Za-z]/.test(line)) {
        // Looks like a new vehicle (has a year) — flush and start new
        if (currentBlock.length > 0) vehicles_raw.push(currentBlock);
        currentBlock = [line];
      } else if (currentBlock.length > 0) {
        // Unknown line — could be continuation, append
        currentBlock.push(line);
      } else {
        // Standalone line — try as single vehicle
        currentBlock = [line];
      }
    }
    if (currentBlock.length > 0) vehicles_raw.push(currentBlock);

    if (vehicles_raw.length > 200) {
      return res.status(400).json({ success: false, error: 'Max 200 vehicles per manual list' });
    }

    // Parse each block: first line is the vehicle, rest is metadata
    const parsed = vehicles_raw.map((block, idx) => {
      const v = parseVehicleLine(block[0], idx);
      // Merge metadata from continuation lines
      for (let i = 1; i < block.length; i++) {
        const meta = block[i];
        const vinM = meta.match(/^vin\s*:\s*([A-HJ-NPR-Z0-9]{17})/i);
        if (vinM && !v.vin) v.vin = vinM[1].toUpperCase();
        const colorM = meta.match(/^color\s*:\s*(.+)/i);
        if (colorM && !v.color) v.color = colorM[1].trim();
        const rowM = meta.match(/row\s*:\s*([A-Za-z0-9]+)/i);
        if (rowM && !v.row) v.row = rowM[1].trim();
        const stockM = meta.match(/^stock\s*[#:]?\s*:?\s*(.+)/i);
        if (stockM) v.stockNumber = stockM[1].trim();
        const engM = meta.match(/^engine\s*:\s*(.+)/i);
        if (engM && !v.engine) v.engine = engM[1].trim();
      }
      return v;
    });
    const valid = parsed.filter(v => v.year && v.make && v.model);

    if (valid.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Could not parse any vehicles. Use format: "2009 Dodge Ram 1500"',
        parsed: parsed.slice(0, 5),
      });
    }

    // Build fake yard_vehicle objects for the scoring engine
    const vehicles = valid.map(v => ({
      id: 'manual-' + uuidv4().slice(0, 8),
      year: v.year,
      make: v.make,
      model: v.model,
      trim: v.trim || null,
      color: v.color || null,
      row_number: v.row || null,
      vin: v.vin || null,
      engine: v.engine || null,
      engine_type: null,
      drivetrain: v.drivetrain || null,
      trim_level: null,
      body_style: null,
      stock_number: null,
      date_added: new Date().toISOString(),
      last_seen: new Date().toISOString(),
      active: true,
      _raw_line: v.raw,
    }));

    // VIN decode any that have VINs (batch via NHTSA)
    const withVins = vehicles.filter(v => v.vin && v.vin.length >= 11);
    if (withVins.length > 0) {
      try {
        for (const v of withVins) {
          try {
            const nhtsa = await fetch(`https://vpic.nhtsa.dot.gov/api/vehicles/decodevin/${v.vin}?format=json`);
            const data = await nhtsa.json();
            const results = data.Results || [];
            const get = (id) => {
              const r = results.find(r => r.VariableId === id);
              return r && r.Value && r.Value !== 'Not Applicable' ? r.Value : null;
            };
            if (!v.year && get(29)) v.year = parseInt(get(29));
            if (get(26)) v.make = get(26);
            if (get(28)) {
              // Use NHTSA model but strip trim suffixes to keep it clean
              const nhtsaModel = get(28);
              // Only override if parser didn't get a model, or NHTSA is more specific
              if (!v.model || v.model.toUpperCase() === nhtsaModel.split(' ')[0].toUpperCase()) {
                v.model = nhtsaModel.split(/\s+(LE|SE|XLE|SR5|LX|EX|SXT|RT|Limited|Sport|Base|Touring)\b/i)[0];
              }
            }
            if (get(38)) v.trim_level = get(38); // NHTSA var 38 = trim
            // Engine: displacement (var 13) + cylinders (var 71)
            const disp = get(13);
            const cyl = get(71);
            if (disp && !v.engine) {
              const d = parseFloat(disp);
              v.engine = (!isNaN(d) ? d.toFixed(1) : disp) + 'L' + (cyl ? ' ' + (parseInt(cyl) <= 4 ? '4-cyl' : parseInt(cyl) === 6 ? 'V6' : parseInt(cyl) === 8 ? 'V8' : cyl + '-cyl') : '');
            }
          } catch (e) { /* skip individual VIN errors */ }
        }
      } catch (e) {
        log.warn({ err: e.message }, 'Manual list VIN decode failed');
      }
    }

    const service = new AttackListService();
    const scored = await service.scoreManualVehicles(vehicles);

    // Enrich with dead inventory warnings
    const deadService = new DeadInventoryService();
    for (const vehicle of scored) {
      for (const part of (vehicle.parts || [])) {
        if (part.partNumber) {
          try {
            const warning = await deadService.getWarning(part.partNumber);
            if (warning) part.deadWarning = warning;
          } catch (e) { /* ignore */ }
        }
      }
    }

    res.json({
      success: true,
      generated_at: new Date().toISOString(),
      total_lines: vehicles_raw.length,
      parsed_count: valid.length,
      skipped_count: vehicles_raw.length - valid.length,
      vehicles: scored,
    });
  } catch (err) {
    log.error({ err }, 'Error scoring manual set list');
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── Vehicle line parser ──────────────────────────────────
const MAKE_MAP = {
  'chevy': 'Chevrolet', 'chevrolet': 'Chevrolet', 'chev': 'Chevrolet',
  'dodge': 'Dodge', 'ram': 'Ram',
  'chrysler': 'Chrysler', 'jeep': 'Jeep',
  'ford': 'Ford', 'gmc': 'GMC', 'gm': 'GMC',
  'toyota': 'Toyota', 'honda': 'Honda', 'nissan': 'Nissan',
  'bmw': 'BMW', 'mercedes': 'Mercedes-Benz', 'mercedes-benz': 'Mercedes-Benz', 'merc': 'Mercedes-Benz',
  'mazda': 'Mazda', 'kia': 'Kia', 'hyundai': 'Hyundai',
  'subaru': 'Subaru', 'mitsubishi': 'Mitsubishi',
  'infiniti': 'Infiniti', 'lexus': 'Lexus', 'acura': 'Acura',
  'cadillac': 'Cadillac', 'caddy': 'Cadillac',
  'buick': 'Buick', 'lincoln': 'Lincoln',
  'volvo': 'Volvo', 'audi': 'Audi',
  'volkswagen': 'Volkswagen', 'vw': 'Volkswagen',
  'mini': 'Mini', 'pontiac': 'Pontiac', 'saturn': 'Saturn',
  'mercury': 'Mercury', 'scion': 'Scion',
  'land rover': 'Land Rover', 'landrover': 'Land Rover',
  'porsche': 'Porsche', 'jaguar': 'Jaguar',
  'saab': 'Saab', 'fiat': 'Fiat', 'alfa': 'Alfa Romeo',
  'alfa romeo': 'Alfa Romeo', 'tesla': 'Tesla',
};

const COLOR_WORDS = new Set([
  'black', 'white', 'silver', 'gray', 'grey', 'red', 'blue', 'green',
  'gold', 'tan', 'beige', 'brown', 'orange', 'yellow', 'purple', 'maroon',
  'burgundy', 'champagne', 'bronze', 'charcoal', 'cream', 'ivory',
]);

function parseVehicleLine(line, idx) {
  const raw = line;
  // Clean up: remove leading bullets, dashes, tabs — but NOT 4-digit years
  // Old regex had \d which stripped years like "2011"
  let cleaned = line.replace(/^[\s\-•*#)\]]+/, '').trim();
  // Strip leading list numbers like "1. " or "3) " but NOT years
  cleaned = cleaned.replace(/^\d{1,2}[.)]\s+/, '').trim();
  if (!cleaned) return { raw, error: 'empty' };

  // Extract VIN if present (17-char alphanumeric, no I/O/Q)
  let vin = null;
  const vinMatch = cleaned.match(/\b([A-HJ-NPR-Z0-9]{17})\b/i);
  if (vinMatch) {
    vin = vinMatch[1].toUpperCase();
    cleaned = cleaned.replace(vinMatch[0], ' ').trim();
  }

  // Extract row/space if present (e.g., "Row C3", "Space 12", "R-C3", "Spot 4A")
  let row = null;
  const rowMatch = cleaned.match(/\b(?:row|space|spot|r-?)\s*([A-Z]?\d+[A-Z]?(?:\s*[-/]\s*[A-Z]?\d+[A-Z]?)?)\b/i);
  if (rowMatch) {
    row = rowMatch[1].toUpperCase();
    cleaned = cleaned.replace(rowMatch[0], ' ').trim();
  }

  // Extract engine displacement (e.g., "3.5L", "5.7", "EcoBoost", "Hemi")
  let engine = null;
  const engMatch = cleaned.match(/\b(\d+\.\d+)\s*[lL]?\b/);
  if (engMatch) {
    engine = engMatch[1] + 'L';
    cleaned = cleaned.replace(engMatch[0], ' ').trim();
  }
  // Named engines
  const namedEng = cleaned.match(/\b(ecoboost|hemi|coyote|vortec|duramax|cummins|powerstroke|ecotec|pentastar)\b/i);
  if (namedEng) {
    engine = (engine ? engine + ' ' : '') + namedEng[1];
    cleaned = cleaned.replace(namedEng[0], ' ').trim();
  }

  // Extract drivetrain
  let drivetrain = null;
  const dtMatch = cleaned.match(/\b(4wd|4x4|awd|2wd|fwd|rwd)\b/i);
  if (dtMatch) {
    drivetrain = dtMatch[1].toUpperCase();
    cleaned = cleaned.replace(dtMatch[0], ' ').trim();
  }

  // Extract color
  let color = null;
  const words = cleaned.toLowerCase().split(/\s+/);
  for (const w of words) {
    if (COLOR_WORDS.has(w)) {
      color = w.charAt(0).toUpperCase() + w.slice(1);
      cleaned = cleaned.replace(new RegExp('\\b' + w + '\\b', 'i'), ' ').trim();
      break;
    }
  }

  // Extract year — full (2009) or short (09)
  let year = null;
  const fullYearMatch = cleaned.match(/\b((?:19|20)\d{2})\b/);
  if (fullYearMatch) {
    year = parseInt(fullYearMatch[1]);
    cleaned = cleaned.replace(fullYearMatch[0], ' ').trim();
  } else {
    const shortYearMatch = cleaned.match(/\b(\d{2})\b/);
    if (shortYearMatch) {
      let y = parseInt(shortYearMatch[1]);
      year = y >= 70 ? 1900 + y : 2000 + y;
      cleaned = cleaned.replace(shortYearMatch[0], ' ').trim();
    }
  }

  // Normalize remaining tokens
  const tokens = cleaned.split(/[\s,/]+/).filter(t => t.length > 0);

  // Find make
  let make = null;
  let makeIdx = -1;
  for (let i = 0; i < tokens.length; i++) {
    const lower = tokens[i].toLowerCase();
    // Check two-word makes first
    if (i + 1 < tokens.length) {
      const twoWord = lower + ' ' + tokens[i + 1].toLowerCase();
      if (MAKE_MAP[twoWord]) {
        make = MAKE_MAP[twoWord];
        makeIdx = i;
        tokens.splice(i, 2);
        break;
      }
    }
    if (MAKE_MAP[lower]) {
      make = MAKE_MAP[lower];
      makeIdx = i;
      tokens.splice(i, 1);
      break;
    }
  }

  // Remaining tokens = model (take up to 3 words, stop at noise)
  const modelTokens = [];
  for (const t of tokens) {
    if (/^(ecm|bcm|abs|tipm|radio|module|oem|used|new|reman|part|engine|control)$/i.test(t)) break;
    if (/^\d+\.\d+$/.test(t)) break;
    modelTokens.push(t);
    if (modelTokens.length >= 3) break;
  }
  const model = modelTokens.join(' ') || null;

  return { raw, year, make, model, color, row, vin, engine, drivetrain, trim: null };
}

module.exports = router;
```
---
## FILE: service/routes/competitors.js
```javascript
'use strict';

const router = require('express-promise-router')();
const { log } = require('../lib/logger');
const { database } = require('../database/database');
const CompetitorMonitorService = require('../services/CompetitorMonitorService');
const SoldItemsManager = require('../managers/SoldItemsManager');

/**
 * POST /competitors/scan
 * Run competitor price monitoring scan.
 */
router.post('/scan', async (req, res) => {
  try {
    const service = new CompetitorMonitorService();
    const result = await service.scan();
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /competitors/alerts
 * Get active competitor alerts.
 */
router.get('/alerts', async (req, res) => {
  try {
    const { dismissed, limit } = req.query;
    const service = new CompetitorMonitorService();
    const alerts = await service.getAlerts({
      dismissed: dismissed === 'true',
      limit: parseInt(limit) || 50,
    });
    res.json({ success: true, alerts });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /competitors/alerts/:id/dismiss
 * Dismiss a competitor alert.
 */
router.post('/alerts/:id/dismiss', async (req, res) => {
  try {
    const service = new CompetitorMonitorService();
    const result = await service.dismiss(req.params.id);
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /competitors/gap-intel
 * Gap intelligence: parts competitors sell that we have never sold or stocked.
 * Scored by competitor revenue volume and median price.
 * Query: days (default 90), limit (default 50)
 */
router.get('/gap-intel', async (req, res) => {
  const days = parseInt(req.query.days) || 90;
  const limit = parseInt(req.query.limit) || 50;
  const sellerFilter = req.query.seller || null;

  try {
    // Exclude rebuild sellers — their data is reference intel, not competitive
    const rebuildSellers = await database('SoldItemSeller').where('type', 'rebuild').select('name');
    const rebuildNames = rebuildSellers.map(s => s.name);

    // Get competitor sold items (capped at 5000, $100+ only)
    let competitorQuery = database('SoldItem')
      .where('soldDate', '>=', database.raw(`NOW() - INTERVAL '${days} days'`))
      .where('soldPrice', '>=', 100)
      .whereNot('seller', 'dynatrack')
      .whereNot('seller', 'dynatrackracing');

    if (rebuildNames.length > 0) {
      competitorQuery = competitorQuery.whereNotIn('seller', rebuildNames);
    }

    if (sellerFilter) {
      competitorQuery = competitorQuery.where('seller', sellerFilter);
    }

    const competitorItems = await competitorQuery
      .orderBy('soldDate', 'desc')
      .limit(5000)
      .select('title', 'soldPrice', 'soldDate', 'seller', 'ebayItemId');

    // Group competitor items by normalized title
    const compGroups = {};
    for (const item of competitorItems) {
      const key = normalizeTitle(item.title);
      if (!key || key.length < 10) continue;
      if (!compGroups[key]) {
        compGroups[key] = {
          title: item.title,
          sellers: new Set(),
          count: 0,
          totalRevenue: 0,
          prices: [],
          lastSold: null,
          ebayItemId: item.ebayItemId,
        };
      }
      const g = compGroups[key];
      g.sellers.add(item.seller);
      g.count++;
      g.totalRevenue += parseFloat(item.soldPrice) || 0;
      g.prices.push(parseFloat(item.soldPrice) || 0);
      if (!g.lastSold || new Date(item.soldDate) > new Date(g.lastSold)) g.lastSold = item.soldDate;
    }

    // Build match sets from our data (PNs + partType|make|model keys)
    const yourSales = await database('YourSale').select('title').limit(25000);
    const yourListings = await database('YourListing').where('listingStatus', 'Active').select('title').limit(10000);
    const yourItems = await database('Item').whereRaw("LOWER(seller) LIKE '%dynatrack%'").select('title').limit(5000);

    const allOurTitles = [
      ...yourSales.map(s => s.title),
      ...yourListings.map(l => l.title),
      ...yourItems.map(i => i.title),
    ].filter(Boolean);
    const { pnSet: yourPNs, keySet: yourKeys } = buildMatchSets(allOurTitles);

    let dismissedTitles = new Set();
    try {
      const dismissed = await database('dismissed_intel').select('normalizedTitle');
      dismissedTitles = new Set(dismissed.map(function(d) { return d.normalizedTitle; }));
    } catch (e) { /* table may not exist yet */ }

    // Exclude items already in the_mark (actively tracked)
    let markedTitles = new Set();
    try {
      const marks = await database('the_mark').where('active', true).select('normalizedTitle');
      markedTitles = new Set(marks.map(function(m) { return m.normalizedTitle; }));
    } catch (e) { /* table may not exist yet */ }

    // Check yard_vehicle for local matches (moved BEFORE gap loop)
    let yardMakes = new Set();
    try {
      const yardVehicles = await database('yard_vehicle').where('active', true).select('make').limit(5000);
      for (const v of yardVehicles) {
        if (v.make) yardMakes.add(v.make.toUpperCase());
      }
    } catch (e) { /* yard_vehicle may not have data */ }

    // Find gaps: competitor parts that we have never sold, listed, or stocked
    const gaps = [];
    for (const [key, group] of Object.entries(compGroups)) {
      if (weAlreadySellThis(group.title, yourPNs, yourKeys)) continue;
      if (dismissedTitles.has(key)) continue;
      if (markedTitles.has(key)) continue;

      // Calculate median price
      const sorted = group.prices.sort((a, b) => a - b);
      const median = sorted.length % 2 === 0
        ? (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
        : sorted[Math.floor(sorted.length / 2)];

      // Extract part number from title - common OEM patterns
      const partNumber = extractPartNumber(group.title);

      const sellerCount = group.sellers.size;
      const isConfluence = sellerCount >= 2;
      const volumeScore = Math.min(100, (group.count / 30) * 100);
      const priceScore = Math.min(100, (median / 500) * 100);
      const partNumberScore = partNumber ? 100 : 0;
      // Confluence reshapes the weights - multi-seller validation is the strongest signal
      let score;
      if (isConfluence) {
        const confluenceScore = Math.min(100, (sellerCount / 4) * 100); // 2=50, 3=75, 4+=100
        score = Math.round(confluenceScore * 0.30 + volumeScore * 0.25 + priceScore * 0.25 + partNumberScore * 0.20);
        // Confluence floor: never below 60 if 2+ sellers agree
        score = Math.max(60, score);
      } else {
        const sellerScore = Math.min(100, (sellerCount / 3) * 100);
        score = Math.round(volumeScore * 0.35 + priceScore * 0.30 + sellerScore * 0.15 + partNumberScore * 0.20);
      }

      gaps.push({
        title: group.title,
        normalizedTitle: key,
        sellers: Array.from(group.sellers),
        soldCount: group.count,
        totalRevenue: Math.round(group.totalRevenue),
        medianPrice: Math.round(median),
        avgPrice: Math.round(group.totalRevenue / group.count),
        minPrice: Math.round(Math.min(...group.prices)),
        maxPrice: Math.round(Math.max(...group.prices)),
        lastSold: group.lastSold,
        score,
        ebayItemId: group.ebayItemId,
        partNumber: partNumber,
        partType: extractPartType(group.title),
        confluence: isConfluence,
        sellerCount: sellerCount,
        yardMatch: titleMatchesYard(group.title, yardMakes),
      });
    }

    // Sort by score descending
    gaps.sort((a, b) => b.score - a.score);

    res.json({
      success: true,
      days,
      totalGaps: gaps.length,
      gaps: gaps.slice(0, limit),
    });
  } catch (err) {
    log.error({ err }, 'Gap intel error');
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /competitors/emerging
 * Detect NEW (first-ever appearance) and ACCELERATING parts from competitor data.
 * Query: days (default 90), limit (default 40)
 */
router.get('/emerging', async (req, res) => {
  const days = parseInt(req.query.days) || 90;
  const limit = parseInt(req.query.limit) || 40;
  const sellerFilter = req.query.seller || null;

  try {
    const now = new Date();
    const cutoff = new Date(now - days * 24 * 60 * 60 * 1000);
    const midpoint = new Date(now - (days / 2) * 24 * 60 * 60 * 1000);
    const recentWindow = new Date(now - 30 * 24 * 60 * 60 * 1000);

    // Exclude rebuild sellers — their data is reference intel, not competitive
    const rebuildSellers = await database('SoldItemSeller').where('type', 'rebuild').select('name');
    const rebuildNames = rebuildSellers.map(s => s.name);

    let emergingQuery = database('SoldItem')
      .where('soldDate', '>=', cutoff)
      .where('soldPrice', '>=', 100)
      .whereNot('seller', 'dynatrack')
      .whereNot('seller', 'dynatrackracing');

    if (rebuildNames.length > 0) {
      emergingQuery = emergingQuery.whereNotIn('seller', rebuildNames);
    }

    if (sellerFilter) {
      emergingQuery = emergingQuery.where('seller', sellerFilter);
    }

    const items = await emergingQuery
      .orderBy('soldDate', 'desc')
      .limit(5000)
      .select('title', 'soldPrice', 'soldDate', 'seller', 'ebayItemId');

    const groups = {};
    for (const item of items) {
      const key = normalizeTitle(item.title);
      if (!key || key.length < 10) continue;
      if (!groups[key]) {
        groups[key] = { title: item.title, sellers: new Set(), firstSeen: new Date(item.soldDate), recentCount: 0, olderCount: 0, totalCount: 0, prices: [], ebayItemId: item.ebayItemId };
      }
      const g = groups[key];
      g.sellers.add(item.seller);
      g.totalCount++;
      g.prices.push(parseFloat(item.soldPrice) || 0);
      const soldDate = new Date(item.soldDate);
      if (soldDate < g.firstSeen) g.firstSeen = soldDate;
      if (soldDate >= midpoint) { g.recentCount++; } else { g.olderCount++; }
    }

    const olderItems = await database('SoldItem').where('soldDate', '<', cutoff).select('title').limit(10000);
    const previouslySeenTitles = new Set(olderItems.map(function(i) { return normalizeTitle(i.title); }).filter(Boolean));

    // Build match sets from our data
    const yourSales = await database('YourSale').select('title').limit(25000);
    const yourListings = await database('YourListing').where('listingStatus', 'Active').select('title').limit(10000);
    const allOurTitles = [...yourSales.map(s => s.title), ...yourListings.map(l => l.title)].filter(Boolean);
    const { pnSet: yourPNs, keySet: yourKeys } = buildMatchSets(allOurTitles);

    let dismissedTitles = new Set();
    try {
      const dismissed = await database('dismissed_intel').select('normalizedTitle');
      dismissedTitles = new Set(dismissed.map(function(d) { return d.normalizedTitle; }));
    } catch (e) { /* table may not exist yet */ }

    const emerging = [];
    for (const [key, group] of Object.entries(groups)) {
      if (weAlreadySellThis(group.title, yourPNs, yourKeys)) continue;
      if (dismissedTitles.has(key)) continue;

      const sorted = group.prices.sort(function(a, b) { return a - b; });
      const median = sorted.length % 2 === 0 ? (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2 : sorted[Math.floor(sorted.length / 2)];
      const partNumber = extractPartNumber(group.title);

      let signal = null;
      let signalStrength = 0;

      if (group.firstSeen >= recentWindow && group.totalCount <= 5 && !previouslySeenTitles.has(key)) {
        signal = 'NEW';
        const rarityScore = Math.max(0, 100 - (group.totalCount - 1) * 20);
        const priceWeight = Math.min(100, (median / 400) * 100);
        const pnBonus = partNumber ? 20 : 0;
        signalStrength = Math.min(100, rarityScore * 0.45 + priceWeight * 0.35 + pnBonus);
      } else if (group.recentCount >= 4 && group.olderCount > 0 && group.recentCount >= group.olderCount * 3) {
        signal = 'ACCEL';
        const acceleration = group.recentCount / Math.max(1, group.olderCount);
        signalStrength = Math.min(100, (acceleration / 6) * 40 + (median / 400) * 30 + (group.recentCount / 20) * 20 + (partNumber ? 10 : 0));
      }

      if (!signal) continue;

      emerging.push({
        title: group.title, partNumber, partType: extractPartType(group.title), signal, signalStrength: Math.round(signalStrength),
        sellers: Array.from(group.sellers), totalCount: group.totalCount, recentCount: group.recentCount,
        olderCount: group.olderCount, medianPrice: Math.round(median),
        totalRevenue: Math.round(group.prices.reduce(function(a, b) { return a + b; }, 0)),
        firstSeen: group.firstSeen.toISOString(), ebayItemId: group.ebayItemId,
      });
    }

    emerging.sort(function(a, b) {
      if (a.signal === 'NEW' && b.signal !== 'NEW') return -1;
      if (b.signal === 'NEW' && a.signal !== 'NEW') return 1;
      return b.signalStrength - a.signalStrength;
    });

    res.json({ success: true, days, totalEmerging: emerging.length, newCount: emerging.filter(function(e) { return e.signal === 'NEW'; }).length, accelCount: emerging.filter(function(e) { return e.signal === 'ACCEL'; }).length, emerging: emerging.slice(0, limit) });
  } catch (err) {
    log.error({ err }, 'Emerging parts error');
    res.status(500).json({ success: false, error: err.message });
  }
});

// Helper: normalize a title for fuzzy matching
function normalizeTitle(title) {
  if (!title) return '';
  return title
    .toUpperCase()
    .replace(/[^A-Z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .substring(0, 65);
}

// Known automotive makes for title parsing
var KNOWN_MAKES_UPPER = ['FORD','CHEVROLET','CHEVY','DODGE','RAM','CHRYSLER','JEEP','TOYOTA','HONDA','NISSAN','HYUNDAI','KIA','SUBARU','MAZDA','MITSUBISHI','BMW','MERCEDES','AUDI','VOLKSWAGEN','VOLVO','MINI','PORSCHE','LEXUS','ACURA','INFINITI','GENESIS','CADILLAC','BUICK','GMC','LINCOLN','PONTIAC','SATURN','OLDSMOBILE','JAGUAR','LAND ROVER','FIAT','SCION','SUZUKI','SAAB'];

/**
 * Extract a structured key from a title: "PARTTYPE|MAKE|MODEL"
 * Used for two-tier gap-intel matching instead of fuzzy word overlap.
 */
function buildTitleKey(title) {
  if (!title) return null;
  var upper = title.toUpperCase();

  var partType = extractPartType(title) || null;
  if (!partType) return null;

  var make = null;
  for (var m of KNOWN_MAKES_UPPER) {
    if (upper.includes(m)) { make = m; break; }
  }
  if (!make) return null;

  // Extract model: first non-noise word(s) after make
  var makeIdx = upper.indexOf(make);
  var afterMake = upper.substring(makeIdx + make.length).trim();
  var modelWords = [];
  var stopWords = new Set(['OEM','GENUINE','PROGRAMMED','REBUILT','PLUG','PLAY','ASSEMBLY','MODULE','UNIT','REMAN','REMANUFACTURED','NEW','USED','TESTED','ENGINE','CONTROL','COMPUTER','ELECTRONIC','ANTI','LOCK','BRAKE','PUMP','FUSE','POWER','BOX','BODY','TRANSMISSION','ECU','ECM','PCM','BCM','TCM','ABS','TIPM','SRS','HVAC','INSTRUMENT','CLUSTER','SPEEDOMETER','RADIO','HEAD','STEREO','AMPLIFIER','THROTTLE','INTAKE','ALTERNATOR','STARTER','TURBO','CAMERA','SENSOR','WORKING','FAST','FREE','SHIPPING','SHIP']);
  for (var w of afterMake.replace(/[^A-Z0-9\s]/g, '').split(/\s+/)) {
    if (!w || w.length < 2) continue;
    if (/^\d{4}$/.test(w)) continue; // skip years
    if (stopWords.has(w)) continue;
    modelWords.push(w);
    if (modelWords.length >= 2) break;
  }
  var model = modelWords.join(' ') || null;
  if (!model) return null;

  return partType + '|' + make + '|' + model;
}

/**
 * Build PN and title-key sets from an array of title strings.
 * Returns { pnSet: Set<string>, keySet: Set<string> }
 */
function buildMatchSets(titles) {
  var pnSet = new Set();
  var keySet = new Set();
  for (var title of titles) {
    if (!title) continue;
    // Extract part number
    var pn = extractPartNumber(title);
    if (pn) {
      var pnBase = pn.replace(/[-\s]/g, '').replace(/[A-Z]{1,2}$/, '');
      if (pnBase.length >= 5) pnSet.add(pnBase);
      pnSet.add(pn.replace(/[-\s]/g, ''));
    }
    // Extract title key
    var key = buildTitleKey(title);
    if (key) keySet.add(key);
  }
  return { pnSet, keySet };
}

/**
 * Two-tier matching: do we already sell this part?
 * Tier 1: PN match (if extractable). Tier 2: strict partType|make|model key match.
 */
function weAlreadySellThis(competitorTitle, yourPNs, yourKeys) {
  // Tier 1: check by part number
  var pn = extractPartNumber(competitorTitle);
  if (pn) {
    var pnClean = pn.replace(/[-\s]/g, '');
    var pnBase = pnClean.replace(/[A-Z]{1,2}$/, '');
    if (yourPNs.has(pnClean) || (pnBase.length >= 5 && yourPNs.has(pnBase))) return true;
  }

  // Tier 2: strict partType|make|model key
  var key = buildTitleKey(competitorTitle);
  if (key && yourKeys.has(key)) return true;

  // No match — this is a gap
  return false;
}

// Extract OEM part number from title
// Matches patterns like: CT43-2C405-AB, 39132-26BL0, 8T0-035-223AN, 68059524AI, BBM466A20
function extractPartNumber(title) {
  if (!title) return null;

  // Common OEM part number patterns (alphanumeric with dashes/spaces, 6+ chars)
  const patterns = [
    /\b([A-Z]{1,4}\d{1,4}[-\s]?\d{2,5}[-\s]?[A-Z0-9]{1,5})\b/i,    // CT43-2C405-AB, 8T0 035 223AN
    /\b(\d{4,6}[-]?[A-Z0-9]{2,6}[-]?[A-Z0-9]{0,4})\b/i,             // 39132-26BL0, 68059524AI
    /\b([A-Z]{2,4}\d{3,6}[A-Z]?\d{0,2})\b/i,                         // BBM466A20, MR578042
    /\b(\d{2,3}[-]\d{4,5}[-]\d{3,5}[-]?[A-Z]{0,2})\b/,               // 84010-48180, 99211-F1000
  ];

  for (const pattern of patterns) {
    const match = title.match(pattern);
    if (match && match[1] && match[1].length >= 6) {
      // Filter out obvious non-part-numbers (years, mileage)
      const candidate = match[1].replace(/\s+/g, '-');
      if (/^(19|20)\d{2}$/.test(candidate)) continue; // skip years
      if (/^\d{1,3},?\d{3}$/.test(candidate)) continue; // skip mileage
      return candidate.toUpperCase();
    }
  }
  return null;
}

var PART_TYPES = [
  { keywords: ['ECU', 'ECM', 'PCM', 'ENGINE CONTROL', 'ENGINE COMPUTER'], type: 'ECM' },
  { keywords: ['BCM', 'BODY CONTROL'], type: 'BCM' },
  { keywords: ['TCM', 'TRANSMISSION CONTROL', 'TRANS CONTROL'], type: 'TCM' },
  { keywords: ['ABS', 'ANTI LOCK', 'ANTILOCK', 'BRAKE PUMP', 'BRAKE MODULE'], type: 'ABS' },
  { keywords: ['TIPM', 'TOTALLY INTEGRATED', 'POWER MODULE'], type: 'TIPM' },
  { keywords: ['FUSE BOX', 'FUSE RELAY', 'JUNCTION BOX', 'RELAY BOX'], type: 'FUSE BOX' },
  { keywords: ['AMPLIFIER', 'AMP ', 'AUDIO AMP', 'BOSE', 'BANG', 'HARMAN', 'JBL', 'ALPINE', 'INFINITY'], type: 'AMP' },
  { keywords: ['RADIO', 'STEREO', 'HEAD UNIT', 'INFOTAINMENT', 'NAVIGATION'], type: 'RADIO' },
  { keywords: ['CLUSTER', 'INSTRUMENT CLUSTER', 'SPEEDOMETER', 'GAUGE'], type: 'CLUSTER' },
  { keywords: ['THROTTLE BODY', 'THROTTLE ASSY'], type: 'THROTTLE' },
  { keywords: ['HVAC', 'CLIMATE CONTROL', 'A/C CONTROL', 'HEATER CONTROL'], type: 'HVAC' },
  { keywords: ['AIRBAG', 'AIR BAG', 'SRS', 'RESTRAINT'], type: 'AIRBAG' },
  { keywords: ['STEERING MODULE', 'STEERING CONTROL', 'EPS', 'POWER STEERING CONTROL'], type: 'STEERING' },
  { keywords: ['CAMERA', 'BACKUP CAM', 'REAR VIEW', 'SURROUND VIEW'], type: 'CAMERA' },
  { keywords: ['BLIND SPOT', 'LANE ASSIST', 'LANE DEPARTURE'], type: 'SENSOR' },
  { keywords: ['LIFTGATE', 'LIFT GATE', 'TAILGATE MODULE'], type: 'LIFTGATE' },
  { keywords: ['PARKING SENSOR', 'PARK ASSIST', 'PDC'], type: 'SENSOR' },
  { keywords: ['TRANSFER CASE MODULE', 'TRANSFER CASE CONTROL'], type: 'XFER' },
];

function extractPartType(title) {
  if (!title) return null;
  var upper = title.toUpperCase();
  for (var i = 0; i < PART_TYPES.length; i++) {
    for (var j = 0; j < PART_TYPES[i].keywords.length; j++) {
      if (upper.includes(PART_TYPES[i].keywords[j])) return PART_TYPES[i].type;
    }
  }
  return null;
}

/**
 * POST /competitors/cleanup
 * Purge sold data older than 90 days for all sellers EXCEPT importapart and pro-rebuild.
 * These two are permanent fixtures - their data is never purged.
 */
router.post('/cleanup', async (req, res) => {
  const protectedSellers = ['importapart', 'pro-rebuild'];
  const retentionDays = parseInt(req.query.days) || 90;

  try {
    const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);

    const result = await database('SoldItem')
      .where('soldDate', '<', cutoff)
      .whereNotIn('seller', protectedSellers)
      .del();

    res.json({
      success: true,
      purged: result,
      retentionDays,
      protectedSellers,
      cutoffDate: cutoff.toISOString(),
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /competitors/auto-scrape
 * Emergency override — scrapes ALL enabled sellers at once.
 * Prefer drip cron (CompetitorDripRunner, 4x daily) for normal operations.
 * Skips sellers scraped in the last 20 hours.
 */
router.post('/auto-scrape', async (req, res) => {
  log.warn('Manual auto-scrape triggered — prefer drip cron for rate limiting');
  try {
    const sellers = await database('SoldItemSeller').where('enabled', true);
    const results = [];
    const skipWindow = new Date(Date.now() - 20 * 60 * 60 * 1000);

    for (const seller of sellers) {
      if (seller.lastScrapedAt && new Date(seller.lastScrapedAt) > skipWindow) {
        results.push({ seller: seller.name, skipped: true, reason: 'scraped recently' });
        continue;
      }

      const manager = new SoldItemsManager();
      try {
        const result = await manager.scrapeCompetitor({
          seller: seller.name,
          categoryId: '6030',
          maxPages: 3,
        });

        await database('SoldItemSeller').where('name', seller.name).update({
          lastScrapedAt: new Date(),
          itemsScraped: (seller.itemsScraped || 0) + result.stored,
          updatedAt: new Date(),
        });

        results.push({ seller: seller.name, ...result });
      } catch (err) {
        log.error({ err: err.message, seller: seller.name }, 'Auto-scrape failed for seller');
        results.push({ seller: seller.name, error: err.message });
      } finally {
        try { await manager.scraper.closeBrowser(); } catch (e) {}
      }
    }

    res.json({ success: true, results });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/dismiss', async (req, res) => {
  const { title } = req.body;
  if (!title) return res.status(400).json({ success: false, error: 'title required' });
  try {
    const key = normalizeTitle(title);
    const exists = await database('dismissed_intel').where('normalizedTitle', key).first();
    if (!exists) {
      await database('dismissed_intel').insert({ normalizedTitle: key, originalTitle: title, dismissedAt: new Date() });
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/undismiss', async (req, res) => {
  const { title } = req.body;
  if (!title) return res.status(400).json({ success: false, error: 'title required' });
  try {
    const key = normalizeTitle(title);
    await database('dismissed_intel').where('normalizedTitle', key).del();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /competitors/mark
 * Add an item to The Mark (want list).
 * Body: { title, partNumber, partType, medianPrice, sourceSignal, sourceSellers, score }
 */
router.post('/mark', async (req, res) => {
  const { title, partNumber, partType, medianPrice, sourceSignal, sourceSellers, score } = req.body;
  if (!title) return res.status(400).json({ success: false, error: 'title required' });

  try {
    const key = normalizeTitle(title);
    const exists = await database('the_mark').where('normalizedTitle', key).first();
    if (exists) {
      // Reactivate if previously graduated
      if (!exists.active) {
        await database('the_mark').where('normalizedTitle', key).update({
          active: true,
          graduatedAt: null,
          graduatedReason: null,
          updatedAt: new Date(),
        });
      }
      return res.json({ success: true, exists: true, id: exists.id });
    }

    const inserted = await database('the_mark').insert({
      normalizedTitle: key,
      originalTitle: title,
      partNumber: partNumber || null,
      partType: partType || null,
      medianPrice: medianPrice || null,
      sourceSignal: sourceSignal || 'gap-intel',
      sourceSellers: sourceSellers || null,
      scoreAtMark: score || null,
      source: 'PERCH',
      active: true,
      markedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    }).returning('id');

    res.json({ success: true, id: inserted[0]?.id || inserted[0] });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /competitors/marks
 * Get all active marks. Query: all=true to include graduated.
 */
router.get('/marks', async (req, res) => {
  try {
    const showAll = req.query.all === 'true';
    let query = database('the_mark').orderBy('markedAt', 'desc');
    if (!showAll) {
      query = query.where('active', true);
    }
    const marks = await query.limit(200);

    // Check which marks have matching vehicles in yards right now
    let yardMakes = new Set();
    try {
      const yardVehicles = await database('yard_vehicle').select('make').limit(5000);
      for (const v of yardVehicles) {
        if (v.make) yardMakes.add(v.make.toUpperCase());
      }
    } catch (e) {}

    // Check which marks have been listed/sold (candidates for auto-graduation)
    const yourSales = await database('YourSale').select('title').limit(25000);
    const yourSoldTitles = new Set(yourSales.map(function(s) { return normalizeTitle(s.title); }).filter(Boolean));
    const yourListings = await database('YourListing').where('listingStatus', 'Active').select('title').limit(10000);
    const yourListingTitles = new Set(yourListings.map(function(l) { return normalizeTitle(l.title); }).filter(Boolean));

    const enriched = marks.map(function(m) {
      var yardMatch = titleMatchesYard(m.originalTitle, yardMakes);
      var inYourInventory = matchesAny(m.normalizedTitle, yourListingTitles);
      var youSoldIt = matchesAny(m.normalizedTitle, yourSoldTitles);

      return {
        ...m,
        yardMatch: yardMatch,
        inYourInventory: inYourInventory,
        youSoldIt: youSoldIt,
        status: !m.active ? 'graduated' : youSoldIt ? 'sold' : inYourInventory ? 'listed' : yardMatch ? 'in-yard' : 'hunting',
      };
    });

    res.json({ success: true, marks: enriched, total: enriched.length });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * DELETE /competitors/mark/:id
 * Remove an item from The Mark.
 */
router.delete('/mark/:id', async (req, res) => {
  try {
    await database('the_mark').where('id', req.params.id).del();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * PATCH /competitors/mark/:id
 * Update notes on a mark.
 */
router.patch('/mark/:id', async (req, res) => {
  try {
    const { notes } = req.body;
    await database('the_mark').where('id', req.params.id).update({ notes, updatedAt: new Date() });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /competitors/mark/graduate
 * Auto-graduate marks that you've now sold. Uses shared graduateMarks() function.
 */
router.post('/mark/graduate', async (req, res) => {
  try {
    const graduated = await graduateMarks();
    res.json({ success: true, graduated });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /competitors/mark/check-vehicle
 * Check if a make/model matches any active marks. Used by attack list.
 * Query: make, model, year (all optional)
 */
router.get('/mark/check-vehicle', async (req, res) => {
  const { make, model, year } = req.query;
  if (!make) return res.json({ success: true, matches: [] });

  try {
    const activeMarks = await database('the_mark').where('active', true);
    const makeUpper = make.toUpperCase();
    const modelUpper = model ? model.toUpperCase() : null;

    const matches = activeMarks.filter(function(m) {
      var title = m.originalTitle.toUpperCase();
      if (!title.includes(makeUpper)) return false;
      if (modelUpper && !title.includes(modelUpper)) return false;
      if (year && !title.includes(String(year))) return false;
      return true;
    }).map(function(m) {
      return {
        id: m.id,
        title: m.originalTitle,
        partType: m.partType,
        partNumber: m.partNumber,
        medianPrice: m.medianPrice,
        markedAt: m.markedAt,
      };
    });

    res.json({ success: true, matches });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /competitors/seed-defaults
 * Add default competitors if not already tracked.
 */
router.post('/seed-defaults', async (req, res) => {
  const defaults = ['importapart', 'pro-rebuild'];
  const added = [];
  for (const name of defaults) {
    try {
      const exists = await database('SoldItemSeller').where('name', name).first();
      if (!exists) {
        await database('SoldItemSeller').insert({
          name,
          enabled: true,
          itemsScraped: 0,
          createdAt: new Date(),
          updatedAt: new Date(),
        });
        added.push(name);
      }
    } catch (e) { /* ignore duplicate */ }
  }
  res.json({ success: true, added });
});

/**
 * DELETE /competitors/:sellerId
 * Remove a seller from tracking. Optionally delete their sold data.
 * Query: deleteData=true to also remove their SoldItem records
 */
router.delete('/:sellerId', async (req, res) => {
  const sellerName = req.params.sellerId.toLowerCase().trim();
  const deleteData = req.query.deleteData === 'true';

  try {
    // Remove from SoldItemSeller
    const deleted = await database('SoldItemSeller').where('name', sellerName).del();

    let itemsDeleted = 0;
    if (deleteData) {
      const result = await database('SoldItem').where('seller', sellerName).del();
      itemsDeleted = result;
    }

    res.json({
      success: true,
      seller: sellerName,
      removed: deleted > 0,
      itemsDeleted,
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /competitors/:sellerId/scrape
 * Trigger scrape for a specific competitor seller. Runs in background.
 */
router.post('/:sellerId/scrape', async (req, res) => {
  const sellerName = req.params.sellerId.toLowerCase().trim();
  const { pages = 3 } = req.query;

  // Auto-add seller to SoldItemSeller if not exists
  try {
    const exists = await database('SoldItemSeller').where('name', sellerName).first();
    if (!exists) {
      await database('SoldItemSeller').insert({ name: sellerName, enabled: true, itemsScraped: 0, createdAt: new Date(), updatedAt: new Date() });
    }
  } catch (e) { /* ignore duplicate */ }

  res.json({ started: true, seller: sellerName, maxPages: parseInt(pages) });

  // Run in background
  const manager = new SoldItemsManager();
  try {
    const result = await manager.scrapeCompetitor({
      seller: sellerName,
      categoryId: '6030',
      maxPages: parseInt(pages),
    });
    log.info({ seller: sellerName, result }, 'Manual competitor scrape complete');

    // Update seller stats (was missing — #7)
    try {
      await database('SoldItemSeller').where('name', sellerName).update({
        lastScrapedAt: new Date(),
        itemsScraped: database.raw('"itemsScraped" + ?', [result.stored]),
        updatedAt: new Date(),
      });
    } catch (e) { log.warn({ err: e.message, seller: sellerName }, 'Could not update seller stats'); }
  } catch (err) {
    log.error({ err: err.message, seller: sellerName }, 'Manual competitor scrape failed');
  } finally {
    try { await manager.scraper.closeBrowser(); } catch (e) {}
  }
});

/**
 * GET /competitors/:sellerId/best-sellers
 * Best sellers report from scraped sold items.
 */
router.get('/:sellerId/best-sellers', async (req, res) => {
  const sellerId = req.params.sellerId.toLowerCase().trim();
  const days = parseInt(req.query.days) || 90;

  try {
    // Get all sold items for this seller
    const items = await database('SoldItem')
      .where('seller', sellerId)
      .where('soldDate', '>=', database.raw(`NOW() - INTERVAL '${days} days'`))
      .orderBy('soldPrice', 'desc')
      .select('title', 'soldPrice', 'soldDate', 'ebayItemId', 'condition', 'manufacturerPartNumber');

    // Group by approximate title (first 40 chars) to find repeated sellers
    const groups = {};
    for (const item of items) {
      const key = normalizeTitle(item.title);
      if (!groups[key]) {
        groups[key] = { title: item.title, count: 0, totalRevenue: 0, prices: [], lastSold: null, pn: item.manufacturerPartNumber, ebayItemId: item.ebayItemId };
      }
      const g = groups[key];
      g.count++;
      g.totalRevenue += parseFloat(item.soldPrice) || 0;
      g.prices.push(parseFloat(item.soldPrice) || 0);
      if (!g.lastSold || new Date(item.soldDate) > new Date(g.lastSold)) g.lastSold = item.soldDate;
    }

    // Build sorted list by revenue
    const bestSellers = Object.values(groups)
      .map(g => ({
        title: g.title,
        partNumber: g.pn || null,
        soldCount: g.count,
        totalRevenue: Math.round(g.totalRevenue),
        avgPrice: Math.round(g.totalRevenue / g.count),
        minPrice: Math.round(Math.min(...g.prices)),
        maxPrice: Math.round(Math.max(...g.prices)),
        lastSold: g.lastSold,
        velocity: Math.round(g.count / (days / 7) * 10) / 10, // per week
        ebayItemId: g.ebayItemId || null,
      }))
      .sort((a, b) => b.totalRevenue - a.totalRevenue);

    res.json({
      success: true,
      seller: sellerId,
      days,
      totalSold: items.length,
      totalRevenue: Math.round(items.reduce((s, i) => s + (parseFloat(i.soldPrice) || 0), 0)),
      uniqueProducts: bestSellers.length,
      bestSellers: bestSellers.slice(0, 100),
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /competitors/sellers
 * List all tracked competitor sellers with stats.
 */
router.get('/sellers', async (req, res) => {
  try {
    const sellers = await database('SoldItemSeller').orderBy('name');

    // Single grouped query instead of N+1
    const counts = await database('SoldItem')
      .select('seller')
      .count('* as count')
      .groupBy('seller');
    const countMap = {};
    for (const c of counts) {
      countMap[c.seller] = parseInt(c.count || 0);
    }

    var withCounts = sellers.map(function(s) {
      var hoursAgo = s.lastScrapedAt ? Math.floor((Date.now() - new Date(s.lastScrapedAt).getTime()) / 3600000) : null;
      var scrapeAlert = null;
      if (s.enabled && (!s.lastScrapedAt || hoursAgo > 48)) {
        scrapeAlert = !s.lastScrapedAt ? 'Never scraped' : 'Last scrape ' + Math.floor(hoursAgo / 24) + 'd ago - may be failing';
      }
      return { ...s, soldItemCount: countMap[s.name] || 0, scrapeAlert: scrapeAlert };
    });

    var alerts = withCounts.filter(function(s) { return s.scrapeAlert; }).map(function(s) { return { seller: s.name, message: s.scrapeAlert }; });

    res.json({ success: true, sellers: withCounts, scrapeAlerts: alerts });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Check if a normalized title matches any title in a Set (word overlap >= 80%)
function matchesAny(normalizedTitle, titleSet) {
  if (!normalizedTitle || titleSet.size === 0) return false;
  const words = normalizedTitle.split(/\s+/).filter(w => w.length > 2);
  if (words.length === 0) return false;
  for (const candidate of titleSet) {
    const cWords = candidate.split(/\s+/).filter(w => w.length > 2);
    if (cWords.length === 0) continue;
    let matches = 0;
    for (const w of words) {
      if (cWords.includes(w)) matches++;
    }
    const overlap = matches / Math.max(words.length, 1);
    if (overlap >= 0.8) return true;
  }
  return false;
}

function titleMatchesYard(title, yardMakes) {
  if (!title || yardMakes.size === 0) return false;
  var upper = title.toUpperCase();
  for (var make of yardMakes) {
    if (make.length >= 3 && upper.includes(make)) return true;
  }
  return false;
}

// Weekly competitor scrape — Sunday 8pm UTC
// Rewired from dead FindingsAPI to SoldItemsScraper (Playwright) in Phase 2.5
// Also runs mark graduation after fresh data arrives
async function graduateMarks() {
  try {
    const activeMarks = await database('the_mark').where('active', true);
    const yListings = await database('YourListing').where('listingStatus', 'Active').select('title').limit(25000);
    const yListingTitles = new Set(yListings.map(function(l) { return normalizeTitle(l.title); }).filter(Boolean));

    let graduated = 0;
    for (const mark of activeMarks) {
      if (matchesAny(mark.normalizedTitle, yListingTitles)) {
        await database('the_mark').where('id', mark.id).update({
          active: false,
          graduatedAt: new Date(),
          graduatedReason: 'Listed - part sourced and in inventory',
          updatedAt: new Date(),
        });
        log.info({ mark: mark.originalTitle }, 'Auto-graduated mark - listed');
        graduated++;
      }
    }
    return graduated;
  } catch (gradErr) {
    log.error({ err: gradErr.message }, 'Auto-graduation check failed');
    return 0;
  }
}

// REMOVED: Sunday 8pm blast-all-sellers cron.
// Replaced by CompetitorDripRunner (4x daily, 1 seller per run, registered in index.js).
// graduateMarks() runs daily at midnight via index.js drip cron.

module.exports = router;
```
---
## FILE: service/routes/yards.js
```javascript
'use strict';

const { log } = require('../lib/logger');
const router = require('express-promise-router')();
const LKQScraper = require('../scrapers/LKQScraper');
const { database } = require('../database/database');
const { enrichYard } = require('../services/PostScrapeService');

// In-memory scrape status tracking
let scrapeStatus = { running: false, started_at: null, finished_at: null, error: null };

/**
 * Yard Routes
 * 
 * GET  /yards              - List all yards
 * GET  /yards/:id/vehicles - Get vehicles at a yard
 * POST /yards/scrape/lkq   - Trigger LKQ scrape for all NC locations (manual trigger)
 * POST /yards/scrape/:id   - Trigger scrape for a specific yard
 */

// Simple test endpoint
router.get('/ping', async (req, res) => {
  res.json({ ok: true, time: new Date().toISOString() });
});

// List all yards
router.get('/', async (req, res) => {
  try {
    const yards = await database('yard')
      .orderBy('flagged', 'asc')
      .orderBy('visit_frequency', 'asc')
      .orderBy('distance_from_base', 'asc');
    res.json(yards);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get vehicles at a specific yard
router.get('/:id/vehicles', async (req, res) => {
  const { id } = req.params;
  const { make, model, year, active = 'true' } = req.query;

  let query = database('yard_vehicle').where('yard_id', id);

  if (active === 'true') query = query.where('active', true);
  if (year) query = query.where('year', year);
  if (make) query = query.whereIlike('make', `%${make}%`);
  if (model) query = query.whereIlike('model', `%${model}%`);

  const vehicles = await query
    .orderBy('date_added', 'desc')
    .orderBy('make', 'asc')
    .orderBy('model', 'asc');

  res.json(vehicles);
});

// Trigger LKQ scrape for all NC locations
router.post('/scrape/lkq', async (req, res) => {
  if (scrapeStatus.running) {
    return res.json({ message: 'Scrape already in progress', already_running: true, started_at: scrapeStatus.started_at });
  }

  log.info('Manual LKQ scrape triggered');
  scrapeStatus = { running: true, started_at: new Date().toISOString(), finished_at: null, error: null };

  // Run async - don't wait for it to finish
  const scraper = new LKQScraper();
  scraper.scrapeAll()
    .then(() => {
      scrapeStatus.running = false;
      scrapeStatus.finished_at = new Date().toISOString();
    })
    .catch(err => {
      log.error({ err }, 'LKQ scrape failed');
      scrapeStatus.running = false;
      scrapeStatus.finished_at = new Date().toISOString();
      scrapeStatus.error = err.message;
    });

  res.json({
    message: 'LKQ scrape started for all 4 NC locations',
    locations: ['LKQ Raleigh', 'LKQ Durham', 'LKQ Greensboro', 'LKQ East NC']
  });
});

// Get current scrape status (for polling)
router.get('/scrape/status', async (req, res) => {
  res.json(scrapeStatus);
});

// Trigger scrape for a specific yard by ID
router.post('/scrape/:id', async (req, res) => {
  const { id } = req.params;
  
  const yard = await database('yard').where('id', id).first();
  if (!yard) {
    return res.status(404).json({ error: 'Yard not found' });
  }

  if (yard.scrape_method === 'none') {
    return res.status(400).json({ error: 'This yard does not support scraping' });
  }

  log.info({ yard: yard.name }, `Manual scrape triggered for ${yard.name}`);

  // Helper: run scraper then enrichment pipeline in background
  async function scrapeAndEnrich(scrapePromise) {
    try {
      await scrapePromise;
    } catch (err) {
      log.error({ err }, `Scrape failed for ${yard.name}`);
    }
    try {
      const enrichStats = await enrichYard(yard.id);
      log.info({ yard: yard.name, ...enrichStats }, `Post-scrape enrichment complete for ${yard.name}`);
    } catch (err) {
      log.error({ err: err.message }, `Post-scrape enrichment failed for ${yard.name}`);
    }
  }

  if (yard.chain === 'LKQ') {
    const scraper = new LKQScraper();
    const location = scraper.locations.find(l => l.name === yard.name);
    if (location) {
      scrapeAndEnrich(scraper.scrapeLocation(location));
    }
  } else if (yard.chain === 'Foss') {
    const FossScraper = require('../scrapers/FossScraper');
    const scraper = new FossScraper();
    const location = scraper.locations.find(l => l.name === yard.name);
    if (location) {
      scrapeAndEnrich(scraper.scrapeLocation(location));
    }
  } else if (yard.chain === 'Pull-A-Part') {
    const PullAPartScraper = require('../scrapers/PullAPartScraper');
    const scraper = new PullAPartScraper();
    scrapeAndEnrich(scraper.scrapeYard(yard));
  } else if (yard.chain === 'Carolina PNP') {
    const CarolinaPickNPullScraper = require('../scrapers/CarolinaPickNPullScraper');
    const scraper = new CarolinaPickNPullScraper();
    scrapeAndEnrich(scraper.scrapeYard(yard));
  } else if (yard.chain === 'upullandsave') {
    const UPullAndSaveScraper = require('../scrapers/UPullAndSaveScraper');
    const scraper = new UPullAndSaveScraper();
    scrapeAndEnrich(scraper.scrapeYard(yard));
  } else if (yard.chain === 'chesterfield') {
    const ChesterfieldScraper = require('../scrapers/ChesterfieldScraper');
    const scraper = new ChesterfieldScraper();
    scrapeAndEnrich(scraper.scrapeYard(yard));
  } else if (yard.chain === 'pickapartva') {
    const PickAPartVAScraper = require('../scrapers/PickAPartVAScraper');
    const scraper = new PickAPartVAScraper();
    scrapeAndEnrich(scraper.scrapeYard(yard));
  }

  res.json({ message: `Scrape + enrichment started for ${yard.name}` });
});

// Get scrape status / last scrape info for all yards
router.get('/status', async (req, res) => {
  try {
    const yards = await database('yard')
      .select('id', 'name', 'chain', 'scrape_method', 'last_scraped', 'visit_frequency', 'flagged', 'flag_reason')
      .orderBy('visit_frequency', 'asc')
      .orderBy('distance_from_base', 'asc');

    // Get vehicle counts per yard
    const counts = await database('yard_vehicle')
      .where('active', true)
      .groupBy('yard_id')
      .select('yard_id')
      .count('* as vehicle_count');

    const countMap = {};
    counts.forEach(c => { countMap[c.yard_id] = parseInt(c.vehicle_count); });

    const result = yards.map(y => ({
      ...y,
      vehicle_count: countMap[y.id] || 0,
    }));

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message, stack: err.stack });
  }
});

// Scrape health dashboard
router.get('/scrape-health', async (req, res) => {
  try {
    const yards = await database('yard')
      .where('enabled', true)
      .where(function() { this.where('flagged', false).orWhereNull('flagged'); })
      .select('id', 'name', 'chain', 'last_scraped')
      .orderBy('name');

    const yardIds = yards.map(y => y.id);

    // Vehicle stats per yard
    const stats = await database('yard_vehicle')
      .whereIn('yard_id', yardIds)
      .where('active', true)
      .groupBy('yard_id')
      .select('yard_id')
      .count('* as total_active')
      .max('date_added as newest_date_added')
      .max({ newest_created_at: 'createdAt' });

    const statsMap = {};
    stats.forEach(s => { statsMap[s.yard_id] = s; });

    // New vehicles per yard from last scrape (within 1hr window of last_scraped)
    const newCounts = await Promise.all(yards.map(async (y) => {
      if (!y.last_scraped) return { yard_id: y.id, new_vehicles_last_scrape: 0 };
      const window = new Date(new Date(y.last_scraped).getTime() - 60 * 60 * 1000);
      const count = await database('yard_vehicle')
        .where('yard_id', y.id)
        .where('createdAt', '>=', window)
        .where('createdAt', '<=', y.last_scraped)
        .count('* as cnt')
        .first();
      return { yard_id: y.id, new_vehicles_last_scrape: parseInt(count.cnt) || 0 };
    }));
    const newMap = {};
    newCounts.forEach(n => { newMap[n.yard_id] = n.new_vehicles_last_scrape; });

    // Recent scrape_log entries (last 5 per yard)
    let logMap = {};
    try {
      const logs = await database('scrape_log')
        .whereIn('yard_id', yardIds)
        .orderBy('scraped_at', 'desc')
        .limit(yardIds.length * 5);
      for (const l of logs) {
        if (!logMap[l.yard_id]) logMap[l.yard_id] = [];
        if (logMap[l.yard_id].length < 5) logMap[l.yard_id].push(l);
      }
    } catch (e) { /* scrape_log may not exist yet */ }

    const result = yards.map(y => {
      const s = statsMap[y.id] || {};
      const hoursSince = y.last_scraped
        ? Math.round((Date.now() - new Date(y.last_scraped).getTime()) / 3600000 * 10) / 10
        : null;

      let status = 'unknown';
      if (!y.last_scraped || hoursSince > 30) status = 'critical';
      else if (hoursSince > 18) status = 'stale';
      else if ((newMap[y.id] || 0) === 0) status = 'warning';
      else status = 'healthy';

      return {
        id: y.id,
        name: y.name,
        chain: y.chain,
        last_scraped: y.last_scraped,
        hours_since_scrape: hoursSince,
        new_vehicles_last_scrape: newMap[y.id] || 0,
        total_active: parseInt(s.total_active) || 0,
        newest_date_added: s.newest_date_added,
        newest_created_at: s.newest_created_at,
        status,
        recent_logs: logMap[y.id] || [],
      };
    });

    const summary = {
      total: result.length,
      healthy: result.filter(r => r.status === 'healthy').length,
      warning: result.filter(r => r.status === 'warning').length,
      stale: result.filter(r => r.status === 'stale').length,
      critical: result.filter(r => r.status === 'critical').length,
    };

    res.json({ success: true, summary, yards: result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Log a yard visit with feedback
router.post('/:id/feedback', async (req, res) => {
  const { id } = req.params;
  const { puller_name, rating, notes } = req.body;
  const { v4: uuidv4 } = require('uuid');

  const yard = await database('yard').where('id', id).first();
  if (!yard) return res.status(404).json({ error: 'Yard not found' });

  await database('yard_visit_feedback').insert({
    id: uuidv4(),
    yard_id: id,
    puller_name,
    visit_date: new Date().toISOString().split('T')[0],
    rating,
    notes,
    createdAt: new Date(),
  });

  // Update last_visited and avg_rating on yard
  const feedbacks = await database('yard_visit_feedback')
    .where('yard_id', id)
    .whereNotNull('rating');

  const avgRating = feedbacks.reduce((sum, f) => sum + f.rating, 0) / feedbacks.length;

  await database('yard')
    .where('id', id)
    .update({ 
      last_visited: new Date(), 
      avg_rating: avgRating.toFixed(2),
      updatedAt: new Date() 
    });

  res.json({ message: 'Feedback recorded', avg_rating: avgRating.toFixed(2) });
});

module.exports = router;
```
---
## FILE: service/routes/stale-inventory.js
```javascript
'use strict';

const router = require('express-promise-router')();
const { log } = require('../lib/logger');
const StaleInventoryService = require('../services/StaleInventoryService');
const ReturnIntakeService = require('../services/ReturnIntakeService');
const RestockService = require('../services/RestockService');

/**
 * POST /stale-inventory/run
 * Trigger stale inventory automation scan.
 * Applies scheduled price reductions via TradingAPI.
 */
router.post('/run', async (req, res) => {
  try {
    const service = new StaleInventoryService();
    // Run in background
    service.runAutomation().catch(err => {
      log.error({ err }, 'Stale inventory automation failed');
    });
    res.json({ success: true, message: 'Stale inventory automation started' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /stale-inventory/actions
 * Get history of stale inventory actions taken.
 */
router.get('/actions', async (req, res) => {
  try {
    const { database } = require('../database/database');
    const { limit = 50, page = 1, tier } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    let query = database('stale_inventory_action').orderBy('createdAt', 'desc');
    if (tier) query = query.where('tier', tier);

    const [actions, countResult] = await Promise.all([
      query.clone().limit(parseInt(limit)).offset(offset),
      query.clone().count('* as total').first(),
    ]);

    res.json({
      success: true,
      actions,
      total: parseInt(countResult?.total || 0),
      page: parseInt(page),
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// === Return Intake ===

/**
 * POST /stale-inventory/returns
 * Log a returned part and auto-queue relist.
 */
router.post('/returns', async (req, res) => {
  try {
    const service = new ReturnIntakeService();
    const result = await service.intakeReturn(req.body);
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /stale-inventory/returns/pending
 * Get all pending relists.
 */
router.get('/returns/pending', async (req, res) => {
  try {
    const service = new ReturnIntakeService();
    const returns = await service.getPendingRelists();
    res.json({ success: true, returns });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /stale-inventory/returns/:id/relisted
 * Mark a return as relisted.
 */
router.post('/returns/:id/relisted', async (req, res) => {
  try {
    const service = new ReturnIntakeService();
    const result = await service.markRelisted(req.params.id, req.body.newEbayItemId);
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /stale-inventory/returns/:id/scrapped
 * Mark a return as scrapped.
 */
router.post('/returns/:id/scrapped', async (req, res) => {
  try {
    const service = new ReturnIntakeService();
    const result = await service.markScrapped(req.params.id);
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// === Restock ===

/**
 * POST /stale-inventory/restock/scan
 * Run restock scan.
 */
router.post('/restock/scan', async (req, res) => {
  try {
    const service = new RestockService();
    const result = await service.scanAndFlag();
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /stale-inventory/restock/flags
 * Get restock flags.
 */
router.get('/restock/flags', async (req, res) => {
  try {
    const { acknowledged, limit } = req.query;
    const service = new RestockService();
    const flags = await service.getFlags({
      acknowledged: acknowledged === 'true',
      limit: parseInt(limit) || 50,
    });
    res.json({ success: true, flags });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /stale-inventory/restock/:id/acknowledge
 * Acknowledge a restock flag.
 */
router.post('/restock/:id/acknowledge', async (req, res) => {
  try {
    const service = new RestockService();
    const result = await service.acknowledge(req.params.id);
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// === Manual Inventory Controls (Phase 5) ===

const TradingAPI = require('../ebay/TradingAPI');
const { database } = require('../database/database');
const { v4: uuidv4 } = require('uuid');

/**
 * GET /stale-inventory/candidates
 * Listings needing action: aged out, reduced 2+ times, or overpriced verdict.
 */
router.get('/candidates', async (req, res) => {
  try {
    const listings = await database('YourListing')
      .where('listingStatus', 'Active')
      .where('quantityAvailable', '>', 0)
      .orderBy('startTime', 'asc')
      .limit(100)
      .select('id', 'ebayItemId', 'title', 'currentPrice', 'startTime', 'isProgrammed');

    const candidates = [];
    for (const l of listings) {
      const daysListed = l.startTime ? Math.floor((Date.now() - new Date(l.startTime).getTime()) / 86400000) : 0;
      if (daysListed < 60) continue;

      // Count prior reductions
      let reductionCount = 0;
      try {
        const actions = await database('stale_inventory_action')
          .where('ebay_item_id', l.ebayItemId)
          .where('action_type', 'REDUCE_PRICE')
          .count('* as c').first();
        reductionCount = parseInt(actions?.c || 0);
      } catch (e) {}

      let recommendation = 'hold';
      if (daysListed > 180 && reductionCount >= 2) recommendation = 'end';
      else if (daysListed > 120) recommendation = 'deep_discount';
      else if (daysListed > 90) recommendation = 'reduce';
      else recommendation = 'monitor';

      candidates.push({
        id: l.id,
        ebayItemId: l.ebayItemId,
        title: l.title,
        currentPrice: parseFloat(l.currentPrice),
        daysListed,
        reductionCount,
        isProgrammed: l.isProgrammed,
        recommendation,
      });
    }

    candidates.sort((a, b) => b.daysListed - a.daysListed);
    res.json({ success: true, candidates, total: candidates.length });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /stale-inventory/revise-price
 * Manually change a listing's price.
 */
router.post('/revise-price', async (req, res) => {
  const { ebayItemId, newPrice } = req.body;
  if (!ebayItemId || !newPrice) return res.status(400).json({ error: 'ebayItemId and newPrice required' });
  if (parseFloat(newPrice) <= 0) return res.status(400).json({ error: 'newPrice must be > 0' });

  try {
    // Get current price
    const listing = await database('YourListing').where('ebayItemId', ebayItemId).first();
    if (!listing) return res.status(404).json({ error: 'Listing not found' });
    if (listing.listingStatus !== 'Active') return res.status(400).json({ error: 'Listing is not active' });

    const oldPrice = parseFloat(listing.currentPrice);
    const api = new TradingAPI();
    await api.reviseItem({ ebayItemId, startPrice: parseFloat(newPrice) });

    // Update local record
    await database('YourListing').where('ebayItemId', ebayItemId).update({ currentPrice: parseFloat(newPrice), updatedAt: new Date() });

    // Log action
    await database('stale_inventory_action').insert({
      id: uuidv4(), ebay_item_id: ebayItemId, listing_id: listing.id, title: listing.title,
      action_type: 'manual_revise', old_price: oldPrice, new_price: parseFloat(newPrice),
      days_listed: listing.startTime ? Math.floor((Date.now() - new Date(listing.startTime).getTime()) / 86400000) : null,
      executed: true, executed_at: new Date(), createdAt: new Date(),
    });

    res.json({ success: true, oldPrice, newPrice: parseFloat(newPrice) });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /stale-inventory/end-item
 * End a listing on eBay.
 */
router.post('/end-item', async (req, res) => {
  const { ebayItemId, reason = 'NotAvailable' } = req.body;
  if (!ebayItemId) return res.status(400).json({ error: 'ebayItemId required' });

  try {
    const listing = await database('YourListing').where('ebayItemId', ebayItemId).first();
    if (!listing) return res.status(404).json({ error: 'Listing not found' });
    if (listing.listingStatus !== 'Active') return res.status(400).json({ error: 'Listing is not active' });

    const api = new TradingAPI();
    const result = await api.endItem({ ebayItemId, endingReason: reason });

    await database('YourListing').where('ebayItemId', ebayItemId).update({ listingStatus: 'Ended', updatedAt: new Date() });

    await database('stale_inventory_action').insert({
      id: uuidv4(), ebay_item_id: ebayItemId, listing_id: listing.id, title: listing.title,
      action_type: 'end', old_price: parseFloat(listing.currentPrice),
      days_listed: listing.startTime ? Math.floor((Date.now() - new Date(listing.startTime).getTime()) / 86400000) : null,
      executed: true, executed_at: new Date(), createdAt: new Date(),
    });

    res.json({ success: true, endTime: result.endTime });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /stale-inventory/relist-item
 * Relist an ended listing on eBay.
 */
router.post('/relist-item', async (req, res) => {
  const { ebayItemId, newPrice } = req.body;
  if (!ebayItemId) return res.status(400).json({ error: 'ebayItemId required' });

  try {
    const listing = await database('YourListing').where('ebayItemId', ebayItemId).first();
    if (!listing) return res.status(404).json({ error: 'Listing not found' });

    const api = new TradingAPI();
    const result = await api.relistItem({ ebayItemId, startPrice: newPrice ? parseFloat(newPrice) : null });

    await database('stale_inventory_action').insert({
      id: uuidv4(), ebay_item_id: ebayItemId, listing_id: listing.id, title: listing.title,
      action_type: 'relist', old_price: parseFloat(listing.currentPrice), new_price: newPrice ? parseFloat(newPrice) : parseFloat(listing.currentPrice),
      executed: true, executed_at: new Date(), createdAt: new Date(),
    });

    res.json({ success: true, newItemId: result.newItemId, fees: result.fees });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /stale-inventory/bulk-end
 * End multiple listings. Max 25 per call.
 */
router.post('/bulk-end', async (req, res) => {
  const { ebayItemIds, reason = 'NotAvailable' } = req.body;
  if (!ebayItemIds || !Array.isArray(ebayItemIds)) return res.status(400).json({ error: 'ebayItemIds array required' });
  if (ebayItemIds.length > 25) return res.status(400).json({ error: 'Max 25 items per bulk end' });

  const api = new TradingAPI();
  const results = [];

  for (const ebayItemId of ebayItemIds) {
    try {
      const listing = await database('YourListing').where('ebayItemId', ebayItemId).first();
      if (!listing || listing.listingStatus !== 'Active') {
        results.push({ ebayItemId, success: false, error: 'Not active' });
        continue;
      }

      await api.endItem({ ebayItemId, endingReason: reason });
      await database('YourListing').where('ebayItemId', ebayItemId).update({ listingStatus: 'Ended', updatedAt: new Date() });
      await database('stale_inventory_action').insert({
        id: uuidv4(), ebay_item_id: ebayItemId, listing_id: listing.id, title: listing.title,
        action_type: 'end', old_price: parseFloat(listing.currentPrice),
        executed: true, executed_at: new Date(), createdAt: new Date(),
      });
      results.push({ ebayItemId, success: true });
    } catch (err) {
      results.push({ ebayItemId, success: false, error: err.message });
    }
    // Rate limit: 1 second between calls
    await new Promise(r => setTimeout(r, 1000));
  }

  res.json({
    success: true,
    results,
    totalEnded: results.filter(r => r.success).length,
    totalFailed: results.filter(r => !r.success).length,
  });
});

module.exports = router;
```
---
## FILE: service/routes/scout-alerts.js
```javascript
'use strict';

const router = require('express-promise-router')();
const { database } = require('../database/database');
const { generateAlerts } = require('../services/ScoutAlertService');

// Hard age ceilings
const BONE_MAX_DAYS = 90;
const PERCH_MAX_DAYS = 60;

// Get alerts with yard + time filters
router.get('/list', async (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const perPage = 50;
  const yard = req.query.yard || 'all';
  const days = parseInt(req.query.days) || 0; // 0 = all (within hard ceilings)
  const hideClaimed = req.query.hideClaimed === '1';

  const knex = database;

  // Base query with hard age ceilings applied always
  let baseQuery = knex('scout_alerts').where(function() {
    this.where(function() {
      this.where('source', 'bone_pile')
        .andWhere('vehicle_set_date', '>=', knex.raw(`NOW() - INTERVAL '${BONE_MAX_DAYS} days'`));
    }).orWhere(function() {
      this.where('source', 'hunters_perch')
        .andWhere('vehicle_set_date', '>=', knex.raw(`NOW() - INTERVAL '${PERCH_MAX_DAYS} days'`));
    });
  });

  // Time filter (days pill)
  if (days > 0) {
    const effectiveBoneDays = Math.min(days, BONE_MAX_DAYS);
    const effectivePerchDays = Math.min(days, PERCH_MAX_DAYS);
    baseQuery = knex('scout_alerts').where(function() {
      this.where(function() {
        this.where('source', 'bone_pile')
          .andWhere('vehicle_set_date', '>=', knex.raw(`NOW() - INTERVAL '${effectiveBoneDays} days'`));
      }).orWhere(function() {
        this.where('source', 'hunters_perch')
          .andWhere('vehicle_set_date', '>=', knex.raw(`NOW() - INTERVAL '${effectivePerchDays} days'`));
      });
    });
  }

  // Also include alerts with NULL vehicle_set_date (can't filter what we can't date)
  // Actually, re-do: build the where as a function we can reuse
  function applyFilters(q) {
    q = q.where(function() {
      this.where(function() {
        this.where('source', 'bone_pile').andWhere(function() {
          this.where('vehicle_set_date', '>=', knex.raw(`NOW() - INTERVAL '${days > 0 ? Math.min(days, BONE_MAX_DAYS) : BONE_MAX_DAYS} days'`))
            .orWhereNull('vehicle_set_date');
        });
      }).orWhere(function() {
        this.where('source', 'hunters_perch').andWhere(function() {
          this.where('vehicle_set_date', '>=', knex.raw(`NOW() - INTERVAL '${days > 0 ? Math.min(days, PERCH_MAX_DAYS) : PERCH_MAX_DAYS} days'`))
            .orWhereNull('vehicle_set_date');
        });
      }).orWhere(function() {
        // PERCH (The Mark) alerts — no hard age ceiling, always show active marks
        this.where('source', 'PERCH');
      }).orWhere(function() {
        // OVERSTOCK alerts — always show, no date filtering
        this.where('source', 'OVERSTOCK');
      });
    });
    if (yard && yard !== 'all') {
      q = q.andWhere('yard_name', 'ilike', `%${yard}%`);
    }
    if (hideClaimed) {
      q = q.andWhere(function() { this.where('claimed', false).orWhereNull('claimed'); });
    }
    return q;
  }

  // Get paginated alerts
  let alertQuery = knex('scout_alerts');
  alertQuery = applyFilters(alertQuery);
  const alerts = await alertQuery
    .orderByRaw(`CASE WHEN claimed = true THEN 1 ELSE 0 END`)
    .orderByRaw(`
      CASE
        WHEN source = 'PERCH' AND confidence = 'high' THEN 0
        WHEN source = 'PERCH' AND confidence = 'medium' THEN 1
        WHEN source = 'bone_pile' AND confidence = 'high' THEN 2
        WHEN source = 'bone_pile' AND confidence = 'medium' THEN 3
        WHEN source = 'bone_pile' AND confidence = 'low' THEN 4
        WHEN source = 'hunters_perch' AND confidence = 'high' THEN 5
        WHEN source = 'hunters_perch' AND confidence = 'medium' THEN 6
        WHEN source = 'hunters_perch' AND confidence = 'low' THEN 7
        WHEN source = 'OVERSTOCK' THEN 1
        ELSE 8
      END
    `)
    .orderBy('part_value', 'desc')
    .offset((page - 1) * perPage)
    .limit(perPage);

  // Get total count with same filters
  let countQuery = knex('scout_alerts');
  countQuery = applyFilters(countQuery);
  const [{ count }] = await countQuery.count('* as count');
  const total = parseInt(count) || 0;

  // Get last generated timestamp
  const meta = await knex('scout_alerts_meta').where('key', 'last_generated').first();
  const lastGenerated = meta ? meta.value : null;

  // Group by yard
  const byYard = {};
  for (const a of alerts) {
    const y = a.yard_name || 'Unknown';
    if (!byYard[y]) byYard[y] = [];
    byYard[y].push(a);
  }

  // Yard counts with same filters
  let yardCountQuery = knex('scout_alerts');
  yardCountQuery = applyFilters(yardCountQuery);
  const yardCounts = await yardCountQuery
    .select('yard_name').count('* as count').groupBy('yard_name').orderBy('count', 'desc');

  // Source counts with same filters
  let srcQuery = knex('scout_alerts');
  srcQuery = applyFilters(srcQuery);
  const sourceCounts = await srcQuery.select('source').count('* as count').groupBy('source');
  const boneCount = parseInt((sourceCounts.find(s => s.source === 'bone_pile') || {}).count) || 0;
  const perchCount = parseInt((sourceCounts.find(s => s.source === 'hunters_perch') || {}).count) || 0;
  const markCount = parseInt((sourceCounts.find(s => s.source === 'PERCH') || {}).count) || 0;
  const overstockCount = parseInt((sourceCounts.find(s => s.source === 'OVERSTOCK') || {}).count) || 0;

  // Tag perch alerts with recent sales
  let justSoldCount = 0;
  try {
    const recentSales = await knex('YourSale')
      .where('soldDate', '>=', knex.raw("NOW() - INTERVAL '3 days'"))
      .whereNotNull('title').select('title', 'soldDate');
    const saleTitles = recentSales.map(s => ({ lower: (s.title || '').toLowerCase(), soldDate: s.soldDate }));
    for (const yardName in byYard) {
      for (const alert of byYard[yardName]) {
        if (alert.source !== 'hunters_perch') continue;
        const alertWords = (alert.source_title || '').toLowerCase()
          .replace(/\([^)]*\)/g, '').replace(/\b\d+\b/g, '').replace(/[^a-z\s]/g, ' ')
          .split(/\s+/).filter(w => w.length >= 3);
        for (const sale of saleTitles) {
          const matches = alertWords.filter(w => sale.lower.includes(w));
          if (matches.length >= 3) {
            const daysAgo = Math.floor((Date.now() - new Date(sale.soldDate).getTime()) / 86400000);
            alert.justSold = daysAgo <= 0 ? 'today' : daysAgo + 'd ago';
            justSoldCount++;
            break;
          }
        }
      }
    }
  } catch (e) { /* ignore */ }

  res.json({
    success: true,
    alerts: byYard,
    yardCounts: yardCounts.map(y => ({ yard: y.yard_name, count: parseInt(y.count) })),
    boneCount, perchCount, markCount, overstockCount, justSoldCount,
    total, page, totalPages: Math.ceil(total / perPage),
    lastGenerated
  });
});

// Claim / unclaim an alert (GOT ONE)
router.post('/claim', async (req, res) => {
  const { id, claimed } = req.body;
  if (!id) return res.status(400).json({ error: 'ID required' });

  const knex = database;
  const alert = await knex('scout_alerts').where({ id }).first();
  if (!alert) return res.status(404).json({ error: 'Alert not found' });

  // Update scout_alerts
  await knex('scout_alerts').where({ id }).update({
    claimed: !!claimed,
    claimed_by: claimed ? (alert.yard_name || 'unknown') : null,
    claimed_at: claimed ? new Date().toISOString() : null,
  });

  // If PERCH alert, sync with restock_want_list
  if (alert.source === 'hunters_perch') {
    // Find the matching want list item by title
    const wantItem = await knex('restock_want_list')
      .where({ active: true })
      .where('title', alert.source_title)
      .first();
    if (wantItem) {
      await knex('restock_want_list').where({ id: wantItem.id }).update({
        pulled: !!claimed,
        pulled_date: claimed ? new Date().toISOString() : null,
        pulled_from: claimed ? (alert.yard_name || null) : null,
      });
    }
  }

  res.json({ success: true });
});

// Manual refresh
router.post('/refresh', async (req, res) => {
  try {
    const result = await generateAlerts();
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
```
---
## FILE: service/routes/flyway.js
```javascript
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
```
---
## FILE: service/routes/phoenix.js
```javascript
'use strict';

const router = require('express-promise-router')();
const { log } = require('../lib/logger');
const { database } = require('../database/database');
const PhoenixService = require('../services/PhoenixService');
const SoldItemsManager = require('../managers/SoldItemsManager');

// GET /phoenix — Main scored list
router.get('/', async (req, res) => {
  try {
    const service = new PhoenixService();
    const days = parseInt(req.query.days) || 180;
    const limit = parseInt(req.query.limit) || 100;
    const seller = req.query.seller || null;
    const sellers = await service.getRebuildSellers();
    const data = await service.getPhoenixList({ days, limit, seller });
    res.json({
      success: true,
      data,
      meta: { days, limit, total: data.length, seller: seller || 'all', allSellers: sellers.filter(s => s.enabled).map(s => s.name) },
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /phoenix/stats — Summary metrics
router.get('/stats', async (req, res) => {
  try {
    const service = new PhoenixService();
    const days = parseInt(req.query.days) || 180;
    const seller = req.query.seller || null;
    const stats = await service.getPhoenixStats({ days, seller });
    res.json({ success: true, stats });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /phoenix/sellers — List rebuild sellers
router.get('/sellers', async (req, res) => {
  try {
    const service = new PhoenixService();
    const sellers = await service.getRebuildSellers();
    res.json({ success: true, sellers });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /phoenix/sellers — Add a rebuild seller
router.post('/sellers', async (req, res) => {
  try {
    const { name } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ success: false, message: 'Seller name is required' });
    const service = new PhoenixService();
    const seller = await service.addRebuildSeller(name);
    res.json({ success: true, seller, message: 'Added rebuild seller: ' + name.trim().toLowerCase() });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// DELETE /phoenix/sellers/:name — Remove rebuild seller
router.delete('/sellers/:name', async (req, res) => {
  try {
    const service = new PhoenixService();
    const result = await service.removeRebuildSeller(req.params.name);
    res.json({ success: true, ...result, message: 'Removed rebuild seller: ' + req.params.name });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /phoenix/sellers/:name/scrape — Trigger scrape (non-blocking)
router.post('/sellers/:name/scrape', async (req, res) => {
  const sellerName = req.params.name;
  const maxPages = parseInt(req.body.maxPages) || 5;
  res.json({ success: true, message: 'Scrape started for ' + sellerName, started: true });

  // Run in background — don't block the request
  const manager = new SoldItemsManager();
  try {
    const result = await manager.scrapeCompetitor({
      seller: sellerName,
      categoryId: '6030',
      maxPages,
    });
    log.info({ seller: sellerName, result }, 'Phoenix seller scrape complete');

    // Update seller stats so UI and auto-scrape skip window stay current
    try {
      await database('SoldItemSeller').where('name', sellerName).update({
        lastScrapedAt: new Date(),
        itemsScraped: database.raw('"itemsScraped" + ?', [result.stored]),
        updatedAt: new Date(),
      });
    } catch (e) { log.warn({ err: e.message, seller: sellerName }, 'Could not update seller stats'); }
  } catch (err) {
    log.error({ err: err.message, seller: sellerName }, 'Phoenix seller scrape failed');
  } finally {
    try { await manager.scraper.closeBrowser(); } catch (e) {}
  }
});

module.exports = router;
```
---
## FILE: service/routes/price-check.js
```javascript
'use strict';

const express = require('express');
const router = express.Router();
const { log } = require('../lib/logger');
const PriceCheckService = require('../services/PriceCheckService');
const PriceCheckCronRunner = require('../lib/PriceCheckCronRunner');
const YourListing = require('../models/YourListing');
const PriceCheck = require('../models/PriceCheck');

/**
 * POST /price-check/omit
 * Omit or un-omit one or more listings from automated price checks.
 * Works as both a single and bulk API — pass one or many listingIds.
 * Body: { listingIds: string[], omit: boolean }
 */
router.post('/omit', async (req, res) => {
  try {
    const { listingIds, omit } = req.body;

    if (!listingIds || !Array.isArray(listingIds) || listingIds.length === 0) {
      return res.status(400).json({ success: false, error: 'listingIds array is required' });
    }
    if (typeof omit !== 'boolean') {
      return res.status(400).json({ success: false, error: 'omit (boolean) is required' });
    }

    await YourListing.query()
      .patch({ priceCheckOmitted: omit })
      .whereIn('id', listingIds);

    return res.json({
      success: true,
      updated: listingIds.length,
      omit,
    });
  } catch (error) {
    console.error('Price check omit error:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /price-check/all
 * Get listings with their most recent price check data (paginated)
 * Query params: page (default: 1), limit (default: 50), verdict (optional filter), omitted (optional: 'true'/'false')
 */
router.get('/all', async (req, res) => {
  try {
    const { page = 1, limit = 50, verdict, search, omitted } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    // Get recent price checks for filtering
    const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    // Build listing query - filter by verdict if provided
    let listingQuery = YourListing.query();
    let countQuery = YourListing.query();

    // Omitted filter — default shows non-omitted listings only
    if (omitted === 'true') {
      listingQuery = listingQuery.where('priceCheckOmitted', true);
      countQuery = countQuery.where('priceCheckOmitted', true);
    } else if (omitted === 'false' || omitted === undefined) {
      listingQuery = listingQuery.where('priceCheckOmitted', false);
      countQuery = countQuery.where('priceCheckOmitted', false);
    }
    // omitted=all → no filter applied

    // Title search filter
    if (search && search.trim()) {
      const term = `%${search.trim()}%`;
      listingQuery = listingQuery.whereRaw('LOWER(title) LIKE LOWER(?)', [term]);
      countQuery = countQuery.whereRaw('LOWER(title) LIKE LOWER(?)', [term]);
    }

    if (verdict && verdict !== 'all') {
      // Get listing IDs that match the verdict filter
      let verdictFilter;
      if (verdict === 'unchecked') {
        // Get listings that DON'T have a recent price check
        const checkedListingIds = await PriceCheck.query()
          .where('checkedAt', '>', cutoff)
          .distinct('listingId')
          .pluck('listingId');

        listingQuery = listingQuery.whereNotIn('id', checkedListingIds);
        countQuery = countQuery.whereNotIn('id', checkedListingIds);
      } else {
        // Get listings that have a price check with the specified verdict
        const matchingVerdicts = verdict === 'atMarket'
          ? ['MARKET PRICE', 'GOOD VALUE']
          : verdict === 'high'
            ? ['OVERPRICED', 'SLIGHTLY HIGH']
            : [verdict.toUpperCase()];

        // Get latest price check per listing with matching verdict
        const matchingListingIds = await PriceCheck.query()
          .where('checkedAt', '>', cutoff)
          .whereIn('verdict', matchingVerdicts)
          .distinct('listingId')
          .pluck('listingId');

        listingQuery = listingQuery.whereIn('id', matchingListingIds);
        countQuery = countQuery.whereIn('id', matchingListingIds);
      }
    }

    // Only show listings confirmed active by a recent sync.
    // The eBay sync runs every 6h and only returns active listings — anything
    // not re-synced within 14 days is ended/removed on eBay.
    // This also naturally deduplicates relisted items (old records go stale).
    const staleCutoff = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
    listingQuery = listingQuery.where('syncedAt', '>', staleCutoff)
      .where('listingStatus', 'Active')
      .where('quantityAvailable', '>', 0);
    countQuery = countQuery.where('syncedAt', '>', staleCutoff)
      .where('listingStatus', 'Active')
      .where('quantityAvailable', '>', 0);

    // Get paginated listings
    const [listings, countResult] = await Promise.all([
      listingQuery.clone().orderBy('createdAt', 'desc').limit(parseInt(limit)).offset(offset),
      countQuery.clone().count('* as total').first(),
    ]);

    const total = parseInt(countResult?.total || 0);
    const totalPages = Math.ceil(total / parseInt(limit));

    // Calculate daysListed for each
    const now = new Date();
    const listingsWithDays = listings.map(listing => {
      const startTime = listing.startTime ? new Date(listing.startTime) : now;
      const daysListed = Math.floor((now - startTime) / (1000 * 60 * 60 * 24));
      return { ...listing, daysListed: Math.max(0, daysListed) };
    });

    // Get all recent price checks (within 7 days for bulk view)
    const priceChecks = await PriceCheck.query()
      .where('checkedAt', '>', cutoff)
      .orderBy('checkedAt', 'desc');

    // Create a map of listing ID to most recent price check
    const priceCheckMap = {};
    priceChecks.forEach(pc => {
      if (!priceCheckMap[pc.listingId]) {
        priceCheckMap[pc.listingId] = pc;
      }
    });

    // Merge listings with price checks and calculate suggested price
    const results = listingsWithDays.map(listing => {
      const priceCheck = priceCheckMap[listing.id];
      let suggestedPrice = null;
      let priceDiff = null;

      if (priceCheck && priceCheck.marketMedian) {
        // Suggest slightly below median for faster sales
        suggestedPrice = Math.round(parseFloat(priceCheck.marketMedian) * 0.95 * 100) / 100;
        priceDiff = parseFloat(listing.currentPrice) - suggestedPrice;
      }

      // Parse topComps if stored as string
      let topComps = [];
      if (priceCheck?.topComps) {
        try {
          topComps = typeof priceCheck.topComps === 'string'
            ? JSON.parse(priceCheck.topComps)
            : priceCheck.topComps;
        } catch (e) {
          topComps = [];
        }
      }

      return {
        id: listing.id,
        ebayItemId: listing.ebayItemId,
        title: listing.title,
        sku: listing.sku,
        currentPrice: parseFloat(listing.currentPrice),
        daysListed: listing.daysListed,
        viewItemUrl: listing.viewItemUrl,
        priceCheckOmitted: !!listing.priceCheckOmitted,
        priceCheck: priceCheck ? {
          checkedAt: priceCheck.checkedAt,
          verdict: priceCheck.verdict,
          marketMedian: parseFloat(priceCheck.marketMedian),
          marketMin: parseFloat(priceCheck.marketMin),
          marketMax: parseFloat(priceCheck.marketMax),
          compCount: priceCheck.compCount,
          priceDiffPercent: parseFloat(priceCheck.priceDiffPercent),
          suggestedPrice,
          priceDiff,
          // Additional details for expandable view
          searchQuery: priceCheck.searchQuery,
          topComps,
          salesPerWeek: priceCheck.salesPerWeek ? parseFloat(priceCheck.salesPerWeek) : null,
          partType: priceCheck.partType,
          make: priceCheck.make,
          model: priceCheck.model,
          years: priceCheck.years,
        } : null,
      };
    });

    // Summary stats - calculate across ALL listings, not just current page
    // This runs separate queries to get accurate totals
    const [allPriceChecks, totalListingsCount, omittedCount] = await Promise.all([
      PriceCheck.query()
        .where('checkedAt', '>', cutoff)
        .select('listingId', 'verdict')
        .orderBy('checkedAt', 'desc'),
      YourListing.query().count('* as count').first(),
      YourListing.query().where('priceCheckOmitted', true).count('* as count').first(),
    ]);

    // Create map of latest verdict per listing
    const verdictMap = {};
    allPriceChecks.forEach(pc => {
      if (!verdictMap[pc.listingId]) {
        verdictMap[pc.listingId] = pc.verdict;
      }
    });

    const checkedTotal = Object.keys(verdictMap).length;
    const overpricedTotal = Object.values(verdictMap).filter(v => v === 'OVERPRICED').length;
    const underpricedTotal = Object.values(verdictMap).filter(v => v === 'UNDERPRICED').length;
    const atMarketTotal = Object.values(verdictMap).filter(v => ['MARKET PRICE', 'GOOD VALUE'].includes(v)).length;
    const totalAll = parseInt(totalListingsCount?.count || 0);

    return res.json({
      success: true,
      count: results.length,
      total,
      page: parseInt(page),
      totalPages,
      summary: {
        checked: checkedTotal,
        overpriced: overpricedTotal,
        underpriced: underpricedTotal,
        atMarket: atMarketTotal,
        unchecked: totalAll - checkedTotal,
        omitted: parseInt(omittedCount?.count || 0),
      },
      listings: results,
    });
  } catch (error) {
    console.error('Bulk price check error:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /price-check/bulk
 * Run price check on multiple listings (processes sequentially to avoid rate limits)
 * Body: { listingIds: string[], forceRefresh: boolean }
 */
router.post('/bulk', async (req, res) => {
  try {
    const { listingIds, forceRefresh = false } = req.body;

    if (!listingIds || !Array.isArray(listingIds)) {
      return res.status(400).json({ success: false, error: 'listingIds array is required' });
    }

    // Limit to 20 at a time to prevent timeouts
    const idsToProcess = listingIds.slice(0, 20);
    const results = [];
    const errors = [];

    for (const listingId of idsToProcess) {
      try {
        const listing = await YourListing.query().findById(listingId);
        if (!listing) {
          errors.push({ listingId, error: 'Listing not found' });
          continue;
        }

        const result = await PriceCheckService.checkPrice(
          listingId,
          listing.title,
          parseFloat(listing.currentPrice),
          forceRefresh
        );

        // Calculate suggested price
        let suggestedPrice = null;
        if (result.metrics?.median) {
          suggestedPrice = Math.round(result.metrics.median * 0.95 * 100) / 100;
        }

        results.push({
          listingId,
          title: listing.title,
          currentPrice: parseFloat(listing.currentPrice),
          verdict: result.metrics?.verdict,
          marketMedian: result.metrics?.median,
          suggestedPrice,
          cached: result.cached,
        });

        // Small delay between requests to be nice to eBay
        if (!result.cached) {
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
      } catch (err) {
        errors.push({ listingId, error: err.message });
      }
    }

    return res.json({
      success: true,
      processed: results.length,
      errors: errors.length,
      results,
      errorDetails: errors,
      remaining: listingIds.length - idsToProcess.length,
    });
  } catch (error) {
    console.error('Bulk price check error:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /price-check/title
 * Run price check for an arbitrary title (not tied to a listing)
 * NOTE: Must be defined before /:listingId to avoid route collision
 */
router.post('/title', async (req, res) => {
  try {
    const { title, price } = req.body;

    if (!title || !price) {
      return res.status(400).json({ success: false, error: 'title and price are required' });
    }

    const result = await PriceCheckService.checkPrice(
      null, // no listing ID
      title,
      parseFloat(price),
      true // always run fresh for ad-hoc checks
    );

    return res.json({
      success: true,
      title,
      yourPrice: parseFloat(price),
      ...result,
    });
  } catch (error) {
    console.error('Price check error:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /price-check/:listingId
 * Run price check for a specific listing
 */
router.post('/:listingId', async (req, res) => {
  try {
    const { listingId } = req.params;
    const { forceRefresh } = req.body;

    // Get the listing
    const listing = await YourListing.query().findById(listingId);
    if (!listing) {
      return res.status(404).json({ success: false, error: 'Listing not found' });
    }

    const result = await PriceCheckService.checkPrice(
      listingId,
      listing.title,
      parseFloat(listing.currentPrice),
      forceRefresh
    );

    return res.json({
      success: true,
      listingId,
      title: listing.title,
      yourPrice: parseFloat(listing.currentPrice),
      ...result,
    });
  } catch (error) {
    console.error('Price check error:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /price-check/history/:listingId
 * Get price check history for a listing
 */
router.get('/history/:listingId', async (req, res) => {
  try {
    const { listingId } = req.params;
    const PriceCheck = require('../models/PriceCheck');

    const history = await PriceCheck.query()
      .where('listingId', listingId)
      .orderBy('checkedAt', 'desc')
      .limit(10);

    return res.json({
      success: true,
      history,
    });
  } catch (error) {
    console.error('Price check history error:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /price-check/cron
 * Manually trigger the price check cron job
 * Query params: batchSize (default: 15)
 */
router.post('/cron', async (req, res) => {
  try {
    const { batchSize = 15 } = req.body;
    log.info({ batchSize }, 'Manually triggering price check cron');

    const runner = new PriceCheckCronRunner();

    // Run in background, don't await
    runner.work({ batchSize: parseInt(batchSize) });

    return res.json({
      success: true,
      message: `Price check cron started with batch size ${batchSize}`,
    });
  } catch (error) {
    console.error('Price check cron trigger error:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /price-check/stats
 * Get stats on price check coverage
 */
router.get('/stats', async (req, res) => {
  try {
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const [totalListings, recentChecks, allChecks] = await Promise.all([
      YourListing.query().where('listingStatus', 'Active').count('* as count').first(),
      PriceCheck.query().where('checkedAt', '>', cutoff).distinct('listingId').count('listingId as count').first(),
      PriceCheck.query().distinct('listingId').count('listingId as count').first(),
    ]);

    const total = parseInt(totalListings?.count || 0);
    const checkedLast24h = parseInt(recentChecks?.count || 0);
    const checkedEver = parseInt(allChecks?.count || 0);

    return res.json({
      success: true,
      stats: {
        totalActiveListings: total,
        checkedLast24h,
        checkedEver,
        unchecked: total - checkedEver,
        stale: checkedEver - checkedLast24h,
        coveragePercent: total > 0 ? Math.round((checkedEver / total) * 100) : 0,
        freshPercent: total > 0 ? Math.round((checkedLast24h / total) * 100) : 0,
      },
    });
  } catch (error) {
    console.error('Price check stats error:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
```
---
## FILE: service/routes/vin.js
```javascript
'use strict';

const { log } = require('../lib/logger');
const router = require('express-promise-router')();
const { database } = require('../database/database');
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const { extractPartNumbers: piExtractPNs, vehicleYearMatchesPart: piYearMatch } = require('../utils/partIntelligence');

function formatEngineStr(displacement, cylinders) {
  if (!displacement) return null;
  const d = parseFloat(displacement);
  let e = (!isNaN(d) ? d.toFixed(1) : displacement) + 'L';
  const c = parseInt(cylinders);
  if (c >= 2 && c <= 16) {
    const label = c <= 4 ? '4-cyl' : c === 5 ? '5-cyl' : c === 6 ? 'V6' : c === 8 ? 'V8' : c === 10 ? 'V10' : c === 12 ? 'V12' : c + '-cyl';
    e += ' ' + label;
  }
  return e;
}

// Multer-free: read raw body as base64 from multipart form data
// Assumption: body-parser is configured with 50mb limit in index.js

/**
 * POST /vin/decode-photo
 * Accepts JSON body: { image: "base64-encoded-jpeg" }
 * Calls Claude Vision API via raw fetch (no SDK dependency).
 */
router.post('/decode-photo', async (req, res) => {
  try {
    const imageBase64 = req.body?.image;
    if (!imageBase64 || imageBase64.length < 1000) {
      return res.status(400).json({ error: 'No image provided or image too small (' + (imageBase64?.length || 0) + ' chars)' });
    }
    if (imageBase64.length > 2000000) {
      return res.status(400).json({ error: 'Image too large — max 2MB base64' });
    }
    log.info({ imageSize: imageBase64.length }, 'VIN photo received');

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured' });
    }

    // Call Claude Vision via raw fetch (avoids SDK dependency issues)
    const fetchRes = await axios.post('https://api.anthropic.com/v1/messages', {
      model: 'claude-sonnet-4-20250514',
      max_tokens: 200,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: imageBase64 } },
          { type: 'text', text: 'Read the Vehicle Identification Number (VIN) from this photo. The photo may have glare, be at an angle, dirty, or partially obscured. A VIN is exactly 17 characters — letters and numbers only. VINs never contain I, O, or Q. If a character is unclear, use VIN rules to determine the most likely character. Common misreads: 0/O/D, 1/I/L, 5/S, 8/B. Return ONLY the 17-character VIN string. If unreadable, return UNREADABLE.' }
        ]
      }]
    }, {
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      timeout: 30000,
    });

    const text = fetchRes.data?.content?.[0]?.text?.trim() || '';
    log.info({ rawResponse: text }, 'Claude Vision response');

    // Extract 17-char VIN from response
    const vinMatch = text.match(/[A-HJ-NPR-Z0-9]{17}/i);
    let vin = vinMatch ? vinMatch[0].toUpperCase() : text.replace(/[^A-HJ-NPR-Z0-9?]/gi, '').toUpperCase();

    if (vin === 'UNREADABLE' || vin.length < 14) {
      return res.json({ success: true, vin: 'UNREADABLE' });
    }
    if (vin.includes('?')) {
      return res.json({ success: true, vin, partial: true });
    }

    // Step 2: Check vin_cache first
    let decoded = null;
    let matchedVehicle = null;

    try {
      const cached = await database('vin_cache').where('vin', vin).first();
      if (cached) {
        decoded = {
          year: cached.year, make: cached.make, model: cached.model,
          engine: cached.engine, bodyStyle: cached.body_style,
        };
      }
    } catch (e) {
      // vin_cache table may not exist yet
    }

    // Step 3: If not cached, call NHTSA
    if (!decoded) {
      const nhtsaRes = await axios.get(
        `https://vpic.nhtsa.dot.gov/api/vehicles/decodevin/${vin}?format=json`,
        { timeout: 10000 }
      );

      const results = nhtsaRes.data?.Results || [];
      const getValue = (varId) => {
        const item = results.find(r => r.VariableId === varId);
        return (item && item.Value && item.Value.trim()) || null;
      };

      decoded = {
        year: getValue(29) ? parseInt(getValue(29)) : null,
        make: getValue(26),
        model: getValue(28),
        engine: [getValue(13), getValue(71)].filter(Boolean).join(' ') || null, // displacement + cylinders
        bodyStyle: getValue(5),
      };

      // Cache the result
      try {
        await database('vin_cache').insert({
          vin,
          year: decoded.year,
          make: decoded.make,
          model: decoded.model,
          engine: decoded.engine,
          body_style: decoded.bodyStyle,
          raw_nhtsa: JSON.stringify(nhtsaRes.data?.Results || []),
          decoded_at: new Date(),
          createdAt: new Date(),
        });
      } catch (e) {
        // Ignore duplicate or table-not-exists errors
        log.warn({ err: e.message }, 'vin_cache insert failed');
      }
    }

    // Step 4: Try to match against yard vehicles
    if (decoded.year && decoded.make && decoded.model) {
      try {
        const match = await database('yard_vehicle')
          .where('active', true)
          .where('year', String(decoded.year))
          .whereRaw('UPPER(make) = ?', [decoded.make.toUpperCase()])
          .whereRaw('UPPER(model) LIKE ?', ['%' + decoded.model.toUpperCase() + '%'])
          .first();
        if (match) matchedVehicle = match.id;
      } catch (e) {
        // Ignore
      }
    }

    res.json({ success: true, vin, decoded, matchedVehicle });
  } catch (err) {
    log.error({ err }, 'VIN decode failed');
    res.status(500).json({ success: false, error: err.message });
  }
});

// Image is now sent as JSON base64, no multipart parsing needed

/**
 * POST /vin/scan
 * Full VIN decode with parts intelligence. Used by the standalone VIN scanner page.
 * Body: { vin: "...", source: "manual"|"camera", scannedBy: "..." }
 */
router.post('/scan', async (req, res) => {
  try {
    let { vin, source, scannedBy } = req.body || {};
    if (!vin || vin.length < 11) return res.status(400).json({ error: 'Valid VIN required (11-17 chars)' });
    vin = vin.trim().toUpperCase().replace(/[^A-HJ-NPR-Z0-9]/g, '');

    // --- Step 1: Decode via cache or NHTSA ---
    let decoded = null;
    let rawResults = null;

    try {
      const cached = await database('vin_cache').where('vin', vin).first();
      if (cached) {
        decoded = {
          year: cached.year, make: cached.make, model: cached.model,
          trim: cached.trim, engine: cached.engine, drivetrain: cached.drivetrain,
          bodyStyle: cached.body_style,
        };
        if (cached.raw_nhtsa) {
          try { rawResults = JSON.parse(cached.raw_nhtsa); } catch (e) {}
        }
      }
    } catch (e) { /* table may not exist */ }

    if (!decoded) {
      const nhtsaRes = await axios.get(
        `https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVin/${vin}?format=json`,
        { timeout: 10000 }
      );
      rawResults = nhtsaRes.data?.Results || [];
      const get = (varId) => {
        const item = rawResults.find(r => r.VariableId === varId);
        const val = item?.Value?.trim();
        return (val && val !== '' && val !== 'Not Applicable') ? val : null;
      };

      const displacement = get(13);
      const cylinders = get(71);
      const engine = formatEngineStr(displacement, cylinders);

      const fuelType = get(24);
      let engineType = 'Gas';
      if (fuelType) {
        const ft = fuelType.toLowerCase();
        if (ft.includes('diesel')) engineType = 'Diesel';
        else if (ft.includes('hybrid')) engineType = 'Hybrid';
        else if (ft.includes('electric') && !ft.includes('hybrid')) engineType = 'Electric';
        else if (ft.includes('flex')) engineType = 'Flex Fuel';
      }

      const driveType = get(15);
      let drivetrain = null;
      if (driveType) {
        const dt = driveType.toUpperCase();
        if (dt.includes('4WD') || dt.includes('4X4') || dt.includes('4-WHEEL')) drivetrain = '4WD';
        else if (dt.includes('AWD') || dt.includes('ALL-WHEEL') || dt.includes('ALL WHEEL')) drivetrain = 'AWD';
        else if (dt.includes('FWD') || dt.includes('FRONT-WHEEL') || dt.includes('FRONT WHEEL')) drivetrain = 'FWD';
        else if (dt.includes('RWD') || dt.includes('REAR-WHEEL') || dt.includes('REAR WHEEL')) drivetrain = 'RWD';
      }

      decoded = {
        year: get(29) ? parseInt(get(29)) : null,
        make: get(26), model: get(28), trim: get(38),
        engine, engineType, drivetrain,
        bodyStyle: get(5), plantCity: get(31), plantCountry: get(75),
        paintCode: null, // NHTSA doesn't provide paint code
      };

      // Cache it
      try {
        await database('vin_cache').insert({
          vin, year: decoded.year, make: decoded.make, model: decoded.model,
          trim: decoded.trim, engine: decoded.engine, drivetrain: decoded.drivetrain,
          body_style: decoded.bodyStyle, raw_nhtsa: JSON.stringify(rawResults),
          decoded_at: new Date(), createdAt: new Date(),
        }).onConflict('vin').ignore();
      } catch (e) { /* ignore */ }
    }

    // Extract extra fields from raw NHTSA if available
    if (rawResults && !decoded.engineType) {
      const get = (varId) => {
        const item = rawResults.find(r => r.VariableId === varId);
        const val = item?.Value?.trim();
        return (val && val !== '' && val !== 'Not Applicable') ? val : null;
      };
      const fuelType = get(24);
      decoded.engineType = 'Gas';
      if (fuelType) {
        const ft = fuelType.toLowerCase();
        if (ft.includes('diesel')) decoded.engineType = 'Diesel';
        else if (ft.includes('hybrid')) decoded.engineType = 'Hybrid';
        else if (ft.includes('electric')) decoded.engineType = 'Electric';
      }
      if (!decoded.plantCity) decoded.plantCity = get(31);
      if (!decoded.plantCountry) decoded.plantCountry = get(75);
    }

    // --- Step 2: Parts Intelligence (3 separate sections) ---
    const make = decoded.make;
    const fullModel = decoded.model;
    const year = decoded.year;

    // Strip NHTSA model to base name: "Tacoma Access Cab" → "Tacoma", "Camry LE" → "Camry"
    // Keep compound models like "Grand Cherokee", "CR-V", "RAV4", "4Runner"
    const baseModel = extractBaseModel(fullModel);
    log.info({ make, fullModel, baseModel, year }, 'VIN scan: searching with base model');

    let salesHistory = [];  // YOUR SALES HISTORY
    let currentStock = [];  // YOUR CURRENT STOCK
    let marketRef = [];     // MARKET REFERENCE (competitors)

    if (make && baseModel) {
      // 2a: YourSale — parts we've SOLD for this vehicle
      try {
        const sales = await database('YourSale')
          .whereNotNull('title')
          .whereRaw('"title" ILIKE ?', [`%${make}%`])
          .whereRaw('"title" ILIKE ?', [`%${baseModel}%`])
          .select('title', 'salePrice', 'soldDate')
          .orderBy('soldDate', 'desc');

        const byType = {};
        for (const sale of sales) {
          const pt = detectPartTypeForVin(sale.title);
          if (!byType[pt]) byType[pt] = { partType: pt, sold: 0, salesData: [], lastSoldDate: null, titles: [] };
          byType[pt].sold++;
          byType[pt].salesData.push({ price: parseFloat(sale.salePrice) || 0, soldDate: sale.soldDate });
          if (!byType[pt].lastSoldDate && sale.soldDate) byType[pt].lastSoldDate = sale.soldDate;
          if (byType[pt].titles.length < 2) byType[pt].titles.push(sale.title);
        }
        for (const [pt, data] of Object.entries(byType)) {
          const avg = vinWeightedAvg(data.salesData);
          salesHistory.push({
            partType: pt, sold: data.sold, avgPrice: avg, lastSoldDate: data.lastSoldDate,
            sampleTitle: data.titles[0] || null,
            color: avg >= 300 ? 'green' : avg >= 200 ? 'yellow' : avg >= 100 ? 'orange' : 'red',
          });
        }
        salesHistory.sort((a, b) => b.avgPrice - a.avgPrice);
      } catch (e) {
        log.warn({ err: e.message, make, model }, 'VIN scan: YourSale query failed');
      }

      // 2b: YourListing — parts we currently HAVE IN STOCK
      // TODO: Use partIntelligence.countStock() instead of ILIKE for PN-first matching
      try {
        const listings = await database('YourListing')
          .whereNotNull('title')
          .where('listingStatus', 'Active')
          .whereRaw('"title" ILIKE ?', [`%${make}%`])
          .whereRaw('"title" ILIKE ?', [`%${baseModel}%`])
          .select('title', 'currentPrice', 'quantityAvailable', 'sku');

        const byType = {};
        for (const l of listings) {
          const pt = detectPartTypeForVin(l.title);
          if (!byType[pt]) byType[pt] = { partType: pt, inStock: 0, totalPrice: 0, listings: [] };
          byType[pt].inStock += parseInt(l.quantityAvailable) || 1;
          byType[pt].totalPrice += parseFloat(l.currentPrice) || 0;
          if (byType[pt].listings.length < 3) byType[pt].listings.push({
            title: l.title, price: parseFloat(l.currentPrice) || 0, sku: l.sku,
          });
        }
        for (const [pt, data] of Object.entries(byType)) {
          const avg = data.listings.length > 0 ? Math.round(data.totalPrice / data.listings.length) : 0;
          currentStock.push({
            partType: pt, inStock: data.inStock, avgPrice: avg, listings: data.listings,
            color: avg >= 300 ? 'green' : avg >= 200 ? 'yellow' : avg >= 100 ? 'orange' : 'red',
          });
        }
        currentStock.sort((a, b) => b.avgPrice - a.avgPrice);
      } catch (e) {
        log.warn({ err: e.message, make, model }, 'VIN scan: YourListing query failed');
      }

      // 2c: Item table — specific parts with verdicts, rebuild separated
      try {
        let items = [];
        // Auto+AIC join with ±1 year range
        if (year) {
          items = await database('Auto')
            .join('AutoItemCompatibility', 'Auto.id', 'AutoItemCompatibility.autoId')
            .join('Item', 'AutoItemCompatibility.itemId', 'Item.id')
            .whereRaw('"Auto"."year"::int >= ? AND "Auto"."year"::int <= ?', [year - 1, year + 1])
            .whereRaw('UPPER("Auto"."make") = ?', [make.toUpperCase()])
            .whereRaw('UPPER(REPLACE(REPLACE("Auto"."model", \'-\', \'\'), \' \', \'\')) = UPPER(REPLACE(REPLACE(?, \'-\', \'\'), \' \', \'\'))', [baseModel])
            .where('Item.price', '>', 0)
            .select('Item.title', 'Item.price', 'Item.seller', 'Item.manufacturerPartNumber', 'Item.isRepair')
            .orderBy('Item.price', 'desc')
            .limit(200);
        }
        // Fallback for sparse results on newer vehicles: title ILIKE with year range
        if (items.length < 5 && year) {
          const yearRange = [];
          for (let y = year - 2; y <= year + 2; y++) yearRange.push(String(y));
          const yearRegex = '(' + yearRange.join('|') + ')';
          const fallback = await database('Item')
            .where('price', '>', 0)
            .whereRaw('"title" ILIKE ?', [`%${make}%`])
            .whereRaw('"title" ILIKE ?', [`%${baseModel}%`])
            .whereRaw('"title" ~ ?', [yearRegex])
            .select('title', 'price', 'seller', 'manufacturerPartNumber', 'isRepair')
            .orderBy('price', 'desc')
            .limit(20);
          // Merge without duplicates
          const existingPNs = new Set(items.map(i => i.manufacturerPartNumber).filter(Boolean));
          for (const fb of fallback) {
            if (fb.manufacturerPartNumber && existingPNs.has(fb.manufacturerPartNumber)) continue;
            items.push(fb);
          }
        }

        // Extract vehicle engine displacement for filtering
        const vDispMatch = (decoded.engine || '').match(/(\d+\.\d)/);
        const vDisp = vDispMatch ? vDispMatch[1] : null;

        // Build sales/stock lookups
        const salesByType = {};
        for (const sh of salesHistory) salesByType[sh.partType] = { sold: sh.sold, avgPrice: sh.avgPrice };
        const stockByType = {};
        for (const cs of currentStock) stockByType[cs.partType] = cs.inStock;

        // Filter + group items by part type
        const EXCLUDED_TYPES = new Set(['XFER CASE', 'STEERING', null]);
        const byType = {};
        for (const item of items) {
          const title = item.title || '';
          const titleUpper = title.toUpperCase();
          const pt = detectPartTypeForVin(title);

          // Exclude transfer case and steering
          if (EXCLUDED_TYPES.has(pt) || titleUpper.includes('TRANSFER CASE') || titleUpper.includes('XFER CASE') ||
              titleUpper.includes('POWER STEERING') || titleUpper.includes('STEERING PUMP') || titleUpper.includes('STEERING RACK')) continue;

          // Year range check: parse years from title and check vehicle fits
          if (year) {
            const rangeMatch = titleUpper.match(/\b((?:19|20)?\d{2})\s*[-–]\s*((?:19|20)?\d{2})\b/);
            if (rangeMatch) {
              let y1 = parseInt(rangeMatch[1]), y2 = parseInt(rangeMatch[2]);
              if (y1 < 100) y1 += y1 >= 70 ? 1900 : 2000;
              if (y2 < 100) y2 += y2 >= 70 ? 1900 : 2000;
              if (y1 > y2) { const tmp = y1; y1 = y2; y2 = tmp; }
              if (year < y1 || year > y2) continue;
            }
            const singleYears = titleUpper.match(/\b((?:19|20)\d{2})\b/g);
            if (singleYears && singleYears.length === 1 && !rangeMatch) {
              const partYear = parseInt(singleYears[0]);
              if (Math.abs(year - partYear) > 2) continue;
            }
          }

          // Engine displacement mismatch
          if (vDisp) {
            const pDispMatch = titleUpper.match(/(\d+\.\d)L/);
            if (pDispMatch && pDispMatch[1] !== vDisp) continue;
          }

          const isRebuild = item.seller === 'pro-rebuild' || item.isRepair === true;
          const key = pt + (isRebuild ? '_rebuild' : '');
          if (!byType[key]) byType[key] = { partType: pt, isRebuild, items: [], totalPrice: 0 };
          byType[key].items.push({
            title, price: parseFloat(item.price) || 0,
            seller: item.seller, partNumber: item.manufacturerPartNumber,
          });
          byType[key].totalPrice += parseFloat(item.price) || 0;
        }

        for (const [key, data] of Object.entries(byType)) {
          const avg = data.items.length > 0 ? Math.round(data.totalPrice / data.items.length) : 0;
          const yourSold = salesByType[data.partType]?.sold || 0;
          const yourAvg = salesByType[data.partType]?.avgPrice || 0;
          const inStock = stockByType[data.partType] || 0;
          let verdict = 'SKIP';
          if (!data.isRebuild) {
            if (inStock === 0 && yourSold >= 2) verdict = 'PULL';
            else if (inStock === 0 && yourSold >= 1) verdict = 'WATCH';
            else if (inStock <= 2 && yourSold >= 3) verdict = 'WATCH';
          }
          const colorPrice = yourAvg > 0 ? yourAvg : avg;
          marketRef.push({
            partType: data.partType, count: data.items.length, avgPrice: avg,
            yourSold, yourAvg, inStock, verdict, isRebuild: data.isRebuild,
            partNumbers: [...new Set(data.items.map(i => i.partNumber).filter(Boolean))].slice(0, 5),
            sellers: [...new Set(data.items.map(i => i.seller).filter(Boolean))],
            topItems: data.items.slice(0, 3).map(i => ({ title: i.title, price: i.price, seller: i.seller, pn: i.partNumber })),
            color: colorPrice >= 300 ? 'green' : colorPrice >= 200 ? 'yellow' : colorPrice >= 100 ? 'orange' : 'red',
          });
        }
        marketRef.sort((a, b) => {
          if (a.isRebuild !== b.isRebuild) return a.isRebuild ? 1 : -1;
          return (b.yourAvg || b.avgPrice) - (a.yourAvg || a.avgPrice);
        });
      } catch (e) {
        log.warn({ err: e.message, make, baseModel }, 'VIN scan: Item query failed');
      }
    }

    // Total estimated value (from sales avg or competitor avg)
    const totalValue = salesHistory.reduce((sum, p) => sum + (p.avgPrice || 0), 0)
      || marketRef.reduce((sum, p) => sum + (p.avgPrice || 0), 0);

    // --- Step 3: Log the scan ---
    try {
      await database('vin_scan_log').insert({
        vin, year: decoded.year, make: decoded.make, model: decoded.model,
        trim: decoded.trim, engine: decoded.engine,
        engine_type: decoded.engineType, drivetrain: decoded.drivetrain,
        scanned_by: scannedBy || null, source: source || 'manual',
        scanned_at: new Date(),
      });
    } catch (e) { /* table may not exist yet */ }

    // --- Step 5: AI Research for newer vehicles with sparse data ---
    let aiResearch = null;
    const nonRebuildParts = marketRef.filter(p => !p.isRebuild).length;
    const minYear = new Date().getFullYear() - 8; // 2017+ for 2025
    if (year >= minYear && nonRebuildParts < 5 && make && baseModel) {
      try {
        // Check cache first
        let cached = null;
        try {
          cached = await database('ai_vehicle_research')
            .where({ year, make: make.toUpperCase(), model: baseModel.toUpperCase() })
            .first();
        } catch (e) { /* table may not exist */ }

        if (cached) {
          aiResearch = cached.research;
        } else {
          const apiKey = process.env.ANTHROPIC_API_KEY;
          if (apiKey) {
            const engineDesc = decoded.engine || '';
            const aiRes = await axios.post('https://api.anthropic.com/v1/messages', {
              model: 'claude-sonnet-4-20250514',
              max_tokens: 500,
              messages: [{
                role: 'user',
                content: `What used OEM parts have the highest resale value for a ${year} ${make} ${baseModel} ${engineDesc}? List the top 10 parts that sell well on eBay as used/pulled parts from junkyards. For each part include: part name, typical eBay price range, and whether it requires programming. Focus on electronic modules, sensors, and hard-to-find components. Format as a simple list.`
              }]
            }, {
              headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
              timeout: 15000,
            });
            aiResearch = aiRes.data?.content?.[0]?.text || null;

            // Cache it
            if (aiResearch) {
              try {
                await database('ai_vehicle_research').insert({
                  year, make: make.toUpperCase(), model: baseModel.toUpperCase(),
                  engine: engineDesc || null, research: aiResearch,
                });
              } catch (e) { /* cache write failure non-fatal */ }
            }
          }
        }
      } catch (e) {
        log.warn({ err: e.message }, 'AI research failed');
      }
    }

    // Limit response size to prevent mobile memory issues
    res.json({
      success: true, vin, decoded, baseModel, totalValue,
      salesHistory: salesHistory.slice(0, 15),
      currentStock: currentStock.slice(0, 15),
      marketRef: marketRef.slice(0, 20),
      aiResearch,
    });
  } catch (err) {
    log.error({ err }, 'VIN scan failed');
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /vin/history
 * Recent scan history
 */
router.get('/history', async (req, res) => {
  try {
    const { limit = 50 } = req.query;
    const scans = await database('vin_scan_log')
      .orderBy('scanned_at', 'desc')
      .limit(parseInt(limit))
      .select('*');
    res.json({ success: true, scans });
  } catch (err) {
    res.json({ success: true, scans: [] });
  }
});

/**
 * Recency-weighted avg price. Recent sales count more.
 */
function vinWeightedAvg(sales) {
  if (!sales || sales.length === 0) return 0;
  let ws = 0, wt = 0;
  for (const s of sales) {
    const d = s.soldDate ? Math.floor((Date.now() - new Date(s.soldDate).getTime()) / 86400000) : 999;
    const w = d <= 30 ? 1.0 : d <= 90 ? 0.75 : d <= 180 ? 0.5 : 0.25;
    ws += (s.price || 0) * w;
    wt += w;
  }
  return wt > 0 ? Math.round(ws / wt) : 0;
}

/**
 * Extract base model from NHTSA full model string.
 * "Tacoma Access Cab" → "Tacoma"
 * "Camry LE" → "Camry"
 * "Grand Cherokee" → "Grand Cherokee"
 * "CR-V" → "CR-V"
 * "RAV4" → "RAV4"
 * "Ram 1500" → "Ram 1500"
 */
function extractBaseModel(model) {
  if (!model) return null;
  const m = model.trim();

  // Known compound models — keep as-is
  const compounds = ['Grand Cherokee','Grand Caravan','Town & Country','Town and Country',
    'Land Cruiser','Ram 1500','Ram 2500','Ram 3500','CR-V','CX-5','CX-9','HR-V',
    'RAV4','4Runner','MR2','RX-8','FR-S','BR-Z','WR-X','NX 200','RX 350',
    'IS 250','GS 350','ES 350','CT 200','LS 460','GX 460','LX 570',
    'Q50','Q60','QX60','QX80','G35','G37','M35','M37','FX35','FX45',
    'MKX','MKZ','MKS','MKC','MKT','GL450','ML350','GLE 350','GLC 300',
    'C 300','E 350','S 550','CLA 250','GLA 250','GLK 350',
    'X5','X3','X1','Z4','M3','M5'];

  for (const c of compounds) {
    if (m.toUpperCase().startsWith(c.toUpperCase())) return c;
  }

  // Trim suffixes: "Tacoma Access Cab" → "Tacoma", "Camry LE" → "Camry"
  // Keep first word, plus second word if it's a number (e.g. "Ram 1500", "F-150")
  const words = m.split(/\s+/);
  if (words.length === 1) return words[0];

  // If second word is a number/trim code, keep both: "Silverado 1500", "F-150"
  if (/^\d/.test(words[1]) || /^[A-Z]-?\d/.test(words[1])) {
    return words.slice(0, 2).join(' ');
  }

  // If second word is a known trim/body suffix, drop it
  const trimSuffixes = ['LE','SE','XLE','XSE','SR','SR5','LX','EX','DX','SX','LT','LS','SS',
    'SXT','RT','GT','SL','SV','S','Limited','Platinum','Premium','Sport','Base',
    'Touring','Laredo','Overland','Trailhawk','Sahara','Rubicon','Willys',
    'Access','Double','Crew','Regular','Cab','Extended','SuperCrew','SuperCab',
    'Sedan','Coupe','Hatchback','Wagon','Convertible','Van','Cargo','Passenger',
    'Short','Long','Bed','Box','4dr','2dr','4D','2D'];

  if (trimSuffixes.some(s => words[1].toUpperCase() === s.toUpperCase())) {
    return words[0];
  }

  // Default: keep first word only
  return words[0];
}

function detectPartTypeForVin(title) {
  const t = (title || '').toUpperCase();
  if (t.includes('TCM') || t.includes('TCU') || t.includes('TRANSMISSION CONTROL')) return 'TCM';
  if (t.includes('BCM') || t.includes('BODY CONTROL')) return 'BCM';
  if (t.includes('ECM') || t.includes('ECU') || t.includes('PCM') || t.includes('ENGINE CONTROL') || t.includes('ENGINE COMPUTER')) return 'ECM';
  if (t.includes('ABS') || t.includes('ANTI LOCK') || t.includes('ANTI-LOCK') || t.includes('BRAKE MODULE')) return 'ABS';
  if (t.includes('TIPM') || t.includes('FUSE BOX') || t.includes('JUNCTION') || t.includes('RELAY BOX') || t.includes('IPDM')) return 'TIPM';
  if (t.includes('AMPLIFIER') || t.includes('BOSE') || t.includes('HARMAN') || t.includes('ALPINE') || t.includes('JBL')) return 'AMP';
  if (t.includes('CLUSTER') || t.includes('SPEEDOMETER') || t.includes('INSTRUMENT') || t.includes('GAUGE')) return 'CLUSTER';
  if (t.includes('RADIO') || t.includes('HEAD UNIT') || t.includes('INFOTAINMENT') || t.includes('STEREO')) return 'RADIO';
  if (t.includes('THROTTLE')) return 'THROTTLE';
  if (t.includes('TRANSFER CASE') || t.includes('XFER CASE')) return null; // excluded
  if (t.includes('STEERING') || t.includes('EPS') || t.includes('POWER STEERING')) return null; // excluded
  if (t.includes('WINDOW') && t.includes('REGULATOR')) return 'REGULATOR';
  if (t.includes('MIRROR')) return 'MIRROR';
  return 'OTHER';
}

module.exports = router;
```
---
## FILE: service/index.js
```javascript
'use strict';

const { log } = require('./lib/logger');
const { Model } = require('objection');
const { database } = require('./database/database');

const schedule = require('node-schedule');
const CronWorkRunner = require('./lib/CronWorkRunner');
const PriceCheckCronRunner = require('./lib/PriceCheckCronRunner');
const path = require('path');
const express = require('express');
const bodyParser = require('body-parser');
const dotenv = require('dotenv');
dotenv.config();
const { authMiddleware } = require('./middleware/Middleware');

const app = express();
const cors = require('cors')
const compression = require('compression');
const PORT = process.env.PORT || 9000;
app.use(compression()); // gzip all responses — critical for mobile
app.use(bodyParser.json({ limit: '50mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '50mb' }));
app.use(cors());


app.get('/api/health-check', (req, res) => res.json({ ok: true, time: new Date(), env: process.env.NODE_ENV }));

// Debug: test market cache lookup for a specific key
app.get('/api/debug/market-cache', async (req, res) => {
  const { key, pn } = req.query;
  try {
    const { getCachedPrice, buildSearchQuery } = require('./services/MarketPricingService');
    const { extractPartNumbers } = require('./utils/partIntelligence');

    const results = {};

    // If PN provided, extract and look up
    if (pn) {
      const pns = extractPartNumbers(pn);
      results.extractedPNs = pns;
      if (pns.length > 0) {
        const sq = buildSearchQuery({ title: pn });
        results.searchQuery = sq;
        results.cached = await getCachedPrice(sq.cacheKey);
      }
    }

    // If key provided, look up directly
    if (key) {
      results.directLookup = await getCachedPrice(key);
    }

    // Sample from cache (correct column names)
    const sample = await database.raw('SELECT part_number_base, ebay_avg_price, ebay_sold_90d, last_updated FROM market_demand_cache ORDER BY last_updated DESC LIMIT 10');
    results.cacheSample = sample.rows;

    // Total counts
    const counts = await database.raw('SELECT COUNT(*) as total, COUNT(CASE WHEN ebay_avg_price > 0 THEN 1 END) as with_price FROM market_demand_cache');
    results.cacheStats = counts.rows[0];

    res.json(results);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.use('/items', require('./routes/items'));
app.use('/cron', require('./routes/cron'));
app.use('/autos', require('./routes/autos'));
app.use('/users', require('./routes/user'));
app.use('/filters', require('./routes/filters'));
app.use('/sync', require('./routes/sync'));
app.use('/intelligence', require('./routes/intelligence'));
app.use('/market-research', require('./routes/market-research'));
app.use('/pricing', require('./routes/pricing'));
app.use('/demand-analysis', require('./routes/demand-analysis'));
app.use('/price-check', require('./routes/price-check'));
app.use('/yards', require('./routes/yards'));
app.use('/attack-list', require('./routes/attack-list'));
app.use('/cogs', require('./routes/cogs'));
// partsLookup mounted first so its /lookup takes priority over old parts.js /lookup
app.use('/api/parts', require('./routes/partsLookup'));
app.use('/api/parts', require('./routes/parts'));
app.use('/api/parts-lookup', require('./routes/partsLookup'));
app.use('/restock', require('./routes/restockReport'));
app.use('/restock-want-list', require('./routes/restock-want-list'));
app.use('/scout-alerts', require('./routes/scout-alerts'));
app.use('/opportunities', require('./routes/opportunities'));
app.use('/api/fitment', require('./routes/fitment'));
app.use('/api/listing-tool', require('./routes/listing-tool'));
app.get('/admin/opportunities', (req, res) => {
  res.sendFile(path.resolve(__dirname, 'public', 'opportunities.html'));
});
app.get('/admin/restock', (req, res) => {
  res.sendFile(path.resolve(__dirname, 'public', 'restock.html'));
});
app.get('/admin/restock-list', (req, res) => {
  res.sendFile(path.resolve(__dirname, 'public', 'restock-list.html'));
});

// Test LKQ fetch — try both axios and curl from Railway
app.get('/api/test-lkq', async (req, res) => {
  const { execSync } = require('child_process');
  const url = 'https://www.pyp.com/inventory/raleigh-1168/';
  const results = {};

  // Test 1: curl
  try {
    const curlResult = execSync(
      `curl -s -o /dev/null -w "%{http_code}" -L --max-time 10 -H "User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" "${url}"`,
      { encoding: 'utf-8', timeout: 15000 }
    ).trim();
    results.curl_status = curlResult;
  } catch (e) {
    results.curl_error = e.message?.substring(0, 100);
  }

  // Test 2: curl with body
  try {
    const html = execSync(
      `curl -s -L --max-time 10 -H "User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" "${url}"`,
      { maxBuffer: 5 * 1024 * 1024, encoding: 'utf-8', timeout: 15000 }
    );
    results.curl_body_length = html.length;
    results.curl_has_vehicles = html.includes('pypvi_resultRow');
    results.curl_has_cf = html.includes('Just a moment');
    results.curl_title = (html.match(/<title[^>]*>([^<]*)/)||[])[1] || '';
  } catch (e) {
    results.curl_body_error = e.message?.substring(0, 100);
  }

  // Test 3: which curl
  try {
    results.curl_path = execSync('which curl 2>/dev/null || echo "not found"', { encoding: 'utf-8' }).trim();
    results.curl_version = execSync('curl --version 2>/dev/null | head -1', { encoding: 'utf-8' }).trim();
  } catch (e) {
    results.curl_path = 'error: ' + e.message?.substring(0, 50);
  }

  res.json(results);
});

// Decode all undecoded VINs in yard_vehicle
app.post('/api/decode-vins', async (req, res) => {
  try {
    const VinDecodeService = require('./services/VinDecodeService');
    const service = new VinDecodeService();
    const result = await service.decodeAllUndecoded();
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Build scrape queue from sales data
app.post('/api/build-scrape-queue', async (req, res) => {
  try {
    const { buildQueue } = require('./scripts/buildScrapeQueue');
    const result = await buildQueue();
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
app.use('/part-location', require('./routes/part-location'));
app.use('/vin', require('./routes/vin'));
app.use('/stale-inventory', require('./routes/stale-inventory'));
app.use('/competitors', require('./routes/competitors'));
app.use('/trim-intelligence', require('./routes/trim-intelligence'));
app.use('/ebay-messaging', require('./routes/ebay-messaging'));
// Serve static admin tools with cache headers
app.use('/admin', express.static(path.resolve(__dirname, 'public'), {
  maxAge: '10m',  // Cache static files for 10 minutes
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.png') || filePath.endsWith('.jpg') || filePath.endsWith('.svg')) {
      res.setHeader('Cache-Control', 'public, max-age=86400'); // Images: 24h
    }
  }
}));
app.get('/admin/import', (req, res) => {
  res.sendFile(path.resolve(__dirname, 'public', 'import.html'));
});
// Attack list - public, no auth required (puller-facing)
app.get('/puller', (req, res) => {
  res.sendFile(path.resolve(__dirname, 'public', 'attack-list.html'));
});
app.get('/admin/pull', (req, res) => {
  res.sendFile(path.resolve(__dirname, 'public', 'attack-list.html'));
});
app.get('/admin/gate', (req, res) => {
  res.sendFile(path.resolve(__dirname, 'public', 'gate.html'));
});
app.get('/admin/vin', (req, res) => {
  res.sendFile(path.resolve(__dirname, 'public', 'vin-scanner.html'));
});
app.get('/admin/hunters-perch', (req, res) => {
  res.sendFile(path.resolve(__dirname, 'public', 'hunters-perch.html'));
});
app.get('/admin/phoenix', (req, res) => {
  res.sendFile(path.resolve(__dirname, 'public', 'phoenix.html'));
});
app.get('/admin/the-mark', (req, res) => {
  res.sendFile(path.resolve(__dirname, 'public', 'the-mark.html'));
});
app.get('/admin/velocity', (req, res) => {
  res.sendFile(path.resolve(__dirname, 'public', 'velocity.html'));
});
app.get('/admin/instincts', (req, res) => {
  res.sendFile(path.resolve(__dirname, 'public', 'instincts.html'));
});
app.get('/admin/prey-cycle', (req, res) => {
  res.sendFile(path.resolve(__dirname, 'public', 'prey-cycle.html'));
});
app.get('/admin/carcass', (req, res) => {
  res.sendFile(path.resolve(__dirname, 'public', 'stale-inventory.html'));
});
app.get('/admin/scout-alerts', (req, res) => {
  res.sendFile(path.resolve(__dirname, 'public', 'scout-alerts.html'));
});
app.get('/admin/alerts', (req, res) => {
  res.sendFile(path.resolve(__dirname, 'public', 'alerts.html'));
});
app.get('/admin/sales', (req, res) => {
  res.sendFile(path.resolve(__dirname, 'public', 'sales.html'));
});
app.get('/admin/competitors', (req, res) => {
  res.sendFile(path.resolve(__dirname, 'public', 'competitors.html'));
});
app.get('/admin/test', (req, res) => {
  res.sendFile(path.resolve(__dirname, 'public', 'test.html'));
});
app.get('/admin/listing-tool', (req, res) => {
  res.sendFile(path.resolve(__dirname, 'public', 'listing-tool.html'));
});
app.get('/admin/listing-tool-v2', (req, res) => {
  res.sendFile(path.resolve(__dirname, 'public', 'listing-tool-v2.html'));
});
app.get('/admin/flyway', (req, res) => {
  res.sendFile(path.resolve(__dirname, 'public', 'flyway.html'));
});
// private routes for admin only
app.use('/private', require('./routes/private'));
app.get('/test', (req, res) => {
  res.json('haribol');
});

// Market pricing batch trigger — kicks off full pricing pass in background
app.post('/api/market-price/run-batch', async (req, res) => {
  res.json({ started: true, message: 'Pricing pass started in background. Check /api/debug/full for market_demand_cache freshness.' });
  try {
    const { runPricingPass } = require('./services/MarketPricingService');
    const result = await runPricingPass();
    log.info({ result }, '[MarketPricing] Manual batch complete');
  } catch (err) {
    log.error({ err: err.message }, '[MarketPricing] Manual batch failed');
  }
});

// Market pricing test route — scrapes eBay sold comps for a single query
app.get('/api/market-price', async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  const { q } = req.query;
  if (!q) return res.status(400).json({ error: 'Provide ?q=searchquery or ?q=68163904AC' });
  try {
    const { singlePriceCheck } = require('./services/MarketPricingService');
    const result = await singlePriceCheck(q);
    res.json({ success: true, ...result });
  } catch (err) {
    log.error({ err, query: q }, 'Market price check failed');
    res.status(500).json({ error: err.message, stack: err.stack });
  }
});

// Build Auto + AutoItemCompatibility from uploaded JSON with clean _year/_make/_model
// Body: { records: [{ id, ebayId, _year, _make, _model }], clearFirst: true }
app.post('/api/build-auto-index', async (req, res) => {
  const { database } = require('./database/database');
  const { v4: uuidv4 } = require('uuid');
  try {
    const { records, clearFirst } = req.body || {};

    // If clearFirst, wipe the bad title-parsed data
    if (clearFirst) {
      await database('AutoItemCompatibility').delete();
      await database('Auto').delete();
    }

    // If no records, just return counts
    if (!records || !Array.isArray(records) || records.length === 0) {
      const ac = await database('Auto').count('* as cnt').first();
      const lc = await database('AutoItemCompatibility').count('* as cnt').first();
      return res.json({ success: true, cleared: !!clearFirst, totalAutos: parseInt(ac?.cnt||0), totalLinks: parseInt(lc?.cnt||0) });
    }

    const autoCache = {};
    let autosCreated = 0, linksCreated = 0, skipped = 0, errors = 0;

    for (const r of records) {
      const year = parseInt(r._year);
      const make = (r._make || '').trim();
      const model = (r._model || '').trim();
      const itemId = r.id;

      if (!year || year < 1990 || year > 2030 || !make || !model || !itemId) { skipped++; continue; }

      const engine = 'N/A';
      const ak = `${year}|${make}|${model}`;
      let autoId = autoCache[ak];
      if (!autoId) {
        const ex = await database('Auto').where({ year, make, model, engine }).first();
        if (ex) { autoId = ex.id; }
        else {
          autoId = uuidv4();
          try {
            await database('Auto').insert({ id: autoId, year, make, model, trim: '', engine, createdAt: new Date(), updatedAt: new Date() });
            autosCreated++;
          } catch (e) {
            const f = await database('Auto').where({ year, make, model, engine }).first();
            autoId = f?.id || autoId;
          }
        }
        autoCache[ak] = autoId;
      }

      try {
        const le = await database('AutoItemCompatibility').where({ autoId, itemId }).first();
        if (!le) {
          await database('AutoItemCompatibility').insert({ autoId, itemId, createdAt: new Date() });
          linksCreated++;
        }
      } catch (e) { errors++; }
    }

    const ac = await database('Auto').count('* as cnt').first();
    const lc = await database('AutoItemCompatibility').count('* as cnt').first();
    res.json({ success: true, processed: records.length, autosCreated, linksCreated, skipped, errors, totalAutos: parseInt(ac?.cnt||0), totalLinks: parseInt(lc?.cnt||0) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});


// Full diagnostic — raw SQL queries against production database
app.get('/api/debug/full', async (req, res) => {
  const { database } = require('./database/database');
  const results = {};
  const q = async (label, sql) => {
    try { const r = await database.raw(sql); results[label] = r.rows || r; }
    catch (e) { results[label] = { ERROR: e.message }; }
  };

  await q('all_tables', "SELECT schemaname, tablename, n_live_tup FROM pg_stat_user_tables ORDER BY n_live_tup DESC");
  await q('yard_vehicle_schema', "SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'yard_vehicle' ORDER BY ordinal_position");
  await q('yard_vehicle_sample', "SELECT * FROM yard_vehicle ORDER BY scraped_at DESC LIMIT 3");
  await q('yard_vehicle_vin_status', "SELECT COUNT(*) as total, COUNT(vin) as has_vin, SUM(CASE WHEN vin_decoded = true THEN 1 ELSE 0 END) as decoded FROM yard_vehicle");
  await q('your_sale_90d', "SELECT COUNT(*) as count, ROUND(SUM(\"salePrice\"::numeric), 2) as revenue FROM \"YourSale\" WHERE \"soldDate\" >= NOW() - INTERVAL '90 days'");
  await q('your_sale_180d', "SELECT COUNT(*) as count FROM \"YourSale\" WHERE \"soldDate\" >= NOW() - INTERVAL '180 days'");
  await q('your_sale_sample', "SELECT title, \"salePrice\", \"soldDate\" FROM \"YourSale\" ORDER BY \"soldDate\" DESC LIMIT 3");
  await q('your_listing_active', "SELECT COUNT(*) as count FROM \"YourListing\" WHERE \"listingStatus\" = 'Active'");
  await q('your_listing_sample', "SELECT title, \"currentPrice\", \"quantityAvailable\", sku FROM \"YourListing\" WHERE \"listingStatus\" = 'Active' LIMIT 3");
  await q('your_sale_schema', "SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'YourSale' ORDER BY ordinal_position");
  await q('your_listing_schema', "SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'YourListing' ORDER BY ordinal_position");
  await q('item_schema', "SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'Item' ORDER BY ordinal_position");
  await q('item_sample', "SELECT title, price, seller, \"manufacturerPartNumber\" FROM \"Item\" LIMIT 3");
  await q('platform_group_count', "SELECT COUNT(*) as count FROM platform_group");
  await q('platform_group_sample', "SELECT * FROM platform_group LIMIT 5");
  await q('platform_vehicle_count', "SELECT COUNT(*) as count FROM platform_vehicle");
  await q('platform_shared_part_count', "SELECT COUNT(*) as count FROM platform_shared_part");
  await q('mustang_sales', "SELECT title, \"salePrice\", \"soldDate\" FROM \"YourSale\" WHERE title ILIKE '%mustang%' ORDER BY \"soldDate\" DESC LIMIT 5");
  await q('mustang_stock', "SELECT title, \"currentPrice\", \"quantityAvailable\" FROM \"YourListing\" WHERE title ILIKE '%mustang%' AND \"listingStatus\" = 'Active' LIMIT 5");
  await q('dodge_ram_sales_90d', "SELECT title, \"salePrice\", \"soldDate\" FROM \"YourSale\" WHERE title ILIKE '%dodge%' AND title ILIKE '%ram%' AND \"soldDate\" >= NOW() - INTERVAL '90 days' ORDER BY \"soldDate\" DESC LIMIT 5");
  await q('auto_sample', "SELECT year, make, model, engine FROM \"Auto\" LIMIT 5");
  await q('auto_item_compat_sample', "SELECT a.year, a.make, a.model, i.title, i.price FROM \"Auto\" a JOIN \"AutoItemCompatibility\" aic ON a.id = aic.\"autoId\" JOIN \"Item\" i ON aic.\"itemId\" = i.id LIMIT 5");

  res.json(results);
});

// One-time dedup YourSale — removes duplicate ebayItemId+soldDate rows
app.post('/api/admin/dedup-sales', async (req, res) => {
  const { database } = require('./database/database');
  try {
    const before = await database.raw('SELECT COUNT(*) as count FROM "YourSale"');
    const before90 = await database.raw('SELECT COUNT(*) as count, ROUND(SUM("salePrice"::numeric),2) as revenue FROM "YourSale" WHERE "soldDate" >= NOW() - INTERVAL \'90 days\'');

    // Delete duplicates: keep the row with the smallest id (first inserted)
    // Round 1: same ebayItemId + same soldDate
    await database.raw(`
      DELETE FROM "YourSale" a USING "YourSale" b
      WHERE a.id > b.id
        AND a."ebayItemId" = b."ebayItemId"
        AND a."soldDate"::date = b."soldDate"::date
    `);
    // Round 2: same ebayItemId (item can only be sold once)
    await database.raw(`
      DELETE FROM "YourSale" a USING "YourSale" b
      WHERE a.id > b.id
        AND a."ebayItemId" = b."ebayItemId"
    `);
    // Round 3: same title + same salePrice + same soldDate (different ebayItemId but same transaction)
    const deleted = await database.raw(`
      DELETE FROM "YourSale" a USING "YourSale" b
      WHERE a.id > b.id
        AND a.title = b.title
        AND a."salePrice" = b."salePrice"
        AND a."soldDate"::date = b."soldDate"::date
    `);

    const after = await database.raw('SELECT COUNT(*) as count FROM "YourSale"');
    const after90 = await database.raw('SELECT COUNT(*) as count, ROUND(SUM("salePrice"::numeric),2) as revenue FROM "YourSale" WHERE "soldDate" >= NOW() - INTERVAL \'90 days\'');

    res.json({
      success: true,
      before: { total: before.rows[0].count, ...before90.rows[0] },
      after: { total: after.rows[0].count, ...after90.rows[0] },
      deleted: parseInt(before.rows[0].count) - parseInt(after.rows[0].count),
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Re-format engine strings for already-decoded vehicles (fix "210cyl" → "V6")
// Also retry decoding for failed VINs
app.post('/api/admin/fix-engines', async (req, res) => {
  const { database } = require('./database/database');
  try {
    // Step 1: Fix engine strings — re-parse from vin_cache for ALL decoded vehicles
    // Targets: "2.2L 170cyl" (hp not cyl), "3.5L" (missing V6), raw decimals
    const decoded = await database('yard_vehicle')
      .where('vin_decoded', true)
      .whereNotNull('vin')
      .select('id', 'vin', 'engine');

    let fixed = 0, cacheHits = 0;
    for (const v of decoded) {
      // Re-format ALL engines that are missing cylinder labels or have bad ones
      const needsFix = !v.engine || !/(V6|V8|V10|V12|4-cyl|5-cyl)/.test(v.engine) || /\d{2,3}cyl/.test(v.engine);
      if (needsFix) {
        // Look up vin_cache for raw NHTSA data to re-parse
        try {
          const cached = await database('vin_cache').where('vin', v.vin.trim().toUpperCase()).first();
          if (cached && cached.raw_nhtsa) {
            let results;
            try { results = JSON.parse(cached.raw_nhtsa); } catch(e) { continue; }
            if (!Array.isArray(results)) continue;
            const get = (varId) => { const r = results.find(x => x.VariableId === varId); const val = r?.Value?.trim(); return (val && val !== '' && val !== 'Not Applicable') ? val : null; };
            const disp = get(13), cyl = get(71);
            if (disp) {
              const dn = parseFloat(disp);
              let eng = (!isNaN(dn) ? dn.toFixed(1) : disp) + 'L';
              const cn = parseInt(cyl);
              if (cn >= 2 && cn <= 16) {
                const lb = cn <= 4 ? '4-cyl' : cn === 5 ? '5-cyl' : cn === 6 ? 'V6' : cn === 8 ? 'V8' : cn === 10 ? 'V10' : cn === 12 ? 'V12' : cn + '-cyl';
                eng += ' ' + lb;
              }
              await database('yard_vehicle').where('id', v.id).update({ engine: eng.substring(0, 50), updatedAt: new Date() });
              fixed++;
            }
            cacheHits++;
          }
        } catch (e) { /* skip */ }
      }
    }

    // Step 2: Count remaining undecoded
    const undecoded = await database('yard_vehicle')
      .whereNotNull('vin').where('vin', '!=', '')
      .where(function() { this.where('vin_decoded', false).orWhereNull('vin_decoded'); })
      .count('* as cnt').first();

    res.json({ success: true, enginesFixed: fixed, cacheChecked: cacheHits, stillUndecoded: parseInt(undecoded?.cnt || 0) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// One-time: backfill Auto table from YourSale titles
app.post('/api/admin/backfill-auto', async (req, res) => {
  const { database } = require('./database/database');
  const { v4: uuidv4 } = require('uuid');
  try {
    const MAKES = ['Acura','Audi','BMW','Buick','Cadillac','Chevrolet','Chrysler','Dodge','Fiat','Ford','Genesis','GMC','Honda','Hummer','Hyundai','Infiniti','Isuzu','Jaguar','Jeep','Kia','Land Rover','Lexus','Lincoln','Mazda','Mercedes-Benz','Mercury','Mini','Mitsubishi','Nissan','Oldsmobile','Pontiac','Porsche','Ram','Saab','Saturn','Scion','Subaru','Suzuki','Toyota','Volkswagen','Volvo'];
    const STOP = new Set(['ECU','ECM','PCM','BCM','TCM','ABS','TIPM','OEM','NEW','USED','REMAN','Engine','Body','Control','Module','Anti','Fuse','Power','Brake','Amplifier','Radio','Cluster','Steering','Throttle','Programmed','Plug','Play','AT','MT','4WD','AWD','2WD','FWD','RWD','EX','LX','DX','SE','LE','XLE','SXT','RT','GT','LT','LS','SS','SL','SV','SR','SR5','Limited','Sport','Base','Touring','Laredo','Overland','Trailhawk','Sahara','Rubicon','Premium','Platinum','Hybrid','Diesel','Hemi','Turbo','Supercharged','Sedan','Coupe','Hatchback','Wagon','Van','Cab','Crew','Access','Double','Regular','Extended','SuperCrew','SuperCab','Short','Long','Bed','4dr','2dr','V6','V8','Dodge','Chrysler','Jeep','Ford','Chevy','Toyota','Honda','Nissan','Kia','Hyundai','Lincoln','Mercury','Mazda','Subaru','BMW','Audi','Acura','Lexus','Infiniti','GMC','Buick','Cadillac','Saturn','Pontiac','Volvo','VW','Volkswagen','Mini','Scion','Ram','Mitsubishi','Isuzu','Suzuki','Fiat','Jaguar','Porsche','Saab','Genesis','Hummer','Land','Rover','Oldsmobile']);

    // Load all existing Auto year+make+model
    const existing = new Set();
    const autos = await database('Auto').select('year','make','model');
    for (const a of autos) existing.add(`${a.year}|${a.make}|${a.model}`);
    const beforeCount = existing.size;

    // Parse YourSale titles
    const sales = await database('YourSale').whereNotNull('title').select('title');
    const toInsert = new Map(); // key → {year, make, model}

    for (const sale of sales) {
      const t = sale.title || '';
      // Extract year
      const ym = t.match(/\b((?:19|20)\d{2})\b/);
      if (!ym) continue;
      const year = parseInt(ym[1]);
      if (year < 1990 || year > 2030) continue;

      // Extract make
      const tu = t.toUpperCase();
      let make = null;
      for (const mk of MAKES) {
        if (tu.includes(mk.toUpperCase())) { make = mk; break; }
      }
      if (!make) continue;
      if (make === 'Chevy') make = 'Chevrolet';
      if (make === 'VW') make = 'Volkswagen';

      // Extract model: words after make, before stop word/engine/year
      // Keep compound models (Grand Cherokee, CR-V, Ram 1500) but stop at trims
      const COMPOUNDS = new Set(['GRAND','TOWN','LAND']);
      const makeIdx = tu.indexOf(make.toUpperCase());
      const after = t.substring(makeIdx + make.length).trim().split(/\s+/);
      const mw = [];
      for (const w of after) {
        const clean = w.replace(/[^A-Za-z0-9\-]/g, '');
        if (/^\d{4}$/.test(clean) || /^\d+\.\d+[lL]?$/.test(clean)) break;
        if (STOP.has(clean) || STOP.has(clean.toUpperCase())) break;
        mw.push(clean);
        // Only take 2nd word if first is a compound prefix (Grand, Town, Land)
        if (mw.length === 1 && COMPOUNDS.has(clean.toUpperCase())) continue;
        // Also keep 2nd word if it's a number (Ram 1500, F-150)
        if (mw.length === 2 && /^\d/.test(clean)) break;
        if (mw.length >= 1 && !COMPOUNDS.has(mw[0].toUpperCase())) break;
        if (mw.length >= 2) break;
      }
      if (mw.length === 0 || mw[0].length < 2) continue;
      let model = mw.join(' ').trim();
      if (model.length < 2 || model.length > 30) continue;

      const key = `${year}|${make}|${model}`;
      if (!existing.has(key) && !toInsert.has(key)) {
        toInsert.set(key, { year: String(year), make, model });
      }
    }

    // Batch insert
    let inserted = 0, errors = 0;
    for (const [key, v] of toInsert) {
      try {
        // Double-check not exists (race condition safety)
        const ex = await database('Auto').where({ year: v.year, make: v.make, model: v.model }).first();
        if (!ex) {
          await database('Auto').insert({ id: uuidv4(), year: v.year, make: v.make, model: v.model, trim: '', engine: 'N/A', createdAt: new Date(), updatedAt: new Date() });
          inserted++;
        }
      } catch (e) { errors++; }
    }

    // Cleanup: delete bad entries from previous backfill (multi-word non-compound models)
    const VALID_COMPOUNDS = new Set(['Grand Cherokee','Grand Caravan','Grand Prix','Town & Country','Town Country','Land Cruiser','Ram 1500','Ram 2500','Ram 3500','CR-V','CX-5','CX-9','HR-V','RAV4','4Runner','F-150','F-250','F-350','Super Duty','Monte Carlo','Park Avenue','El Camino','Trans Am','Le Sabre']);
    let cleaned = 0;
    try {
      const allAutos = await database('Auto').where('engine', 'N/A').select('id', 'model');
      for (const a of allAutos) {
        if (a.model && a.model.includes(' ') && !VALID_COMPOUNDS.has(a.model)) {
          // Multi-word model that's not a known compound — delete it
          await database('Auto').where('id', a.id).delete();
          cleaned++;
        }
      }
    } catch (e) { /* ignore cleanup errors */ }

    // Direct insert of commonly missing vehicles
    const MISSING = [
      ['Honda','Civic'],['Honda','Accord'],['Honda','Odyssey'],['Honda','Prelude'],['Honda','Element'],['Honda','Fit'],['Honda','Pilot'],
      ['Toyota','Camry'],['Toyota','Corolla'],['Toyota','Tacoma'],['Toyota','Tundra'],['Toyota','4Runner'],['Toyota','Sienna'],['Toyota','Highlander'],['Toyota','Matrix'],['Toyota','Prius'],['Toyota','Avalon'],['Toyota','Celica'],
      ['Nissan','Altima'],['Nissan','Maxima'],['Nissan','Sentra'],['Nissan','Pathfinder'],['Nissan','Frontier'],['Nissan','Xterra'],['Nissan','Murano'],['Nissan','Rogue'],['Nissan','Versa'],['Nissan','Quest'],
      ['Ford','Mustang'],['Ford','Explorer'],['Ford','Expedition'],['Ford','Ranger'],['Ford','Focus'],['Ford','Taurus'],['Ford','Escape'],['Ford','Crown Victoria'],
      ['Chevrolet','Impala'],['Chevrolet','Malibu'],['Chevrolet','Cruze'],['Chevrolet','Cobalt'],['Chevrolet','Cavalier'],['Chevrolet','Monte Carlo'],['Chevrolet','Blazer'],['Chevrolet','TrailBlazer'],['Chevrolet','Colorado'],
      ['Dodge','Durango'],['Dodge','Dakota'],['Dodge','Neon'],['Dodge','Stratus'],['Dodge','Intrepid'],['Dodge','Caravan'],
      ['Hyundai','Elantra'],['Hyundai','Sonata'],['Hyundai','Tucson'],['Hyundai','Santa Fe'],['Hyundai','Accent'],
      ['Kia','Optima'],['Kia','Sorento'],['Kia','Sportage'],['Kia','Soul'],['Kia','Forte'],['Kia','Rio'],
    ];
    let directInserted = 0;
    for (const [mk, md] of MISSING) {
      for (let yr = 1995; yr <= 2025; yr++) {
        const key = `${yr}|${mk}|${md}`;
        if (!existing.has(key)) {
          try {
            const ex = await database('Auto').where({ year: String(yr), make: mk, model: md }).first();
            if (!ex) {
              await database('Auto').insert({ id: uuidv4(), year: String(yr), make: mk, model: md, trim: '', engine: 'N/A', createdAt: new Date(), updatedAt: new Date() });
              directInserted++;
            }
          } catch (e) { /* dup */ }
        }
      }
    }

    // Flush the cache so dropdowns show new data immediately
    try {
      const CacheManager = require('./middleware/CacheManager');
      const cm = new CacheManager();
      cm.flush();
    } catch (e) { /* ignore */ }

    const afterCount = await database('Auto').count('* as cnt').first();

    res.json({
      success: true,
      before: beforeCount,
      after: parseInt(afterCount?.cnt || 0),
      parsed: toInsert.size,
      inserted,
      errors,
      cleaned,
      sample: [...toInsert.values()].slice(0, 20),
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Check which eBay env vars are configured (names only, not values)
app.get('/api/debug/env-check', async (req, res) => {
  const keys = ['TRADING_API_TOKEN','TRADING_API_DEV_NAME','TRADING_API_APP_NAME','TRADING_API_CERT_NAME','FINDINGS_APP_NAME','EBAY_TOKEN','ANTHROPIC_API_KEY','DATABASE_URL'];
  const result = {};
  for (const k of keys) {
    result[k] = process.env[k] ? `SET (${process.env[k].length} chars)` : 'NOT SET';
  }
  res.json(result);
});

// Seed Florida yards if they don't exist
app.post('/api/admin/seed-florida', async (req, res) => {
  const { database } = require('./database/database');
  const results = [];
  const yards = [
    { name: 'LKQ Tampa', chain: 'LKQ', scrape_method: 'html', visit_frequency: 'road_trip', distance_from_base: 600, enabled: true, flagged: false },
    { name: 'LKQ Largo', chain: 'LKQ', scrape_method: 'html', visit_frequency: 'road_trip', distance_from_base: 610, enabled: true, flagged: false },
    { name: 'LKQ Clearwater', chain: 'LKQ', scrape_method: 'html', visit_frequency: 'road_trip', distance_from_base: 615, enabled: true, flagged: false },
  ];
  for (const yard of yards) {
    try {
      const exists = await database('yard').where('name', yard.name).first();
      if (exists) { results.push({ name: yard.name, status: 'exists', id: exists.id }); continue; }
      const inserted = await database('yard').insert({ id: database.raw('gen_random_uuid()'), ...yard, createdAt: new Date(), updatedAt: new Date() }).returning('id');
      results.push({ name: yard.name, status: 'created', id: inserted[0]?.id || inserted[0] });
    } catch (e) { results.push({ name: yard.name, status: 'error', error: e.message }); }
  }
  res.json({ success: true, results });
});

// Full raw SQL diagnostic — replaces old debug/makes
app.get('/api/debug/makes', async (req, res) => {
  const { database } = require('./database/database');
  const R = {};
  const q = async (k, sql) => { try { const r = await database.raw(sql); R[k] = r.rows || r; } catch(e) { R[k] = {ERROR: e.message}; } };
  try {
    await q('all_tables', "SELECT tablename, n_live_tup FROM pg_stat_user_tables ORDER BY n_live_tup DESC");
    await q('yard_vehicle_schema', "SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'yard_vehicle' ORDER BY ordinal_position");
    await q('yard_vehicle_sample', "SELECT * FROM yard_vehicle ORDER BY scraped_at DESC LIMIT 3");
    await q('yard_vehicle_vin_status', "SELECT COUNT(*) as total, COUNT(vin) as has_vin, SUM(CASE WHEN vin_decoded = true THEN 1 ELSE 0 END) as decoded FROM yard_vehicle");
    await q('your_sale_schema', "SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'YourSale' ORDER BY ordinal_position");
    await q('your_sale_90d', "SELECT COUNT(*) as count, ROUND(SUM(\"salePrice\"::numeric), 2) as revenue, ROUND(AVG(\"salePrice\"::numeric), 2) as avg_price FROM \"YourSale\" WHERE \"soldDate\" >= NOW() - INTERVAL '90 days'");
    await q('your_sale_180d', "SELECT COUNT(*) as count FROM \"YourSale\" WHERE \"soldDate\" >= NOW() - INTERVAL '180 days'");
    await q('your_sale_sample', "SELECT title, \"salePrice\", \"soldDate\" FROM \"YourSale\" WHERE title IS NOT NULL ORDER BY \"soldDate\" DESC LIMIT 3");
    await q('your_listing_schema', "SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'YourListing' ORDER BY ordinal_position");
    await q('your_listing_active', "SELECT COUNT(*) as count FROM \"YourListing\" WHERE \"listingStatus\" = 'Active'");
    await q('your_listing_sample', "SELECT title, \"currentPrice\", \"quantityAvailable\", sku FROM \"YourListing\" WHERE \"listingStatus\" = 'Active' LIMIT 3");
    await q('item_schema', "SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'Item' ORDER BY ordinal_position");
    await q('item_sample', "SELECT title, price, seller, \"manufacturerPartNumber\" FROM \"Item\" LIMIT 3");
    await q('platform_counts', "SELECT (SELECT COUNT(*) FROM platform_group) as groups, (SELECT COUNT(*) FROM platform_vehicle) as vehicles, (SELECT COUNT(*) FROM platform_shared_part) as shared_parts");
    await q('platform_sample', "SELECT pg.name, pg.platform, pg.year_start, pg.year_end FROM platform_group pg LIMIT 5");
    await q('mustang_sales', "SELECT title, \"salePrice\", \"soldDate\" FROM \"YourSale\" WHERE title ILIKE '%mustang%' ORDER BY \"soldDate\" DESC LIMIT 5");
    await q('mustang_stock', "SELECT title, \"currentPrice\", \"quantityAvailable\" FROM \"YourListing\" WHERE title ILIKE '%mustang%' AND \"listingStatus\" = 'Active' LIMIT 5");
    await q('dodge_ram_sales_90d', "SELECT title, \"salePrice\", \"soldDate\" FROM \"YourSale\" WHERE title ILIKE '%dodge%' AND title ILIKE '%ram%' AND \"soldDate\" >= NOW() - INTERVAL '90 days' ORDER BY \"soldDate\" DESC LIMIT 5");
    await q('auto_sample', "SELECT year, make, model, engine FROM \"Auto\" LIMIT 5");
    await q('auto_item_join', "SELECT a.year, a.make, a.model, i.title, i.price FROM \"Auto\" a JOIN \"AutoItemCompatibility\" aic ON a.id = aic.\"autoId\" JOIN \"Item\" i ON aic.\"itemId\" = i.id LIMIT 5");
    // Env var check
    const envKeys = ['TRADING_API_TOKEN','TRADING_API_DEV_NAME','TRADING_API_APP_NAME','TRADING_API_CERT_NAME','FINDINGS_APP_NAME','ANTHROPIC_API_KEY'];
    const envCheck = {};
    for (const k of envKeys) envCheck[k] = process.env[k] ? `SET (${process.env[k].length} chars)` : 'NOT SET';
    R.env_check = envCheck;
    await q('sale_by_store', "SELECT store, COUNT(*) as cnt FROM \"YourSale\" GROUP BY store ORDER BY cnt DESC");
    await q('sale_null_store', "SELECT COUNT(*) as no_store FROM \"YourSale\" WHERE store IS NULL");
    await q('sale_date_range_by_store', "SELECT store, MIN(\"soldDate\") as earliest, MAX(\"soldDate\") as latest, COUNT(*) as cnt FROM \"YourSale\" GROUP BY store ORDER BY cnt DESC");
    await q('sale_dupes', "SELECT \"ebayItemId\", \"soldDate\"::date as sold_date, COUNT(*) as dupes FROM \"YourSale\" GROUP BY \"ebayItemId\", \"soldDate\"::date HAVING COUNT(*) > 1 LIMIT 10");
    await q('sale_most_recent', "SELECT id, \"ebayItemId\", title, \"salePrice\", \"soldDate\", store, \"createdAt\" FROM \"YourSale\" ORDER BY \"createdAt\" DESC LIMIT 5");
    await q('sale_non_csv_count', "SELECT COUNT(*) as cnt FROM \"YourSale\" WHERE \"createdAt\"::text NOT LIKE '2026-03-18T23:1%' AND \"createdAt\"::text NOT LIKE '2026-03-18T23:2%'");
    await q('sale_csv_count', "SELECT COUNT(*) as cnt FROM \"YourSale\" WHERE \"createdAt\"::text LIKE '2026-03-18T23:1%' OR \"createdAt\"::text LIKE '2026-03-18T23:2%'");
    await q('sale_non_csv_date_range', "SELECT MIN(\"soldDate\") as earliest, MAX(\"soldDate\") as latest, COUNT(*) as cnt FROM \"YourSale\" WHERE \"createdAt\"::text NOT LIKE '2026-03-18T23:1%' AND \"createdAt\"::text NOT LIKE '2026-03-18T23:2%'");
    await q('sale_created_at_groups', "SELECT \"createdAt\"::date as created_date, COUNT(*) as cnt FROM \"YourSale\" GROUP BY \"createdAt\"::date ORDER BY created_date DESC LIMIT 10");
    await q('sale_overlap_count', "SELECT COUNT(*) as overlap FROM \"YourSale\" a WHERE (a.\"createdAt\"::text LIKE '2026-03-18T23:1%' OR a.\"createdAt\"::text LIKE '2026-03-18T23:2%') AND EXISTS (SELECT 1 FROM \"YourSale\" b WHERE b.\"createdAt\"::text NOT LIKE '2026-03-18T23:1%' AND b.\"createdAt\"::text NOT LIKE '2026-03-18T23:2%' AND b.\"ebayItemId\" = a.\"ebayItemId\")");
    await q('all_public_tables', "SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename");
    await q('sale_like_tables', "SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND (tablename ILIKE '%sale%' OR tablename ILIKE '%order%' OR tablename ILIKE '%sold%' OR tablename ILIKE '%transaction%')");
    await q('yoursale_latest_created', "SELECT MAX(\"createdAt\") as latest_created, MAX(\"soldDate\") as latest_sold FROM \"YourSale\"");
    await q('yard_vehicle_by_yard', "SELECT y.name, COUNT(yv.id) as total, SUM(CASE WHEN yv.active THEN 1 ELSE 0 END) as active, MAX(yv.scraped_at) as last_scraped FROM yard y LEFT JOIN yard_vehicle yv ON y.id = yv.yard_id WHERE y.enabled = true GROUP BY y.name ORDER BY y.name");
    await q('yard_status', "SELECT id, name, enabled, last_scraped, flagged, flag_reason FROM yard WHERE chain = 'LKQ' ORDER BY name");
    await q('yard_vehicle_by_yard_id', "SELECT yard_id, COUNT(*) as total, SUM(CASE WHEN active THEN 1 ELSE 0 END) as active_count, MAX(scraped_at) as last_scraped FROM yard_vehicle GROUP BY yard_id ORDER BY total DESC");
    await q('attack_list_yards', "SELECT id, name, enabled, flagged FROM yard WHERE enabled = true AND (flagged = false OR flagged IS NULL) ORDER BY name");
    await q('fl_vehicle_dates', "SELECT y.name, COUNT(*) as total, MIN(yv.date_added) as oldest_date, MAX(yv.date_added) as newest_date, COUNT(CASE WHEN yv.date_added >= NOW() - INTERVAL '7 days' THEN 1 END) as within_7d FROM yard y JOIN yard_vehicle yv ON y.id = yv.yard_id WHERE y.name IN ('LKQ Tampa','LKQ Largo','LKQ Clearwater') AND yv.active = true GROUP BY y.name");
    await q('restock_diag_sales_7d', "SELECT COUNT(*) as cnt FROM \"YourSale\" WHERE \"soldDate\" >= NOW() - INTERVAL '7 days'");
    await q('restock_diag_sales_30d', "SELECT COUNT(*) as cnt FROM \"YourSale\" WHERE \"soldDate\" >= NOW() - INTERVAL '30 days'");
    await q('restock_diag_recent_sales', "SELECT title, \"salePrice\", \"soldDate\", sku FROM \"YourSale\" WHERE \"soldDate\" IS NOT NULL ORDER BY \"soldDate\" DESC LIMIT 10");
    await q('restock_diag_active_listings', "SELECT COUNT(*) as cnt FROM \"YourListing\" WHERE \"listingStatus\" = 'Active'");
    await q('restock_diag_sku_sample', "SELECT sku, title, \"salePrice\", \"soldDate\" FROM \"YourSale\" WHERE \"soldDate\" >= NOW() - INTERVAL '7 days' AND sku IS NOT NULL AND sku != '' ORDER BY \"soldDate\" DESC LIMIT 10");
    await q('restock_diag_sku_null_pct', "SELECT COUNT(*) as total, COUNT(CASE WHEN sku IS NOT NULL AND sku != '' THEN 1 END) as has_sku, COUNT(CASE WHEN sku IS NULL OR sku = '' THEN 1 END) as no_sku FROM \"YourSale\" WHERE \"soldDate\" >= NOW() - INTERVAL '7 days'");
    await q('restock_diag_listing_sku_sample', "SELECT sku, title, \"currentPrice\", \"quantityAvailable\" FROM \"YourListing\" WHERE \"listingStatus\" = 'Active' AND sku IS NOT NULL AND sku != '' LIMIT 5");
    await q('restock_diag_part_base_fn', "SELECT part_number_base('AL3T-15604-BD') as ford, part_number_base('56044691AA') as chrysler, part_number_base('39980-TS8-A0') as honda");
    await q('restock_diag_7d_count', "SELECT COUNT(*) as total_sales FROM \"YourSale\" WHERE \"soldDate\" >= NOW() - INTERVAL '7 days'");
    await q('restock_diag_jeep_ecm_stock', "SELECT COUNT(*) as cnt, array_agg(sku) as skus FROM \"YourListing\" WHERE \"listingStatus\" = 'Active' AND (sku ILIKE '%0518731%' OR title ILIKE '%0518731%')");
    await q('restock_diag_model_extract', "SELECT title, SUBSTRING(title FROM '(?:Jeep|Dodge|Ford|Chevrolet|Chevy|Toyota|Honda)\\s+(\\w+(?:\\s+\\w+)?)') as extracted_model FROM \"YourSale\" WHERE \"soldDate\" >= NOW() - INTERVAL '7 days' AND title ILIKE '%Jeep%' LIMIT 5");
    await q('restock_diag_grouped_pre_stock', "SELECT make, part_type, base_pn, sold_7d, sample_title FROM (WITH rs AS (SELECT title, \"salePrice\"::numeric as price, CASE WHEN title ILIKE '%Jeep%' THEN 'Jeep' WHEN title ILIKE '%Dodge%' THEN 'Dodge' WHEN title ILIKE '%Ford%' THEN 'Ford' WHEN title ILIKE '%Honda%' THEN 'Honda' WHEN title ILIKE '%Toyota%' THEN 'Toyota' WHEN title ILIKE '%Chevrolet%' OR title ILIKE '%Chevy%' THEN 'Chevrolet' ELSE 'Other' END as make, CASE WHEN title ~* '\\m(ECU|ECM|PCM|engine control)\\M' THEN 'ECM' WHEN title ~* '\\m(ABS|anti.lock)\\M' THEN 'ABS' WHEN title ~* '\\m(BCM|body control)\\M' THEN 'BCM' WHEN title ~* '\\m(TIPM)\\M' THEN 'TIPM' WHEN title ~* '\\m(fuse box|junction|ipdm)\\M' THEN 'Fuse Box' WHEN title ~* '\\m(amplifier|bose|harman)\\M' THEN 'Amplifier' WHEN title ~* '\\m(radio|stereo)\\M' THEN 'Radio' ELSE 'Other' END as part_type, part_number_base(COALESCE((regexp_match(title, '\\m(\\d{8}[A-Z]{2})\\M'))[1], (regexp_match(title, '\\m([A-Z]{1,4}\\d{1,2}[A-Z]-[A-Z0-9]{4,6})\\M'))[1], (regexp_match(title, '\\m(\\d{5}-[A-Z0-9]{2,7})\\M'))[1])) as base_pn FROM \"YourSale\" WHERE \"soldDate\" >= NOW() - INTERVAL '7 days' AND title IS NOT NULL AND \"salePrice\"::numeric >= 50) SELECT make, part_type, base_pn, COUNT(*) as sold_7d, (array_agg(title))[1] as sample_title FROM rs WHERE make != 'Other' AND part_type != 'Other' GROUP BY make, part_type, base_pn ORDER BY COUNT(*) DESC LIMIT 20) sub");
    await q('restock_diag_raw_query', "SELECT make, part_type, sold_7d, stock, avg_price, action, sample_title FROM (WITH recent_sales AS (SELECT CASE WHEN title ILIKE '%Toyota%' THEN 'Toyota' WHEN title ILIKE '%Honda%' THEN 'Honda' WHEN title ILIKE '%Ford%' THEN 'Ford' WHEN title ILIKE '%Dodge%' THEN 'Dodge' WHEN title ILIKE '%Chrysler%' THEN 'Chrysler' WHEN title ILIKE '%Jeep%' THEN 'Jeep' WHEN title ILIKE '%Ram%' AND title NOT ILIKE '%Ramcharger%' THEN 'Ram' WHEN title ILIKE '%Chevrolet%' OR title ILIKE '%Chevy%' THEN 'Chevrolet' WHEN title ILIKE '%GMC%' THEN 'GMC' WHEN title ILIKE '%Nissan%' THEN 'Nissan' WHEN title ILIKE '%Hyundai%' THEN 'Hyundai' WHEN title ILIKE '%Kia%' THEN 'Kia' ELSE 'Other' END as make, CASE WHEN title ~* '\\m(TCM|TCU|transmission control)\\M' THEN 'TCM' WHEN title ~* '\\m(BCM|body control)\\M' THEN 'BCM' WHEN title ~* '\\m(ECU|ECM|PCM|engine control|engine computer)\\M' THEN 'ECM' WHEN title ~* '\\m(TIPM)\\M' THEN 'TIPM' WHEN title ~* '\\m(fuse box|junction box|ipdm|relay box)\\M' THEN 'Fuse Box' WHEN title ~* '\\m(ABS|anti.lock|brake pump)\\M' THEN 'ABS' WHEN title ~* '\\m(amplifier|bose|harman|JBL)\\M' THEN 'Amplifier' WHEN title ~* '\\m(radio|stereo|receiver)\\M' THEN 'Radio' WHEN title ~* '\\m(cluster|speedometer|gauge)\\M' THEN 'Cluster' WHEN title ~* '\\m(throttle body)\\M' THEN 'Throttle' ELSE 'Other' END as part_type, title, \"salePrice\"::numeric as price, \"soldDate\" FROM \"YourSale\" WHERE \"soldDate\" >= NOW() - INTERVAL '7 days' AND title IS NOT NULL), grouped AS (SELECT make, part_type, COUNT(*) as sold_7d, ROUND(AVG(price),2) as avg_price, (array_agg(title))[1] as sample_title FROM recent_sales WHERE make != 'Other' AND part_type != 'Other' GROUP BY make, part_type), with_stock AS (SELECT g.*, COALESCE((SELECT COUNT(*) FROM \"YourListing\" l WHERE l.\"listingStatus\" = 'Active' AND l.title ILIKE '%' || g.make || '%' AND l.title ~* (CASE g.part_type WHEN 'ECM' THEN '\\m(ECU|ECM|PCM)\\M' WHEN 'ABS' THEN '\\m(ABS|anti.lock)\\M' WHEN 'BCM' THEN '\\m(BCM|body control)\\M' WHEN 'TCM' THEN '\\m(TCM|TCU)\\M' WHEN 'TIPM' THEN '\\m(TIPM)\\M' WHEN 'Fuse Box' THEN '\\m(fuse box|junction|ipdm)\\M' WHEN 'Amplifier' THEN '\\m(amplifier|bose|harman)\\M' WHEN 'Radio' THEN '\\m(radio|stereo|receiver)\\M' WHEN 'Cluster' THEN '\\m(cluster|speedometer|gauge)\\M' WHEN 'Throttle' THEN '\\m(throttle body)\\M' ELSE g.part_type END)), 0) as stock FROM grouped g) SELECT *, CASE WHEN stock = 0 AND avg_price >= 200 THEN 'RESTOCK NOW' WHEN stock = 0 THEN 'OUT OF STOCK' WHEN stock <= 1 AND sold_7d >= 2 THEN 'LOW STOCK' ELSE 'MONITOR' END as action FROM with_stock ORDER BY avg_price DESC) sub WHERE stock <= 1 LIMIT 30");
    await q('honda_2000_with_items', "SELECT a.year, a.make, a.model, COUNT(aic.\"itemId\") as item_count FROM \"Auto\" a JOIN \"AutoItemCompatibility\" aic ON aic.\"autoId\" = a.id WHERE a.make ILIKE '%Honda%' AND a.year::text = '2000' GROUP BY a.year, a.make, a.model ORDER BY a.model");
    await q('honda_2000_auto_only', "SELECT DISTINCT a.model FROM \"Auto\" a WHERE a.make ILIKE '%Honda%' AND a.year::text = '2000' ORDER BY a.model");
    await q('honda_2000_auto_linked', "SELECT DISTINCT a.model FROM \"Auto\" a JOIN \"AutoItemCompatibility\" aic ON aic.\"autoId\" = a.id WHERE a.make ILIKE '%Honda%' AND a.year::text = '2000' ORDER BY a.model");
    await q('aic_columns', "SELECT column_name FROM information_schema.columns WHERE table_name = 'AutoItemCompatibility' ORDER BY column_name");
    await q('honda_civic_camelCase', "SELECT i.title, i.price, i.seller FROM \"Item\" i JOIN \"AutoItemCompatibility\" aic ON aic.\"itemId\" = i.id JOIN \"Auto\" a ON a.id = aic.\"autoId\" WHERE a.make = 'Honda' AND a.model = 'Civic' AND a.year::text = '2000' LIMIT 5");
    await q('honda_civic_any_year', "SELECT a.year, i.title, i.price FROM \"Item\" i JOIN \"AutoItemCompatibility\" aic ON aic.\"itemId\" = i.id JOIN \"Auto\" a ON a.id = aic.\"autoId\" WHERE a.make = 'Honda' AND a.model ILIKE '%Civic%' LIMIT 5");
    await q('honda_civic_count_all_years', "SELECT a.year::text, COUNT(*) as cnt FROM \"Item\" i JOIN \"AutoItemCompatibility\" aic ON aic.\"itemId\" = i.id JOIN \"Auto\" a ON a.id = aic.\"autoId\" WHERE a.make = 'Honda' AND a.model ILIKE '%Civic%' GROUP BY a.year ORDER BY a.year");
    await q('q1_aic_columns', "SELECT column_name FROM information_schema.columns WHERE table_name = 'AutoItemCompatibility' ORDER BY column_name");
    await q('q2_lowercase_2000', "SELECT COUNT(*) as cnt FROM \"Item\" i JOIN \"AutoItemCompatibility\" aic ON aic.\"itemId\" = i.id JOIN \"Auto\" a ON a.id = aic.\"autoId\" WHERE a.make = 'Honda' AND a.model = 'Civic' AND a.year::text = '2000'");
    await q('q3_lowercase_1999', "SELECT COUNT(*) as cnt FROM \"Item\" i JOIN \"AutoItemCompatibility\" aic ON aic.\"itemId\" = i.id JOIN \"Auto\" a ON a.id = aic.\"autoId\" WHERE a.make = 'Honda' AND a.model = 'Civic' AND a.year::text = '1999'");
    await q('q4_lowercase_2001', "SELECT COUNT(*) as cnt FROM \"Item\" i JOIN \"AutoItemCompatibility\" aic ON aic.\"itemId\" = i.id JOIN \"Auto\" a ON a.id = aic.\"autoId\" WHERE a.make = 'Honda' AND a.model = 'Civic' AND a.year::text = '2001'");
    await q('q5_lowercase_range', "SELECT COUNT(*) as cnt FROM \"Item\" i JOIN \"AutoItemCompatibility\" aic ON aic.\"itemId\" = i.id JOIN \"Auto\" a ON a.id = aic.\"autoId\" WHERE a.make = 'Honda' AND a.model = 'Civic' AND a.year::int >= 1999 AND a.year::int <= 2001");
    await q('q6_brute_force_ilike', "SELECT COUNT(*) as cnt FROM \"Item\" WHERE title ILIKE '%Honda%' AND title ILIKE '%Civic%' AND (title ~ '(1996|1997|1998|1999|2000|2001|2002)')");
    await q('q7_original_app_query', "SELECT COUNT(*) as cnt FROM \"Auto\" a JOIN \"AutoItemCompatibility\" aic ON a.id = aic.\"autoId\" JOIN \"Item\" i ON aic.\"itemId\" = i.id WHERE a.year = 2000 AND a.make = 'Honda' AND a.model = 'Civic'");
    await q('q8_year_as_int', "SELECT COUNT(*) as cnt FROM \"Auto\" a JOIN \"AutoItemCompatibility\" aic ON a.id = aic.\"autoId\" JOIN \"Item\" i ON aic.\"itemId\" = i.id WHERE a.year = '2000' AND a.make = 'Honda' AND a.model = 'Civic'");
    await q('q9_auto_civic_exists', "SELECT id, year, make, model, trim, engine FROM \"Auto\" WHERE make = 'Honda' AND model = 'Civic' AND year::text IN ('1999','2000','2001') ORDER BY year");
    await q('q10_aic_for_civic_autos', "SELECT aic.\"autoId\", aic.\"itemId\" FROM \"AutoItemCompatibility\" aic JOIN \"Auto\" a ON a.id = aic.\"autoId\" WHERE a.make = 'Honda' AND a.model = 'Civic' AND a.year::text IN ('1999','2000','2001') LIMIT 10");
    await q('yard_vehicle_engine_samples', "SELECT engine, engine_type, drivetrain, vin_decoded, COUNT(*) as cnt FROM yard_vehicle WHERE active = true AND engine IS NOT NULL GROUP BY engine, engine_type, drivetrain, vin_decoded ORDER BY cnt DESC LIMIT 15");
    await q('yard_vehicle_decode_status', "SELECT COUNT(*) as total, SUM(CASE WHEN vin_decoded THEN 1 ELSE 0 END) as decoded, SUM(CASE WHEN vin_decoded AND engine IS NOT NULL THEN 1 ELSE 0 END) as has_engine, SUM(CASE WHEN vin IS NOT NULL AND NOT COALESCE(vin_decoded, false) THEN 1 ELSE 0 END) as vin_not_decoded FROM yard_vehicle WHERE active = true");
    await q('market_demand_cache_freshness', "SELECT COUNT(*) as total, COUNT(CASE WHEN last_updated >= NOW() - INTERVAL '7 days' THEN 1 END) as last_7d, COUNT(CASE WHEN last_updated >= NOW() - INTERVAL '30 days' THEN 1 END) as last_30d, MIN(last_updated) as oldest, MAX(last_updated) as newest FROM market_demand_cache");
    res.json(R);
  } catch(e) { res.status(500).json({error: e.message, stack: e.stack}); }
});


// Instant Research — live eBay market research for a vehicle
app.use('/api/instant-research', require('./routes/instant-research'));

// Market pricing cache status
app.get('/api/market-price/status', async (req, res) => {
  try {
    const result = await database.raw(`
      SELECT COUNT(*) as cached_parts, MAX(last_updated) as last_run
      FROM market_demand_cache
      WHERE last_updated > NOW() - INTERVAL '24 hours'
    `);
    const row = result.rows[0];
    res.json({
      cachedParts: parseInt(row.cached_parts) || 0,
      lastRun: row.last_run || null,
      stale: parseInt(row.cached_parts) === 0,
    });
  } catch (err) {
    res.json({ cachedParts: 0, lastRun: null, stale: true });
  }
});

app.use('/return-intelligence', require('./routes/return-intelligence'));
app.use('/flyway', require('./routes/flyway'));
app.use('/phoenix', require('./routes/phoenix'));

// ═══ SPA CATCH-ALL — MUST BE LAST ═══
// All API routes are registered above this point.
// Static files + SPA fallback below catches everything else.
app.use(express.static(path.resolve(__dirname, '../client/build'), {
  maxAge: '1h',
  setHeaders: (res, filePath) => {
    if (filePath.includes('/static/js/') || filePath.includes('/static/css/')) {
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    }
  }
}));
app.get('/*', (req, res) => {
  res.sendFile(path.resolve(__dirname, '../client/build', 'index.html'));
});


async function start() {
  try {
    log.level('debug');

    Model.knex(database);

    log.info(`Running as process: ${process.env.NODE_ENV}`);

    log.debug('running latest database migrations');
    try {
      await database.migrate.latest(database.client.config.migration);
      log.info('Migrations complete');
    } catch (migrationErr) {
      log.error({ err: migrationErr }, 'Migration failed — server will start anyway');
    }

    app.listen(PORT, function () {
      log.info(`Server started at port ${PORT}`);
    });

    // DISABLED: CronWorkRunner used SellerItemManager → FindingsAPI (dead since Feb 2025).
    // Item table (21K records) is permanently frozen. market_demand_cache is the pricing source of truth (see priceResolver.js).
    // if (process.env.RUN_JOB_NOW === '1') {
    //   const cronWorker = new CronWorkRunner();
    //   cronWorker.work();
    // }
    // const ebaySellerProcessingJob = schedule.scheduleJob('0 6 * * *', function (scheduledTime) {
    //   const cronWorker = new CronWorkRunner();
    //   cronWorker.work();
    // });

    // YOUR eBay data sync — orders + listings every 6 hours (offset by 1 hour from competitor cron)
    const YourDataManager = require('./managers/YourDataManager');
    const yourDataSyncJob = schedule.scheduleJob('0 1,7,13,19 * * *', async function (scheduledTime) {
      log.info({ scheduledTime }, 'Starting scheduled eBay YourData sync (orders + listings)');
      try {
        const manager = new YourDataManager();
        const results = await manager.syncAll({ daysBack: 30 });
        log.info({ results, scheduledTime }, 'Completed scheduled eBay YourData sync');
      } catch (err) {
        log.error({ err }, 'Scheduled eBay YourData sync failed');
      }
    });

    // Run an immediate sync on startup if sales data is stale (> 24 hours old)
    (async () => {
      try {
        const staleCheck = await database.raw('SELECT MAX("soldDate") as latest FROM "YourSale"');
        const latest = staleCheck.rows[0]?.latest;
        const hoursOld = latest ? Math.floor((Date.now() - new Date(latest).getTime()) / 3600000) : 999;
        if (hoursOld > 24) {
          log.info({ hoursOld, latestSale: latest }, 'YourSale data is stale — triggering immediate sync');
          const manager = new YourDataManager();
          const results = await manager.syncAll({ daysBack: 30 });
          log.info({ results }, 'Startup YourData sync completed');
        } else {
          log.info({ hoursOld }, 'YourSale data is fresh — skipping startup sync');
        }
      } catch (err) {
        log.warn({ err: err.message }, 'Startup YourData stale check failed (non-fatal)');
      }
    })();

    // Price check cron - runs once a week (Sunday at 2:00 AM)
    const priceCheckJob = schedule.scheduleJob('0 2 * * 0', async function (scheduledTime) {
      log.info({ scheduledTime }, 'Starting weekly price check cron');
      const priceCheckRunner = new PriceCheckCronRunner();
      await priceCheckRunner.work({ batchSize: 15 });
    });

    // DISABLED: MarketDemandCronRunner used findCompletedItems (Finding API dead since Feb 2025).
    // Market cache now populated by: PriceCheckService (weekly), yard sniper (on-demand), importapart drip (manual).
    // const MarketDemandCronRunner = require('./lib/MarketDemandCronRunner');
    // const marketDemandJob = schedule.scheduleJob('0 3 * * *', async function (scheduledTime) {
    //   const runner = new MarketDemandCronRunner();
    //   await runner.work();
    // });

    // Stale inventory automation - runs weekly Wednesday at 3:00 AM
    const StaleInventoryService = require('./services/StaleInventoryService');
    const staleInventoryJob = schedule.scheduleJob('0 3 * * 3', async function (scheduledTime) {
      log.info({ scheduledTime }, 'Starting weekly stale inventory automation');
      try {
        const service = new StaleInventoryService();
        const result = await service.runAutomation();
        log.info({ result }, 'Stale inventory automation complete');
      } catch (err) {
        log.error({ err }, 'Stale inventory automation failed');
      }
    });

    // Dead inventory scan - runs weekly Monday at 4:00 AM
    const DeadInventoryService = require('./services/DeadInventoryService');
    const deadInventoryJob = schedule.scheduleJob('0 4 * * 1', async function (scheduledTime) {
      log.info({ scheduledTime }, 'Starting weekly dead inventory scan');
      try {
        const service = new DeadInventoryService();
        await service.scanAndLog();
      } catch (err) {
        log.error({ err }, 'Dead inventory scan failed');
      }
    });

    // Restock scan - runs weekly Tuesday at 4:00 AM
    const RestockService = require('./services/RestockService');
    const restockJob = schedule.scheduleJob('0 4 * * 2', async function (scheduledTime) {
      log.info({ scheduledTime }, 'Starting weekly restock scan');
      try {
        const service = new RestockService();
        await service.scanAndFlag();
      } catch (err) {
        log.error({ err }, 'Restock scan failed');
      }
    });

    // Competitor monitoring - runs weekly Thursday at 4:00 AM
    const CompetitorMonitorService = require('./services/CompetitorMonitorService');
    const competitorJob = schedule.scheduleJob('0 4 * * 4', async function (scheduledTime) {
      log.info({ scheduledTime }, 'Starting weekly competitor monitoring');
      try {
        const service = new CompetitorMonitorService();
        await service.scan();
      } catch (err) {
        log.error({ err }, 'Competitor monitoring failed');
      }
    });

    // Flyway scrape: daily 6am UTC - scrapes Pull-A-Part/Foss/Carolina PNP for active road trips
    const FlywayScrapeRunner = require('./lib/FlywayScrapeRunner');
    const flywayJob = schedule.scheduleJob('0 6 * * *', async function (scheduledTime) {
      log.info({ scheduledTime }, 'Starting Flyway scrape run');
      try {
        const runner = new FlywayScrapeRunner();
        await runner.work();
      } catch (err) {
        log.error({ err }, 'Flyway scrape run failed');
      }
    });

    // Competitor drip scraping — 4x daily with random 0-45min startup jitter
    // Each run: picks 1 least-recently-scraped seller, scrapes 1-2 pages
    // Replaces old Sunday 8pm blast-all-sellers cron (removed from competitors.js)
    const CompetitorDripRunner = require('./lib/CompetitorDripRunner');

    const dripJob5am = schedule.scheduleJob('0 5 * * *', async function () {
      log.info('Competitor drip cron fired (5am UTC window)');
      try { await CompetitorDripRunner.runDrip(); } catch (err) { log.error({ err: err.message }, 'Drip 5am failed'); }
    });

    const dripJobNoon = schedule.scheduleJob('0 12 * * *', async function () {
      log.info('Competitor drip cron fired (noon UTC window)');
      try { await CompetitorDripRunner.runDrip(); } catch (err) { log.error({ err: err.message }, 'Drip noon failed'); }
    });

    const dripJob6pm = schedule.scheduleJob('0 18 * * *', async function () {
      log.info('Competitor drip cron fired (6pm UTC window)');
      try { await CompetitorDripRunner.runDrip(); } catch (err) { log.error({ err: err.message }, 'Drip 6pm failed'); }
    });

    const dripJobMidnight = schedule.scheduleJob('0 0 * * *', async function () {
      log.info('Competitor drip cron fired (midnight UTC window)');
      try { await CompetitorDripRunner.runDrip(); } catch (err) { log.error({ err: err.message }, 'Drip midnight failed'); }

      // Graduate marks once daily (moved from old Sunday-only cron in competitors.js)
      try {
        const axios = require('axios');
        await axios.post('http://localhost:' + (process.env.PORT || 9000) + '/competitors/mark/graduate');
        log.info('Daily mark graduation complete');
      } catch (err) {
        log.error({ err: err.message }, 'Daily mark graduation failed');
      }
    });

    // eBay Messaging — poll for new orders every 15 minutes, process queue every 2 minutes
    const EbayMessagingService = require('./services/EbayMessagingService');
    const messagingService = new EbayMessagingService();

    const messagingPollJob = schedule.scheduleJob('*/15 * * * *', async function () {
      log.info('Cron: Polling for new orders to message');
      try {
        await messagingService.pollNewOrders();
      } catch (err) {
        log.error({ err }, 'Cron: Order polling failed');
      }
    });

    const messagingProcessJob = schedule.scheduleJob('*/2 * * * *', async function () {
      try {
        await messagingService.processQueue();
      } catch (err) {
        log.error({ err }, 'Cron: Message queue processing failed');
      }
    });

    // Load Auto table models into partMatcher cache, then regenerate scout alerts
    try {
      const { loadModelsFromDB } = require('./utils/partMatcher');
      const { generateAlerts } = require('./services/ScoutAlertService');
      setTimeout(async () => {
        try {
          await loadModelsFromDB();
          const r = await generateAlerts();
          log.info({ alertCount: r.alerts }, 'Scout alerts regenerated on startup');
        } catch (e) {
          log.warn({ err: e.message }, 'Scout alert startup generation failed');
        }
      }, 10000); // delay 10s to let migrations finish
    } catch (e) { /* ignore */ }

    // Auto-complete expired flyway trips
    try {
      const FlywayService = require('./services/FlywayService');
      FlywayService.autoCompleteExpiredTrips()
        .then(count => { if (count > 0) log.info({ count }, 'Flyway: auto-completed expired trips'); })
        .catch(err => log.warn({ err: err.message }, 'Flyway: auto-complete error'));
    } catch (e) { /* ignore */ }

    // LKQ scraping runs locally via Task Scheduler — CloudFlare blocks Railway

  } catch (err) {
    log.error({ err }, 'Unable to start server')
  }
}

// istanbul ignore next
if (require.main === module) {
  start();
}```
---
## FILE: CLAUDE_RULES.md
```javascript
# CLAUDE_RULES.md — READ THIS FIRST EVERY SESSION

These are non-negotiable constraints for DarkHawk development. Violating any of these has caused real bugs in production. Read all of them before touching any file.

---

## WORKFLOW RULES

1. **DIAGNOSE BEFORE TOUCHING.** Read the actual deployed code before making changes. Run read-only diagnostics before any writes. No assumptions about what a file contains.

2. **ONE DELIVERABLE PER SESSION.** Fix one thing, test it, commit it. Do not touch files unrelated to the current task.

3. **READ LAST_SESSION.md AND CHANGELOG.md FIRST.** These tell you what the previous session did. Do not overwrite work from previous sessions without understanding it.

4. **COMMIT FORMAT:** `git add -A && git commit -m "descriptive message" && git push origin main`

5. **UPDATE LAST_SESSION.md** at the end of every session with: what was changed, what files were touched, what's still broken, what's next.

6. **APPEND TO CHANGELOG.md** at the end of every session with: date, summary, files touched.

---

## DATABASE RULES

7. **Part lookup MUST use Auto + AIC JOIN** (`autoId`, `itemId` — lowercase). NEVER use ILIKE on `Item.title` for part matching. The Auto+AIC path is the only correct way to match parts to vehicles.

8. **`Item.price` is FROZEN.** 21K items with stale prices. NEVER use `Item.price` as a display price or scoring input. It is a last-resort fallback only in `priceResolver.js`.

9. **`market_demand_cache` is the pricing source of truth.** Price resolution priority: `market_demand_cache` → `PriceCheck` → `Item.price` (last resort only, with `estimate` source tag).

10. **`priceResolver.js` is the single price resolution point.** All scoring and display prices flow through it. Do not invent alternate price lookups.

11. **Cherokee ≠ Grand Cherokee.** Transit ≠ Transit Connect. Use word-boundary matching (`\b`), not substring matching.

12. **PN-specific parts (ECM/BCM/TIPM) require exact year range matching.** Generational parts allow ±1 year tolerance. 

13. **Engine filter must always include N/A/null records** alongside engine-specific matches. Many yard vehicles and items have no engine data.

14. **Both apps share one database.** DarkHawk (`parthawk-production.up.railway.app`) and the original app (`dynatrack.up.railway.app`) read/write the same Postgres on `switchyard.proxy.rlwy.net:12023`. Never touch the original app's deployment.

---

## SCORING RULES

15. **Attack list vehicle colors:** green = $800+, yellow = $500-799, orange = $250-499, red = <$250.

16. **Part badges:** GREAT = $250+, GOOD = $150-249, FAIR = $100-149, POOR = <$100.

17. **Price freshness:** ✅ within 60d, ⚠️ 60-90d, ❌ over 90d.

18. **Price source display:** `sold` and `market` sources display normally. `estimate` source displays as grey `~$XXX EST`.

19. **Engines and transmissions are excluded** from attack list parts via `isExcludedPart()`. Also exclude transfer cases and steering.

20. **Pro-rebuild parts shown as grey reference only,** never scored.

21. **Restock scoring:** Your demand max 35pts, Market demand max 35pts, Ratio max 15pts, Price max 25pts. $300+ parts with any market signal get floor score 75.

---

## TRIM SYSTEM RULES

22. **Four tiers:** BASE (grey) / CHECK (yellow) / PREMIUM (green) / PERFORMANCE (blue).

23. **Independent badges (fire alongside any tier):** CULT (magenta), DIESEL (blue), 4WD (green), MANUAL (cyan), CHECK MT (faded cyan).

24. **Fallback is CONSERVATIVE** — lowest tier when unknown. Never optimistic (caused false PERFORMANCE tags).

25. **BMW model numbers normalize to series** (328I → 3 Series), original preserved as trim. Mercedes model numbers normalize to class (C300 → C-Class).

26. **LKQ body code stripper regex runs ONLY on Stellantis makes** (tighter pattern to avoid eating G35, G6, Q7, X5).

27. **CHECK_MT:** ambiguous-era base trucks where manual was common but not certain. Silverado excluded. Tacoma CHECK_MT limited to V6 trims only.

28. **Trim value validation verdicts:** CONFIRMED (green), WORTH_IT (yellow), MARGINAL (grey), NO_PREMIUM (red), UNVALIDATED (dim). Non-sellable suggestions (NO_PREMIUM with negative delta) are filtered out entirely.

---

## SCRAPING RULES

29. **All market data scraping: search by part number only.** No keyword fallback, no title matching. Parts without OEM part number are skipped entirely.

30. **LKQ scraper runs locally only** (CloudFlare blocks Railway). Run via `run-scrape.bat`, Windows Task Scheduler 5am daily.

31. **Playwright browser singleton pattern** prevents Railway OOM. Never share browser instance with PriceCheckService.

32. **Competitor scraping uses Playwright intentionally** — no eBay API exists for competitor sold data. Rate limit to avoid blocks.

---

## UI RULES

33. **Background is black.** Do not change it.

34. **Listing tool output: no em dashes** (AI-generated red flag to buyers).

35. **Score badge uses 0-100 numeric format.**

36. **Badge order on vehicle cards:** YMM · engine · [TRIM] [CULT] [4WD/AWD] [MANUAL/CVT] · age.

37. **Drivetrain display:** 4WD/AWD = yellow badge, FWD = grey, RWD = hidden. **Transmission:** MANUAL = cyan, CVT = grey, AUTO = hidden.

---

## CRON SCHEDULE (UTC)

- YourDataManager.syncAll: 4x/day (1am, 7am, 1pm, 7pm)
- PriceCheckCronRunner: Sunday 2am
- StaleInventoryService: Wednesday 3am
- DeadInventoryService: Monday 4am
- RestockService: Tuesday 4am
- CompetitorMonitor: Thursday 4am
- CompetitorDripRunner: 4x/day (5am, noon, 6pm, midnight — random 0-45min jitter)
- FlywayScrapeRunner: daily 6am
- ScoutAlerts: on startup
- DISABLED: CronWorkRunner, MarketDemandCronRunner (Finding API dead)

---

## KNOWN TECH DEBT (do not make worse)

- Unauthenticated write endpoints (end-item/relist/revise/bulk-end)
- StaleInventoryService has inline ReviseItem separate from TradingAPI.reviseItem()
- CompetitorMonitor reads frozen SoldItem (degraded until Sunday scrape)
- LifecycleService loads all YourSale into memory (fine at 22K, watch at 50K+)
```
---
## FILE: CHANGELOG.md
```javascript
# DARKHAWK CHANGELOG

Reverse chronological. Every deploy gets one entry. Claude Code appends to this after every session.

---

## [2026-04-01] Workflow Infrastructure
- **Added:** CLAUDE_RULES.md, CHANGELOG.md, LAST_SESSION.md
- **Purpose:** Prevent Claude Code sessions from overwriting each other's work
- **Files:** CLAUDE_RULES.md, CHANGELOG.md, LAST_SESSION.md
- **Notes:** Every future session reads these files first before touching code

---

<!-- TEMPLATE FOR NEW ENTRIES (copy and fill in at top of file):

## [YYYY-MM-DD] Short Description
- **Changed:** What was modified
- **Added:** What was created
- **Fixed:** What bugs were resolved
- **Files touched:** List every file modified
- **Affects:** What downstream features are impacted
- **Notes:** Anything the next session needs to know

-->
```
---
## FILE: LAST_SESSION.md
```javascript
# LAST SESSION — READ THIS BEFORE DOING ANYTHING

**Date:** 2026-04-01
**Session type:** Workflow setup

## What was done
- Created CLAUDE_RULES.md with all hard constraints
- Created CHANGELOG.md for session-to-session continuity
- Created this LAST_SESSION.md file

## What files were touched
- CLAUDE_RULES.md (new)
- CHANGELOG.md (new)
- LAST_SESSION.md (new)

## What is still broken / needs attention
- Attack list frontend: multiple reported display bugs — full audit needed
- Run the attack-list-audit-prompt.md diagnostic to identify specific issues
- Trim value validation Step 4 not yet done (eBay sold listing scrapes for gaps)
- yard_vehicle transmission columns exist but are never populated (need VIN re-decode)

## What's next
- Full attack list audit (read all files, run DB diagnostics, produce bug report)
- Fix whatever the audit surfaces, one bug at a time

## Critical reminders for next session
- DO NOT modify AttackListService.js without reading it completely first
- DO NOT modify attack-list.html without reading it completely first
- Item.price is FROZEN — never use as display/scoring price
- Price resolution: market_demand_cache → PriceCheck → Item.price (last resort)
```
---
## FILE: service/managers/YourDataManager.js
```javascript
'use strict';

const { log } = require('../lib/logger');
const SellerAPI = require('../ebay/SellerAPI');
const YourSale = require('../models/YourSale');
const YourListing = require('../models/YourListing');
const Promise = require('bluebird');

/**
 * YourDataManager - Syncs YOUR eBay seller data (orders and listings) to database
 */
class YourDataManager {
  constructor() {
    this.log = log.child({ class: 'YourDataManager' }, true);
    this.sellerAPI = new SellerAPI();
  }

  /**
   * Sync all your data (orders and listings)
   */
  async syncAll({ daysBack = 365 } = {}) {
    this.log.info({ daysBack }, 'Starting full sync of your eBay data');

    const results = {
      orders: { synced: 0, errors: 0 },
      listings: { synced: 0, errors: 0 },
    };

    try {
      const orderResults = await this.syncOrders({ daysBack });
      results.orders = orderResults;
    } catch (err) {
      this.log.error({ err }, 'Error syncing orders');
      results.orders.errors = 1;
    }

    try {
      const listingResults = await this.syncListings();
      results.listings = listingResults;
    } catch (err) {
      this.log.error({ err }, 'Error syncing listings');
      results.listings.errors = 1;
    }

    // Overstock watch check — runs after every listing sync
    try {
      const OverstockCheckService = require('../services/OverstockCheckService');
      const overstockService = new OverstockCheckService();
      const result = await overstockService.checkAll();
      if (result.triggered > 0) {
        this.log.info({ result }, 'Overstock alerts triggered');
      } else {
        this.log.debug({ result }, 'Overstock watch check complete');
      }
    } catch (err) {
      this.log.error({ err }, 'Overstock watch check failed (non-fatal)');
    }

    this.log.info({ results }, 'Completed full sync of your eBay data');
    return results;
  }

  /**
   * Sync your orders/sales from eBay
   * @param {Object} options
   * @param {number} options.daysBack - Number of days back to fetch (default: 365)
   */
  async syncOrders({ daysBack = 365 } = {}) {
    this.log.info({ daysBack }, 'Syncing orders from eBay');

    let synced = 0;
    let errors = 0;

    try {
      const orders = await this.sellerAPI.getOrders({ daysBack });
      this.log.info({ orderCount: orders.length }, 'Fetched orders from eBay');

      // Flatten orders into individual line items (each item sold is a YourSale record)
      await Promise.mapSeries(orders, async (order) => {
        await Promise.mapSeries(order.lineItems, async (lineItem) => {
          try {
            const toInsert = {
              ebayOrderId: `${order.orderId}-${lineItem.itemId}`, // Unique per line item
              ebayItemId: lineItem.itemId,
              title: lineItem.title,
              sku: lineItem.sku,
              quantity: lineItem.quantity,
              salePrice: lineItem.price,
              soldDate: order.createdTime ? new Date(order.createdTime) : null,
              buyerUsername: order.buyerUsername,
              shippedDate: order.shippedTime ? new Date(order.shippedTime) : null,
            };

            // Upsert on conflict (order ID + item ID)
            // id omitted from insert so DB generates it via gen_random_uuid(),
            // and .merge() won't touch id on conflict — preserving FK references
            await YourSale.query()
              .insert(toInsert)
              .onConflict('ebayOrderId')
              .merge();

            synced++;
          } catch (err) {
            this.log.error({ err, orderId: order.orderId, itemId: lineItem.itemId }, 'Error inserting sale');
            errors++;
          }
        });
      });

      this.log.info({ synced, errors }, 'Completed syncing orders');
    } catch (err) {
      this.log.error({ err }, 'Error fetching orders from eBay');
      throw err;
    }

    return { synced, errors };
  }

  /**
   * Sync your active listings from eBay
   */
  async syncListings() {
    this.log.info('Syncing active listings from eBay');

    let synced = 0;
    let errors = 0;

    try {
      const listings = await this.sellerAPI.getActiveListings();
      this.log.info({ listingCount: listings.length }, 'Fetched listings from eBay');

      await Promise.mapSeries(listings, async (listing) => {
        try {
          const toInsert = {
            ebayItemId: listing.itemId,
            title: listing.title,
            sku: listing.sku,
            quantityAvailable: listing.quantityAvailable,
            currentPrice: listing.currentPrice,
            listingStatus: listing.listingStatus,
            startTime: listing.startTime ? new Date(listing.startTime) : null,
            viewItemUrl: listing.viewItemUrl,
            syncedAt: new Date(),
          };

          // Upsert on conflict (item ID)
          // id omitted from insert so DB generates it via gen_random_uuid(),
          // and .merge() won't touch id on conflict — preserving FK references from PriceCheck
          await YourListing.query()
            .insert(toInsert)
            .onConflict('ebayItemId')
            .merge();

          synced++;
        } catch (err) {
          this.log.error({ err, itemId: listing.itemId }, 'Error inserting listing');
          errors++;
        }
      });

      // Mark listings not in this sync as Ended (they're no longer active on eBay)
      const syncedIds = listings.map(l => l.itemId).filter(Boolean);
      let deactivated = 0;
      if (syncedIds.length > 0) {
        try {
          const { database } = require('../database/database');
          const now = new Date();
          const result = await database('YourListing')
            .where('listingStatus', 'Active')
            .where('syncedAt', '<', new Date(now.getTime() - 60000)) // not synced in last minute
            .whereNotIn('ebayItemId', syncedIds)
            .update({ listingStatus: 'Ended', updatedAt: now });
          deactivated = result;
          if (deactivated > 0) {
            this.log.info({ deactivated }, 'Marked stale listings as Ended');
          }
        } catch (err) {
          this.log.warn({ err: err.message }, 'Failed to deactivate stale listings (non-fatal)');
        }
      }

      this.log.info({ synced, errors, deactivated }, 'Completed syncing listings');
    } catch (err) {
      this.log.error({ err }, 'Error fetching listings from eBay');
      throw err;
    }

    return { synced, errors };
  }

  /**
   * Get sync statistics
   */
  async getStats() {
    const [salesCount, listingsCount, recentSales] = await Promise.all([
      YourSale.query().count('* as count').first(),
      YourListing.query().count('* as count').first(),
      YourSale.query()
        .where('soldDate', '>=', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000))
        .count('* as count')
        .first(),
    ]);

    return {
      totalSales: parseInt(salesCount.count, 10),
      totalListings: parseInt(listingsCount.count, 10),
      salesLast30Days: parseInt(recentSales.count, 10),
    };
  }
}

module.exports = YourDataManager;
```
---
## FILE: service/utils/partIntelligence.js
```javascript
/**
 * partIntelligence.js — Unified matching engine for DarkHawk
 *
 * ONE module for: PN extraction, stock counting, model matching, year parsing.
 * Used by: DAILY FEED, HAWK EYE, THE QUARRY, SCOUR STREAM, SCOUT ALERTS.
 *
 * REPLACES: partNumberExtractor.js, partMatcher.extractPartNumbers(),
 * AttackListService local regexes, and all inline ILIKE stock queries.
 */

// ═══════════════════════════════════════════════════════════════
// PART NUMBER EXTRACTION
// ═══════════════════════════════════════════════════════════════

const SKIP_WORDS = new Set([
  'TESTED', 'PROGRAMMED', 'MODULE', 'CONTROL', 'ASSEMBLY',
  'INTERIOR', 'EXTERIOR', 'ELECTRIC', 'ELECTRONIC', 'PREMIUM',
  'DISCOUNT', 'PRICES', 'CHECK', 'GENUINE', 'REPLACEMENT',
  'STOCKED', 'KEYWORD', 'MATCH', 'VEHICLE', 'ENGINE',
  'TRANSMISSION', 'AUTOMATIC', 'MANUAL', 'CYLINDER',
  'DRIVER', 'PASSENGER', 'FRONT', 'REAR', 'LEFT', 'RIGHT',
  'UPPER', 'LOWER', 'INNER', 'OUTER', 'SEDAN', 'COUPE',
  'HATCHBACK', 'WAGON', 'CONVERTIBLE', 'PICKUP', 'TRUCK',
  'HYBRID', 'DIESEL', 'TURBO', 'SUPERCHARGED', 'RUNNING',
  'WORKING', 'PULLED', 'REMOVED', 'CLEANED', 'ORIGINAL',
  'FACTORY', 'CONDITION', 'PLAY', 'PLUG', 'COMPATIBLE',
  'DIRECT', 'REMAN', 'REFURBISHED', 'REBUILT',
]);

const MAKES_MODELS = new Set([
  'FORD','CHEVY','CHEVROLET','DODGE','CHRYSLER','JEEP','RAM',
  'TOYOTA','HONDA','NISSAN','HYUNDAI','SUBARU','MAZDA','MITSUBISHI',
  'LEXUS','INFINITI','ACURA','LINCOLN','BUICK','CADILLAC','PONTIAC',
  'VOLKSWAGEN','AUDI','PORSCHE','VOLVO','SAAB','MINI','FIAT',
  'CHARGER','CHALLENGER','MUSTANG','CAMARO','CORVETTE',
  'SILVERADO','SIERRA','TAHOE','SUBURBAN','EXPEDITION','YUKON',
  'EXPLORER','ESCAPE','FUSION','TAURUS','FOCUS','RANGER','BRONCO',
  'ACCORD','CIVIC','CAMRY','COROLLA','TACOMA','TUNDRA','PRIUS',
  'ALTIMA','MAXIMA','SENTRA','PATHFINDER','FRONTIER','ROGUE',
  'SONATA','ELANTRA','TUCSON','SPORTAGE','SORENTO','OPTIMA',
  'OUTBACK','FORESTER','IMPREZA','LEGACY','CROSSTREK','ASCENT',
  'WRANGLER','CHEROKEE','COMPASS','RENEGADE','GLADIATOR',
  'DURANGO','CARAVAN','JOURNEY','DAKOTA','MAGNUM','CALIBER',
  'IMPALA','MALIBU','EQUINOX','TRAVERSE','TRAILBLAZER','ENVOY',
  'TERRAIN','ACADIA','DENALI','ENCLAVE','LACROSSE','BONNEVILLE',
  'NAVIGATOR','AVIATOR','CORSAIR','NAUTILUS','CONTINENTAL',
  'ESCALADE','DEVILLE','SEVILLE','ELDORADO','FLEETWOOD',
  'BEETLE','JETTA','PASSAT','TIGUAN','ATLAS','GOLF',
  'LANCER','OUTLANDER','ECLIPSE','GALANT','MONTERO',
  'HUNDRED','FIVE','FREESTYLE','FREESTAR','WINDSTAR',
  'RIDGELINE','PILOT','PASSPORT','ODYSSEY','ELEMENT',
  'HIGHLANDER','RUNNER','SEQUOIA','SIENNA','VENZA',
  'MURANO','ARMADA','TITAN','VERSA','JUKE','KICKS',
  'TRANSIT','CONNECT','EDGE','FLEX','EXCURSION',
  'GRAND','PRIX','TOWN','COUNTRY','PACIFICA',
  'COLORADO','CANYON','BLAZER','SPARK','SONIC','CRUZE',
  'NEON','AVENGER','STRATUS','SEBRING','INTREPID',
  'AVALANCHE','TRAX','BOLT','COBALT','VENTURE',
]);

function isSkipWord(s) {
  if (!s) return true;
  const u = s.toUpperCase();
  if (/^(19[89]\d|20[0-3]\d)$/.test(u)) return true;
  if (/^\d{1,5}$/.test(u)) return true;
  if (SKIP_WORDS.has(u)) return true;
  if (MAKES_MODELS.has(u)) return true;
  if (u.length < 5 && !/\d/.test(u)) return true;
  return false;
}

function stripRevisionSuffix(pn) {
  if (!pn) return pn;
  // Chrysler/Mopar: 56044691AA → 56044691, 68269652AD → 68269652
  if (/^\d{7,10}[A-Z]{2}$/.test(pn)) return pn.slice(0, -2);
  // GM with letter prefix: A12345678AA → A12345678
  if (/^[A-Z]\d{7,9}[A-Z]{2}$/.test(pn)) return pn.slice(0, -2);
  // Ford dash-separated: AL3T15604BD → AL3T15604 (normalized, dashes stripped)
  // Match: 4+ alphanum + 4-6 alphanum + 1-2 letter suffix
  if (/^[A-Z0-9]{4,}[A-Z0-9]{4,6}[A-Z]{1,2}$/.test(pn) && pn.length >= 10) {
    const base = pn.replace(/[A-Z]{1,2}$/, '');
    if (base.length >= 8) return base;
  }
  // Toyota/Lexus/Honda dash-format (normalized): 8966104840AA → 8966104840
  // Pattern: digits + alphanums ending in 2-char alpha revision
  // Also catches: 5C6035456A (VW) where last A is a revision
  if (pn.length >= 10 && /[A-Z]{1,2}$/.test(pn)) {
    const base = pn.replace(/[A-Z]{1,2}$/, '');
    if (base.length >= 8) return base;
  }
  return pn;
}

/**
 * Extract OEM part numbers from text.
 * @param {string} text
 * @returns {Array<{raw: string, normalized: string, base: string}>}
 */
function extractPartNumbers(text) {
  if (!text) return [];
  const candidates = [];
  const seen = new Set();
  const t = text.replace(/\s+/g, ' ').trim();

  const patterns = [
    /\b[A-Z0-9]{2}\d{2}[A-Z]?-\d[A-Z]\d{3,4}-[A-Z]{1,2}\b/gi,
    /\b[A-Z0-9]{2}\d{2}[A-Z]?\d[A-Z]\d{3,4}[A-Z]{1,2}\b/gi,
    /\b[A-Z]{2}\d[A-Z]-\d{2}[A-Z]\d{3}-[A-Z]{1,2}\b/gi,
    /\b[A-Z]?\d{7,8}[A-Z]{2}\b/gi,
    /\b\d{5}-[A-Z0-9]{4,6}\b/gi,
    /\b\d{5}-[A-Z0-9]{2,4}-[A-Z0-9]{2,4}\b/gi,
    /\b\d{3,5}[A-Z]\d-[A-Z]{2}\d{3}\b/gi,
    /\b\d{5}-\d[A-Z]\d{3}\b/gi,
    /\b\d[A-Z]\d[\s]?\d{3}[\s]?\d{3}[\s]?[A-Z]{0,2}\b/gi,
    /\b[A-Z]\s?\d{3}\s?\d{3}\s?\d{2}\s?\d{2}\b/gi,
    /\b\d{2}\.?\d{2}-?\d[\s]?\d{3}[\s]?\d{3}\b/gi,
    /\b\d{8}\b/g,
    /\b(?=[A-Za-z0-9]*[A-Za-z])(?=[A-Za-z0-9]*\d)[A-Za-z0-9]{6,}\b/g,
  ];

  for (const pattern of patterns) {
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(t)) !== null) {
      const raw = match[0];
      const normalized = raw.toUpperCase().replace(/[\s.\-]/g, '');
      if (seen.has(normalized)) continue;
      if (isSkipWord(raw)) continue;
      seen.add(normalized);
      candidates.push({ raw, normalized, base: stripRevisionSuffix(normalized) });
    }
  }
  return candidates;
}

// ═══════════════════════════════════════════════════════════════
// YEAR RANGE PARSING
// ═══════════════════════════════════════════════════════════════

function parseYearRange(title) {
  if (!title) return null;
  const rangeMatch = title.match(/\b((?:19|20)\d{2})\s*[-–]\s*((?:19|20)?\d{2,4})\b/);
  if (rangeMatch) {
    let start = parseInt(rangeMatch[1]);
    let end = parseInt(rangeMatch[2]);
    if (end < 100) end += (end < 50 ? 2000 : 1900);
    return { start: Math.min(start, end), end: Math.max(start, end) };
  }
  const shortRange = title.match(/\b(\d{2})\s*[-–]\s*(\d{2})\b/);
  if (shortRange) {
    let s = parseInt(shortRange[1]);
    let e = parseInt(shortRange[2]);
    s += (s < 50 ? 2000 : 1900);
    e += (e < 50 ? 2000 : 1900);
    if (s >= 1980 && s <= 2030 && e >= 1980 && e <= 2030) {
      return { start: Math.min(s, e), end: Math.max(s, e) };
    }
  }
  const singleMatch = title.match(/\b((?:19|20)\d{2})\b/);
  if (singleMatch) {
    const yr = parseInt(singleMatch[1]);
    if (yr >= 1980 && yr <= 2030) return { start: yr, end: yr };
  }
  // 2-digit year at start of string: "13 Caravan..." → 2013
  const shortStart = title.match(/^(\d{2})\b/);
  if (shortStart) {
    let y = parseInt(shortStart[1]);
    y += (y < 50 ? 2000 : 1900);
    if (y >= 1980 && y <= 2030) return { start: y, end: y };
  }
  return null;
}

function vehicleYearMatchesPart(vehicleYear, partTitle) {
  const range = parseYearRange(partTitle);
  if (!range) return { matches: true, confirmed: false };
  return { matches: vehicleYear >= range.start && vehicleYear <= range.end, confirmed: true };
}

// ═══════════════════════════════════════════════════════════════
// MODEL MATCHING
// ═══════════════════════════════════════════════════════════════

function modelMatches(partModel, vehicleModel) {
  if (!partModel || !vehicleModel) return false;
  const norm = (s) => s.trim().toUpperCase().replace(/[-\s]+/g, ' ').trim();
  const pNorm = norm(partModel);
  const vNorm = norm(vehicleModel);
  if (pNorm === vNorm) return true;
  const pFlat = pNorm.replace(/\s+/g, '');
  const vFlat = vNorm.replace(/\s+/g, '');
  if (pFlat === vFlat) return true;
  const pWords = pNorm.split(/\s+/);
  const vWords = vNorm.split(/\s+/);
  const shorter = pWords.length <= vWords.length ? pWords : vWords;
  const longer = pWords.length <= vWords.length ? vWords : pWords;
  let isPrefix = true;
  for (let i = 0; i < shorter.length; i++) {
    if (shorter[i].replace(/-/g, '') !== longer[i].replace(/-/g, '')) {
      isPrefix = false;
      break;
    }
  }
  if (isPrefix && longer.length > shorter.length) {
    const extraWords = longer.slice(shorter.length);
    if (extraWords.every(w => /^\d+$/.test(w))) return true;
  }
  return false;
}

function buildStockIndex(listings) {
  const byPN = new Map();
  const byBase = new Map();
  for (const listing of listings) {
    const title = typeof listing === 'string' ? listing : (listing.title || '');
    const pns = extractPartNumbers(title);
    for (const pn of pns) {
      byPN.set(pn.normalized, (byPN.get(pn.normalized) || 0) + 1);
      if (pn.base !== pn.normalized) {
        byBase.set(pn.base, (byBase.get(pn.base) || 0) + 1);
      }
    }
  }
  return { byPN, byBase };
}

function lookupStockFromIndex(index, title) {
  const pns = extractPartNumbers(title);
  for (const pn of pns) {
    const exact = index.byPN.get(pn.normalized) || 0;
    if (exact > 0) return { count: exact, method: 'PART_NUMBER' };
    const base = index.byBase.get(pn.base) || 0;
    if (base > 0) return { count: base, method: 'PART_NUMBER' };
    for (const [indexedPN, count] of index.byPN) {
      if (stripRevisionSuffix(indexedPN) === pn.base) {
        return { count, method: 'PART_NUMBER' };
      }
    }
  }
  return { count: 0, method: 'NO_MATCH' };
}

module.exports = {
  extractPartNumbers,
  stripRevisionSuffix,
  parseYearRange,
  vehicleYearMatchesPart,
  modelMatches,
  buildStockIndex,
  lookupStockFromIndex,
};
```
---
## FILE: service/public/attack-list.html
```javascript
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="theme-color" content="#0a0a0a">
<meta name="mobile-web-app-capable" content="yes">
<link rel="manifest" href="/admin/manifest.json">
<link rel="apple-touch-icon" href="/admin/icon-192.png">
<title>DarkHawk — DAILY FEED</title>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  :root {
    --bg: #0a0a0a; --surface: #141414; --surface2: #1a1a1a;
    --border: #2a2a2a; --red: #DC2626; --red-dim: #7f1d1d;
    --yellow: #eab308; --yellow-dim: #713f12; --green: #22c55e;
    --gray: #9ca3af; --text: #F0F0F0; --text-mid: #d1d5db;
    --text-muted: #9CA3AF; --text-faint: #6B7280;
    --font: -apple-system, BlinkMacSystemFont, 'SF Pro Display', sans-serif;
  }
  body { font-family: var(--font); background: var(--bg); color: var(--text); min-height: 100vh; -webkit-tap-highlight-color: transparent; }

  /* Header */
  header {
    background: var(--surface); border-bottom: 1px solid var(--border);
    padding: 14px 16px; position: sticky; top: 0; z-index: 100;
    display: flex; align-items: center; justify-content: space-between;
  }
  .header-left h1 { font-size: 18px; font-weight: 700; letter-spacing: -0.03em; }
  .header-left p { font-size: 11px; color: var(--text-muted); margin-top: 1px; }
  .header-actions { display: flex; gap: 8px; }
  .icon-btn {
    width: 40px; height: 40px; border-radius: 10px;
    background: var(--surface2); border: 1px solid var(--border);
    color: var(--text-mid); font-size: 18px; cursor: pointer;
    display: flex; align-items: center; justify-content: center;
  }
  .icon-btn:active { opacity: 0.7; }

  /* Tabs */
  .tabs {
    display: flex; background: var(--surface); border-bottom: 1px solid var(--border);
    overflow-x: auto; scrollbar-width: none; -webkit-overflow-scrolling: touch;
  }
  .tabs::-webkit-scrollbar { display: none; }
  .tab {
    padding: 11px 16px; font-size: 12px; font-weight: 600;
    color: var(--text-muted); cursor: pointer; white-space: nowrap;
    border-bottom: 2px solid transparent; flex-shrink: 0;
  }
  .tab.active { color: var(--text); border-bottom-color: var(--red); }

  /* Status bar */
  .status-bar {
    padding: 6px 16px; background: var(--surface); border-bottom: 1px solid var(--border);
    font-size: 11px; color: var(--text-muted); display: flex; justify-content: space-between;
  }

  /* Vehicle list */
  .vehicle-list { padding: 0; }
  .vehicle-row {
    border-bottom: 1px solid var(--border); background: var(--surface2);
  }
  .vehicle-row:active { background: var(--surface); }

  /* Collapsed view — 48px min height per spec */
  .v-collapsed {
    display: flex; align-items: center; padding: 10px 14px; gap: 10px;
    min-height: 48px; cursor: pointer; user-select: none;
  }
  .v-score {
    width: 36px; height: 36px; border-radius: 8px; flex-shrink: 0;
    display: flex; align-items: center; justify-content: center;
    font-size: 13px; font-weight: 800;
  }
  .v-score.green { background: #064e3b; color: #22c55e; }
  .v-score.yellow { background: #713f12; color: #eab308; }
  .v-score.orange { background: #7c2d12; color: #f97316; }
  .v-score.red { background: #7f1d1d; color: #ef4444; }
  .v-score.gray { background: #1f2937; color: #6B7280; }
  .v-info { flex: 1; min-width: 0; }
  .v-title { font-size: 14px; font-weight: 600; }
  .v-meta { font-size: 11px; color: var(--text-muted); margin-top: 2px; display: flex; gap: 8px; flex-wrap: wrap; }
  .v-chips { display: flex; gap: 4px; margin-top: 5px; flex-wrap: wrap; }
  .chip {
    font-size: 10px; font-weight: 700; padding: 2px 6px; border-radius: 4px;
    letter-spacing: 0.03em; text-transform: uppercase;
  }
  .chip-green { background: #064e3b; color: #22c55e; }
  .chip-yellow { background: #713f12; color: #eab308; }
  .chip-orange { background: #7c2d12; color: #f97316; }
  .chip-red { background: #7f1d1d; color: #ef4444; }
  .chip-gray { background: #1f2937; color: #6B7280; }
  .chip-age { font-size: 9px; font-weight: 600; padding: 1px 5px; border-radius: 3px; margin-left: 4px; }
  .age-today { background: #064e3b; color: #22c55e; }
  .age-recent { background: #713f12; color: #eab308; }
  .age-old { background: #1f2937; color: #6B7280; }
  .alert-badge { font-size: 9px; font-weight: 700; padding: 2px 7px; border-radius: 4px; display: inline-flex; align-items: center; gap: 3px; cursor: pointer; }
  .alert-badge-mark { background: #eab308; color: #78350f; }
  .alert-badge-mark.claimed { background: #064e3b; color: #22c55e; }
  .alert-badge-stream { background: #1e3a5f; color: #3b82f6; font-size: 8px; }
  .alert-badge-stream.claimed { background: #064e3b; color: #22c55e; }
  .vehicle-stale { opacity: 0.45; }
  .vehicle-gone .v-score { border: 1px dashed var(--border); }
  .v-right { text-align: right; flex-shrink: 0; }
  .v-value { font-size: 13px; font-weight: 700; color: var(--green); }
  .v-row { font-size: 10px; color: var(--text-muted); margin-top: 1px; }
  .v-parts-count { font-size: 10px; color: var(--text-muted); margin-top: 1px; }
  /* Retention toggle */
  .toggle-bar { display: flex; align-items: center; justify-content: center; gap: 8px; padding: 8px 16px; background: var(--surface); border-bottom: 1px solid var(--border); font-size: 12px; color: var(--text-muted); }
  .toggle-btn { padding: 5px 12px; border-radius: 6px; border: 1px solid var(--border); background: var(--surface2); color: var(--text-muted); font-size: 11px; font-weight: 600; cursor: pointer; }
  .toggle-btn.active { background: #064e3b; color: #22c55e; border-color: #bbf7d0; }

  /* Expanded view */
  .v-expanded {
    display: none; padding: 0 14px 14px; background: var(--surface);
    border-top: 1px solid var(--border);
  }
  .v-expanded.open { display: block; }

  /* Part detail rows in expanded view */
  .part-detail {
    padding: 12px 0; border-bottom: 1px solid var(--border);
  }
  .part-detail:last-child { border-bottom: none; }
  .pd-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px; }
  .pd-title { font-size: 13px; font-weight: 600; flex: 1; min-width: 0; }
  .pd-verdict {
    font-size: 11px; font-weight: 700; padding: 3px 8px; border-radius: 5px; flex-shrink: 0; margin-left: 8px;
  }
  .verdict-great { background: #064e3b; color: #22c55e; }
  .verdict-good { background: #713f12; color: #eab308; }
  .verdict-fair { background: #7c2d12; color: #f97316; }
  .verdict-poor { background: #7f1d1d; color: #ef4444; }
  .pd-stats { display: flex; gap: 12px; font-size: 11px; color: var(--text-muted); flex-wrap: wrap; }
  .pd-reason { font-size: 11px; color: var(--text-muted); font-style: italic; margin-top: 4px; }
  .pd-actions { display: flex; gap: 6px; margin-top: 6px; }
  .btn-pull { padding: 4px 10px; font-size: 11px; font-weight: 700; border-radius: 6px; border: 1px solid #22c55e; background: transparent; color: #22c55e; cursor: pointer; font-family: var(--font); }
  .btn-pull:active { opacity: 0.7; }
  .btn-skip { padding: 4px 10px; font-size: 11px; font-weight: 700; border-radius: 6px; border: 1px solid var(--border); background: transparent; color: var(--text-muted); cursor: pointer; font-family: var(--font); }
  .btn-note { padding: 4px 10px; font-size: 11px; font-weight: 700; border-radius: 6px; border: 1px solid var(--border); background: transparent; color: var(--text-muted); cursor: pointer; font-family: var(--font); }
  .skip-dropdown { display: none; }
  .note-input { display: none; }

  /* Skip dropdown */
  .skip-dropdown {
    display: none; margin-top: 6px; background: var(--surface2);
    border: 1px solid var(--border); border-radius: 6px; overflow: hidden;
  }
  .skip-dropdown.open { display: block; }
  .skip-option {
    padding: 10px 12px; font-size: 12px; color: var(--text-mid);
    cursor: pointer; border-bottom: 1px solid var(--border);
  }
  .skip-option:last-child { border-bottom: none; }
  .skip-option:active { background: var(--border); }

  /* Note input */
  .note-input {
    display: none; margin-top: 6px;
  }
  .note-input.open { display: flex; gap: 6px; }
  .note-input input {
    flex: 1; padding: 8px 10px; background: var(--surface2); border: 1px solid var(--border);
    border-radius: 6px; color: var(--text); font-size: 12px; outline: none;
  }
  .note-input input:focus { border-color: var(--red); }
  .note-input button { padding: 8px 12px; }

  /* Location section */
  .loc-section {
    margin-top: 10px; padding: 10px; background: var(--surface2);
    border: 1px solid var(--border); border-radius: 6px;
  }
  .loc-header { font-size: 11px; font-weight: 700; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 5px; }
  .loc-text { font-size: 13px; font-weight: 600; color: var(--text); margin-bottom: 4px; }
  .loc-steps { list-style: decimal; padding-left: 16px; font-size: 12px; color: var(--text-mid); line-height: 1.5; }
  .loc-meta { display: flex; gap: 10px; flex-wrap: wrap; margin-top: 6px; font-size: 10px; color: var(--text-muted); }
  .loc-hazard { margin-top: 5px; font-size: 11px; color: var(--yellow); background: var(--yellow-dim); padding: 5px 7px; border-radius: 4px; }
  .loc-badge { font-size: 9px; font-weight: 700; padding: 2px 5px; border-radius: 3px; text-transform: uppercase; }
  .badge-high { background: #064e3b; color: #22c55e; }
  .badge-field { background: #713f12; color: #eab308; }
  .badge-res { background: #1f2937; color: #6B7280; }
  .loc-actions { display: flex; gap: 6px; margin-top: 8px; }
  .loc-actions button { font-size: 10px; font-weight: 600; padding: 4px 8px; border-radius: 4px; border: 1px solid var(--border); background: var(--surface); color: var(--text-muted); cursor: pointer; }

  /* Empty / loading states */
  .loading { text-align: center; padding: 60px 20px; color: var(--text-muted); }
  .spinner { width: 28px; height: 28px; border: 2px solid #333; border-top-color: #DC2626; border-radius: 50%; animation: spin 0.8s linear infinite; margin: 0 auto 12px; }
  @keyframes spin { to { transform: rotate(360deg); } }
  .empty-state { padding: 40px 20px; text-align: center; color: var(--text-muted); }
  .empty-state h3 { font-size: 15px; font-weight: 600; margin-bottom: 6px; color: var(--text); }
  .empty-state p { font-size: 12px; line-height: 1.5; }
  .btn-primary { margin-top: 12px; padding: 10px 20px; background: var(--red); border: none; border-radius: 8px; color: white; font-size: 13px; font-weight: 600; cursor: pointer; }

  /* VIN scanner modal — lightweight inline */
  .vin-modal { display:none; position:fixed; inset:0; background:rgba(0,0,0,0.9); z-index:200; overflow-y:auto; }
  .vin-modal.open { display:block; }
  .vin-inner { max-width:480px; margin:0 auto; padding:16px; padding-top:50px; }
  .vin-close { position:fixed; top:12px; right:16px; z-index:201; background:var(--surface2); border:1px solid var(--border); color:var(--text-muted); font-size:14px; width:36px; height:36px; border-radius:8px; cursor:pointer; display:flex; align-items:center; justify-content:center; }
  .vin-card { background:var(--surface); border:1px solid var(--border); border-radius:10px; padding:14px; margin-bottom:10px; }
  .vin-input { width:100%; padding:12px; border:1px solid var(--border); border-radius:8px; font-size:18px; font-family:monospace; font-weight:700; letter-spacing:0.08em; text-transform:uppercase; outline:none; background:var(--surface2); color:var(--text); }
  .vin-input:focus { border-color:var(--red); }

  /* Manual set list modal */
  .manual-modal { display: none; position: fixed; inset: 0; background: rgba(0,0,0,0.85); z-index: 200; align-items: flex-start; justify-content: center; padding: 20px; padding-top: 60px; }
  .manual-modal.open { display: flex; }
  .manual-card { background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 20px; width: 100%; max-width: 480px; }
  .manual-card h3 { font-size: 16px; margin-bottom: 4px; }
  .manual-card .subtitle { font-size: 11px; color: var(--text-muted); margin-bottom: 12px; line-height: 1.4; }
  .manual-textarea {
    width: 100%; min-height: 200px; max-height: 50vh; padding: 12px; font-family: monospace;
    font-size: 13px; line-height: 1.5; background: var(--surface2); border: 1px solid var(--border);
    border-radius: 8px; color: var(--text); resize: vertical; outline: none;
  }
  .manual-textarea:focus { border-color: var(--red); }
  .manual-textarea::placeholder { color: var(--text-faint); }
  .manual-actions { display: flex; gap: 8px; margin-top: 12px; justify-content: flex-end; }
  .manual-actions button { padding: 10px 20px; border-radius: 8px; font-size: 13px; font-weight: 600; cursor: pointer; border: none; }
  .btn-run { background: var(--red); color: white; }
  .btn-run:disabled { opacity: 0.5; cursor: not-allowed; }
  .btn-cancel { background: var(--surface2); color: var(--text-muted); border: 1px solid var(--border) !important; }
  .manual-banner {
    padding: 8px 14px; background: linear-gradient(90deg, #7f1d1d, #1a1a1a); border-bottom: 1px solid var(--border);
    display: flex; justify-content: space-between; align-items: center;
  }
  .manual-banner span { font-size: 12px; font-weight: 700; color: #ef4444; letter-spacing: 0.05em; }
  .manual-banner button { font-size: 11px; padding: 4px 10px; border-radius: 5px; background: var(--surface2); border: 1px solid var(--border); color: var(--text-muted); cursor: pointer; }
  @keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.6; } }
</style>
</head>
<body>

<div id="dh-nav"></div>
<script src="/admin/dh-nav.js?v=2"></script><script>dhNav('feed')</script>
<div style="display:flex;justify-content:space-between;align-items:center;padding:6px 14px;background:#0a0a0a;border-bottom:1px solid #2a2a2a;">
  <p id="headerSub" style="font-size:11px;color:#6b7280;">Loading...</p>
  <div class="header-actions">
    <button class="icon-btn" onclick="openManualModal()" title="Paste Set List">📋</button>
    <button class="icon-btn" onclick="openVinModal()" title="Scan VIN">📷</button>
    <button class="icon-btn" id="scrapeBtn" onclick="triggerScrapeAll(this)" title="Refresh inventory from LKQ">🔄</button>
  </div>
</div>

<div class="tabs" id="tabBar">
  <div class="tab active" onclick="showTab('all')" id="tab-all">All</div>
  <div class="tab" onclick="showTab('yard:LKQ Raleigh')" id="tab-yard:LKQ Raleigh">Raleigh</div>
  <div class="tab" onclick="showTab('yard:LKQ Durham')" id="tab-yard:LKQ Durham">Durham</div>
  <div class="tab" onclick="showTab('yard:LKQ Greensboro')" id="tab-yard:LKQ Greensboro">Greensboro</div>
  <div class="tab" onclick="showTab('yard:LKQ East NC')" id="tab-yard:LKQ East NC">East NC</div>
  <div class="tab" onclick="showTab('florida')" id="tab-florida" style="border-left:1px solid var(--border);margin-left:4px;padding-left:12px">Florida</div>
  <div class="tab" onclick="showTab('yard:LKQ Tampa')" id="tab-yard:LKQ Tampa">Tampa</div>
  <div class="tab" onclick="showTab('yard:LKQ Largo')" id="tab-yard:LKQ Largo">Largo</div>
  <div class="tab" onclick="showTab('yard:LKQ Clearwater')" id="tab-yard:LKQ Clearwater">Clearwater</div>
  <div class="tab" id="tab-manual" onclick="showTab('manual')" style="display:none;border-left:1px solid var(--border);margin-left:4px;padding-left:12px;color:#ef4444;font-weight:700;">MANUAL</div>
</div>

<div class="status-bar">
  <span id="statusLeft">—</span>
  <span id="statusRight">—</span>
</div>

<div class="toggle-bar">
  <button class="toggle-btn active" id="filt-today" onclick="setDateFilter('today')">Today</button>
  <button class="toggle-btn" id="filt-3d" onclick="setDateFilter('3d')">3 Days</button>
  <button class="toggle-btn" id="filt-7d" onclick="setDateFilter('7d')">7 Days</button>
  <button class="toggle-btn" id="filt-30d" onclick="setDateFilter('30d')">30 Days</button>
  <button class="toggle-btn" id="filt-60d" onclick="setDateFilter('60d')">60 Days</button>
  <button class="toggle-btn" id="filt-all" onclick="setDateFilter('all')">All</button>
</div>

<div id="mainContent">
  <div class="loading"><div class="spinner"></div><div>Building attack list...</div></div>
</div>

<!-- Manual Set List Modal -->
<div class="manual-modal" id="manualModal">
  <div class="manual-card">
    <h3>📋 Paste Set List</h3>
    <div class="subtitle">Paste vehicles from any junkyard — website, Facebook, text, whatever. One per line. Any format works.</div>
    <textarea class="manual-textarea" id="manualText" placeholder="2009 Dodge Ram 1500 Silver Row C3&#10;09 RAM 1500&#10;2011 Ford F-150 3.5L EcoBoost&#10;2018 Chevy Silverado 4WD White&#10;Honda Civic 2016 Blue"></textarea>
    <div class="manual-actions">
      <button class="btn-cancel" onclick="closeManualModal()">Cancel</button>
      <button class="btn-run" id="manualRunBtn" onclick="runManualList()">Run It</button>
    </div>
    <div id="manualError" style="margin-top:8px;font-size:11px;color:#ef4444;display:none;"></div>
  </div>
</div>

<!-- VIN Scanner Modal — inline, no page navigation -->
<div class="vin-modal" id="vinModal">
  <button class="vin-close" onclick="closeVinModal()">X</button>
  <div class="vin-inner">
    <div class="vin-card">
      <div style="font-size:10px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.06em;margin-bottom:8px">Scan or Enter VIN</div>
      <input type="text" class="vin-input" id="vinInput" maxlength="17" placeholder="17-character VIN" autocomplete="off" spellcheck="false">
      <div style="display:flex;gap:8px;margin-top:10px">
        <button class="icon-btn" style="font-size:20px;width:48px;height:44px;" id="vinCamBtn">📷</button>
        <button class="btn-primary" style="flex:1;padding:12px;font-size:14px;" id="vinDecBtn" onclick="vinDecode()">Decode</button>
      </div>
      <div id="vinStatus" style="font-size:11px;color:var(--text-muted);margin-top:6px"></div>
    </div>
    <div id="vinResults"></div>
  </div>
</div>

<script>
  let allData = null;
  let currentTab = 'all';
  let dateFilter = 'today'; // 'today', '3d', '7d', '30d', 'all'
  const activeSessions = {};
  const dataCache = {}; // keyed by filter mode

  // Eastern time helpers
  function easternDateStr(d) {
    if (!d) return null;
    return new Date(d).toLocaleDateString('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' });
  }

  function easternSinceDateISO(daysAgo) {
    const now = new Date();
    const past = new Date(now);
    past.setDate(past.getDate() - daysAgo);
    const dateStr = past.toLocaleDateString('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' });
    // 5am UTC = midnight EST (safe floor — in EDT this is 1am, still captures full day)
    return dateStr + 'T05:00:00.000Z';
  }

  function filterSinceParam() {
    if (dateFilter === 'today') return easternSinceDateISO(0);
    if (dateFilter === '3d') return easternSinceDateISO(3);
    if (dateFilter === '7d') return easternSinceDateISO(7);
    if (dateFilter === '30d') return easternSinceDateISO(30);
    if (dateFilter === '60d') return easternSinceDateISO(60);
    return null; // 'all' = no filter
  }

  async function setDateFilter(mode) {
    dateFilter = mode;
    document.querySelectorAll('.toggle-btn').forEach(b => b.classList.remove('active'));
    document.getElementById('filt-' + mode).classList.add('active');
    if (dataCache[mode]) {
      allData = dataCache[mode];
      renderData();
    } else {
      await loadData();
    }
  }

  function getLastSeenDaysAgo(v) {
    // How many calendar days ago (Eastern) was this vehicle last confirmed on the yard
    const d = v.last_seen || v.scraped_at;
    if (!d) return 999;
    const todayET = easternDateStr(new Date());
    const seenET = easternDateStr(d);
    if (!todayET || !seenET) return 999;
    const todayMs = new Date(todayET + 'T00:00:00').getTime();
    const seenMs = new Date(seenET + 'T00:00:00').getTime();
    return Math.round((todayMs - seenMs) / 86400000);
  }

  function getSetDaysAgo(v) {
    // How many calendar days ago (Eastern) was this vehicle set at the yard?
    // Uses date_added (LKQ's "Available" date) because createdAt reflects scraper
    // run time (often 10pm ET = previous day in Eastern), not the actual set date.
    // Clamp future dates to today (Clearwater sometimes reports 1 day ahead).
    const d = v.date_added || v.createdAt;
    if (!d) return 999;
    const todayET = easternDateStr(new Date());
    const addedET = easternDateStr(d);
    if (!todayET || !addedET) return 999;
    const todayMs = new Date(todayET + 'T00:00:00').getTime();
    const addedMs = new Date(addedET + 'T00:00:00').getTime();
    const days = Math.round((todayMs - addedMs) / 86400000);
    return Math.max(0, days); // clamp: future dates show as "today"
  }

  function ageBadge(v) {
    const days = getSetDaysAgo(v);
    if (days < 0) return '<span class="chip chip-age age-today">NEW ' + Math.abs(days) + 'd</span>';
    if (days === 0) return '<span class="chip chip-age age-today">Today</span>';
    if (days <= 2) return '<span class="chip chip-age age-recent">' + days + 'd ago</span>';
    if (days <= 7) return '<span class="chip chip-age age-old">' + days + 'd ago</span>';
    if (days <= 30) return '<span class="chip chip-age age-old">' + days + 'd</span>';
    return '<span class="chip chip-age age-old">' + days + 'd</span>';
  }

  function vehicleRowClass(v) {
    if (!v.is_active) return 'vehicle-stale vehicle-gone';
    const days = getSetDaysAgo(v);
    if (days > 30) return 'vehicle-stale';
    return '';
  }

  // Strip LKQ platform/body codes from display
  // Strips letter+digit codes (DS1, DS6, WK2, LA1, RT1) and known platform-only letter codes (JK, JL, JT, WK, XK, MK, KJ, KL, DJ, DT, DH, BK, WJ, ZJ, TJ, ND, WD, PF, UF, FK)
  // Preserves real trims: LX, SXT, SRT, GT, SE, LE, XLE, LTZ, etc.
  const LKQ_PLATFORM_CODES = new Set(['JK','JL','JT','WK','XK','MK','KJ','KL','DJ','DT','DH','BK','WJ','ZJ','TJ','ND','WD','PF','UF','FK','FF','AN','EN','GS','JS','KA','RU','ZH','WH','RE','PT','LA','LD','BR','BE','AB','AY','PM','PG','DR','SA']);
  // Clean model name: strip LKQ codes, NHTSA trim junk, duplicate words
  function cleanModel(text, make) {
    if (!text) return text;
    var cleaned = stripLKQCodes(text, make);
    // Suburban 1500/2500 → Suburban, Yukon XL 1500 → Yukon XL, Avalanche 1500 → Avalanche
    cleaned = cleaned.replace(/\bSUBURBAN\s+1500\b/gi, 'Suburban');
    cleaned = cleaned.replace(/\bSUBURBAN\s+2500\b/gi, 'Suburban');
    cleaned = cleaned.replace(/\bYUKON\s+XL\s+1500\b/gi, 'Yukon XL');
    cleaned = cleaned.replace(/\bAVALANCHE\s+1500\b/gi, 'Avalanche');
    // Mazda: LKQ stores "3" but should display "Mazda3"
    if (/mazda/i.test(make || '')) {
      cleaned = cleaned.replace(/^3$/i, 'Mazda3');
      cleaned = cleaned.replace(/^6$/i, 'Mazda6');
      cleaned = cleaned.replace(/^5$/i, 'Mazda5');
    }
    // Strip NHTSA trim lists stuffed into model names ("CAMRY LE/SE/XLE" → "CAMRY")
    cleaned = cleaned.replace(/\s+(LE|SE|XLE|XSE|LX|EX|LT|LS|SL|SV|SR|DX|SXT|SLT|XLT|SEL|Limited|Sport|Base|Premium|Luxury|Touring)(\/[A-Za-z]+)*\s*$/i, '');
    cleaned = cleaned.replace(/\s+[A-Z]{1,4}(\/[A-Z]{1,4}){2,}\s*$/i, '');
    cleaned = cleaned.replace(/\b(NFA|NFB|NFC)\b/gi, '');
    // Remove duplicate consecutive words (case-insensitive): "350 350" → "350"
    cleaned = cleaned.replace(/\b(\w+)\s+\1\b/gi, '$1');
    return cleaned.trim();
  }

  function stripLKQCodes(text, make) {
    if (!text) return text;
    var clean = text;
    // Only strip LKQ body codes (DS1, DS6, WK2, LA1) on Stellantis vehicles where they actually appear
    if (/dodge|ram|chrysler|jeep/i.test(make || '')) {
      clean = clean.replace(/\b[A-Z]{2}\d\b/g, '');  // Exactly 2 letters + 1 digit: DS1, DS6, WK2
    }
    return clean
      .replace(/\b([A-Z]{2})\b/g, (m, code) => LKQ_PLATFORM_CODES.has(code) ? '' : m) // known 2-letter platform codes
      .replace(/,\s*,/g, ',')
      .replace(/[, ]+,/g, ',')
      .replace(/,\s*$/, '')
      .replace(/^\s*,\s*/, '')
      .replace(/\s*,\s*(\d+\.\d+L)/g, ' $1') // comma before engine size
      .replace(/\s{2,}/g, ' ')
      .trim();
  }

  let scrapeHealth = {}; // keyed by yard name

  async function loadData() {
    document.getElementById('mainContent').innerHTML = '<div class="loading"><div class="spinner"></div><div>Scoring vehicles...</div></div>';
    try {
      const since = filterSinceParam();
      const url = since ? '/attack-list?since=' + encodeURIComponent(since) : '/attack-list';
      // Fetch attack list and scrape health in parallel
      const [res, healthRes] = await Promise.all([
        fetch(url),
        fetch('/yards/scrape-health').catch(() => null),
      ]);
      const data = await res.json();
      if (!data.success) throw new Error(data.error);

      // Parse scrape health
      if (healthRes && healthRes.ok) {
        try {
          const h = await healthRes.json();
          scrapeHealth = {};
          if (h.yards) h.yards.forEach(y => { scrapeHealth[y.name] = y; });
          scrapeHealth._summary = h.summary;
        } catch (e) { scrapeHealth = {}; }
      }

      allData = data;
      dataCache[dateFilter] = data;
      renderData();
      const ts = new Date(data.generated_at);
      document.getElementById('statusLeft').textContent = 'Updated ' + ts.toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'});
      document.getElementById('headerSub').textContent = data.yards.length + ' yards scored';

      // Pre-fetch 3d in background after today renders
      if (dateFilter === 'today' && !dataCache['3d']) {
        const since3d = easternSinceDateISO(3);
        fetch('/attack-list?since=' + encodeURIComponent(since3d))
          .then(r => r.json())
          .then(d => { if (d.success) dataCache['3d'] = d; })
          .catch(() => {});
      }
    } catch (err) {
      document.getElementById('mainContent').innerHTML = `<div class="empty-state"><h3>Could not load</h3><p>${err.message}</p><button class="btn-primary" onclick="loadData()">Retry</button></div>`;
    }
  }

  function showTab(tab) {
    currentTab = tab;
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.getElementById('tab-' + tab).classList.add('active');
    if (tab === 'manual' && manualResults) {
      showingManual = true;
      renderManualResults();
    } else {
      showingManual = false;
      renderData();
    }
  }

  function renderData() {
    if (!allData) return;
    pendingLazy = []; // Reset lazy sections
    if (lazyObserver) lazyObserver.disconnect();
    let yards = allData.yards;

    if (currentTab.startsWith('yard:')) {
      const yardName = currentTab.slice(5);
      yards = yards.filter(y => y.yard.name === yardName);
    } else if (currentTab === 'florida') {
      yards = yards.filter(y => ['LKQ Tampa','LKQ Largo','LKQ Clearwater'].includes(y.yard.name));
    }

    if (!yards.length || !yards.some(y => y.total_vehicles > 0)) {
      document.getElementById('mainContent').innerHTML = `<div class="empty-state"><h3>No vehicles found</h3><p>LKQ scrapes run at 2am nightly.</p><button class="btn-primary" onclick="triggerScrape(this)">Refresh Inventory Now</button></div>`;
      return;
    }

    // Count totals for status bar (server already filtered by last_seen)
    let totalV = 0, hotV = 0;
    yards.forEach(y => {
      const fv = y.vehicles || [];
      totalV += fv.length;
      hotV += fv.filter(v => v.color_code === 'green' || v.color_code === 'yellow').length;
    });
    document.getElementById('statusRight').textContent = `${totalV} vehicles · ${hotV} flagged`;

    let html = '';

    // Scrape health summary on All tab — only show when problems exist
    if (currentTab === 'all' && scrapeHealth._summary) {
      const s = scrapeHealth._summary;
      const problems = s.warning + s.stale + s.critical;
      if (problems > 0) {
        const color = s.critical > 0 ? '#fca5a5' : '#fbbf24';
        const bg = s.critical > 0 ? '#7f1d1d' : '#713f12';
        html += `<div style="padding:8px 14px;background:${bg};border-bottom:1px solid var(--border);font-size:12px;color:${color};font-weight:600;">
          Scrape health: ${s.healthy}/${s.total} yards healthy · ${problems} yard${problems > 1 ? 's' : ''} need attention
        </div>`;
      }
    }

    for (const yd of yards) {
      if (yd.total_vehicles === 0) continue;

      const vehicles = yd.vehicles || yd.top_vehicles || [];
      // Yard priority based on highest est_value vehicle
      const topValue = yd.est_total_value > 0 ? Math.max(...(yd.vehicles||[]).map(v=>v.est_value||0)) : 0;
      const priority = topValue >= 800 ? 'GO' : topValue >= 500 ? 'GOOD' : topValue >= 250 ? 'OK' : '—';
      const prioClass = topValue >= 800 ? 'chip-green' : topValue >= 500 ? 'chip-yellow' : topValue >= 250 ? 'chip-orange' : 'chip-gray';
      const lastScraped = yd.yard.last_scraped ? timeAgo(yd.yard.last_scraped) : 'never';

      // Vehicles already filtered server-side by last_seen
      const filtered = vehicles;
      if (filtered.length === 0) continue;

      html += `<div class="yard-group">
        <div style="padding:10px 14px;background:var(--surface);border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center;">
          <div>
            <span style="font-size:14px;font-weight:700;">${yd.yard.name}</span>
            <span style="font-size:11px;color:#9CA3AF;margin-left:8px;">${filtered.length} vehicles · ${lastScraped}</span>
          </div>
          <div style="display:flex;gap:6px;align-items:center;">
            <span class="chip ${prioClass}">${priority}</span>
            <button class="icon-btn" style="width:28px;height:28px;font-size:12px;" onclick="scrapeYard('${yd.yard.id}',this)" title="Refresh ${yd.yard.name}">🔄</button>
          </div>
        </div>
        <div class="vehicle-list">`;

      // Scrape health indicator
      const yHealth = scrapeHealth[yd.yard.name];
      if (yHealth) {
        const hrs = yHealth.hours_since_scrape;
        const newV = yHealth.new_vehicles_last_scrape;
        if (yHealth.status === 'critical') {
          html += `<div style="padding:6px 14px;background:#7f1d1d;border-bottom:1px solid var(--border);font-size:11px;color:#fca5a5;display:flex;justify-content:space-between;align-items:center;animation:pulse 2s infinite;">
            <span>No scrape in ${Math.round(hrs)}h — CHECK SCRAPER IMMEDIATELY</span>
            <button class="icon-btn" style="width:24px;height:24px;font-size:11px;background:transparent;border:1px solid #fca5a5;color:#fca5a5;" onclick="scrapeYard('${yd.yard.id}',this)">🔄</button>
          </div>`;
        } else if (yHealth.status === 'stale') {
          html += `<div style="padding:6px 14px;background:#7f1d1d;border-bottom:1px solid var(--border);font-size:11px;color:#fca5a5;display:flex;justify-content:space-between;align-items:center;">
            <span>No scrape in ${Math.round(hrs)}h — scraper may not have run</span>
            <button class="icon-btn" style="width:24px;height:24px;font-size:11px;background:transparent;border:1px solid #fca5a5;color:#fca5a5;" onclick="scrapeYard('${yd.yard.id}',this)">🔄</button>
          </div>`;
        } else if (yHealth.status === 'warning') {
          html += `<div style="padding:6px 14px;background:#713f12;border-bottom:1px solid var(--border);font-size:11px;color:#fbbf24;display:flex;justify-content:space-between;align-items:center;">
            <span>Last scrape found 0 new vehicles — data may be stale</span>
            <button class="icon-btn" style="width:24px;height:24px;font-size:11px;background:transparent;border:1px solid #fbbf24;color:#fbbf24;" onclick="scrapeYard('${yd.yard.id}',this)">🔄</button>
          </div>`;
        }
      }

      // Group by date section
      const sections = [
        { label: 'SET TODAY', vehicles: filtered.filter(v => getSetDaysAgo(v) <= 0) },
        { label: 'LAST 3 DAYS', vehicles: filtered.filter(v => { const d = getSetDaysAgo(v); return d >= 1 && d <= 3; }) },
        { label: 'THIS WEEK', vehicles: filtered.filter(v => { const d = getSetDaysAgo(v); return d >= 4 && d <= 7; }) },
        { label: 'OLDER', vehicles: filtered.filter(v => getSetDaysAgo(v) > 7) },
      ];

      for (const sec of sections) {
        if (sec.vehicles.length === 0) continue;
        html += `<div style="padding:6px 14px;background:#1a1a1a;border-bottom:1px solid var(--border);font-size:10px;font-weight:700;color:#9CA3AF;text-transform:uppercase;letter-spacing:0.05em;display:flex;justify-content:space-between;">`
          + `<span>${sec.label}</span><span>${sec.vehicles.length}</span></div>`;
        // Render first BATCH_SIZE immediately, rest via lazy loading
        const BATCH = 30;
        for (let i = 0; i < Math.min(BATCH, sec.vehicles.length); i++) {
          html += renderVehicle(sec.vehicles[i]);
        }
        if (sec.vehicles.length > BATCH) {
          const sectionId = 'lazy-' + yd.yard.id + '-' + sec.label.replace(/\s+/g, '');
          pendingLazy.push({ id: sectionId, vehicles: sec.vehicles.slice(BATCH) });
          html += `<div id="${sectionId}" style="padding:12px 14px;text-align:center;color:#6B7280;font-size:11px;cursor:pointer;" onclick="loadLazySection('${sectionId}')">Show ${sec.vehicles.length - BATCH} more...</div>`;
        }
      }
      html += '</div></div>';
    }
    document.getElementById('mainContent').innerHTML = html;
    // Auto-load lazy sections as user scrolls near them
    setupLazyObserver();
  }

  let pendingLazy = [];
  let lazyObserver = null;

  function setupLazyObserver() {
    if (lazyObserver) lazyObserver.disconnect();
    if (pendingLazy.length === 0) return;
    lazyObserver = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          loadLazySection(entry.target.id);
          lazyObserver.unobserve(entry.target);
        }
      }
    }, { rootMargin: '200px' });
    for (const p of pendingLazy) {
      const el = document.getElementById(p.id);
      if (el) lazyObserver.observe(el);
    }
  }

  function loadLazySection(sectionId) {
    const idx = pendingLazy.findIndex(p => p.id === sectionId);
    if (idx === -1) return;
    const section = pendingLazy[idx];
    pendingLazy.splice(idx, 1);
    const el = document.getElementById(sectionId);
    if (!el) return;
    let html = '';
    for (const v of section.vehicles) html += renderVehicle(v);
    el.outerHTML = html;
  }

  function renderVehicle(v) {
    const sc = v.color_code;
    // Use part_chips (slim mode) or parts (full/manual mode) for chip display
    const chipSource = v.part_chips || (v.parts || []).slice(0, 4).map(p => ({ partType: p.partType || p.category, price: p.price }));
    const chipTypes = new Set();
    const chips = chipSource.filter(p => {
      const t = p.partType || '?';
      if (chipTypes.has(t)) return false;
      chipTypes.add(t);
      return true;
    }).sort((a, b) => (b.price || 0) - (a.price || 0)).slice(0, 4).map(p => {
      const price = p.price || 0;
      const cc = price >= 250 ? 'chip-green' : price >= 150 ? 'chip-yellow' : price >= 100 ? 'chip-orange' : price > 0 ? 'chip-red' : 'chip-gray';
      return `<span class="chip ${cc}">${p.partType || '?'}</span>`;
    }).join('');

    const rowClass = vehicleRowClass(v);
    const aBadge = ageBadge(v);
    const goneLabel = v.is_active === false ? '<span class="chip chip-age age-old">GONE</span>' : '';

    // Don't pre-render expanded parts — load on demand when tapped
    const hasPartsPreloaded = v.parts && v.parts.length > 0;

    return `<div class="vehicle-row ${rowClass}" id="vrow-${v.id}">
      <div class="v-collapsed" onclick="toggleV('${v.id}')">
        <div class="v-score ${sc}">${v.score}</div>
        <div class="v-info">
          <div class="v-title"><strong style="color:#fff">${v.year} ${cleanModel(v.make, '')} ${cleanModel(v.model, v.make)}</strong>${v.engine ? ` <span style="font-size:13px;color:#b0b0b0;font-weight:600">${v.engine}</span>` : ''}${v.trimBadge ? ` <span class="chip" style="font-size:9px;font-weight:${v.trimBadge.color === 'gray' ? '500' : '700'};padding:1px 6px;background:${v.trimBadge.color === 'green' ? '#22c55e' : v.trimBadge.color === 'blue' ? '#3b82f6' : v.trimBadge.color === 'gray' ? '#374151' : '#f59e0b'};color:${v.trimBadge.color === 'gray' ? '#9ca3af' : '#000'}">${v.trimBadge.decodedTrim || v.trimBadge.label}</span>` : ''}${v.cult ? ' <span class="chip" style="font-size:9px;font-weight:700;padding:1px 6px;background:#d946ef;color:#000">CULT</span>' : ''}${v.diesel ? ' <span class="chip" style="font-size:9px;font-weight:700;padding:1px 6px;background:#3b82f6;color:#000">DIESEL</span>' : ''}${(() => { const dt = (v.decoded_drivetrain || v.drivetrain || '').toUpperCase(); if (/4WD|4X4|AWD/i.test(dt)) return ' <span class="chip" style="font-size:9px;font-weight:700;padding:1px 6px;background:#16a34a;color:#000">' + (/AWD/i.test(dt) ? 'AWD' : '4WD') + '</span>'; if (/FWD/i.test(dt)) return ' <span class="chip" style="font-size:9px;font-weight:500;padding:1px 6px;background:#374151;color:#9ca3af">FWD</span>'; return ''; })()}${v.decoded_transmission ? (/manual/i.test(v.decoded_transmission) && v.decoded_transmission !== 'CHECK_MT' ? ' <span class="chip" style="font-size:9px;font-weight:700;padding:1px 6px;background:#06b6d4;color:#000">MANUAL</span>' : v.decoded_transmission === 'CHECK_MT' ? ' <span class="chip" style="font-size:9px;font-weight:700;padding:1px 6px;background:#06b6d4;color:#000;opacity:0.6">CHECK MT</span>' : /cvt/i.test(v.decoded_transmission) ? ' <span class="chip" style="font-size:9px;font-weight:500;padding:1px 6px;background:#374151;color:#9ca3af">CVT</span>' : '') : ''}${(() => { const dt = (v.decoded_drivetrain || v.drivetrain || '').toUpperCase(); const is4x4 = /4WD|4X4|AWD/i.test(dt); const isMT = v.decoded_transmission && (/manual/i.test(v.decoded_transmission) || v.decoded_transmission === 'CHECK_MT'); return is4x4 && isMT ? ' <span class="chip" style="font-size:9px;font-weight:700;padding:1px 6px;background:#3b82f6;color:#000">4\u00d74+MT</span>' : ''; })()} ${aBadge}${goneLabel}</div>
          ${renderAlertBadges(v)}
          <div class="v-meta">
            ${v.row_number ? `<span>Row ${v.row_number}</span>` : ''}
            ${v.color ? `<span style="font-weight:600">${v.color}</span>` : ''}
            ${v.engine_type && v.engine_type !== 'Gas' ? `<span class="chip chip-age ${v.engine_type === 'Hybrid' ? 'age-recent' : 'age-today'}" style="font-size:9px;font-weight:700">${v.engine_type.toUpperCase()}</span>` : ''}
            ${(v.date_added || v.createdAt) ? `<span>${timeAgo(v.date_added || v.createdAt)}</span>` : ''}
          </div>
          <div class="v-chips">${chips || '<span class="chip chip-gray">No data</span>'}</div>
        </div>
        <div class="v-right">
          ${v.est_value > 0 ? `<div class="v-value">$${v.est_value}</div>` : ''}
          ${v.matched_parts > 0 ? `<div class="v-parts-count">${v.matched_parts} parts</div>` : ''}
        </div>
      </div>
      <div class="v-expanded" id="vexp-${v.id}">
        ${hasPartsPreloaded ? renderExpandedParts(v) : (v.parts && v.parts.length === 0 ? '<div style="padding:12px 0;color:#6B7280;font-size:12px;">No parts matched for this vehicle</div>' : '<div style="padding:12px 0;color:#9CA3AF;font-size:12px;">Tap to load parts...</div>')}
      </div>
    </div>`;
  }

  function renderExpandedParts(v) {
    const parts = v.parts || [];
    const rebuildParts = v.rebuild_parts || [];
    if (parts.length === 0 && rebuildParts.length === 0) {
      return '<div style="padding:12px 0;color:#9CA3AF;font-size:12px;">No matching inventory parts found.</div>';
    }

    let html = '';

    // Show validated trim suggestions (sellable parts only, with avg prices)
    if (v.validated_suggestions && v.validated_suggestions.length > 0) {
      const lines = [];
      const baseNeeded = {}; // part_type_key → base_avg_price (deduplicated)

      for (const s of v.validated_suggestions) {
        const price = s.premium_avg ? Math.round(s.premium_avg) : null;

        if (s.verdict === 'CONFIRMED' || s.verdict === 'WORTH_IT') {
          const color = price >= 100 ? '#22c55e' : '#eab308';
          lines.push(`<span style="color:${color};font-weight:600">\u2705 ${s.suggestion} — $${price}</span>`);
        } else if (s.verdict === 'NO_PREMIUM') {
          if (price && price >= 100) {
            lines.push(`<span style="color:#9CA3AF">${s.suggestion} — $${price}</span>`);
          }
        } else if (s.verdict === 'MARGINAL') {
          if (price && price >= 100) {
            lines.push(`<span style="color:#9CA3AF">${s.suggestion} — $${price}</span>`);
          }
        } else if (s.verdict === 'INSUFFICIENT') {
          if (price && price >= 100) {
            lines.push(`<span style="color:#9CA3AF">${s.suggestion} — $${price}</span>`);
          }
        } else {
          // UNVALIDATED
          lines.push(`<span style="color:#4b5563">? ${s.suggestion}</span>`);
        }

        // Track base lines needed (deduplicated per part_type)
        if (s.show_base && s.part_type_key && !baseNeeded[s.part_type_key]) {
          baseNeeded[s.part_type_key] = Math.round(s.base_avg_price);
        }
      }

      // Append base lines at the end, one per part_type
      const baseLabels = { amp: 'Amp', nav_radio: 'Radio', '360_camera': 'Camera', digital_cluster: 'Cluster', backup_camera: 'Camera' };
      for (const [pt, basePrice] of Object.entries(baseNeeded)) {
        if (basePrice >= 100) {
          const label = baseLabels[pt] || pt;
          lines.push(`<span style="color:#22c55e;font-weight:600">\u2705 ${label} (base) — $${basePrice}</span>`);
        }
      }

      if (lines.length > 0) {
        const suggestionsHtml = lines.join('<br>');
        html += `<div style="margin:6px 0 8px 0;padding:6px 8px;background:#1a1a2e;border-radius:6px;border:1px solid #333">
          <span style="color:#888;font-size:10px;text-transform:uppercase;letter-spacing:0.5px">Validated Trim Parts</span>
          ${v.audio_brand ? `<span style="color:#d946ef;font-size:10px;margin-left:8px;font-weight:600">\uD83D\uDD0A ${v.audio_brand}</span>` : ''}
          <div style="font-size:12px;margin-top:3px;line-height:1.6">${suggestionsHtml}</div>
        </div>`;
      }
    } else if (v.expected_parts) {
      // Fallback: show raw expected_parts if no validated suggestions
      html += `<div style="margin:6px 0 8px 0;padding:6px 8px;background:#1a1a2e;border-radius:6px;border:1px solid #333">
        <span style="color:#888;font-size:10px;text-transform:uppercase;letter-spacing:0.5px">Expected on this trim</span>
        ${v.audio_brand ? `<span style="color:#d946ef;font-size:10px;margin-left:8px;font-weight:600">\uD83D\uDD0A ${v.audio_brand}</span>` : ''}
        <div style="color:#ccc;font-size:12px;margin-top:3px">${v.expected_parts}</div>
      </div>`;
    }

    if (v.platform_siblings && v.platform_siblings.length > 0) {
      html += `<div style="padding:8px 0;font-size:11px;color:#9CA3AF;border-bottom:1px solid var(--border);">
        <span style="color:var(--yellow);font-weight:600;">PLATFORM:</span> Also fits ${v.platform_siblings.join(', ')}
      </div>`;
    }

    // Sort parts: our sold data first, then market data, then price descending
    parts.sort((a, b) => {
      // Parts we've sold are always most trustworthy
      const soldA = (a.sold_90d || 0) > 0 ? 1 : (a.marketMedian > 0 ? 2 : 3);
      const soldB = (b.sold_90d || 0) > 0 ? 1 : (b.marketMedian > 0 ? 2 : 3);
      if (soldA !== soldB) return soldA - soldB;
      // Then by primary price descending (our price if we've sold, market otherwise)
      const pA = (a.sold_90d > 0 && a.price > 0) ? a.price : (a.marketMedian > 0 ? a.marketMedian : a.price || 0);
      const pB = (b.sold_90d > 0 && b.price > 0) ? b.price : (b.marketMedian > 0 ? b.marketMedian : b.price || 0);
      return pB - pA;
    });

    // Pullable parts
    for (const p of parts) {
      if (!p) continue;
      const pid = p.itemId || ('s' + Math.random().toString(36).slice(2, 8));
      // OUR sold price is primary when we have recent sales; market data fills gaps
      const hasOurSales = (p.sold_90d || 0) > 0 && p.price > 0;
      const isEst = p.priceSource === 'estimate';
      const displayPrice = hasOurSales ? p.price : (p.marketMedian > 0 ? p.marketMedian : (p.price != null ? p.price : 0));
      const badgeVerdict = isEst ? 'EST' : displayPrice >= 250 ? 'GREAT' : displayPrice >= 150 ? 'GOOD' : displayPrice >= 100 ? 'FAIR' : 'POOR';
      const vc = badgeVerdict === 'EST' ? 'verdict-poor' : badgeVerdict === 'GREAT' ? 'verdict-great' : badgeVerdict === 'GOOD' ? 'verdict-good' : badgeVerdict === 'FAIR' ? 'verdict-fair' : 'verdict-poor';
      const price = displayPrice;
      const pricePrefix = isEst ? '~$' : '$';
      const inStock = p.in_stock != null ? p.in_stock : 0;
      const sold90d = p.sold_90d != null ? p.sold_90d : 0;
      // Price freshness indicator
      let freshness = '❓';
      if (hasOurSales) {
        // Our own sales — freshness based on last sold date
        if (p.lastSoldDate) {
          const daysAgo = Math.floor((Date.now() - new Date(p.lastSoldDate).getTime()) / 86400000);
          freshness = daysAgo <= 30 ? '✅' : daysAgo <= 60 ? '⚠️' : '❌';
        } else {
          freshness = '✅'; // We have sold_90d > 0 so it's recent
        }
      } else if (p.marketCheckedAt) {
        const daysAgo = Math.floor((Date.now() - new Date(p.marketCheckedAt).getTime()) / 86400000);
        freshness = daysAgo <= 60 ? '✅' : daysAgo <= 90 ? '⚠️' : '❌';
      } else if (p.marketMedian > 0) {
        freshness = '✅';
      }
      html += `<div class="part-detail" id="pd-${v.id}-${pid}">
        <div class="pd-header">
          <div class="pd-title">${p.isMarked ? '<span style="font-size:9px;font-weight:700;padding:1px 6px;border-radius:3px;background:#f59e0b;color:#000;margin-right:4px" title="On your restock watch list">MARKED</span>' : ''}${p.partType ? `[${p.partType}] ` : ''}${p.title || p.category || 'Part'}</div>
          <div class="pd-verdict ${vc}">${badgeVerdict} ${pricePrefix}${price} ${freshness}</div>
        </div>
        <div class="pd-stats">
          <span>${inStock} in stock</span>
          <span>${sold90d} sold/90d</span>
          ${p.partNumber ? `<span>${p.partNumber}</span>` : ''}
          ${isEst ? '<span style="color:#6B7280;font-size:9px" title="Conservative estimate — no market data available">est</span>' : ''}
        </div>
        <div class="pd-reason">${p.reason || ''}${p.trimMultiplier !== undefined && p.trimMultiplier < 1.0 ? (p.trimMultiplier === 0 ? ' <span style="color:#ef4444;font-weight:600">· Not expected on this trim</span>' : ' <span style="color:#f59e0b;font-weight:600">· ⚠️ Verify on vehicle</span>') : ''}</div>
        ${p.marketMedian > 0 ? `<div style="font-size:11px;margin-top:2px;display:flex;gap:8px;align-items:center">
          <span style="color:#9CA3AF">${hasOurSales ? 'Market ref' : 'Market'}</span>
          <span style="color:${hasOurSales ? '#6B7280' : (Math.abs(displayPrice - p.marketMedian) / p.marketMedian > 0.2 ? (displayPrice > p.marketMedian ? '#ef4444' : '#eab308') : '#10B981')};font-weight:600">$${p.marketMedian} med</span>
          <span style="color:#6B7280">${p.marketCount || 0} sold</span>
          ${p.marketVelocity ? `<span style="color:#6B7280">${p.marketVelocity.toFixed(1)}/wk</span>` : ''}
        </div>` : ''}
        ${p.deadWarning && p.deadWarning.failureReason && p.deadWarning.failureReason !== 'unknown' ? `<div style="margin-top:4px;padding:4px 8px;background:#fee2e2;border-radius:4px;font-size:10px;color:#dc2626;font-weight:600;">${p.deadWarning.failureReason === 'overpriced' ? 'Sat unsold — was overpriced vs market' : p.deadWarning.failureReason === 'low_demand' ? 'Sat unsold — low demand for this part' : p.deadWarning.failureReason}</div>` : ''}
        <div class="pd-actions">
          <button class="btn-pull" onclick="markPulled('${v.id}','${pid}',event)">Pull</button>
          <button class="btn-skip" onclick="toggleSkip('${v.id}','${pid}')">Skip</button>
          <button class="btn-note" onclick="toggleNote('${v.id}','${pid}')">Note</button>
        </div>
        <div class="skip-dropdown" id="skip-${v.id}-${pid}">
          <div style="padding:6px 10px;font-size:11px;cursor:pointer;border-bottom:1px solid var(--border)" onclick="logSkip('${v.id}','${pid}','already_have')">Already have</div>
          <div style="padding:6px 10px;font-size:11px;cursor:pointer;border-bottom:1px solid var(--border)" onclick="logSkip('${v.id}','${pid}','too_low_value')">Too low value</div>
          <div style="padding:6px 10px;font-size:11px;cursor:pointer;border-bottom:1px solid var(--border)" onclick="logSkip('${v.id}','${pid}','hard_to_pull')">Hard to pull</div>
          <div style="padding:6px 10px;font-size:11px;cursor:pointer" onclick="logSkip('${v.id}','${pid}','other')">Other</div>
        </div>
        <div class="note-input" id="note-${v.id}-${pid}">
          <input type="text" id="noteval-${v.id}-${pid}" placeholder="Add note..." style="flex:1;padding:6px 8px;border:1px solid var(--border);border-radius:6px;background:var(--surface2);color:var(--text);font-size:12px;font-family:var(--font);outline:none;">
          <button onclick="saveNote('${v.id}','${pid}')" style="padding:6px 10px;border-radius:6px;border:1px solid var(--border);background:var(--surface2);color:var(--text);font-size:11px;font-weight:700;cursor:pointer;font-family:var(--font)">Save</button>
        </div>
      </div>`;
    }

    // Rebuild reference — grouped by part type, one line each
    if (rebuildParts.length > 0) {
      html += `<div style="margin-top:10px;padding-top:8px;border-top:2px dashed var(--border);">
        <div style="font-size:10px;font-weight:700;color:#9ca3af;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:6px;">Rebuild Reference (not included in pull value)</div>`;
      for (const p of rebuildParts) {
        const priceDisplay = p.priceRange || ('$' + p.price);
        const countDisplay = p.count > 1 ? ` (${p.count} listings)` : '';
        html += `<div style="padding:4px 0;opacity:0.6;display:flex;justify-content:space-between;font-size:11px;color:#9ca3af;">
          <span>[REBUILD] ${p.seller || 'pro-rebuild'} — ${p.partType || 'Part'}</span>
          <span style="font-weight:600;">${priceDisplay}${countDisplay}</span>
        </div>`;
      }
      html += '</div>';
    }

    // Trim + Location sections — only for 2016+ vehicles (rolling 10-year window)
    const vYear = parseInt(v.year) || 0;
    if (vYear >= 2016) {
      if (v.trim) {
        html += `<div class="loc-section" id="trim-${v.id}" style="margin-top:10px;">
          <div class="loc-header">Trim Parts</div>
          <div style="font-size:11px;color:#9CA3AF;font-style:italic;">Loading...</div>
        </div>`;
      }
      html += `<div class="loc-section" id="loc-${v.id}">
        <div class="loc-header">Part Location</div>
        <div style="font-size:11px;color:#9CA3AF;font-style:italic;">Tap to load</div>
      </div>`;
    }

    return html;
  }

  function findVehicleById(id) {
    // Search yards data
    if (allData && allData.yards) {
      for (const yd of allData.yards) {
        const vList = yd.vehicles || yd.top_vehicles || [];
        const v = vList.find(v => v.id === id);
        if (v) return v;
      }
    }
    // Search manual results
    if (manualResults && manualResults.vehicles) {
      const v = manualResults.vehicles.find(v => v.id === id);
      if (v) return v;
    }
    return null;
  }

  async function toggleV(id) {
    const exp = document.getElementById('vexp-' + id);
    if (!exp) return;
    const wasOpen = exp.classList.contains('open');
    exp.classList.toggle('open');
    if (!wasOpen && !exp.dataset.loaded) {
      exp.dataset.loaded = '1';
      const vehicle = findVehicleById(id);

      // Load parts on-demand if not already present (slim mode)
      if (vehicle && !vehicle.parts) {
        exp.innerHTML = '<div style="padding:12px 0;color:#9CA3AF;font-size:12px;text-align:center;"><div class="spinner" style="display:inline-block;"></div> Loading parts...</div>';
        try {
          const res = await fetch('/attack-list/vehicle/' + id + '/parts');
          const data = await res.json();
          if (data.success) {
            vehicle.parts = data.parts || [];
            vehicle.rebuild_parts = data.rebuild_parts || null;
            vehicle.platform_siblings = data.platform_siblings || null;
          }
        } catch (e) { /* use empty parts */ }
        exp.innerHTML = renderExpandedParts(vehicle || { parts: [] });
      }

      loadLocation(id);
      if (vehicle && vehicle.trim) loadTrimIntel(vehicle);
    }
  }

  // === Part actions ===

  function markPulled(vid, itemId, evt) {
    evt.stopPropagation();
    const el = document.getElementById('pd-' + vid + '-' + itemId);
    if (el) {
      el.style.opacity = '0.4';
      el.querySelector('.btn-pull').textContent = '✓ Logged';
      el.querySelector('.btn-pull').disabled = true;
    }
    // Log to pull_session via API (best effort)
    fetch('/attack-list/log-pull', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vehicleId: vid, itemId }),
    }).catch(() => {});
  }

  function toggleSkip(vid, itemId) {
    const dd = document.getElementById('skip-' + vid + '-' + itemId);
    dd.classList.toggle('open');
  }

  function logSkip(vid, itemId, reason) {
    const dd = document.getElementById('skip-' + vid + '-' + itemId);
    dd.classList.remove('open');
    const el = document.getElementById('pd-' + vid + '-' + itemId);
    if (el) {
      el.style.opacity = '0.3';
      const btn = el.querySelector('.btn-skip');
      btn.textContent = '✗ ' + reason.replace('_', ' ');
    }
  }

  function toggleNote(vid, itemId) {
    const ni = document.getElementById('note-' + vid + '-' + itemId);
    ni.classList.toggle('open');
    if (ni.classList.contains('open')) {
      ni.querySelector('input').focus();
    }
  }

  function saveNote(vid, itemId) {
    const input = document.getElementById('noteval-' + vid + '-' + itemId);
    const note = input.value.trim();
    if (!note) return;
    input.value = '';
    document.getElementById('note-' + vid + '-' + itemId).classList.remove('open');
    // Show confirmation
    const el = document.getElementById('pd-' + vid + '-' + itemId);
    const noteEl = document.createElement('div');
    noteEl.style.cssText = 'font-size:11px;color:var(--yellow);margin-top:4px;';
    noteEl.textContent = '📝 ' + note;
    el.appendChild(noteEl);
  }

  // === Location loading ===

  const RESEARCH_PARTS = ['ECM','PCM','BCM','TIPM','FUSE BOX','TCM','ABS','AMPLIFIER','TRANSFER CASE MODULE','HVAC MODULE','AIRBAG MODULE','PARKING SENSOR MODULE','BLIND SPOT MODULE','CAMERA MODULE','LIFTGATE MODULE','STEERING MODULE'];

  async function loadLocation(vid) {
    const vehicle = findVehicleById(vid);
    if (!vehicle) return;

    const locDiv = document.getElementById('loc-' + vid);
    const year = parseInt(vehicle.year) || 0;
    const make = encodeURIComponent(vehicle.make || '');
    const model = encodeURIComponent(vehicle.model || '');
    const trim = vehicle.trim ? '&trim=' + encodeURIComponent(vehicle.trim) : '';

    // Detect part type from first matched part
    let partType = 'ECM';
    for (const p of (vehicle.parts || [])) {
      if (p.partType) { partType = p.partType; break; }
    }

    if (year < 2014) {
      locDiv.innerHTML = '<div class="loc-header">📍 Part Location</div><div style="font-size:11px;color:var(--text-faint);">Add location — no auto-research for pre-2014</div>';
      return;
    }

    locDiv.innerHTML = '<div class="loc-header">📍 Part Location — ' + partType + '</div><div style="font-size:11px;color:#9CA3AF;font-style:italic;">Researching...</div>';

    try {
      const res = await fetch('/part-location/' + encodeURIComponent(partType) + '/' + make + '/' + model + '/' + year + '?' + trim);
      const data = await res.json();
      if (!data.success) throw new Error(data.error);
      if (!data.found) {
        locDiv.innerHTML = '<div class="loc-header">📍 Part Location — ' + partType + '</div><div style="font-size:11px;color:var(--text-faint);">' + (data.eligible ? 'No data found' : 'Add location') + '</div>';
        return;
      }
      renderLoc(locDiv, data.location, partType);
    } catch (err) {
      locDiv.innerHTML = '<div class="loc-header">📍 Part Location</div><div style="font-size:11px;color:#9CA3AF;">Could not load</div>';
    }
  }

  function renderLoc(el, loc, pt) {
    const steps = Array.isArray(loc.removal_steps) ? loc.removal_steps : [];
    const stepsHtml = steps.length ? '<ol class="loc-steps">' + steps.map(s => '<li>' + s + '</li>').join('') + '</ol>' : '';
    const bc = loc.confidence === 'high_confidence' ? 'badge-high' : loc.confidence === 'field_confirmed' ? 'badge-field' : 'badge-res';
    const bl = loc.confidence === 'high_confidence' ? 'Confirmed' : loc.confidence === 'field_confirmed' ? 'Field' : 'Researched';

    el.innerHTML = `<div class="loc-header">📍 ${pt} <span class="loc-badge ${bc}">${bl}</span></div>
      ${loc.location_text ? '<div class="loc-text">' + loc.location_text + '</div>' : ''}
      ${stepsHtml}
      <div class="loc-meta">
        ${loc.tools ? '<span>🔧 ' + loc.tools + '</span>' : ''}
        ${loc.avg_pull_minutes ? '<span>⏱ ~' + loc.avg_pull_minutes + ' min</span>' : ''}
      </div>
      ${loc.hazards ? '<div class="loc-hazard">⚠️ ' + loc.hazards + '</div>' : ''}
      <div class="loc-actions">
        <button onclick="confirmLoc('${loc.id}')">✓ Confirm</button>
        <button onclick="flagLoc('${loc.id}')">✗ Wrong</button>
      </div>`;
  }

  async function confirmLoc(id) { fetch('/part-location/confirm', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({id}) }).catch(()=>{}); }
  async function flagLoc(id) { fetch('/part-location/flag-wrong', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({id}) }).catch(()=>{}); }

  // === Utility ===
  async function triggerScrape(btn) {
    btn.textContent = 'Scraping...'; btn.disabled = true;
    try {
      await fetch('/yards/scrape/lkq', { method: 'POST' });
      pollScrapeStatus(btn);
    } catch (e) { btn.textContent = 'Failed'; btn.disabled = false; }
  }

  async function triggerScrapeAll(btn) {
    btn.disabled = true; btn.title = 'Scraping all yards...';
    btn.innerHTML = '<div class="spinner" style="width:18px;height:18px;margin:0;border-width:2px;"></div>';
    document.getElementById('statusLeft').textContent = 'Scraping LKQ...';
    try {
      const res = await fetch('/yards/scrape/lkq', { method: 'POST' });
      const data = await res.json();
      if (data.already_running) {
        document.getElementById('statusLeft').textContent = 'Scrape already running...';
      }
      pollScrapeStatus(btn);
    } catch (e) {
      btn.textContent = '🔄'; btn.disabled = false; btn.title = 'Refresh inventory from LKQ';
      document.getElementById('statusLeft').textContent = 'Scrape failed to start';
    }
  }

  function pollScrapeStatus(btn) {
    const poll = setInterval(async () => {
      try {
        const res = await fetch('/yards/scrape/status');
        const status = await res.json();
        if (!status.running) {
          clearInterval(poll);
          btn.textContent = '🔄'; btn.disabled = false; btn.title = 'Refresh inventory from LKQ';
          if (status.error) {
            document.getElementById('statusLeft').textContent = 'Scrape error: ' + status.error;
          } else {
            document.getElementById('statusLeft').textContent = 'Scrape complete — reloading...';
            loadData();
          }
        }
      } catch (e) {
        clearInterval(poll);
        btn.textContent = '🔄'; btn.disabled = false;
      }
    }, 5000);
  }

  async function scrapeYard(yardId, btn) {
    const orig = btn.textContent;
    btn.textContent = '⏳'; btn.disabled = true;
    try {
      await fetch('/yards/scrape/' + yardId, { method: 'POST' });
      btn.textContent = '✓';
      setTimeout(() => { btn.textContent = orig; btn.disabled = false; loadData(); }, 60000);
    } catch (e) { btn.textContent = '✗'; btn.disabled = false; }
  }

  // Load trim intelligence for a vehicle (triggered on expand)
  async function loadTrimIntel(vehicle) {
    if (!vehicle.trim || !vehicle.make || !vehicle.model || !vehicle.year) return;
    try {
      const url = `/trim-intelligence/${vehicle.year}/${encodeURIComponent(vehicle.make)}/${encodeURIComponent(vehicle.model)}/${encodeURIComponent(vehicle.trim)}`;
      const res = await fetch(url);
      const data = await res.json();
      if (data.success && data.found && data.intelligence?.expected_parts?.length > 0) {
        const el = document.getElementById('trim-' + vehicle.id);
        if (el) {
          const parts = data.intelligence.expected_parts;
          let html = '<div class="loc-header">✨ Trim Parts (' + vehicle.trim + ')</div>';
          html += parts.map(p => `<div style="font-size:11px;color:var(--text-mid);padding:2px 0;">• ${p.part_type}: ${p.description} <span style="color:${p.value_premium === 'high' ? 'var(--green)' : 'var(--yellow)'}">(${p.value_premium})</span></div>`).join('');
          el.innerHTML = html;
        }
      }
    } catch (e) { /* ignore */ }
  }

  function timeAgo(ds) {
    const d = new Date(ds); const diff = Date.now() - d.getTime();
    const h = Math.floor(diff / 3600000); const dd = Math.floor(h / 24);
    if (dd > 0) return dd + 'd ago'; if (h > 0) return h + 'h ago'; return 'now';
  }

  function renderAlertBadges(v) {
    if (!v.alertBadges || v.alertBadges.length === 0) return '';
    let html = '<div style="display:flex;gap:4px;margin-top:3px;flex-wrap:wrap;align-items:center">';
    for (const ab of v.alertBadges) {
      if (ab.source === 'PERCH') {
        // Gold star badge — Mark signal (highest priority)
        const conf = ab.confidence === 'high' ? '★' : '☆';
        html += `<span class="alert-badge alert-badge-mark" onclick="event.stopPropagation();claimAlertFromFeed(${ab.id},this)" title="${ab.title || 'Marked part'}">${conf} MARKED</span>`;
      } else {
        // Blue badge — Scour Stream signal
        html += `<span class="alert-badge alert-badge-stream" onclick="event.stopPropagation();claimAlertFromFeed(${ab.id},this)" title="${ab.title || 'Restock'}">Restock</span>`;
      }
    }
    html += '</div>';
    return html;
  }

  function claimAlertFromFeed(alertId, el) {
    el.classList.add('claimed');
    el.innerHTML = '✓ Got it';
    fetch('/scout-alerts/claim', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: alertId, claimed: true }),
    }).catch(() => {});
  }

  // === Manual Set List ===
  let manualResults = null;
  let showingManual = false;

  function openManualModal() {
    document.getElementById('manualModal').classList.add('open');
    document.getElementById('manualText').value = '';
    document.getElementById('manualError').style.display = 'none';
    document.getElementById('manualRunBtn').disabled = false;
    document.getElementById('manualRunBtn').textContent = 'Run It';
    setTimeout(() => document.getElementById('manualText').focus(), 100);
  }

  function closeManualModal() {
    document.getElementById('manualModal').classList.remove('open');
  }

  async function runManualList() {
    const text = document.getElementById('manualText').value.trim();
    if (!text) return;

    const btn = document.getElementById('manualRunBtn');
    const errEl = document.getElementById('manualError');
    btn.disabled = true;
    btn.textContent = 'Scoring...';
    errEl.style.display = 'none';

    try {
      const res = await fetch('/attack-list/manual', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error);

      manualResults = data;
      showingManual = true;
      closeManualModal();
      renderManualResults();
    } catch (err) {
      errEl.textContent = err.message;
      errEl.style.display = 'block';
      btn.disabled = false;
      btn.textContent = 'Run It';
    }
  }

  function clearManualResults() {
    manualResults = null;
    showingManual = false;
    document.getElementById('tab-manual').style.display = 'none';
    currentTab = 'all';
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.getElementById('tab-all').classList.add('active');
    renderData();
    if (allData) {
      document.getElementById('headerSub').textContent = allData.yards.length + ' yards scored';
      const ts = new Date(allData.generated_at);
      document.getElementById('statusLeft').textContent = 'Updated ' + ts.toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'});
    }
  }

  function renderManualResults() {
    if (!manualResults) return;

    // Show and activate the MANUAL tab
    const manualTab = document.getElementById('tab-manual');
    manualTab.style.display = '';
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    manualTab.classList.add('active');
    currentTab = 'manual';

    const vehicles = manualResults.vehicles || [];
    document.getElementById('headerSub').textContent = 'MANUAL LIST — ' + vehicles.length + ' scored';
    document.getElementById('statusLeft').textContent = 'Manual list · ' + new Date().toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'});

    const hotV = vehicles.filter(v => v.color_code === 'green' || v.color_code === 'yellow').length;
    document.getElementById('statusRight').textContent = vehicles.length + ' vehicles · ' + hotV + ' flagged';

    let html = '';

    // Banner
    html += `<div class="manual-banner">
      <span>MANUAL SET LIST — ${manualResults.parsed_count} vehicles${manualResults.skipped_count > 0 ? ' (' + manualResults.skipped_count + ' skipped)' : ''}</span>
      <button onclick="clearManualResults()">Back to Yards</button>
    </div>`;

    if (vehicles.length === 0) {
      html += '<div class="empty-state"><h3>No scoreable vehicles</h3><p>None of the parsed vehicles matched parts in the database.</p></div>';
      document.getElementById('mainContent').innerHTML = html;
      return;
    }

    // Group by date section (all manual are "today" — group by score tier instead)
    const sections = [
      { label: 'PULL', vehicles: vehicles.filter(v => v.vehicle_verdict === 'PULL'), cls: 'chip-green' },
      { label: 'WATCH', vehicles: vehicles.filter(v => v.vehicle_verdict === 'WATCH'), cls: 'chip-yellow' },
      { label: 'CONSIDER', vehicles: vehicles.filter(v => v.vehicle_verdict === 'CONSIDER'), cls: 'chip-orange' },
      { label: 'SKIP', vehicles: vehicles.filter(v => v.vehicle_verdict === 'SKIP'), cls: 'chip-gray' },
    ];

    html += '<div class="vehicle-list">';
    for (const sec of sections) {
      if (sec.vehicles.length === 0) continue;
      html += `<div style="padding:6px 14px;background:#1a1a1a;border-bottom:1px solid var(--border);font-size:10px;font-weight:700;color:#9CA3AF;text-transform:uppercase;letter-spacing:0.05em;display:flex;justify-content:space-between;">
        <span>${sec.label}</span><span>${sec.vehicles.length}</span></div>`;
      for (const v of sec.vehicles) {
        html += renderVehicle(v);
      }
    }
    html += '</div>';

    document.getElementById('mainContent').innerHTML = html;
  }

  // === Inline VIN Scanner (no page navigation = no memory crash) ===
  function openVinModal() {
    document.getElementById('vinModal').classList.add('open');
    document.getElementById('vinResults').innerHTML = '';
    document.getElementById('vinStatus').textContent = '';
    var vi = document.getElementById('vinInput');
    vi.value = '';
    setTimeout(function(){ vi.focus(); }, 100);
  }
  function closeVinModal() {
    document.getElementById('vinModal').classList.remove('open');
  }

  // Camera photo processing — Image+canvas, resize aggressively for mobile memory
  async function processVinPhoto(file) {
    try {
      var url = URL.createObjectURL(file);
      var img = new Image();
      await new Promise(function(resolve, reject) { img.onload = resolve; img.onerror = function() { reject(new Error('Failed to load image')); }; img.src = url; });
      var MAX_DIM = 1280;
      var w = img.naturalWidth, h = img.naturalHeight;
      if (w > MAX_DIM || h > MAX_DIM) {
        if (w > h) { h = Math.round(h * (MAX_DIM / w)); w = MAX_DIM; }
        else { w = Math.round(w * (MAX_DIM / h)); h = MAX_DIM; }
      }
      var canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      var ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(url); img.src = '';
      var b64 = canvas.toDataURL('image/jpeg', 0.7).split(',')[1];
      if (b64.length > 1500000) {
        canvas.width = Math.round(w * 0.5); canvas.height = Math.round(h * 0.5);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        b64 = canvas.toDataURL('image/jpeg', 0.5).split(',')[1];
      }
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      canvas.width = 1; canvas.height = 1;
      return b64;
    } catch(err) {
      throw new Error('Could not process photo: ' + err.message);
    }
  }

  document.getElementById('vinCamBtn').onclick = function() {
    var inp = document.createElement('input');
    inp.type = 'file'; inp.accept = 'image/*'; inp.capture = 'environment';
    inp.onchange = async function(e) {
      var file = e.target.files[0]; if (!file) return;
      document.getElementById('vinStatus').textContent = 'Reading VIN from photo...';
      document.getElementById('vinResults').innerHTML = '<div class="vin-card" style="text-align:center"><div class="spinner"></div><div style="margin-top:6px;color:var(--text-muted);font-size:12px">Processing...</div></div>';
      try {
        var b64 = await processVinPhoto(file);
        var r = await fetch('/vin/decode-photo', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({image:b64})}).then(function(r){ return r.json(); });
        b64 = null;
        if (r.vin && r.vin !== 'UNREADABLE' && r.vin.length >= 11) {
          document.getElementById('vinInput').value = r.vin;
          document.getElementById('vinStatus').textContent = 'VIN read: ' + r.vin;
          vinDecode('camera');
        } else {
          document.getElementById('vinStatus').textContent = 'Could not read VIN. Try closer.';
          document.getElementById('vinResults').innerHTML = '<div class="vin-card" style="text-align:center;color:var(--red);font-weight:600">Could not read VIN<div style="color:var(--text-muted);font-size:12px;font-weight:400;margin-top:4px">Avoid glare, try door jamb sticker.</div></div>';
        }
      } catch(err) {
        document.getElementById('vinStatus').textContent = 'Error: ' + err.message;
        document.getElementById('vinResults').innerHTML = '<div class="vin-card" style="color:var(--red)">Error: ' + err.message + '</div>';
      }
    };
    inp.click();
  };

  function vinDecode(src) {
    var vin = document.getElementById('vinInput').value.trim().toUpperCase().replace(/[^A-HJ-NPR-Z0-9]/g, '');
    if (vin.length < 11) { document.getElementById('vinResults').innerHTML = '<div class="vin-card" style="color:var(--red);font-size:13px">Enter at least 11 characters</div>'; return; }
    var btn = document.getElementById('vinDecBtn');
    btn.disabled = true; btn.innerHTML = '<div class="spinner" style="margin:0 auto"></div>';
    document.getElementById('vinResults').innerHTML = '<div class="vin-card" style="text-align:center"><div class="spinner"></div><div style="margin-top:6px;color:var(--text-muted);font-size:12px">Decoding...</div></div>';
    fetch('/vin/scan', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({vin:vin, source:src||'manual'}) })
    .then(function(r){ return r.json(); })
    .then(function(data) {
      if (!data.success) throw new Error(data.error);
      vinRender(data);
    })
    .catch(function(err) {
      document.getElementById('vinResults').innerHTML = '<div class="vin-card" style="color:var(--red)">Error: ' + err.message + '</div>';
    })
    .finally(function() { btn.disabled = false; btn.textContent = 'Decode'; });
  }

  function vinRender(data) {
    var d = data.decoded || {}, sh = data.salesHistory || [], cs = data.currentStock || [], mr = data.marketRef || [];
    var h = '';
    // Vehicle header
    var hl = [d.year, d.make, data.baseModel || d.model].filter(Boolean).join(' ');
    var sp = [d.engine, d.engineType && d.engineType !== 'Gas' ? d.engineType : null, d.drivetrain, d.trim].filter(Boolean).join(' · ');
    h += '<div class="vin-card"><div style="font-size:20px;font-weight:900;letter-spacing:-0.03em">' + hl + '</div>';
    if (sp) h += '<div style="font-size:12px;font-weight:600;color:var(--text-mid);margin-top:2px">' + sp + '</div>';
    h += '<div style="font-family:monospace;font-size:13px;color:var(--green);font-weight:700;margin-top:4px">' + data.vin + '</div></div>';

    // Build unified parts
    var pm = {};
    sh.forEach(function(s) { if (s.partType) pm[s.partType] = { pt:s.partType, sold:s.sold, avg:s.avgPrice, last:s.lastSoldDate, title:s.sampleTitle, stk:0, mp:0 }; });
    cs.forEach(function(c) { if (!c.partType) return; if (pm[c.partType]) pm[c.partType].stk = c.inStock; else pm[c.partType] = { pt:c.partType, sold:0, avg:0, last:null, title:null, stk:c.inStock, mp:c.avgPrice }; });
    mr.filter(function(m) { return !m.isRebuild && m.partType; }).forEach(function(m) {
      if (pm[m.partType]) { pm[m.partType].mp = m.avgPrice; if (!pm[m.partType].stk) pm[m.partType].stk = m.inStock || 0; }
      else pm[m.partType] = { pt:m.partType, sold:m.yourSold||0, avg:m.yourAvg||m.avgPrice, last:null, title:null, stk:m.inStock||0, mp:m.avgPrice };
    });
    var parts = [];
    for (var k in pm) { var p = pm[k]; if (p.pt && p.pt !== 'OTHER' && p.pt !== 'null' && (p.avg > 0 || p.mp > 0 || p.sold > 0)) parts.push(p); }
    parts.sort(function(a, b) { return (b.avg || b.mp) - (a.avg || a.mp); });
    var tot = 0;

    h += '<div class="vin-card"><div style="font-size:10px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.06em;margin-bottom:8px">Parts Intelligence</div>';
    if (parts.length > 0) {
      parts.forEach(function(p) {
        var price = p.avg || p.mp || 0; tot += price;
        var vd = price >= 250 ? 'GREAT' : price >= 150 ? 'GOOD' : price >= 100 ? 'FAIR' : 'POOR';
        var cls = vd === 'GREAT' ? 'chip-green' : vd === 'GOOD' ? 'chip-yellow' : vd === 'FAIR' ? 'chip-orange' : 'chip-red';
        var badge = '';
        if (p.stk === 0 && p.sold >= 2) badge = '<span class="chip chip-green" style="font-size:9px">PULL THIS</span> ';
        else if (p.stk === 0 && p.sold >= 1) badge = '<span class="chip chip-yellow" style="font-size:9px">NEED</span> ';
        else if (p.stk > 0) badge = '<span class="chip chip-gray" style="font-size:9px">' + p.stk + ' stk</span> ';
        h += '<div style="padding:8px 0;border-bottom:1px solid var(--border)">';
        h += '<div style="display:flex;align-items:center;gap:5px;flex-wrap:wrap">' + badge + '<span class="chip ' + cls + '">' + vd + ' $' + price + '</span> <span style="font-size:13px;font-weight:700">[' + p.pt + ']</span></div>';
        if (p.title) h += '<div style="font-size:11px;color:var(--text-mid);margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + (p.title || '').substring(0, 60) + '</div>';
        h += '<div style="font-size:10px;color:var(--text-muted);margin-top:2px">' + p.stk + ' in stock · ' + p.sold + 'x sold</div>';
        h += '</div>';
      });
    } else {
      h += '<div style="color:var(--text-muted);font-size:12px;text-align:center;padding:8px 0">No parts data for this vehicle yet</div>';
    }
    h += '</div>';

    // Est. Haul Value
    if (tot > 0) {
      var vc = tot >= 800 ? 'var(--green)' : tot >= 500 ? '#eab308' : tot >= 250 ? '#f97316' : '#ef4444';
      h += '<div class="vin-card" style="text-align:center"><div style="font-size:11px;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.06em">Est. Haul Value</div>';
      h += '<div style="font-size:28px;font-weight:800;color:' + vc + ';margin-top:2px">$' + tot + '</div>';
      var pc = parts.filter(function(p) { return p.stk === 0 && p.sold >= 2; }).length;
      if (pc > 0) h += '<div style="font-size:11px;color:var(--green);margin-top:2px">' + pc + ' part' + (pc > 1 ? 's' : '') + ' we need</div>';
      h += '</div>';
    }

    // Scan Another
    h += '<div style="padding:4px 0"><button class="btn-primary" style="width:100%;padding:12px;font-size:14px;" onclick="document.getElementById(\'vinInput\').value=\'\';document.getElementById(\'vinInput\').focus();document.getElementById(\'vinResults\').innerHTML=\'\';">Scan Another</button></div>';
    document.getElementById('vinResults').innerHTML = h;
  }

  document.getElementById('vinInput').addEventListener('keydown', function(e) { if (e.key === 'Enter') vinDecode(); });

  // Boot
  loadData();

  // PWA service worker
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/admin/sw.js').catch(() => {});
  }
</script>
</body>
</html>
```
---
## FILE: service/public/hunters-perch.html
```javascript
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="theme-color" content="#0a0a0a">
<title>DarkHawk — HUNTERS PERCH</title>
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,sans-serif;background:#0a0a0a;color:#F0F0F0;min-height:100vh}
header{background:#141414;border-bottom:1px solid #2a2a2a;padding:14px 16px;display:flex;align-items:center;justify-content:space-between}
nav{display:flex;gap:6px;padding:6px 14px;background:#0a0a0a;border-bottom:1px solid #2a2a2a;overflow-x:auto;scrollbar-width:none;font-size:11px}
nav::-webkit-scrollbar{display:none}
nav a{color:#9CA3AF;text-decoration:none;padding:4px 8px;border-radius:4px;white-space:nowrap;background:#1a1a1a}
nav a.active{color:#DC2626;font-weight:700}
.container{padding:12px;max-width:800px;margin:0 auto}
.card{background:#141414;border:1px solid #2a2a2a;border-radius:10px;padding:14px;margin-bottom:10px}
.add-row{display:flex;gap:8px}
.add-input{flex:1;padding:10px;border:1px solid #333;border-radius:8px;font-size:13px;background:#141414;color:#F0F0F0;outline:none}
.add-input:focus{border-color:#dc2626}
.btn{padding:8px 14px;border-radius:6px;border:none;font-size:12px;font-weight:700;cursor:pointer}
.btn-red{background:#dc2626;color:#fff}
.btn-sm{padding:6px 10px;font-size:11px;border-radius:4px;border:1px solid #333;background:#1a1a1a;color:#d1d5db;cursor:pointer}
.btn-sm:disabled{opacity:.3}
.seller-card{background:#141414;border:1px solid #2a2a2a;border-radius:10px;margin-bottom:12px;overflow:hidden}
.seller-header{padding:12px 14px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid #2a2a2a;cursor:pointer}
.seller-name{font-size:14px;font-weight:700}
.seller-stats{font-size:10px;color:#6B7280}
.seller-body{padding:0}
.item-row{padding:8px 14px;border-bottom:1px solid #1f1f1f;display:flex;justify-content:space-between;align-items:flex-start;gap:10px}
.item-row:last-child{border-bottom:none}
.item-title{font-size:12px;font-weight:600;flex:1;line-height:1.3}
.item-price{font-size:13px;font-weight:700;color:#22c55e;white-space:nowrap}
.item-meta{font-size:10px;color:#6B7280;margin-top:2px}
.badge{font-size:9px;font-weight:700;padding:2px 6px;border-radius:3px;text-transform:uppercase}
.b-hot{background:#7f1d1d;color:#dc2626}
.b-good{background:#064e3b;color:#22c55e}
.spinner{width:16px;height:16px;border:2px solid #333;border-top-color:#dc2626;border-radius:50%;animation:spin .7s linear infinite;display:inline-block}
@keyframes spin{to{transform:rotate(360deg)}}
.empty{text-align:center;color:#6B7280;padding:30px;font-size:13px}
</style>
</head>
<body>
<div id="dh-nav"></div>
<script src="/admin/dh-nav.js?v=2"></script><script>dhNav('perch')</script>
<div class="container">
  <div id="scrapeAlerts" style="display:none"></div>
  <div class="card" id="gapCard" style="border-color:#dc2626;margin-bottom:16px">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
      <div>
        <div style="font-size:10px;font-weight:700;color:#dc2626;text-transform:uppercase;letter-spacing:0.06em">NEW INTEL - Parts We've Never Stocked</div>
        <div style="font-size:11px;color:#6B7280;margin-top:2px">Parts competitors sell that are not in our database</div>
      </div>
      <button class="btn-sm" onclick="loadGapIntel()" id="gapRefresh">Refresh</button>
    </div>
    <div id="sellerFilterRow" style="display:flex;gap:6px;margin-bottom:8px">
      <select id="sellerFilter" onchange="applySellerFilter()" style="flex:1;padding:6px 8px;border:1px solid #333;border-radius:6px;font-size:11px;background:#1a1a1a;color:#F0F0F0;outline:none">
        <option value="">All sellers</option>
      </select>
    </div>
    <div id="gapLoading" style="text-align:center;padding:16px"><div class="spinner"></div></div>
    <div id="gapResults" style="display:none"></div>
  </div>
  <div class="card" id="emergingCard" style="border-color:#f59e0b;margin-bottom:16px">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
      <div>
        <div style="font-size:10px;font-weight:700;color:#f59e0b;text-transform:uppercase;letter-spacing:0.06em">EMERGING - New & Accelerating Parts</div>
        <div style="font-size:11px;color:#6B7280;margin-top:2px">Parts appearing for the first time or gaining momentum</div>
      </div>
    </div>
    <div id="emergingLoading" style="text-align:center;padding:16px"><div class="spinner"></div></div>
    <div id="emergingResults" style="display:none"></div>
  </div>
  <div class="card">
    <div style="font-size:10px;font-weight:700;color:#6B7280;text-transform:uppercase;letter-spacing:0.06em;margin-bottom:8px">Track a Competitor</div>
    <div class="add-row">
      <input type="text" class="add-input" id="addInput" placeholder="eBay seller ID (e.g. instrumentclusterstore)" autocomplete="off">
      <button class="btn btn-red" id="addBtn" onclick="addSeller()">Track</button>
    </div>
    <div style="font-size:10px;color:#6B7280;margin-top:8px">Only items $100+ are stored. Data auto-purges after 90 days (importapart & pro-rebuild are permanent).</div>
    <div style="margin-top:8px"><button class="btn-sm" id="scrapeAllBtn" onclick="scrapeAll(this)">Scrape All Sellers</button></div>
  </div>
  <div id="loading" style="text-align:center;padding:30px"><div class="spinner"></div></div>
  <div id="sellers"></div>
</div>
<script>
var sellersData = [];
var currentSellerFilter = '';

function populateSellerFilter(sellers) {
  var sel = document.getElementById('sellerFilter');
  if (!sel) return;
  while (sel.options.length > 1) sel.remove(1);
  sellers.forEach(function(s) {
    if (s.soldItemCount > 0) {
      var opt = document.createElement('option');
      opt.value = s.name;
      opt.textContent = s.name + ' (' + s.soldItemCount + ')';
      sel.appendChild(opt);
    }
  });
}

function applySellerFilter() {
  currentSellerFilter = document.getElementById('sellerFilter').value;
  loadGapIntel();
  loadEmerging();
}

function showScrapeAlerts(alerts) {
  var el = document.getElementById('scrapeAlerts');
  if (!alerts || alerts.length === 0) { el.style.display = 'none'; return; }
  el.style.display = 'block';
  var h = '';
  alerts.forEach(function(a) {
    h += '<div class="card" style="border-color:#dc2626;padding:10px;margin-bottom:8px;display:flex;justify-content:space-between;align-items:center">';
    h += '<div style="font-size:12px;color:#dc2626"><strong>' + esc(a.seller) + '</strong>: ' + esc(a.message) + '</div>';
    h += '<button class="btn-sm" style="font-size:9px;color:#6B7280" onclick="this.closest(\'.card\').remove()">✕</button>';
    h += '</div>';
  });
  el.innerHTML = h;
}

function loadEmerging() {
  var results = document.getElementById('emergingResults');
  var loading = document.getElementById('emergingLoading');
  loading.style.display = 'block';
  results.style.display = 'none';
  fetch('/competitors/emerging?days=90&limit=30' + (currentSellerFilter ? '&seller=' + encodeURIComponent(currentSellerFilter) : ''))
    .then(function(r) { return r.json(); })
    .then(function(d) {
      loading.style.display = 'none';
      results.style.display = 'block';
      if (!d.success || !d.emerging || d.emerging.length === 0) {
        results.innerHTML = '<div class="empty">No emerging parts detected yet. Run a scrape to populate competitor data.</div>';
        return;
      }
      var h = '<div style="padding:6px 0;font-size:10px;color:#6B7280;border-bottom:1px solid #2a2a2a;margin-bottom:6px">' + d.newCount + ' new on scene · ' + d.accelCount + ' accelerating</div>';
      d.emerging.forEach(function(item) {
        var signalBadge = item.signal === 'NEW' ? '<span class="badge" style="background:#1e3a5f;color:#3b82f6">NEW</span> ' : '<span class="badge" style="background:#422006;color:#f59e0b">ACCEL ' + item.recentCount + 'x</span> ';
        var pn = item.partNumber ? '<span style="font-family:monospace;font-size:11px;color:#f59e0b;background:#422006;padding:1px 5px;border-radius:3px;margin-right:4px">' + esc(item.partNumber) + '</span>' : '';
        var ptBadge = item.partType ? '<span style="font-size:9px;font-weight:700;color:#a78bfa;background:#2e1065;padding:1px 5px;border-radius:3px;margin-right:4px">' + esc(item.partType) + '</span>' : '';
        var sellerList = item.sellers.slice(0, 3).join(', ');
        var searchUrl = 'https://www.ebay.com/sch/i.html?_nkw=' + encodeURIComponent((item.title || '').substring(0, 60)) + '&_sacat=6030&LH_Sold=1&LH_Complete=1';
        h += '<div class="item-row" style="align-items:center">';
        h += '<div style="min-width:36px;text-align:center"><div style="font-size:16px;font-weight:800;color:#f59e0b;background:#422006;border-radius:6px;padding:4px 6px">' + item.signalStrength + '</div></div>';
        h += '<div style="flex:1;min-width:0;padding-left:8px"><div class="item-title">' + signalBadge + '<a href="' + searchUrl + '" target="_blank" rel="noopener" style="color:#F0F0F0;text-decoration:none">' + esc(item.title || '') + '</a></div>';
        h += '<div class="item-meta">' + ptBadge + pn + item.totalCount + 'x sold by ' + esc(sellerList) + ' · $' + item.medianPrice + ' median · $' + item.totalRevenue.toLocaleString() + ' rev</div></div>';
        h += '<div style="text-align:right"><div class="item-price">$' + item.medianPrice + '<div style="font-size:9px;color:#6B7280;font-weight:400">median</div></div>';
        h += '<button class="btn-sm" style="font-size:9px;padding:2px 6px;margin-top:3px;color:#22c55e;border-color:#22c55e" onclick="markItem(\'' + esc(item.title).replace(/\'/g, "\\'") + '\',\'' + esc(item.partNumber || '').replace(/\'/g, "\\'") + '\',\'' + esc(item.partType || '').replace(/\'/g, "\\'") + '\',' + (item.medianPrice || 0) + ',\'emerging\',' + JSON.stringify(item.sellers) + ',' + item.signalStrength + ',this)">+ Mark</button>';
        h += '<button class="btn-sm" style="font-size:9px;padding:2px 6px;margin-top:3px;color:#6B7280" onclick="dismissIntel(\'' + esc(item.title).replace(/\'/g, "\\'") + '\',this)">✕</button></div>';
        h += '</div>';
      });
      results.innerHTML = h;
    })
    .catch(function(err) {
      loading.style.display = 'none';
      results.style.display = 'block';
      results.innerHTML = '<div class="empty" style="color:#dc2626">Error: ' + err.message + '</div>';
    });
}

function loadGapIntel() {
  var gapResults = document.getElementById('gapResults');
  var gapLoading = document.getElementById('gapLoading');
  gapLoading.style.display = 'block';
  gapResults.style.display = 'none';

  fetch('/competitors/gap-intel?days=90&limit=30' + (currentSellerFilter ? '&seller=' + encodeURIComponent(currentSellerFilter) : ''))
    .then(function(r) { return r.json(); })
    .then(function(d) {
      gapLoading.style.display = 'none';
      gapResults.style.display = 'block';

      if (!d.success || !d.gaps || d.gaps.length === 0) {
        gapResults.innerHTML = '<div class="empty">No competitor data yet — run a scrape to populate.</div>';
        return;
      }

      var h = '<div style="padding:6px 0;font-size:10px;color:#6B7280;border-bottom:1px solid #2a2a2a;margin-bottom:6px">' + d.totalGaps + ' parts found that we have never stocked or sold</div>';

      d.gaps.forEach(function(gap) {
        var scoreColor = gap.score >= 70 ? '#22c55e' : gap.score >= 40 ? '#eab308' : '#6B7280';
        var scoreBg = gap.score >= 70 ? '#064e3b' : gap.score >= 40 ? '#422006' : '#1a1a1a';
        var badge = gap.soldCount >= 3 ? '<span class="badge b-hot">HOT ' + gap.soldCount + 'x</span> ' : '';
        var confluenceBadge = gap.confluence ? '<span class="badge" style="background:#1e3a5f;color:#60a5fa">' + gap.sellerCount + ' SELLERS</span> ' : '';
        var sellerList = gap.sellers.slice(0, 4).join(', ');
        var searchUrl = 'https://www.ebay.com/sch/i.html?_nkw=' + encodeURIComponent((gap.title || '').substring(0, 60)) + '&_sacat=6030&LH_Sold=1&LH_Complete=1';
        var pn = gap.partNumber ? '<span style="font-family:monospace;font-size:11px;color:#f59e0b;background:#422006;padding:1px 5px;border-radius:3px;margin-right:4px">' + esc(gap.partNumber) + '</span>' : '';
        var ptBadge = gap.partType ? '<span style="font-size:9px;font-weight:700;color:#a78bfa;background:#2e1065;padding:1px 5px;border-radius:3px;margin-right:4px">' + esc(gap.partType) + '</span>' : '';

        h += '<div class="item-row" style="align-items:center' + (gap.confluence ? ';border-left:3px solid #3b82f6' : '') + '">';
        h += '<div style="min-width:36px;text-align:center"><div style="font-size:16px;font-weight:800;color:' + scoreColor + ';background:' + scoreBg + ';border-radius:6px;padding:4px 6px;font-variant-numeric:tabular-nums">' + gap.score + '</div></div>';
        h += '<div style="flex:1;min-width:0;padding-left:8px"><div class="item-title">' + confluenceBadge + badge + '<a href="' + searchUrl + '" target="_blank" rel="noopener" style="color:#F0F0F0;text-decoration:none">' + esc(gap.title || '') + '</a></div>';
        var yardIcon = gap.yardMatch ? '<span title="Vehicle make in local yard" style="margin-right:4px">📍</span>' : '';
        h += '<div class="item-meta">' + yardIcon + ptBadge + pn + gap.soldCount + 'x sold by ' + esc(sellerList) + ' · $' + gap.medianPrice + ' median · $' + gap.totalRevenue.toLocaleString() + ' rev</div></div>';
        h += '<div style="text-align:right"><div class="item-price">$' + gap.medianPrice + '<div style="font-size:9px;color:#6B7280;font-weight:400">median</div></div>';
        h += '<button class="btn-sm" style="font-size:9px;padding:2px 6px;margin-top:3px;color:#22c55e;border-color:#22c55e" onclick="markItem(\'' + esc(gap.title).replace(/\'/g, "\\'") + '\',\'' + esc(gap.partNumber || '').replace(/\'/g, "\\'") + '\',\'' + esc(gap.partType || '').replace(/\'/g, "\\'") + '\',' + (gap.medianPrice || 0) + ',\'gap-intel\',' + JSON.stringify(gap.sellers) + ',' + gap.score + ',this)">+ Mark</button>';
        h += '<button class="btn-sm" style="font-size:9px;padding:2px 6px;margin-top:3px;color:#6B7280" onclick="dismissIntel(\'' + esc(gap.title).replace(/\'/g, "\\'") + '\',this)">✕</button></div>';
        h += '</div>';
      });

      gapResults.innerHTML = h;
    })
    .catch(function(err) {
      gapLoading.style.display = 'none';
      gapResults.style.display = 'block';
      gapResults.innerHTML = '<div class="empty" style="color:#dc2626">Error: ' + err.message + '</div>';
    });
}

function load() {
  fetch('/competitors/sellers')
    .then(function(r) { return r.json(); })
    .then(function(d) {
      document.getElementById('loading').style.display = 'none';
      if (!d.success || !d.sellers) { document.getElementById('sellers').innerHTML = '<div class="empty">Could not load sellers</div>'; return; }
      sellersData = d.sellers;
      populateSellerFilter(d.sellers);
      if (d.scrapeAlerts) showScrapeAlerts(d.scrapeAlerts);
      renderSellers();
    })
    .catch(function(err) {
      document.getElementById('loading').style.display = 'none';
      document.getElementById('sellers').innerHTML = '<div class="empty">Error: ' + err.message + '</div>';
    });
}

function renderSellers() {
  if (sellersData.length === 0) {
    document.getElementById('sellers').innerHTML = '<div class="empty">No competitors tracked yet. Add one above.</div>';
    return;
  }
  var h = '';
  sellersData.forEach(function(s) {
    h += '<div class="seller-card" id="seller-' + esc(s.name) + '">';
    h += '<div class="seller-header" onclick="toggleSeller(\'' + esc(s.name) + '\')">';
    h += '<div><div class="seller-name">' + esc(s.name) + '</div>';
    var healthColor = '#6B7280';
    if (s.lastScrapedAt) {
      var hoursAgo = Math.floor((Date.now() - new Date(s.lastScrapedAt).getTime()) / 3600000);
      if (hoursAgo > 48) healthColor = '#dc2626';
      else if (hoursAgo > 24) healthColor = '#eab308';
      else healthColor = '#22c55e';
    }
    h += '<div class="seller-stats"><span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:' + healthColor + ';margin-right:4px"></span>' + (s.soldItemCount || 0) + ' items tracked';
    if (s.lastScrapedAt) {
      var d = Math.floor((Date.now() - new Date(s.lastScrapedAt).getTime()) / 3600000);
      h += ' · scraped ' + (d < 1 ? 'just now' : d < 24 ? d + 'h ago' : Math.floor(d/24) + 'd ago');
    }
    h += '</div></div>';
    h += '<div style="display:flex;gap:6px">';
    h += '<a href="https://www.ebay.com/sch/i.html?_ssn=' + encodeURIComponent(s.name) + '&LH_Sold=1&LH_Complete=1&_ipg=240" target="_blank" rel="noopener" class="btn-sm" style="text-decoration:none;display:flex;align-items:center" onclick="event.stopPropagation()">Store ↗</a>';
    h += '<button class="btn-sm" onclick="event.stopPropagation();scrapeSeller(\'' + esc(s.name) + '\',this)">Scrape</button>';
    h += '<button class="btn-sm" style="color:#dc2626;border-color:#dc2626" onclick="event.stopPropagation();removeSeller(\'' + esc(s.name) + '\',this)">✕</button>';
    h += '</div></div>';
    h += '<div class="seller-body" id="body-' + esc(s.name) + '" style="display:none"></div>';
    h += '</div>';
  });
  document.getElementById('sellers').innerHTML = h;
}

function toggleSeller(name) {
  var body = document.getElementById('body-' + name);
  if (body.style.display === 'none') {
    body.style.display = 'block';
    if (!body.dataset.loaded) {
      body.innerHTML = '<div style="padding:12px;text-align:center"><div class="spinner"></div></div>';
      loadBestSellers(name);
    }
  } else {
    body.style.display = 'none';
  }
}

function loadBestSellers(name) {
  fetch('/competitors/' + encodeURIComponent(name) + '/best-sellers?days=90')
    .then(function(r) { return r.json(); })
    .then(function(d) {
      var body = document.getElementById('body-' + name);
      body.dataset.loaded = '1';
      if (!d.success || !d.bestSellers || d.bestSellers.length === 0) {
        body.innerHTML = '<div style="padding:12px;color:#6B7280;font-size:12px;text-align:center">No sold items. Scrape this seller first.</div>';
        return;
      }
      var h = '<div style="padding:8px 14px;font-size:10px;color:#6B7280;border-bottom:1px solid #2a2a2a">' + d.totalSold + ' sold · $' + d.totalRevenue.toLocaleString() + ' revenue · ' + d.uniqueProducts + ' products (90d)</div>';
      d.bestSellers.slice(0, 30).forEach(function(item) {
        var hot = item.soldCount >= 3 ? '<span class="badge b-hot">HOT ' + item.soldCount + 'x</span> ' : '';
        // Clean title for search — remove mileage specifics
        var searchTitle = (item.title || '').replace(/\d{1,3},?\d{3}\s*miles?/gi, '').replace(/\s+/g, ' ').trim();
        // Build eBay URL with seller filter (_ssn) + full title
        var searchUrl = 'https://www.ebay.com/sch/i.html?_ssn=' + encodeURIComponent(name) + '&_nkw=' + encodeURIComponent(searchTitle) + '&LH_Sold=1&LH_Complete=1&_ipg=240';
        // Direct item link if we have eBay item ID
        var itemUrl = item.ebayItemId ? 'https://www.ebay.com/itm/' + item.ebayItemId : searchUrl;
        h += '<div class="item-row">';
        h += '<div style="flex:1;min-width:0"><div class="item-title"><a href="' + itemUrl + '" target="_blank" rel="noopener" style="color:#F0F0F0;text-decoration:none">' + hot + esc(item.title || '') + '</a></div>';
        h += '<div class="item-meta">$' + item.avgPrice + ' avg · ' + item.soldCount + 'x sold · $' + item.totalRevenue.toLocaleString() + ' rev · ' + item.velocity + '/wk · <a href="' + searchUrl + '" target="_blank" rel="noopener" style="color:#3b82f6;font-size:9px">eBay ↗</a></div></div>';
        h += '<div class="item-price">$' + item.avgPrice + '<div style="font-size:9px;color:#6B7280;font-weight:400">avg</div></div>';
        h += '</div>';
      });
      body.innerHTML = h;
    })
    .catch(function() {
      document.getElementById('body-' + name).innerHTML = '<div style="padding:12px;color:#dc2626;font-size:12px">Failed to load</div>';
    });
}

function scrapeSeller(name, btn) {
  btn.disabled = true; btn.textContent = 'Scraping...';
  fetch('/competitors/' + encodeURIComponent(name) + '/scrape', { method: 'POST' })
    .then(function(r) { return r.json(); })
    .then(function() {
      btn.textContent = 'Scraping eBay...';
      // Poll every 10s for up to 2 minutes until new data appears
      var attempts = 0;
      var poll = setInterval(function() {
        attempts++;
        fetch('/competitors/' + encodeURIComponent(name) + '/best-sellers?days=90')
          .then(function(r) { return r.json(); })
          .then(function(d) {
            if (d.totalSold > 0 || attempts >= 12) {
              clearInterval(poll);
              btn.disabled = false; btn.textContent = 'Scrape';
              // Refresh seller data and auto-expand
              var body = document.getElementById('body-' + name);
              if (body) { body.dataset.loaded = ''; body.style.display = 'block'; loadBestSellers(name); }
              load(); // refresh seller list for updated counts
            }
          }).catch(function() {});
      }, 10000);
    })
    .catch(function() { btn.disabled = false; btn.textContent = 'Scrape'; });
}

function removeSeller(name, btn) {
  if (!confirm('Remove ' + name + ' from tracking?\n\nClick OK to keep their data for gap intel.\nTheir sold history will remain in the database.')) return;
  btn.disabled = true; btn.textContent = '...';
  fetch('/competitors/' + encodeURIComponent(name), { method: 'DELETE' })
    .then(function(r) { return r.json(); })
    .then(function(d) {
      if (d.success) {
        sellersData = sellersData.filter(function(s) { return s.name !== name; });
        renderSellers();
      } else {
        btn.disabled = false; btn.textContent = '✕';
      }
    })
    .catch(function() { btn.disabled = false; btn.textContent = '✕'; });
}

function addSeller() {
  var inp = document.getElementById('addInput');
  var name = inp.value.trim().toLowerCase();
  if (!name) return;
  var btn = document.getElementById('addBtn');
  btn.disabled = true; btn.textContent = '...';
  fetch('/competitors/' + encodeURIComponent(name) + '/scrape', { method: 'POST' })
    .then(function() {
      inp.value = '';
      btn.disabled = false; btn.textContent = 'Track';
      // Add to SoldItemSeller table
      return fetch('/competitors/sellers');
    })
    .then(function(r) { return r.json(); })
    .then(function(d) {
      if (d.success) { sellersData = d.sellers; renderSellers(); }
    })
    .catch(function() { btn.disabled = false; btn.textContent = 'Track'; });
}

function scrapeAll(btn) {
  btn.disabled = true;
  btn.textContent = 'Scraping all...';
  fetch('/competitors/auto-scrape', { method: 'POST' })
    .then(function(r) { return r.json(); })
    .then(function(d) {
      btn.disabled = false;
      btn.textContent = 'Scrape All Sellers';
      if (d.success) {
        var summary = (d.results || []).map(function(r) { return r.seller + ': ' + (r.scraped || 0) + ' scraped'; }).join(', ');
        alert('Scrape complete! ' + summary);
        load();
        loadGapIntel();
        loadEmerging();
      }
    })
    .catch(function() { btn.disabled = false; btn.textContent = 'Scrape All Sellers'; });
}

function esc(s) { if (!s) return ''; var d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

function markItem(title, partNumber, partType, medianPrice, sourceSignal, sellers, score, btn) {
  btn.disabled = true;
  btn.textContent = '...';
  fetch('/competitors/mark', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title: title,
      partNumber: partNumber || null,
      partType: partType || null,
      medianPrice: medianPrice || null,
      sourceSignal: sourceSignal || 'gap-intel',
      sourceSellers: sellers || null,
      score: score || null,
    }),
  })
    .then(function(r) { return r.json(); })
    .then(function(d) {
      if (d.success) {
        // Remove the card from DOM — marked items are filtered from gap-intel
        var row = btn.closest('.item-row');
        if (row) {
          row.style.transition = 'opacity 0.3s';
          row.style.opacity = '0';
          setTimeout(function() { row.remove(); }, 300);
        } else {
          btn.textContent = '✓';
          btn.style.color = '#22c55e';
          btn.style.borderColor = '#22c55e';
          btn.disabled = true;
        }
      } else { btn.disabled = false; btn.textContent = '+ Mark'; }
    })
    .catch(function() { btn.disabled = false; btn.textContent = '+ Mark'; });
}

function dismissIntel(title, btn) {
  btn.disabled = true;
  btn.textContent = '...';
  fetch('/competitors/dismiss', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: title }),
  })
    .then(function(r) { return r.json(); })
    .then(function(d) {
      if (d.success) {
        var row = btn.closest('.item-row');
        if (row) { row.style.transition = 'opacity 0.3s'; row.style.opacity = '0'; setTimeout(function() { row.remove(); }, 300); }
      } else { btn.disabled = false; btn.textContent = '✕'; }
    })
    .catch(function() { btn.disabled = false; btn.textContent = '✕'; });
}

load();
loadGapIntel();
loadEmerging();
</script>
</body>
</html>
```
---
## FILE: service/public/scout-alerts.html
```javascript
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="theme-color" content="#0a0a0a">
<title>DarkHawk — SCOUT ALERTS</title>
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,sans-serif;background:#0a0a0a;color:#F0F0F0;min-height:100vh}
header{background:#141414;border-bottom:1px solid #2a2a2a;padding:14px 16px;display:flex;align-items:center;justify-content:space-between}
nav{display:flex;gap:6px;padding:6px 14px;background:#0a0a0a;border-bottom:1px solid #2a2a2a;overflow-x:auto;scrollbar-width:none;font-size:11px}
nav::-webkit-scrollbar{display:none}
nav a{color:#9CA3AF;text-decoration:none;padding:4px 8px;border-radius:4px;white-space:nowrap;background:#1a1a1a}
nav a.active{color:#DC2626;font-weight:700}
.tabs{display:flex;background:#141414;border-bottom:1px solid #2a2a2a;overflow-x:auto;scrollbar-width:none;-webkit-overflow-scrolling:touch}
.tabs::-webkit-scrollbar{display:none}
.tab{padding:11px 16px;font-size:12px;font-weight:600;color:#9CA3AF;cursor:pointer;white-space:nowrap;border-bottom:2px solid transparent;flex-shrink:0}
.tab.active{color:#F0F0F0;border-bottom-color:#DC2626}
.pill-bar{display:flex;align-items:center;justify-content:center;gap:6px;padding:8px 16px;background:#0a0a0a;border-bottom:1px solid #2a2a2a;font-size:11px;overflow-x:auto;scrollbar-width:none}
.pill-bar::-webkit-scrollbar{display:none}
.pill{padding:4px 10px;border-radius:4px;border:1px solid #333;background:#1a1a1a;color:#9CA3AF;font-size:11px;font-weight:600;cursor:pointer;white-space:nowrap}
.pill.active{background:#dc2626;color:#fff;border-color:#dc2626}
.container{padding:12px;max-width:700px;margin:0 auto}
.card{background:#141414;border:1px solid #2a2a2a;border-radius:10px;padding:14px;margin-bottom:10px}
.badge{font-size:9px;font-weight:700;padding:2px 7px;border-radius:4px;text-transform:uppercase;white-space:nowrap}
.b-high{background:#064e3b;color:#22c55e}
.b-med{background:#713f12;color:#eab308}
.b-low{background:#7c2d12;color:#ea580c}
.b-bone{background:#dc2626;color:#fff;font-size:8px;letter-spacing:0.05em}
.b-perch{background:#ea580c;color:#fff;font-size:8px;letter-spacing:0.05em}
.b-mark{background:#eab308;color:#78350f;font-size:8px;letter-spacing:0.05em;font-weight:800}
.b-sold{background:#16a34a;color:#fff;font-size:8px;letter-spacing:0.05em}
.b-overstock{background:#F59E0B;color:#78350F;font-size:8px;letter-spacing:0.05em;font-weight:800}
.yard-header{padding:10px 0;display:flex;align-items:center;justify-content:space-between;border-bottom:2px solid #dc2626;margin-bottom:8px}
.yard-name{font-size:15px;font-weight:800;color:#F0F0F0}
.yard-count{font-size:11px;color:#9CA3AF}
.alert-row{padding:10px 0;border-bottom:1px solid #1f1f1f;display:flex;align-items:flex-start;gap:8px}
.alert-row:last-child{border-bottom:none}
.alert-row.claimed{opacity:0.45}
.alert-info{flex:1;min-width:0}
.claim-check{width:32px;height:32px;border-radius:6px;border:2px solid #333;background:#1a1a1a;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;-webkit-tap-highlight-color:transparent;transition:all 0.15s}
.claim-check:active{transform:scale(0.9)}
.claim-check.checked{background:#064e3b;border-color:#22c55e}
.claim-check svg{width:18px;height:18px}
.alert-part{font-size:13px;font-weight:600;line-height:1.3}
.alert-vehicle{font-size:12px;color:#22c55e;font-weight:600;margin-top:3px}
.alert-meta{font-size:10px;color:#9CA3AF;margin-top:3px;display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.alert-notes{font-size:10px;color:#eab308;margin-top:2px;font-style:italic}
.btn-refresh{padding:8px 14px;border-radius:6px;border:1px solid #333;background:#1a1a1a;color:#d1d5db;font-size:11px;font-weight:600;cursor:pointer}
.btn-refresh:active{opacity:.5}
.btn-refresh:disabled{opacity:.3}
.spinner{width:18px;height:18px;border:2px solid #333;border-top-color:#dc2626;border-radius:50%;animation:spin .7s linear infinite;display:inline-block}
@keyframes spin{to{transform:rotate(360deg)}}
.empty{text-align:center;color:#6B7280;padding:30px 10px;font-size:13px}
.pg-row{display:flex;justify-content:center;gap:8px;padding:12px 0}
.pg-btn{padding:8px 16px;border-radius:6px;border:1px solid #333;background:#1a1a1a;color:#d1d5db;font-size:12px;font-weight:600;cursor:pointer}
.pg-btn.active{background:#dc2626;color:#fff;border-color:#dc2626}
.summary-bar{display:flex;gap:10px;flex-wrap:wrap;margin-bottom:10px}
.summary-card{flex:1;min-width:70px;background:#141414;border:1px solid #2a2a2a;border-radius:8px;padding:8px 10px;text-align:center}
.summary-num{font-size:20px;font-weight:800;color:#F0F0F0}
.summary-label{font-size:9px;color:#6B7280;text-transform:uppercase;letter-spacing:0.05em;margin-top:1px}
</style>
</head>
<body>
<div id="dh-nav"></div>
<script src="/admin/dh-nav.js?v=2"></script><script>dhNav('alerts')</script>
<div style="display:flex;justify-content:space-between;align-items:center;padding:6px 14px;background:#0a0a0a;border-bottom:1px solid #2a2a2a;">
  <div style="font-size:10px;color:#6B7280">SCOUT ALERTS <span id="alertCount" style="color:#dc2626;font-weight:700"></span></div>
  <div style="display:flex;align-items:center;gap:8px">
    <div id="lastUpdated" style="font-size:9px;color:#6B7280;text-align:right"></div>
    <button class="btn-refresh" id="refreshBtn" onclick="refreshAlerts()">Refresh</button>
  </div>
</div>
</nav>
<!-- Yard Tabs -->
<div class="tabs" id="yardTabs">
  <div class="tab active" onclick="setYard('all',this)">All</div>
  <div class="tab" onclick="setYard('Raleigh',this)">Raleigh</div>
  <div class="tab" onclick="setYard('Durham',this)">Durham</div>
  <div class="tab" onclick="setYard('Greensboro',this)">Greensboro</div>
  <div class="tab" onclick="setYard('East NC',this)">East NC</div>
  <div class="tab" onclick="setYard('Tampa',this)">Tampa</div>
  <div class="tab" onclick="setYard('Largo',this)">Largo</div>
  <div class="tab" onclick="setYard('Clearwater',this)">Clearwater</div>
</div>
<!-- Time Filter Pills -->
<div class="pill-bar">
  <span style="font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;color:#6B7280">Set:</span>
  <button class="pill" onclick="setDays(0,this)">Today</button>
  <button class="pill" onclick="setDays(3,this)">3d</button>
  <button class="pill active" onclick="setDays(7,this)">7d</button>
  <button class="pill" onclick="setDays(30,this)">30d</button>
  <button class="pill" onclick="setDays(60,this)">60d</button>
  <button class="pill" onclick="setDays(90,this)">90d</button>
  <button class="pill" onclick="setDays(-1,this)">All</button>
</div>
<div style="display:flex;align-items:center;justify-content:flex-end;padding:6px 14px;background:#0a0a0a;font-size:11px">
  <label style="display:flex;align-items:center;gap:6px;color:#6B7280;cursor:pointer;user-select:none">
    <input type="checkbox" id="hidePulled" onchange="toggleHidePulled()" style="accent-color:#dc2626"> Hide pulled
  </label>
</div>
<div class="container">
  <div id="loading" style="text-align:center;padding:40px"><div class="spinner"></div><div style="margin-top:8px;color:#6B7280;font-size:12px">Loading alerts...</div></div>
  <div id="summary"></div>
  <div id="list"></div>
  <div id="pagination" class="pg-row"></div>
</div>
<script>
var currentPage = 1;
var currentYard = 'all';
var currentDays = 7;
var hidePulled = false;

function setYard(yard, el) {
  currentYard = yard;
  document.querySelectorAll('.tabs .tab').forEach(function(t) { t.classList.remove('active'); });
  el.classList.add('active');
  load(1);
}

function setDays(days, el) {
  currentDays = days === -1 ? 0 : (days === 0 ? 1 : days); // 0=today(1d), -1=all(0)
  if (days === -1) currentDays = 0;
  else if (days === 0) currentDays = 1;
  else currentDays = days;
  document.querySelectorAll('.pill-bar .pill').forEach(function(p) { p.classList.remove('active'); });
  el.classList.add('active');
  load(1);
}

function toggleHidePulled() {
  hidePulled = document.getElementById('hidePulled').checked;
  load(1);
}

function claimAlert(id, claimed) {
  if (!claimed && !confirm('Unmark this as pulled?')) return;
  fetch('/scout-alerts/claim', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: id, claimed: claimed }) })
    .then(function(r) { return r.json(); })
    .then(function(d) { if (d.success) load(currentPage); })
    .catch(function(err) { alert('Error: ' + err.message); });
}

function load(page) {
  currentPage = page || 1;
  var url = '/scout-alerts/list?page=' + currentPage;
  if (currentYard !== 'all') url += '&yard=' + encodeURIComponent(currentYard);
  if (currentDays > 0) url += '&days=' + currentDays;
  if (hidePulled) url += '&hideClaimed=1';

  fetch(url)
    .then(function(r) { return r.json(); })
    .then(function(d) {
      document.getElementById('loading').style.display = 'none';
      if (!d.success) { document.getElementById('list').innerHTML = '<div class="empty">Error loading alerts</div>'; return; }

      document.getElementById('alertCount').textContent = d.total > 0 ? '(' + d.total + ')' : '';
      if (d.lastGenerated) {
        var mins = Math.floor((Date.now() - new Date(d.lastGenerated).getTime()) / 60000);
        var ts = mins < 1 ? 'just now' : mins < 60 ? mins + 'm ago' : Math.floor(mins / 60) + 'h ago';
        document.getElementById('lastUpdated').textContent = 'Updated ' + ts;
      }

      // Summary cards — filtered counts
      var sh = '<div class="summary-bar">';
      sh += '<div class="summary-card"><div class="summary-num" style="color:#eab308">' + (d.markCount || 0) + '</div><div class="summary-label">★ MARK</div></div>';
      sh += '<div class="summary-card"><div class="summary-num" style="color:#dc2626">' + (d.boneCount || 0) + '</div><div class="summary-label">QUARRY</div></div>';
      sh += '<div class="summary-card"><div class="summary-num" style="color:#ea580c">' + (d.perchCount || 0) + '</div><div class="summary-label">STREAM</div></div>';
      sh += '<div class="summary-card"><div class="summary-num" style="color:#F59E0B">' + (d.overstockCount || 0) + '</div><div class="summary-label">OVERSTOCK</div></div>';
      sh += '<div class="summary-card"><div class="summary-num" style="color:#22c55e">' + (d.justSoldCount || 0) + '</div><div class="summary-label">JUST SOLD</div></div>';
      sh += '<div class="summary-card"><div class="summary-num">' + (d.yardCounts ? d.yardCounts.length : 0) + '</div><div class="summary-label">YARDS</div></div>';
      sh += '</div>';
      document.getElementById('summary').innerHTML = d.total > 0 ? sh : '';

      if (d.total === 0) {
        document.getElementById('list').innerHTML = '<div class="empty">No alerts for this filter.<br>Try a wider time range or different yard.</div>';
        document.getElementById('pagination').innerHTML = '';
        return;
      }

      var h = '';
      var yardOrder = d.yardCounts.map(function(y) { return y.yard; });
      yardOrder.forEach(function(yardName) {
        var alerts = d.alerts[yardName];
        if (!alerts || alerts.length === 0) return;

        h += '<div class="card">';
        h += '<div class="yard-header"><span class="yard-name">' + esc(yardName) + '</span><span class="yard-count">' + alerts.length + ' alert' + (alerts.length > 1 ? 's' : '') + '</span></div>';

        alerts.forEach(function(a) {
          var bc = a.confidence === 'high' ? 'b-high' : a.confidence === 'medium' ? 'b-med' : 'b-low';
          var srcClass = a.source === 'PERCH' ? 'b-mark' : a.source === 'OVERSTOCK' ? 'b-overstock' : a.source === 'bone_pile' ? 'b-bone' : 'b-perch';
          var srcLabel = a.source === 'PERCH' ? '★ MARK' : a.source === 'OVERSTOCK' ? 'OVERSTOCK' : a.source === 'bone_pile' ? 'QUARRY' : 'STREAM';
          var soldTag = a.justSold ? '<span class="badge b-sold">SOLD ' + a.justSold.toUpperCase() + '</span>' : '';
          var priceStr = a.part_value ? '$' + a.part_value : '';
          var setStr = '';
          if (a.vehicle_set_date) {
            var days = Math.floor((Date.now() - new Date(a.vehicle_set_date).getTime()) / 86400000);
            setStr = 'set ' + (days <= 0 ? 'today' : days + 'd ago');
          }

          var isClaimed = a.claimed;
          var checkSvg = isClaimed
            ? '<svg viewBox="0 0 24 24" fill="#22c55e" stroke="none"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>'
            : '<svg viewBox="0 0 24 24" fill="none" stroke="#6B7280" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="3"/></svg>';

          h += '<div class="alert-row' + (isClaimed ? ' claimed' : '') + '">';
          h += '<div class="claim-check' + (isClaimed ? ' checked' : '') + '" onclick="claimAlert(' + a.id + ',' + !isClaimed + ')">' + checkSvg + '</div>';
          h += '<div class="alert-info">';
          if (a.source === 'OVERSTOCK') {
            h += '<div class="alert-part">' + esc(a.source_title) + '</div>';
            h += '<div class="alert-vehicle" style="color:#F59E0B">Low Stock Alert</div>';
          } else {
            h += '<div class="alert-part">' + esc(a.source_title) + '</div>';
            h += '<div class="alert-vehicle">' + esc([a.vehicle_year, a.vehicle_make, a.vehicle_model].filter(Boolean).join(' '));
            if (a.vehicle_color) h += ' <span style="color:#6B7280;font-weight:400">(' + esc(a.vehicle_color) + ')</span>';
            h += '</div>';
          }
          h += '<div class="alert-meta">';
          if (isClaimed) h += '<span class="badge" style="background:#064e3b;color:#22c55e">PULLED</span>';
          h += '<span class="badge ' + srcClass + '">' + srcLabel + '</span>';
          if (a.source !== 'OVERSTOCK') h += '<span class="badge ' + bc + '">' + (a.confidence || '').toUpperCase() + '</span>';
          if (soldTag) h += soldTag;
          if (a.source === 'OVERSTOCK' && priceStr) {
            h += '<span style="font-weight:700;color:#22c55e">Sells for ' + priceStr + '</span>';
          } else if (priceStr) {
            h += '<span style="font-weight:700;color:#22c55e">' + priceStr + '</span>';
          }
          if (a.row) h += '<span>Row ' + esc(a.row) + '</span>';
          if (setStr) h += '<span>' + setStr + '</span>';
          h += '</div>';
          if (a.notes) h += '<div class="alert-notes">' + esc(a.notes) + '</div>';
          h += '</div></div>';
        });
        h += '</div>';
      });

      document.getElementById('list').innerHTML = h;

      if (d.totalPages <= 1) { document.getElementById('pagination').innerHTML = ''; return; }
      var ph = '';
      for (var i = 1; i <= d.totalPages; i++) {
        ph += '<button class="pg-btn' + (i === currentPage ? ' active' : '') + '" onclick="load(' + i + ')">' + i + '</button>';
      }
      document.getElementById('pagination').innerHTML = ph;
    })
    .catch(function(err) {
      document.getElementById('loading').style.display = 'none';
      document.getElementById('list').innerHTML = '<div class="empty">Error: ' + err.message + '</div>';
    });
}

function refreshAlerts() {
  var btn = document.getElementById('refreshBtn');
  btn.disabled = true; btn.textContent = 'Generating...';
  document.getElementById('list').innerHTML = '<div style="text-align:center;padding:30px"><div class="spinner"></div><div style="margin-top:8px;color:#6B7280;font-size:12px">Matching parts against yard vehicles...</div></div>';

  fetch('/scout-alerts/refresh', { method: 'POST' })
    .then(function(r) { return r.json(); })
    .then(function(d) {
      btn.disabled = false; btn.textContent = 'Refresh';
      if (d.success) load(1);
      else document.getElementById('list').innerHTML = '<div class="empty">Error: ' + (d.error || 'Unknown') + '</div>';
    })
    .catch(function(err) {
      btn.disabled = false; btn.textContent = 'Refresh';
      document.getElementById('list').innerHTML = '<div class="empty">Error: ' + err.message + '</div>';
    });
}

function esc(s) { if (!s) return ''; var d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

load(1);
</script>
</body>
</html>
```
---
## FILE: service/public/phoenix.html
```javascript
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="theme-color" content="#0a0a0a">
<title>DarkHawk - THE PHOENIX</title>
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,sans-serif;background:#0a0a0a;color:#F0F0F0;min-height:100vh;padding-bottom:40px}
.container{padding:12px;max-width:800px;margin:0 auto}
header{background:#141414;border-bottom:1px solid #2a2a2a;padding:14px 16px;display:flex;align-items:center;justify-content:space-between}
.h-title{font-size:18px;font-weight:700;letter-spacing:-0.03em}
.h-sub{font-size:11px;color:#9CA3AF;margin-top:1px}
.controls{display:flex;gap:8px;align-items:center;padding:10px 12px;background:#141414;border-bottom:1px solid #2a2a2a;flex-wrap:wrap}
.pill{padding:6px 12px;border-radius:6px;border:1px solid #333;background:#1a1a1a;color:#9CA3AF;font-size:11px;font-weight:600;cursor:pointer}
.pill.active{background:#7f1d1d;color:#dc2626;border-color:#dc2626}
select{padding:6px 10px;border-radius:6px;border:1px solid #333;background:#1a1a1a;color:#d1d5db;font-size:11px;outline:none;appearance:none;-webkit-appearance:none;cursor:pointer}
.stats-row{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;padding:10px 12px}
.stat-box{background:#141414;border:1px solid #2a2a2a;border-radius:8px;padding:10px;text-align:center}
.stat-val{font-size:16px;font-weight:700;color:#F0F0F0}
.stat-label{font-size:9px;color:#6B7280;text-transform:uppercase;letter-spacing:.06em;margin-top:2px}
.card{background:#141414;border:1px solid #2a2a2a;border-radius:10px;padding:14px;margin-bottom:10px}
.ph-card{display:flex;gap:12px;align-items:flex-start;padding:12px 14px;border-bottom:1px solid #1f1f1f}
.ph-card:last-child{border-bottom:none}
.ph-thumb{width:44px;height:44px;border-radius:8px;background:#1f2937;display:flex;align-items:center;justify-content:center;font-size:20px;flex-shrink:0;overflow:hidden}
.ph-thumb img{width:100%;height:100%;object-fit:cover}
.ph-score{width:36px;height:36px;border-radius:8px;display:flex;flex-direction:column;align-items:center;justify-content:center;flex-shrink:0;font-size:13px;font-weight:800;line-height:1}
.ph-score .lbl{font-size:7px;font-weight:600;letter-spacing:.04em;margin-top:1px}
.sc-prime{background:#064e3b;color:#22c55e}
.sc-solid{background:#713f12;color:#eab308}
.sc-watch{background:#7c2d12;color:#f97316}
.sc-low{background:#7f1d1d;color:#ef4444}
.ph-info{flex:1;min-width:0}
.ph-top{display:flex;justify-content:space-between;align-items:flex-start}
.ph-type{font-size:13px;font-weight:700}
.ph-year{font-size:11px;color:#6B7280}
.ph-stats{font-size:11px;color:#9CA3AF;margin-top:2px}
.ph-range{font-size:10px;color:#6B7280;margin-top:1px}
.ph-sellers{font-size:10px;color:#4B5563;margin-top:2px}
.ph-sample{font-size:10px;color:#374151;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.manage-toggle{padding:8px 14px;font-size:11px;font-weight:600;color:#6B7280;cursor:pointer;border:none;background:none;width:100%;text-align:left}
.manage-panel{display:none;padding:0 12px 12px}
.manage-panel.open{display:block}
.seller-row{display:flex;align-items:center;justify-content:space-between;padding:8px 0;border-bottom:1px solid #1f1f1f;font-size:12px}
.seller-row:last-child{border-bottom:none}
.add-row{display:flex;gap:8px;margin-top:8px}
.add-input{flex:1;padding:8px 10px;border:1px solid #333;border-radius:6px;font-size:12px;background:#0a0a0a;color:#F0F0F0;outline:none}
.add-input:focus{border-color:#dc2626}
.btn{padding:8px 14px;border-radius:6px;border:none;font-size:12px;font-weight:700;cursor:pointer}
.btn-red{background:#dc2626;color:#fff}
.btn-sm{padding:5px 8px;font-size:10px;border-radius:4px;border:1px solid #333;background:#1a1a1a;color:#d1d5db;cursor:pointer}
.btn-sm:disabled{opacity:.3}
.spinner{width:14px;height:14px;border:2px solid #333;border-top-color:#dc2626;border-radius:50%;animation:spin .7s linear infinite;display:inline-block}
@keyframes spin{to{transform:rotate(360deg)}}
.empty{text-align:center;color:#6B7280;padding:30px;font-size:13px;line-height:1.6}
.count-header{font-size:11px;color:#6B7280;padding:6px 12px;font-weight:600}
.toast{position:fixed;bottom:20px;left:50%;transform:translateX(-50%);background:#141414;border:1px solid #2a2a2a;color:#F0F0F0;padding:8px 16px;border-radius:8px;font-size:12px;z-index:300}
@media(max-width:500px){.stats-row{grid-template-columns:repeat(2,1fr)}}
</style>
</head>
<body>
<div id="dh-nav"></div>
<script src="/admin/dh-nav.js?v=3"></script><script>dhNav('phoenix')</script>

<header>
  <div>
    <div class="h-title">THE PHOENIX</div>
    <div class="h-sub">Rebuild Candidate Intelligence</div>
  </div>
</header>

<div class="controls" id="controls">
  <button class="pill" data-days="90" onclick="setDays(90)">90d</button>
  <button class="pill active" data-days="180" onclick="setDays(180)">180d</button>
  <button class="pill" data-days="365" onclick="setDays(365)">365d</button>
  <button class="pill" data-days="9999" onclick="setDays(9999)">All</button>
  <select id="sellerFilter" onchange="loadData()"><option value="">All Sellers</option></select>
</div>

<div class="stats-row" id="statsRow">
  <div class="stat-box"><div class="stat-val" id="statCatalog">-</div><div class="stat-label">Catalog Parts</div></div>
  <div class="stat-box"><div class="stat-val" id="statPNs">-</div><div class="stat-label">Part Numbers</div></div>
  <div class="stat-box"><div class="stat-val" id="statFitment">-</div><div class="stat-label">With Fitment</div></div>
  <div class="stat-box"><div class="stat-val" id="statSales">-</div><div class="stat-label">Sold Items</div></div>
</div>

<div class="container">
  <!-- Seller Management -->
  <div class="card" style="padding:0;margin-bottom:12px">
    <button class="manage-toggle" id="manageBtn" onclick="toggleManage()">Manage Sellers ▼</button>
    <div class="manage-panel" id="managePanel">
      <div id="sellerList"></div>
      <div class="add-row">
        <input class="add-input" id="newSeller" placeholder="eBay seller name..." />
        <button class="btn btn-red" id="addBtn" onclick="addSeller()">Add</button>
      </div>
    </div>
  </div>

  <div id="listContent"><div class="empty"><div class="spinner"></div><br>Loading Phoenix data...</div></div>
</div>

<script>
var currentDays = 180;
var allSellers = [];

function setDays(d) {
  currentDays = d;
  document.querySelectorAll('.pill').forEach(function(b) { b.classList.toggle('active', parseInt(b.dataset.days) === d); });
  loadData();
}

function toggleManage() {
  var p = document.getElementById('managePanel');
  var b = document.getElementById('manageBtn');
  var open = p.classList.toggle('open');
  b.textContent = open ? 'Manage Sellers ▲' : 'Manage Sellers ▼';
}

function toast(msg) {
  var el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(function() { el.remove(); }, 3000);
}

async function loadSellers() {
  try {
    var res = await fetch('/phoenix/sellers');
    var data = await res.json();
    allSellers = data.sellers || [];
    renderSellers();
    var sel = document.getElementById('sellerFilter');
    sel.innerHTML = '<option value="">All Sellers</option>';
    allSellers.filter(function(s) { return s.enabled; }).forEach(function(s) {
      sel.innerHTML += '<option value="' + s.name + '">' + s.name + '</option>';
    });
  } catch (e) { /* silent */ }
}

function renderSellers() {
  var el = document.getElementById('sellerList');
  if (allSellers.length === 0) { el.innerHTML = '<div class="empty" style="padding:12px">No rebuild sellers configured.</div>'; return; }
  var h = '';
  allSellers.forEach(function(s) {
    var scraped = s.lastScrapedAt ? new Date(s.lastScrapedAt).toLocaleDateString() : 'Never';
    h += '<div class="seller-row">';
    h += '<span style="font-weight:600">' + s.name + '</span>';
    h += '<span style="color:#6B7280;font-size:10px">' + (s.itemsScraped || 0) + ' items · ' + scraped + '</span>';
    h += '<span>';
    h += '<button class="btn-sm" onclick="scrapeSeller(\'' + s.name + '\',this)">Scrape</button> ';
    h += '<button class="btn-sm" style="color:#ef4444" onclick="removeSeller(\'' + s.name + '\')">Remove</button>';
    h += '</span></div>';
  });
  el.innerHTML = h;
}

async function addSeller() {
  var input = document.getElementById('newSeller');
  var name = input.value.trim();
  if (!name) return;
  var btn = document.getElementById('addBtn');
  btn.disabled = true;
  try {
    var res = await fetch('/phoenix/sellers', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: name }) });
    var data = await res.json();
    if (data.success) { input.value = ''; toast('Added ' + name); await loadSellers(); loadData(); }
    else toast(data.message || 'Failed');
  } catch (e) { toast('Error adding seller'); }
  btn.disabled = false;
}

async function removeSeller(name) {
  if (!confirm('Remove ' + name + ' from rebuild sellers?')) return;
  try {
    await fetch('/phoenix/sellers/' + name, { method: 'DELETE' });
    toast('Removed ' + name);
    await loadSellers();
    loadData();
  } catch (e) { toast('Error removing seller'); }
}

async function scrapeSeller(name, btn) {
  if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner"></span>'; }
  try {
    var res = await fetch('/phoenix/sellers/' + name + '/scrape', { method: 'POST' });
    var data = await res.json();
    toast(data.success ? 'Scrape complete for ' + name : (data.error || 'Scrape failed'));
    await loadSellers();
    loadData();
  } catch (e) { toast('Scrape error'); }
  if (btn) { btn.disabled = false; btn.textContent = 'Scrape'; }
}

async function loadData() {
  var seller = document.getElementById('sellerFilter').value;
  var params = 'days=' + currentDays + '&limit=100' + (seller ? '&seller=' + seller : '');

  // Stats
  try {
    var sr = await fetch('/phoenix/stats?' + params);
    var sd = await sr.json();
    if (sd.success) {
      var st = sd.stats;
      document.getElementById('statCatalog').textContent = st.catalogItems || 0;
      document.getElementById('statPNs').textContent = st.itemsWithPartNumber || 0;
      document.getElementById('statFitment').textContent = st.itemsWithFitment || 0;
      document.getElementById('statSales').textContent = st.totalSales || 0;
    }
  } catch (e) { /* silent */ }

  // List
  var el = document.getElementById('listContent');
  try {
    var res = await fetch('/phoenix?' + params);
    var data = await res.json();
    if (!data.success) { el.innerHTML = '<div class="empty">Error: ' + (data.error || 'unknown') + '</div>'; return; }
    var items = data.data || [];
    // statParts removed — stats come from /stats endpoint

    if (items.length === 0) {
      if (allSellers.length === 0) { el.innerHTML = '<div class="empty">No rebuild sellers configured. Expand "Manage Sellers" to add one.</div>'; }
      else { el.innerHTML = '<div class="empty">No sold data found. Scrape your rebuild sellers to populate the list.</div>'; }
      return;
    }

    var sellerLabel = seller ? 'from ' + seller : '';
    var h = '<div class="count-header">Showing ' + items.length + ' rebuild candidates ' + sellerLabel + '</div>';
    h += '<div class="card" style="padding:0">';
    items.forEach(function(it) {
      var sc = it.phoenixScore >= 75 ? 'sc-prime' : it.phoenixScore >= 50 ? 'sc-solid' : it.phoenixScore >= 25 ? 'sc-watch' : 'sc-low';
      var lbl = it.phoenixScore >= 75 ? 'PRIME' : it.phoenixScore >= 50 ? 'SOLID' : it.phoenixScore >= 25 ? 'WATCH' : 'LOW';
      var thumb = it.catalogImage ? '<img src="' + it.catalogImage + '" alt="">' : '🔥';
      var pnDisplay = it.partNumberBase ? it.partNumberBase : '';

      h += '<div class="ph-card">';
      h += '<div class="ph-thumb">' + thumb + '</div>';
      h += '<div class="ph-score ' + sc + '">' + it.phoenixScore + '<span class="lbl">' + lbl + '</span></div>';
      h += '<div class="ph-info">';

      // Line 1: Part type + PN
      h += '<div class="ph-top"><div><span class="ph-type">' + esc(it.partType) + '</span>';
      if (pnDisplay) h += ' <span style="color:#6B7280;font-size:11px">' + esc(pnDisplay) + '</span>';
      if (it.salesCount === 0 && it.catalogCount > 0) h += ' <span style="background:#1f2937;color:#6B7280;font-size:8px;padding:1px 4px;border-radius:3px">CATALOG</span>';
      h += '</div><span class="ph-year">' + (it.yearRange || '') + '</span></div>';

      // Line 2: Fitment (from AIC)
      if (it.fitmentSummary) {
        h += '<div style="font-size:12px;color:#d1d5db;margin-top:1px">' + esc(it.fitmentSummary);
        if (it.fitment && it.fitment[0] && it.fitment[0].engine) h += ' · ' + esc(it.fitment[0].engine);
        h += '</div>';
      }

      // Line 3: Market data
      if (it.marketAvgPrice || it.marketSold90d) {
        h += '<div style="font-size:11px;color:#06b6d4;margin-top:2px">Market $' + (it.marketAvgPrice || '?') + ' avg · ' + (it.marketSold90d || 0) + ' sold/90d';
        if (it.marketScore) h += ' · Score ' + it.marketScore;
        h += '</div>';
      }

      // Line 4: Sales velocity
      if (it.salesCount > 0) {
        h += '<div class="ph-stats">Sold ' + it.salesCount + 'x @ avg $' + it.avgSoldPrice + ' · $' + it.totalRevenue + ' revenue';
        if (it.lastSoldDate) h += ' · Last ' + new Date(it.lastSoldDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        h += '</div>';
      } else {
        h += '<div style="font-size:10px;color:#4B5563;margin-top:2px">No sales data yet</div>';
      }

      // Line 5: Seller breakdown
      if (it.soldSellers && it.soldSellers.length > 1) {
        h += '<div class="ph-sellers">' + it.soldSellers.map(function(s) { return s + ' (' + (it.sellerBreakdown[s] || 0) + ')'; }).join(' · ') + '</div>';
      }

      // Line 6: Sample title
      if (it.sampleTitles && it.sampleTitles[0]) {
        var sample = it.sampleTitles[0];
        h += '<div class="ph-sample">' + esc(sample.length > 80 ? sample.substring(0, 80) + '...' : sample) + '</div>';
      }

      h += '</div></div>';
    });
    h += '</div>';
    el.innerHTML = h;
  } catch (e) {
    el.innerHTML = '<div class="empty" style="color:#ef4444">Failed to load data: ' + e.message + '</div>';
  }
}

function esc(s) { if (!s) return ''; var d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

// Init
loadSellers().then(function() { loadData(); });
</script>
</body>
</html>
```
---
## FILE: service/public/flyway.html
```javascript
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="theme-color" content="#0a0a0a">
<title>DarkHawk - THE FLYWAY</title>
<style>
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
:root {
  --bg: #0a0a0a; --surface: #141414; --surface2: #1a1a1a;
  --border: #2a2a2a; --red: #DC2626; --red-dim: #7f1d1d;
  --yellow: #eab308; --yellow-dim: #713f12; --green: #22c55e;
  --gray: #9ca3af; --text: #F0F0F0; --text-mid: #d1d5db;
  --text-muted: #9CA3AF; --text-faint: #6B7280;
  --teal: #06b6d4; --teal-bg: #164e63; --orange: #f97316; --orange-bg: #7c2d12;
  --font: -apple-system, BlinkMacSystemFont, 'SF Pro Display', sans-serif;
}
body { font-family: var(--font); background: var(--bg); color: var(--text); min-height: 100vh; -webkit-tap-highlight-color: transparent; padding-bottom: 60px; }

/* Header */
header { background: var(--surface); border-bottom: 1px solid var(--border); padding: 14px 16px; display: flex; align-items: center; justify-content: space-between; }
.header-left h1 { font-size: 18px; font-weight: 700; letter-spacing: -0.03em; }
.header-left p { font-size: 11px; color: var(--text-muted); margin-top: 1px; }

/* View Tabs */
.view-tabs { display: flex; background: var(--surface); border-bottom: 1px solid var(--border); }
.view-tab { flex: 1; padding: 11px 16px; font-size: 12px; font-weight: 600; color: var(--text-muted); cursor: pointer; text-align: center; border-bottom: 2px solid transparent; }
.view-tab.active { color: var(--text); border-bottom-color: var(--red); }

/* Yard Tabs */
.yard-tabs { display: flex; background: var(--surface); border-bottom: 1px solid var(--border); overflow-x: auto; scrollbar-width: none; -webkit-overflow-scrolling: touch; }
.yard-tabs::-webkit-scrollbar { display: none; }
.yard-tab { padding: 11px 16px; font-size: 12px; font-weight: 600; color: var(--text-muted); cursor: pointer; white-space: nowrap; border-bottom: 2px solid transparent; flex-shrink: 0; }
.yard-tab.active { color: var(--text); border-bottom-color: var(--red); }

/* Status Bar */
.status-bar { padding: 6px 16px; background: var(--surface); border-bottom: 1px solid var(--border); font-size: 11px; color: var(--text-muted); display: flex; justify-content: space-between; }

/* Toggle Bar */
.toggle-bar { display: flex; align-items: center; justify-content: center; gap: 6px; padding: 8px 12px; background: var(--surface); border-bottom: 1px solid var(--border); flex-wrap: wrap; }
.toggle-btn { padding: 5px 10px; border-radius: 6px; border: 1px solid var(--border); background: var(--surface2); color: var(--text-muted); font-size: 11px; font-weight: 600; cursor: pointer; }
.toggle-btn.active { background: #064e3b; color: #22c55e; border-color: #22c55e; }

/* Cards */
.card { background: var(--surface); border: 1px solid var(--border); border-radius: 10px; padding: 14px; margin: 8px 12px; }

/* Spinner */
.loading { text-align: center; padding: 40px 20px; color: var(--text-muted); font-size: 12px; }
.spinner { width: 28px; height: 28px; border: 2px solid #333; border-top-color: #DC2626; border-radius: 50%; animation: spin 0.8s linear infinite; margin: 0 auto 12px; }
@keyframes spin { to { transform: rotate(360deg); } }

/* Form */
.form-group { margin-bottom: 12px; }
.form-label { font-size: 10px; font-weight: 700; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.06em; margin-bottom: 4px; }
.form-input, .form-textarea, .form-date { width: 100%; padding: 10px 12px; border: 1px solid var(--border); border-radius: 8px; background: var(--surface2); color: var(--text); font-size: 14px; font-family: var(--font); outline: none; }
.form-input:focus, .form-textarea:focus, .form-date:focus { border-color: var(--red); }
.form-input::placeholder, .form-textarea::placeholder { color: var(--text-faint); }
.form-textarea { min-height: 60px; resize: vertical; font-size: 13px; }
.form-date { color-scheme: dark; }
.form-date:disabled { opacity: 0.4; }
.form-row { display: flex; gap: 8px; }
.form-row .form-group { flex: 1; }

/* Buttons */
.btn { padding: 10px 16px; border-radius: 8px; border: none; font-size: 13px; font-weight: 700; cursor: pointer; font-family: var(--font); }
.btn-red { background: var(--red); color: #fff; }
.btn-red:active { opacity: 0.8; }
.btn-green { background: var(--green); color: #000; }
.btn-gray { background: var(--surface2); color: var(--text-muted); border: 1px solid var(--border); }
.btn-sm { padding: 6px 10px; font-size: 11px; border-radius: 6px; }
.btn:disabled { opacity: 0.4; cursor: not-allowed; }

/* Trip Type Toggle */
.trip-type-toggle { display: flex; gap: 0; margin-bottom: 12px; border-radius: 8px; overflow: hidden; border: 1px solid var(--border); }
.trip-type-btn { flex: 1; padding: 10px 16px; font-size: 12px; font-weight: 700; cursor: pointer; text-align: center; background: var(--surface2); color: var(--text-faint); border: none; font-family: var(--font); letter-spacing: 0.04em; }
.trip-type-btn.active-day { background: var(--teal); color: #fff; }
.trip-type-btn.active-road { background: var(--orange); color: #fff; }

/* Trip Type Badge */
.badge-day { background: var(--teal-bg); color: var(--teal); font-size: 9px; font-weight: 700; padding: 2px 6px; border-radius: 4px; text-transform: uppercase; letter-spacing: 0.04em; display: inline-block; vertical-align: middle; }
.badge-road { background: var(--orange-bg); color: var(--orange); font-size: 9px; font-weight: 700; padding: 2px 6px; border-radius: 4px; text-transform: uppercase; letter-spacing: 0.04em; display: inline-block; vertical-align: middle; }

/* Trip Picker */
.trip-picker { padding: 20px 12px; }
.trip-picker-title { text-align: center; font-size: 14px; font-weight: 700; color: var(--text-muted); margin-bottom: 16px; }
.trip-pick-card { background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 16px; margin-bottom: 10px; cursor: pointer; }
.trip-pick-card:active { opacity: 0.8; }
.trip-pick-card .pick-name { font-size: 15px; font-weight: 700; }
.trip-pick-card .pick-dates { font-size: 11px; color: var(--text-muted); margin-top: 2px; }
.trip-pick-card .pick-meta { display: flex; gap: 8px; align-items: center; margin-top: 8px; }
.trip-pick-card .pick-tap { font-size: 10px; color: var(--text-faint); text-transform: uppercase; letter-spacing: 0.1em; margin-top: 10px; text-align: center; }

/* Yard Selector */
.yard-group { margin: 8px 12px; }
.yard-group-label { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; padding: 8px 0 4px; }
.yard-item { display: flex; align-items: center; gap: 10px; padding: 10px 12px; background: var(--surface); border: 1px solid var(--border); border-radius: 8px; margin-bottom: 4px; cursor: pointer; }
.yard-item.selected { border-color: var(--green); background: #064e3b22; }
.yard-item.flagged { opacity: 0.4; cursor: not-allowed; }
.yard-check { width: 20px; height: 20px; border: 2px solid var(--border); border-radius: 4px; flex-shrink: 0; display: flex; align-items: center; justify-content: center; font-size: 12px; }
.yard-item.selected .yard-check { border-color: var(--green); background: var(--green); color: #000; }
.yard-info { flex: 1; min-width: 0; }
.yard-name { font-size: 13px; font-weight: 600; }
.yard-meta { font-size: 10px; color: var(--text-muted); margin-top: 1px; }
.yard-dist { font-size: 12px; font-weight: 700; color: var(--text-muted); flex-shrink: 0; }

/* Chip */
.chip { font-size: 10px; font-weight: 700; padding: 2px 6px; border-radius: 4px; letter-spacing: 0.03em; text-transform: uppercase; display: inline-block; }
.chip-green { background: #064e3b; color: #22c55e; }
.chip-yellow { background: #713f12; color: #eab308; }
.chip-orange { background: #7c2d12; color: #f97316; }
.chip-red { background: #7f1d1d; color: #ef4444; }
.chip-gray { background: #1f2937; color: #6B7280; }
.chip-blue { background: #1e3a5f; color: #3b82f6; }
.chip-cyan { background: #164e63; color: #06b6d4; }
.chip-magenta { background: #701a75; color: #d946ef; }

/* Trip Cards */
.trip-card { background: var(--surface); border: 1px solid var(--border); border-radius: 10px; padding: 14px; margin: 8px 12px; }
.trip-card-header { display: flex; justify-content: space-between; align-items: flex-start; }
.trip-name { font-size: 15px; font-weight: 700; }
.trip-dates { font-size: 11px; color: var(--text-muted); margin-top: 2px; }
.trip-actions { display: flex; gap: 6px; margin-top: 10px; }

/* Vehicle Cards */
.vehicle-row { border-bottom: 1px solid #1a1a1a; }
.vehicle-row:last-child { border-bottom: none; }
.v-collapsed { display: flex; align-items: center; padding: 10px 14px; gap: 10px; min-height: 48px; cursor: pointer; user-select: none; }
.v-score { width: 36px; height: 36px; border-radius: 8px; flex-shrink: 0; display: flex; align-items: center; justify-content: center; font-size: 13px; font-weight: 800; }
.v-score.green { background: #064e3b; color: #22c55e; }
.v-score.yellow { background: #713f12; color: #eab308; }
.v-score.orange { background: #7c2d12; color: #f97316; }
.v-score.red { background: #7f1d1d; color: #ef4444; }
.v-score.gray { background: #1f2937; color: #6B7280; }
.v-info { flex: 1; min-width: 0; }
.v-title { font-size: 14px; font-weight: 600; }
.v-badges { display: flex; gap: 4px; margin-top: 3px; flex-wrap: wrap; align-items: center; }
.v-highvalue { margin-top: 3px; font-size: 11px; color: #eab308; font-weight: 600; }
.v-chips { display: flex; gap: 4px; margin-top: 4px; flex-wrap: wrap; }
.v-right { text-align: right; flex-shrink: 0; }
.v-value { font-size: 13px; font-weight: 700; color: var(--green); }
.v-parts-count { font-size: 10px; color: var(--text-muted); margin-top: 1px; }
.v-decay { font-size: 10px; margin-top: 1px; }
.v-expanded { display: none; padding: 0 14px 14px; }
.v-expanded.open { display: block; }

/* Expanded Part List */
.part-row { display: flex; justify-content: space-between; align-items: center; padding: 6px 0; border-bottom: 1px solid #1a1a1a; font-size: 12px; }
.part-row:last-child { border-bottom: none; }
.part-type { font-weight: 600; }
.part-price { font-weight: 700; }
.part-meta { font-size: 10px; color: var(--text-muted); }

/* Trip Header */
.trip-header { background: var(--surface); border-bottom: 1px solid var(--border); padding: 12px 16px; }
.trip-header-name { font-size: 16px; font-weight: 700; }
.trip-header-dates { font-size: 11px; color: var(--text-muted); margin-top: 2px; }
.trip-countdown { font-size: 11px; font-weight: 700; margin-top: 4px; }

/* Empty State */
.empty { text-align: center; padding: 40px 20px; color: var(--text-faint); font-size: 13px; line-height: 1.6; }

/* Confirm Dialog */
.confirm-overlay { position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.7); z-index: 200; display: none; align-items: center; justify-content: center; padding: 20px; }
.confirm-overlay.open { display: flex; }
.confirm-box { background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 20px; max-width: 320px; width: 100%; }
.confirm-title { font-size: 15px; font-weight: 700; margin-bottom: 8px; }
.confirm-body { font-size: 12px; color: var(--text-muted); margin-bottom: 16px; }
.confirm-actions { display: flex; gap: 8px; justify-content: flex-end; }

@keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }
.pulse { animation: pulse 1.5s ease-in-out infinite; }
</style>
</head>
<body>
<div id="dh-nav"></div>
<script src="/admin/dh-nav.js?v=3"></script><script>dhNav('flyway')</script>

<header>
  <div class="header-left">
    <h1>THE FLYWAY</h1>
    <p id="headerSub">Road Trip Intelligence</p>
  </div>
</header>

<div class="view-tabs">
  <div class="view-tab active" id="vtab-plan" onclick="switchView('plan')">PLAN</div>
  <div class="view-tab" id="vtab-active" onclick="switchView('active')">ACTIVE</div>
  <div class="view-tab" id="vtab-history" onclick="switchView('history')">HISTORY</div>
</div>

<div id="view-plan" style="display:block">
  <!-- Trip Creation -->
  <div class="card" style="margin-top:8px">
    <div class="form-label" style="margin-bottom:8px;color:var(--red)">New Trip</div>
    <div class="trip-type-toggle">
      <button class="trip-type-btn" id="btnDayTrip" onclick="setTripType('day_trip')">DAY TRIP</button>
      <button class="trip-type-btn active-road" id="btnRoadTrip" onclick="setTripType('road_trip')">ROAD TRIP</button>
    </div>
    <div class="form-group">
      <input class="form-input" id="tripName" placeholder="Charlotte Run, GA/FL Sweep..." autocomplete="off">
    </div>
    <div class="form-row">
      <div class="form-group"><div class="form-label">Start</div><input type="date" class="form-date" id="tripStart" onchange="onStartDateChange()"></div>
      <div class="form-group"><div class="form-label">End</div><input type="date" class="form-date" id="tripEnd"></div>
    </div>
    <div class="form-group">
      <textarea class="form-textarea" id="tripNotes" placeholder="Budget, route notes, priorities..."></textarea>
    </div>
    <button class="btn btn-red" style="width:100%" onclick="handleCreateTrip()">Create Trip</button>
  </div>

  <!-- Planning Trips -->
  <div id="planningTrips"></div>

  <!-- Yard Selector (shown after selecting a trip) -->
  <div id="yardSelectorWrap" style="display:none">
    <div style="padding:8px 16px;display:flex;justify-content:space-between;align-items:center">
      <div class="form-label" style="color:var(--yellow);margin:0">Select Yards</div>
      <div id="yardCount" style="font-size:11px;color:var(--text-muted)">0 selected</div>
    </div>
    <div id="yardSelector"></div>
  </div>
</div>

<div id="view-active" style="display:none">
  <div id="activeContent">
    <div class="empty">No active trip. Go to Plan tab to create and activate one.</div>
  </div>
</div>

<div id="view-history" style="display:none">
  <div id="historyContent">
    <div class="loading"><div class="spinner"></div><div>Loading...</div></div>
  </div>
</div>

<!-- Confirm Dialog -->
<div class="confirm-overlay" id="confirmOverlay">
  <div class="confirm-box">
    <div class="confirm-title" id="confirmTitle"></div>
    <div class="confirm-body" id="confirmBody"></div>
    <div class="confirm-actions">
      <button class="btn btn-gray btn-sm" onclick="closeConfirm()">Cancel</button>
      <button class="btn btn-red btn-sm" id="confirmBtn" onclick="doConfirm()">Confirm</button>
    </div>
  </div>
</div>

<script>
// ═══ STATE ═══
var currentView = 'plan';
var allTrips = [];
var activeTrip = null;
var activeTripData = null;
var editingTripId = null;
var editingTripType = null;
var availableYards = [];
var selectedYardIds = new Set();
var activeYardFilter = 'all';
var sortMode = 'score';
var filterPremium = false;
var filterHighValue = false;
var confirmCallback = null;
var refreshTimer = null;
var newTripType = 'road_trip';
var multipleActiveTrips = [];

// ═══ HELPERS ═══
function esc(s) { if (!s) return ''; var d = document.createElement('div'); d.textContent = s; return d.innerHTML; }
function timeAgo(ds) { var d = new Date(ds); var diff = Date.now() - d.getTime(); var h = Math.floor(diff / 3600000); var dd = Math.floor(h / 24); if (dd > 0) return dd + 'd ago'; if (h > 0) return h + 'h ago'; return 'now'; }
function fmtDate(d) { if (!d) return ''; return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }); }
function fmtDateRange(s, e) { if (s === e) return fmtDate(s); return fmtDate(s) + ' - ' + fmtDate(e); }
function daysUntil(d) { return Math.ceil((new Date(d).getTime() - Date.now()) / 86400000); }
function tripTypeBadge(t) { var tt = t.trip_type || 'road_trip'; return tt === 'day_trip' ? '<span class="badge-day">DAY TRIP</span>' : '<span class="badge-road">ROAD TRIP</span>'; }
function tripTypeAccent(t) { return (t.trip_type || 'road_trip') === 'day_trip' ? 'var(--teal)' : 'var(--orange)'; }

var LKQ_CODES = new Set(['JK','JL','JT','WK','XK','MK','KJ','KL','DJ','DT','DH','BK','WJ','ZJ','TJ','ND','WD','PF','UF','FK','FF','AN','EN','GS','JS','KA','RU','ZH','WH','RE','PT','LA','LD','BR','BE','AB','AY','PM','PG','DR','SA']);
function cleanModel(text, make) {
  if (!text) return text;
  var c = text;
  if (/dodge|ram|chrysler|jeep/i.test(make || '')) c = c.replace(/\b[A-Z]{2}\d\b/g, '');
  c = c.replace(/\b([A-Z]{2})\b/g, function(m, code) { return LKQ_CODES.has(code) ? '' : m; });
  c = c.replace(/\bSUBURBAN\s+1500\b/gi, 'Suburban').replace(/\bYUKON\s+XL\s+1500\b/gi, 'Yukon XL').replace(/\bAVALANCHE\s+1500\b/gi, 'Avalanche');
  if (/mazda/i.test(make || '')) { c = c.replace(/^3$/i, 'Mazda3').replace(/^6$/i, 'Mazda6').replace(/^5$/i, 'Mazda5'); }
  c = c.replace(/\s+(LE|SE|XLE|XSE|LX|EX|LT|LS|SL|SV|SR|DX|SXT|SLT|XLT|SEL|Limited|Sport|Base|Premium|Luxury|Touring)(\/[A-Za-z]+)*\s*$/i, '');
  c = c.replace(/\b(NFA|NFB|NFC)\b/gi, '');
  c = c.replace(/\b(\w+)\s+\1\b/gi, '$1');
  return c.replace(/\s{2,}/g, ' ').trim();
}

// ═══ API ═══
async function api(url, opts) {
  var res = await fetch(url, opts);
  return res.json();
}

// ═══ TRIP TYPE TOGGLE ═══
function setTripType(type) {
  newTripType = type;
  var dayBtn = document.getElementById('btnDayTrip');
  var roadBtn = document.getElementById('btnRoadTrip');
  dayBtn.className = 'trip-type-btn' + (type === 'day_trip' ? ' active-day' : '');
  roadBtn.className = 'trip-type-btn' + (type === 'road_trip' ? ' active-road' : '');

  var nameInput = document.getElementById('tripName');
  var endInput = document.getElementById('tripEnd');
  if (type === 'day_trip') {
    nameInput.placeholder = 'Foss Run, Charlotte Day Trip...';
    endInput.disabled = true;
    var startVal = document.getElementById('tripStart').value;
    if (startVal) endInput.value = startVal;
  } else {
    nameInput.placeholder = 'Charlotte Run, GA/FL Sweep...';
    endInput.disabled = false;
  }

  // Re-render yard selector if open
  if (editingTripId) renderYardSelector();
}

function onStartDateChange() {
  if (newTripType === 'day_trip') {
    document.getElementById('tripEnd').value = document.getElementById('tripStart').value;
  }
}

// ═══ VIEW SWITCHING ═══
function switchView(view) {
  currentView = view;
  ['plan','active','history'].forEach(function(v) {
    document.getElementById('view-' + v).style.display = v === view ? 'block' : 'none';
    document.getElementById('vtab-' + v).classList.toggle('active', v === view);
  });
  if (view === 'plan') loadPlanView();
  if (view === 'active') loadActiveView();
  if (view === 'history') loadHistoryView();
  location.hash = view;
}

// ═══ PLAN VIEW ═══
async function loadPlanView() {
  var data = await api('/flyway/trips');
  allTrips = data.trips || [];
  var planning = allTrips.filter(function(t) { return t.status === 'planning'; });
  renderPlanningTrips(planning);
}

function renderPlanningTrips(trips) {
  var el = document.getElementById('planningTrips');
  if (trips.length === 0) { el.innerHTML = ''; return; }
  var h = '<div style="padding:12px 16px 4px"><div class="form-label" style="color:var(--text-muted)">Planning Trips</div></div>';
  trips.forEach(function(t) {
    var yardNames = (t.yards || []).map(function(y) { return esc(y.name); }).join(', ') || 'No yards';
    var badge = tripTypeBadge(t);
    var dateDisplay = (t.trip_type === 'day_trip' || t.start_date === t.end_date) ? fmtDate(t.start_date) : fmtDateRange(t.start_date, t.end_date);
    h += '<div class="trip-card">';
    h += '<div class="trip-card-header"><div><div class="trip-name">' + esc(t.name) + ' ' + badge + '</div>';
    h += '<div class="trip-dates">' + dateDisplay + '</div>';
    h += '<div style="font-size:10px;color:var(--text-faint);margin-top:2px">' + (t.yards || []).length + ' yards: ' + yardNames + '</div>';
    h += '</div><span class="chip chip-blue">PLANNING</span></div>';
    h += '<div class="trip-actions">';
    h += '<button class="btn btn-green btn-sm" onclick="confirmActivate(' + t.id + ')" ' + ((t.yards || []).length === 0 ? 'disabled title="Add yards first"' : '') + '>ACTIVATE</button>';
    h += '<button class="btn btn-gray btn-sm" onclick="editTripYards(' + t.id + ')">YARDS</button>';
    h += '<button class="btn btn-gray btn-sm" onclick="confirmDelete(' + t.id + ')">DELETE</button>';
    h += '</div></div>';
  });
  el.innerHTML = h;
}

async function handleCreateTrip() {
  var name = document.getElementById('tripName').value.trim();
  var start = document.getElementById('tripStart').value;
  var end = newTripType === 'day_trip' ? start : document.getElementById('tripEnd').value;
  var notes = document.getElementById('tripNotes').value.trim();
  if (!name || !start || !end) return;
  var data = await api('/flyway/trips', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: name, start_date: start, end_date: end, notes: notes || null, trip_type: newTripType }) });
  if (data.success) {
    document.getElementById('tripName').value = '';
    document.getElementById('tripStart').value = '';
    document.getElementById('tripEnd').value = '';
    document.getElementById('tripNotes').value = '';
    editTripYards(data.id);
    loadPlanView();
  }
}

// ═══ YARD SELECTOR ═══
async function editTripYards(tripId) {
  editingTripId = tripId;
  // Determine trip type for this specific trip
  var trip = allTrips.find(function(t) { return t.id === tripId; });
  editingTripType = (trip && trip.trip_type) || newTripType;
  document.getElementById('yardSelectorWrap').style.display = 'block';

  if (availableYards.length === 0) {
    var data = await api('/flyway/available-yards');
    availableYards = data.yards || [];
  }

  selectedYardIds = new Set((trip && trip.yards || []).map(function(y) { return y.id; }));
  renderYardSelector();
}

function renderYardSelector() {
  var isDayTrip = editingTripType === 'day_trip';
  var tiers = isDayTrip ? [
    { label: 'Local', min: 0, max: 60, color: '#22c55e' },
    { label: 'Nearby', min: 60, max: 120, color: '#eab308' },
  ] : [
    { label: 'Local', min: 0, max: 60, color: '#22c55e' },
    { label: 'Day Trip', min: 60, max: 150, color: '#eab308' },
    { label: 'Road Trip', min: 150, max: 500, color: '#f97316' },
    { label: 'Expedition', min: 500, max: 99999, color: '#ef4444' },
  ];
  var h = '';
  tiers.forEach(function(tier) {
    var yards = availableYards.filter(function(y) {
      var d = parseFloat(y.distance_from_base) || 0;
      return d >= tier.min && d < tier.max && !y.flagged;
    });
    if (yards.length === 0) return;
    h += '<div class="yard-group">';
    h += '<div class="yard-group-label" style="color:' + tier.color + '">' + tier.label + ' (' + tier.min + '-' + tier.max + 'mi)</div>';
    yards.forEach(function(y) {
      var sel = selectedYardIds.has(y.id);
      var scrapeIcon = y.scrape_method === 'automated' || y.scrape_method === 'lkq' ? '\u26A1' : y.scrape_method === 'on_demand' || y.scrape_method === 'pullapart' ? '\u{1F447}' : '\u270F';
      h += '<div class="yard-item' + (sel ? ' selected' : '') + '" onclick="toggleYard(\'' + y.id + '\')" style="border-left:3px solid ' + tier.color + '">';
      h += '<div class="yard-check">' + (sel ? '\u2713' : '') + '</div>';
      h += '<div class="yard-info"><div class="yard-name">' + esc(y.name) + ' <span class="chip chip-gray" style="font-size:8px">' + esc(y.chain || '?') + '</span></div>';
      h += '<div class="yard-meta">' + scrapeIcon + ' ' + (y.scrape_method || 'none') + (y.last_scraped ? ' \u00B7 scraped ' + timeAgo(y.last_scraped) : '') + '</div></div>';
      h += '<div class="yard-dist">' + Math.round(y.distance_from_base) + 'mi</div>';
      h += '</div>';
    });
    h += '</div>';
  });
  // Show flagged yards dimmed (not for day trips — keep it clean)
  if (!isDayTrip) {
    var flagged = availableYards.filter(function(y) { return y.flagged; });
    if (flagged.length > 0) {
      h += '<div class="yard-group"><div class="yard-group-label" style="color:#ef4444">Flagged (unavailable)</div>';
      flagged.forEach(function(y) {
        h += '<div class="yard-item flagged"><div class="yard-check"></div><div class="yard-info"><div class="yard-name" style="color:var(--text-faint)">' + esc(y.name) + '</div><div class="yard-meta" style="color:#ef4444">' + esc(y.flag_reason || 'Flagged') + '</div></div></div>';
      });
      h += '</div>';
    }
  }
  document.getElementById('yardSelector').innerHTML = h;
  document.getElementById('yardCount').textContent = selectedYardIds.size + ' selected';
}

async function toggleYard(yardId) {
  if (!editingTripId) return;
  if (selectedYardIds.has(yardId)) {
    await api('/flyway/trips/' + editingTripId + '/yards/' + yardId, { method: 'DELETE' });
    selectedYardIds.delete(yardId);
  } else {
    await api('/flyway/trips/' + editingTripId + '/yards', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ yard_id: yardId }) });
    selectedYardIds.add(yardId);
  }
  renderYardSelector();
  loadPlanView();
}

// ═══ CONFIRM DIALOGS ═══
function showConfirm(title, body, callback) {
  document.getElementById('confirmTitle').textContent = title;
  document.getElementById('confirmBody').textContent = body;
  confirmCallback = callback;
  document.getElementById('confirmOverlay').classList.add('open');
}
function closeConfirm() { document.getElementById('confirmOverlay').classList.remove('open'); confirmCallback = null; }
function doConfirm() { if (confirmCallback) confirmCallback(); closeConfirm(); }

function confirmActivate(tripId) {
  showConfirm('Activate Trip', 'This will mark the trip as active and enable scraping for selected yards. Continue?', async function() {
    await api('/flyway/trips/' + tripId, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'active' }) });
    switchView('active');
  });
}

function confirmDelete(tripId) {
  showConfirm('Delete Trip', 'This will permanently delete this trip and remove all yard associations. Continue?', async function() {
    await api('/flyway/trips/' + tripId, { method: 'DELETE' });
    loadPlanView();
  });
}

// ═══ ACTIVE VIEW ═══
async function loadActiveView() {
  var el = document.getElementById('activeContent');
  el.innerHTML = '<div class="loading"><div class="spinner"></div><div>Loading active trip...</div></div>';

  var data = await api('/flyway/trips?status=active');
  var trips = data.trips || [];
  if (trips.length === 0) {
    el.innerHTML = '<div class="empty">No active trip. Go to Plan tab to create and activate one.</div>';
    return;
  }

  multipleActiveTrips = trips;

  // Multiple active trips: show picker
  if (trips.length > 1 && !activeTrip) {
    renderTripPicker(trips);
    return;
  }

  // Single active trip or already selected
  if (!activeTrip) activeTrip = trips[0];
  el.innerHTML = '<div class="loading"><div class="spinner"></div><div>Scoring vehicles...</div></div>';

  activeTripData = await api('/flyway/trips/' + activeTrip.id + '/attack-list');
  renderActiveTrip();

  if (refreshTimer) clearInterval(refreshTimer);
  refreshTimer = setInterval(function() { if (currentView === 'active') refreshActiveTrip(); }, 300000);
}

function renderTripPicker(trips) {
  var el = document.getElementById('activeContent');
  var h = '<div class="trip-picker">';
  h += '<div class="trip-picker-title">Which trip are you on?</div>';
  trips.forEach(function(t) {
    var badge = tripTypeBadge(t);
    var dateDisplay = (t.trip_type === 'day_trip' || t.start_date === t.end_date) ? fmtDate(t.start_date) : fmtDateRange(t.start_date, t.end_date);
    var accentColor = tripTypeAccent(t);
    h += '<div class="trip-pick-card" onclick="selectActiveTrip(' + t.id + ')" style="border-left:3px solid ' + accentColor + '">';
    h += '<div class="pick-name">' + esc(t.name) + '</div>';
    h += '<div class="pick-dates">' + dateDisplay + '</div>';
    h += '<div class="pick-meta">' + badge + ' <span style="font-size:11px;color:var(--text-muted)">' + (t.yards || []).length + ' yards</span></div>';
    h += '<div class="pick-tap">TAP TO LOAD</div>';
    h += '</div>';
  });
  h += '</div>';
  el.innerHTML = h;
}

function selectActiveTrip(tripId) {
  activeTrip = multipleActiveTrips.find(function(t) { return t.id === tripId; });
  loadActiveView();
}

function switchTrip() {
  activeTrip = null;
  activeTripData = null;
  loadActiveView();
}

async function refreshActiveTrip() {
  if (!activeTrip) return;
  activeTripData = await api('/flyway/trips/' + activeTrip.id + '/attack-list');
  renderActiveTrip();
}

function renderActiveTrip() {
  if (!activeTrip || !activeTripData) return;
  var el = document.getElementById('activeContent');
  var trip = activeTripData.trip || activeTrip;
  var yards = activeTripData.yards || [];
  var accentColor = tripTypeAccent(trip);
  var badge = tripTypeBadge(trip);

  // Trip header
  var daysLeft = daysUntil(trip.end_date);
  var countdownText, countdownColor;
  if (daysLeft <= 0) { countdownText = 'ENDS TODAY'; countdownColor = '#ef4444'; }
  else if (daysLeft === 1) { countdownText = 'LAST DAY'; countdownColor = '#ef4444'; }
  else { countdownText = daysLeft + ' DAYS LEFT'; countdownColor = daysLeft <= 3 ? '#eab308' : '#22c55e'; }

  var dateDisplay = (trip.trip_type === 'day_trip' || trip.start_date === trip.end_date) ? fmtDate(trip.start_date) : fmtDateRange(trip.start_date, trip.end_date);

  var h = '<div class="trip-header" style="border-left:3px solid ' + accentColor + '">';
  h += '<div style="display:flex;justify-content:space-between;align-items:flex-start">';
  h += '<div><div class="trip-header-name">' + esc(trip.name) + ' ' + badge + '</div>';
  h += '<div class="trip-header-dates">' + dateDisplay + '</div>';
  h += '<div class="trip-countdown' + (daysLeft <= 0 ? ' pulse' : '') + '" style="color:' + countdownColor + '">' + countdownText + '</div>';
  h += '</div>';
  h += '<div style="display:flex;flex-direction:column;gap:4px">';
  if (multipleActiveTrips.length > 1) {
    h += '<button class="btn btn-gray btn-sm" onclick="switchTrip()" style="font-weight:700;letter-spacing:0.03em">\u21C4 SWITCH</button>';
  }
  h += '<button class="btn btn-gray btn-sm" id="scrapeBtn" onclick="triggerFlywayScrape(' + trip.id + ')">SCRAPE</button>';
  h += '<button class="btn btn-gray btn-sm" onclick="confirmComplete()">Complete</button>';
  h += '</div></div></div>';

  // Build vehicle count map from scored yards
  var yardVehicleCounts = {};
  yards.forEach(function(y) { yardVehicleCounts[y.yard.id] = y.total_vehicles || 0; });

  // Yard tabs — built from trip.yards (always complete, even with 0 vehicles)
  var tripYards = (trip.yards || []).filter(function(y) { return y.scrape_enabled !== false; });
  h += '<div class="yard-tabs">';
  h += '<div class="yard-tab' + (activeYardFilter === 'all' ? ' active' : '') + '" onclick="setYardFilter(\'all\')">ALL</div>';
  tripYards.forEach(function(y) {
    var yid = y.id;
    var count = yardVehicleCounts[yid] || 0;
    h += '<div class="yard-tab' + (activeYardFilter === yid ? ' active' : '') + '" onclick="setYardFilter(\'' + yid + '\')">' + esc(y.name.replace(/^LKQ |^Pull-A-Part /, '')) + ' <span style="color:var(--text-faint)">' + count + '</span></div>';
  });
  h += '</div>';

  // Sort/filter controls
  h += '<div class="toggle-bar">';
  h += '<button class="toggle-btn' + (sortMode === 'score' ? ' active' : '') + '" onclick="setSort(\'score\')">Score</button>';
  h += '<button class="toggle-btn' + (sortMode === 'age' ? ' active' : '') + '" onclick="setSort(\'age\')">Newest</button>';
  h += '<button class="toggle-btn' + (sortMode === 'value' ? ' active' : '') + '" onclick="setSort(\'value\')">Value</button>';
  h += '<button class="toggle-btn' + (sortMode === 'row' ? ' active' : '') + '" onclick="setSort(\'row\')" style="' + (sortMode === 'row' ? '' : '') + '">Row</button>';
  h += '<span style="color:#333">|</span>';
  h += '<button class="toggle-btn' + (filterPremium ? ' active' : '') + '" onclick="toggleFilter(\'premium\')">Premium</button>';
  h += '<button class="toggle-btn' + (filterHighValue ? ' active' : '') + '" onclick="toggleFilter(\'highvalue\')">$500+</button>';
  h += '</div>';

  // Collect all vehicles (or filter by yard)
  var allVehicles = [];
  yards.forEach(function(y) {
    (y.vehicles || []).forEach(function(v) {
      v._yardName = y.yard.name;
      v._yardId = y.yard.id;
      allVehicles.push(v);
    });
  });

  var filtered = allVehicles;
  if (activeYardFilter !== 'all') {
    filtered = filtered.filter(function(v) { return v._yardId === activeYardFilter; });
  }
  if (filterPremium) filtered = filtered.filter(function(v) { return (v.premiumFlags || []).length > 0; });
  if (filterHighValue) filtered = filtered.filter(function(v) { return (v.est_value || 0) >= 500; });

  // Sort
  if (sortMode === 'score') filtered.sort(function(a, b) { return (b.score || 0) - (a.score || 0); });
  else if (sortMode === 'age') filtered.sort(function(a, b) { return (a.daysInYard || 0) - (b.daysInYard || 0); });
  else if (sortMode === 'value') filtered.sort(function(a, b) { return (b.est_value || 0) - (a.est_value || 0); });
  else if (sortMode === 'row') filtered.sort(function(a, b) {
    var aRow = a.row_number != null ? parseInt(a.row_number, 10) : Infinity;
    var bRow = b.row_number != null ? parseInt(b.row_number, 10) : Infinity;
    if (isNaN(aRow)) aRow = Infinity;
    if (isNaN(bRow)) bRow = Infinity;
    return aRow - bRow;
  });

  // Split into top vehicles and guaranteed (rare finds)
  var topVehicles = filtered.filter(function(v) { return !v.isGuaranteedInclusion; });
  var rareFinds = filtered.filter(function(v) { return v.isGuaranteedInclusion; });

  // Status bar
  var countText = topVehicles.length + ' vehicles';
  if (rareFinds.length > 0) countText += ' + ' + rareFinds.length + ' rare finds';
  h += '<div class="status-bar"><span>' + countText + '</span>';
  h += '<span>Updated ' + (activeTripData.generated_at ? new Date(activeTripData.generated_at).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}) : 'now') + '</span></div>';

  // Vehicle list
  if (filtered.length === 0) {
    // If filtering by a specific yard, show yard metadata
    var emptyYard = activeYardFilter !== 'all' ? tripYards.find(function(y) { return y.id === activeYardFilter; }) : null;
    if (emptyYard) {
      var methodMap = { lkq: 'Local scrape (nightly)', pullapart: 'Server scrape (daily 6am UTC)', on_demand: 'Server scrape (daily 6am UTC)', carolina: 'Server scrape (daily 6am UTC)', chesterfield: 'Server scrape (daily 6am UTC)', upullandsave: 'Server scrape (daily 6am UTC)', pickapartva: 'Server scrape (daily 6am UTC)', manual: 'Manual paste only' };
      var methodDisplay = methodMap[(emptyYard.scrape_method || '').toLowerCase()] || (emptyYard.scrape_method || 'unknown');
      var lastScraped = emptyYard.last_scraped ? timeAgo(emptyYard.last_scraped) : 'Never';
      var dist = Math.round(parseFloat(emptyYard.distance_from_base) || 0);
      h += '<div class="card" style="margin-top:8px">';
      h += '<div style="font-size:15px;font-weight:700;margin-bottom:8px">' + esc(emptyYard.name) + '</div>';
      h += '<div style="font-size:12px;color:var(--text-muted);line-height:1.8">';
      h += 'Chain: ' + esc(emptyYard.chain || '?') + '<br>';
      h += 'Method: ' + esc(methodDisplay) + '<br>';
      h += 'Last scraped: ' + esc(lastScraped) + '<br>';
      h += 'Distance: ' + dist + 'mi</div>';
      h += '<div style="margin-top:12px;font-size:12px;color:var(--text-faint);line-height:1.6">No vehicles scored for this yard yet.<br>';
      h += 'Tap SCRAPE to trigger a manual scrape for non-LKQ yards.</div>';
      h += '</div>';
    } else {
      h += '<div class="empty">No vehicles above threshold. Top 50 per yard shown plus rare finds (manual, diesel, 4x4, premium, performance, cult). Road trip floor: $1,000+. Day trip floor: $600+.</div>';
    }
  } else {
    h += '<div style="margin:0 12px">';
    topVehicles.forEach(function(v) { h += renderVehicleCard(v); });
    if (rareFinds.length > 0) {
      h += '<div style="text-align:center;padding:16px 0 8px;border-top:1px solid #2a2a2a;margin-top:8px"><span style="font-size:11px;font-weight:700;letter-spacing:0.1em;color:#eab308;text-transform:uppercase">Rare Finds</span></div>';
      rareFinds.forEach(function(v) { h += renderVehicleCard(v); });
    }
    h += '</div>';
  }

  el.innerHTML = h;
}

function renderVehicleCard(v) {
  var sc = v.color_code || 'gray';
  var make = cleanModel(v.make || '', '');
  var model = cleanModel(v.model || '', v.make || '');
  var engine = v.engine ? ' <span style="font-size:12px;color:#b0b0b0;font-weight:600">' + esc(v.engine) + '</span>' : '';

  var trimBadge = '';
  if (v.trimBadge) {
    var tbColor = v.trimBadge.color === 'green' ? '#22c55e' : v.trimBadge.color === 'blue' ? '#3b82f6' : v.trimBadge.color === 'gray' ? '#374151' : '#f59e0b';
    var tbText = v.trimBadge.color === 'gray' ? '#9ca3af' : '#000';
    trimBadge = ' <span class="chip" style="font-size:9px;padding:1px 6px;background:' + tbColor + ';color:' + tbText + ';font-weight:' + (v.trimBadge.color === 'gray' ? '500' : '700') + '">' + esc(v.trimBadge.decodedTrim || v.trimBadge.label) + '</span>';
  }

  var rowNum = v.row_number ? '<span style="font-size:11px;color:var(--text-faint);float:right">Row ' + esc(v.row_number) + '</span>' : '';

  // Premium flag badges
  var badges = '';
  var pf = v.premiumFlags || [];
  pf.forEach(function(f) {
    if (f === 'PERFORMANCE') badges += '<span class="chip" style="font-size:9px;padding:1px 6px;background:#f97316;color:#000;font-weight:700">PERFORMANCE</span> ';
    if (f === 'PREMIUM') badges += '<span class="chip" style="font-size:9px;padding:1px 6px;background:#eab308;color:#000;font-weight:700">PREMIUM</span> ';
    if (f === 'CULT') badges += '<span class="chip" style="font-size:9px;padding:1px 6px;background:#d946ef;color:#000;font-weight:700">CULT</span> ';
    if (f === 'MANUAL') badges += '<span class="chip" style="font-size:9px;padding:1px 6px;background:#06b6d4;color:#000;font-weight:700">MANUAL</span> ';
    if (f === 'DIESEL') badges += '<span class="chip" style="font-size:9px;padding:1px 6px;background:#166534;color:#22c55e;font-weight:700">DIESEL</span> ';
    if (f === '4WD') badges += '<span class="chip" style="font-size:9px;padding:1px 6px;background:#16a34a;color:#000;font-weight:700">4WD</span> ';
    if (f === 'AWD') badges += '<span class="chip" style="font-size:9px;padding:1px 6px;background:#16a34a;color:#000;font-weight:700">AWD</span> ';
  });
  if (v.isGuaranteedInclusion && v.guaranteedReason) {
    badges += '<span class="chip" style="font-size:8px;padding:1px 5px;background:#78350f;color:#fbbf24;font-weight:600;letter-spacing:0.05em">RARE: ' + esc(v.guaranteedReason) + '</span> ';
  }

  // Days in yard badge
  var diy = v.daysInYard || 0;
  if (diy > 0) {
    var ageColor = diy <= 3 ? '#22c55e' : diy <= 7 ? '#eab308' : diy <= 14 ? '#f97316' : '#6B7280';
    badges += '<span style="font-size:10px;color:' + ageColor + '">' + diy + 'd</span>';
  }

  // Part type chips — names only, no dollar amounts (matches Daily Feed)
  var chipSource = v.part_chips || [];
  var chipTypes = {};
  var chips = '';
  chipSource.filter(function(p) {
    var t = p.partType || '?';
    if (chipTypes[t]) return false;
    chipTypes[t] = true;
    return true;
  }).sort(function(a, b) { return (b.price || 0) - (a.price || 0); }).slice(0, 4).forEach(function(p) {
    var price = p.price || 0;
    var cc = price >= 250 ? 'chip-green' : price >= 150 ? 'chip-yellow' : price >= 100 ? 'chip-orange' : price > 0 ? 'chip-red' : 'chip-gray';
    chips += '<span class="chip ' + cc + '">' + esc(p.partType || '?') + '</span> ';
  });

  var yardLabel = activeYardFilter === 'all' && v._yardName ? '<span style="font-size:9px;color:var(--text-faint)">' + esc(v._yardName.replace(/^LKQ |^Pull-A-Part /, '')) + '</span> ' : '';

  var h = '<div class="vehicle-row" id="vrow-' + v.id + '">';
  h += '<div class="v-collapsed" onclick="toggleV(\'' + v.id + '\')">';
  h += '<div class="v-score ' + sc + '">' + (v.score || 0) + '</div>';
  h += '<div class="v-info">';
  h += '<div class="v-title"><strong style="color:#fff">' + esc(v.year) + ' ' + esc(make) + ' ' + esc(model) + '</strong>' + engine + trimBadge + ' ' + rowNum + '</div>';
  if (badges) h += '<div class="v-badges">' + yardLabel + badges + '</div>';
  h += '<div class="v-chips">' + (chips || '<span class="chip chip-gray">No data</span>') + '</div>';
  h += '</div>';
  h += '<div class="v-right">';
  if (v.est_value > 0) h += '<div class="v-value">$' + v.est_value + '</div>';
  if (v.matched_parts > 0) h += '<div class="v-parts-count">' + v.matched_parts + ' parts</div>';
  h += '</div></div>';

  // Expanded view — loaded on demand via API
  h += '<div class="v-expanded" id="vexp-' + v.id + '">';
  h += '<div style="padding:12px 0;color:#9CA3AF;font-size:12px;">Tap to load parts...</div>';
  h += '</div>';
  h += '</div>';
  return h;
}

async function toggleV(id) {
  var exp = document.getElementById('vexp-' + id);
  if (!exp) return;

  if (exp.classList.contains('open')) {
    exp.classList.remove('open');
    return;
  }

  // Load parts on-demand via API — same as Daily Feed
  if (exp.dataset.loaded !== 'true') {
    exp.innerHTML = '<div style="padding:12px 0;color:#9CA3AF;font-size:12px;">Loading parts...</div>';
    exp.classList.add('open');

    try {
      var res = await fetch('/flyway/vehicle/' + id + '/parts');
      var data = await res.json();
      if (data.success) {
        exp.innerHTML = renderExpandedParts(id, data);
        exp.dataset.loaded = 'true';
      } else {
        exp.innerHTML = '<div style="padding:12px 0;color:#ef4444;font-size:12px;">Failed to load parts</div>';
      }
    } catch (e) {
      exp.innerHTML = '<div style="padding:12px 0;color:#ef4444;font-size:12px;">Failed to load parts</div>';
    }
  } else {
    exp.classList.add('open');
  }
}

function renderExpandedParts(vehicleId, data) {
  var parts = data.parts || [];
  if (parts.length === 0) return '<div style="padding:10px 0;color:var(--text-faint);font-size:12px">No matching parts found.</div>';

  var h = '';

  // Sort: sold first, then market, then estimates — then by display price DESC
  parts.sort(function(a, b) {
    var soldA = (a.sold_90d || 0) > 0 ? 1 : (a.marketMedian > 0 ? 2 : 3);
    var soldB = (b.sold_90d || 0) > 0 ? 1 : (b.marketMedian > 0 ? 2 : 3);
    if (soldA !== soldB) return soldA - soldB;
    var pA = (a.sold_90d > 0 && a.price > 0) ? a.price : (a.marketMedian > 0 ? a.marketMedian : a.price || 0);
    var pB = (b.sold_90d > 0 && b.price > 0) ? b.price : (b.marketMedian > 0 ? b.marketMedian : b.price || 0);
    return pB - pA;
  });

  parts.forEach(function(p) {
    var hasOurSales = (p.sold_90d || 0) > 0 && p.price > 0;
    var isEst = p.priceSource === 'estimate';
    var displayPrice = hasOurSales ? p.price : (p.marketMedian > 0 ? p.marketMedian : (p.price != null ? p.price : 0));
    var badgeVerdict = isEst && !hasOurSales && !p.marketMedian ? 'EST' : displayPrice >= 250 ? 'GREAT' : displayPrice >= 150 ? 'GOOD' : displayPrice >= 100 ? 'FAIR' : 'POOR';
    var vc = badgeVerdict === 'EST' ? 'chip-gray' : badgeVerdict === 'GREAT' ? 'chip-green' : badgeVerdict === 'GOOD' ? 'chip-cyan' : badgeVerdict === 'FAIR' ? 'chip-yellow' : 'chip-gray';
    var pricePrefix = isEst && !hasOurSales && !p.marketMedian ? '~$' : '$';

    var freshness = '';
    if (hasOurSales) {
      if (p.lastSoldDate) {
        var daysAgo = Math.floor((Date.now() - new Date(p.lastSoldDate).getTime()) / 86400000);
        freshness = daysAgo <= 30 ? '\u2705' : daysAgo <= 60 ? '\u26A0\uFE0F' : '\u274C';
      } else {
        freshness = '\u2705';
      }
    } else if (p.marketCheckedAt) {
      var daysSince = Math.floor((Date.now() - new Date(p.marketCheckedAt).getTime()) / 86400000);
      freshness = daysSince <= 60 ? '\u2705' : daysSince <= 90 ? '\u26A0\uFE0F' : '\u274C';
    } else if (p.marketMedian > 0) {
      freshness = '\u2705';
    } else {
      freshness = '\u2753';
    }

    h += '<div class="part-row" style="flex-direction:column;align-items:stretch;padding:10px 0">';
    h += '<div style="display:flex;justify-content:space-between;align-items:center">';
    h += '<div style="font-size:13px;font-weight:600">' + (p.isMarked ? '<span style="font-size:9px;font-weight:700;padding:1px 6px;border-radius:3px;background:#f59e0b;color:#000;margin-right:4px">MARKED</span>' : '') + (p.partType ? '[' + esc(p.partType) + '] ' : '') + esc(p.title || p.category || 'Part') + '</div>';
    h += '<div><span class="chip ' + vc + '" style="font-size:10px">' + badgeVerdict + ' ' + pricePrefix + displayPrice + ' ' + freshness + '</span></div>';
    h += '</div>';
    h += '<div style="font-size:11px;color:var(--text-muted);margin-top:3px;display:flex;gap:12px;flex-wrap:wrap">';
    h += '<span>' + (p.in_stock || 0) + ' in stock</span>';
    h += '<span>' + (p.sold_90d || 0) + ' sold/90d</span>';
    if (p.partNumber) h += '<span>' + esc(p.partNumber) + '</span>';
    if (isEst && !hasOurSales && !p.marketMedian) h += '<span style="color:#6B7280">est</span>';
    h += '</div>';
    if (p.reason) h += '<div style="font-size:11px;color:var(--text-muted);font-style:italic;margin-top:3px">' + esc(p.reason) + '</div>';
    if (p.marketMedian > 0) {
      var mColor = hasOurSales ? '#6B7280' : (Math.abs(displayPrice - p.marketMedian) / p.marketMedian > 0.2 ? (displayPrice > p.marketMedian ? '#ef4444' : '#eab308') : '#10B981');
      h += '<div style="font-size:11px;margin-top:3px;display:flex;gap:8px;color:#6B7280">';
      h += '<span>' + (hasOurSales ? 'Market ref' : 'Market') + '</span>';
      h += '<span style="color:' + mColor + ';font-weight:600">$' + p.marketMedian + ' med</span>';
      h += '<span>' + (p.marketCount || 0) + ' sold</span>';
      if (p.marketVelocity) h += '<span>' + p.marketVelocity.toFixed(1) + '/wk</span>';
      h += '</div>';
    }
    if (p.deadWarning && p.deadWarning.failureReason && p.deadWarning.failureReason !== 'unknown') {
      var dwText = p.deadWarning.failureReason === 'overpriced' ? 'Sat unsold \u2014 was overpriced vs market' : p.deadWarning.failureReason === 'low_demand' ? 'Sat unsold \u2014 low demand for this part' : esc(p.deadWarning.failureReason);
      h += '<div style="margin-top:4px;padding:4px 8px;background:#fee2e2;border-radius:4px;font-size:10px;color:#dc2626;font-weight:600;">' + dwText + '</div>';
    }
    h += '</div>';
  });

  // Rebuild reference
  var rebuildParts = data.rebuild_parts || [];
  if (rebuildParts.length > 0) {
    h += '<div style="margin-top:10px;padding-top:8px;border-top:2px dashed var(--border)">';
    h += '<div style="font-size:10px;font-weight:700;color:#9ca3af;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:6px">Rebuild Reference</div>';
    rebuildParts.forEach(function(p) {
      var pd = p.priceRange || ('$' + p.price);
      h += '<div style="padding:4px 0;opacity:0.6;display:flex;justify-content:space-between;font-size:11px;color:#9ca3af">';
      h += '<span>[REBUILD] ' + esc(p.seller || 'pro-rebuild') + ' \u2014 ' + esc(p.partType || 'Part') + '</span>';
      h += '<span style="font-weight:600">' + pd + '</span>';
      h += '</div>';
    });
    h += '</div>';
  }

  return h;
}

function setYardFilter(yardId) {
  activeYardFilter = yardId;
  renderActiveTrip();
}

function setSort(mode) {
  sortMode = mode;
  renderActiveTrip();
}

function toggleFilter(which) {
  if (which === 'premium') filterPremium = !filterPremium;
  if (which === 'highvalue') filterHighValue = !filterHighValue;
  renderActiveTrip();
}

// ═══ SCRAPE ═══
async function triggerFlywayScrape(tripId) {
  var btn = document.getElementById('scrapeBtn');
  if (btn) { btn.disabled = true; btn.textContent = 'Scraping...'; }
  try {
    var data = await api('/flyway/trips/' + tripId + '/scrape', { method: 'POST' });
    if (data.success) {
      showToast('Scrape started. Non-LKQ yards will update in a few minutes. LKQ yards update via nightly local scrape.');
      setTimeout(function() { loadScrapeStatus(tripId); }, 30000);
    } else {
      showToast(data.error || 'Scrape failed');
    }
  } catch (err) {
    showToast('Scrape request failed');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'SCRAPE'; }
  }
}

async function loadScrapeStatus(tripId) {
  try {
    var data = await api('/flyway/trips/' + tripId + '/scrape-status');
    if (data.success && data.status) {
      data.status.forEach(function(y) {
        var scraped = y.last_scraped ? timeAgo(y.last_scraped) : 'never';
        var badge = y.scrape_type === 'local' ? 'LOCAL' : y.scrape_type === 'manual' ? 'PASTE' : 'AUTO';
        console.log('[Flyway] ' + y.name + ': ' + badge + ' | ' + scraped + ' | ' + y.vehicle_count + ' vehicles');
      });
    }
  } catch (err) { /* silent */ }
}

function showToast(msg) {
  var el = document.createElement('div');
  el.style.cssText = 'position:fixed;bottom:20px;left:50%;transform:translateX(-50%);background:#141414;border:1px solid #2a2a2a;color:#F0F0F0;padding:10px 16px;border-radius:8px;font-size:12px;z-index:300;max-width:90vw;text-align:center';
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(function() { el.remove(); }, 5000);
}

function confirmComplete() {
  if (!activeTrip) return;
  showConfirm('Complete Trip', 'Vehicle data will be kept for 24 hours. You can reinstate the trip during that window if you complete it by accident.', async function() {
    await api('/flyway/trips/' + activeTrip.id, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'complete' }) });
    activeTrip = null;
    activeTripData = null;
    switchView('history');
  });
}

// ═══ REINSTATE ═══
async function reinstateTrip(tripId) {
  var btn = document.querySelector('[data-reinstate="' + tripId + '"]');
  if (btn) { btn.disabled = true; btn.textContent = 'Reinstating...'; }
  try {
    var data = await api('/flyway/trips/' + tripId + '/reinstate', { method: 'POST' });
    if (data.success) {
      showToast('Trip reinstated! Switching to Active view.');
      activeTrip = null;
      activeTripData = null;
      switchView('active');
    } else {
      showToast(data.error || 'Failed to reinstate trip');
      loadHistoryView();
    }
  } catch (err) {
    showToast('Failed to reinstate trip');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'REINSTATE TRIP'; }
  }
}

// ═══ HISTORY VIEW ═══
async function loadHistoryView() {
  var el = document.getElementById('historyContent');
  el.innerHTML = '<div class="loading"><div class="spinner"></div><div>Loading...</div></div>';
  var data = await api('/flyway/trips?status=complete');
  var trips = data.trips || [];

  if (trips.length === 0) {
    el.innerHTML = '<div class="empty">No completed trips yet.</div>';
    return;
  }

  var h = '';
  trips.forEach(function(t) {
    var yardNames = (t.yards || []).map(function(y) { return esc(y.name); }).join(', ') || 'No yards';
    var badge = tripTypeBadge(t);
    var dateDisplay = (t.trip_type === 'day_trip' || t.start_date === t.end_date) ? fmtDate(t.start_date) : fmtDateRange(t.start_date, t.end_date);
    h += '<div class="trip-card">';
    h += '<div class="trip-card-header"><div><div class="trip-name">' + esc(t.name) + ' ' + badge + '</div>';
    h += '<div class="trip-dates">' + dateDisplay + '</div>';
    h += '<div style="font-size:10px;color:var(--text-faint);margin-top:2px">' + (t.yards || []).length + ' yards: ' + yardNames + '</div>';
    if (t.canReinstate && t.gracePeriodRemaining > 0) {
      var hoursAgo = Math.round((24 - t.gracePeriodRemaining) * 10) / 10;
      h += '<div style="font-size:11px;color:#eab308;margin-top:6px">Completed ' + hoursAgo + 'h ago \u2014 ' + t.gracePeriodRemaining + 'h remaining</div>';
    }
    h += '</div><span class="chip chip-gray">COMPLETE</span></div>';
    if (t.canReinstate) {
      h += '<div class="trip-actions"><button class="btn btn-green btn-sm" data-reinstate="' + t.id + '" onclick="reinstateTrip(' + t.id + ')">REINSTATE TRIP</button></div>';
    }
    h += '</div>';
  });
  el.innerHTML = h;
}

// ═══ INIT ═══
async function init() {
  var hash = location.hash.replace('#', '') || '';

  var data = await api('/flyway/trips');
  allTrips = data.trips || [];
  var active = allTrips.filter(function(t) { return t.status === 'active'; });

  if (active.length > 0 && hash !== 'plan' && hash !== 'history') {
    switchView('active');
  } else if (hash === 'history') {
    switchView('history');
  } else {
    switchView('plan');
  }
}

init();
</script>
</body>
</html>
```
---
## FILE: service/public/gate.html
```javascript
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="theme-color" content="#0a0a0a">
<title>DarkHawk - NEST PROTECTOR</title>
<style>
  *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
  :root{--bg:#0a0a0a;--s:#141414;--s2:#1a1a1a;--b:#2a2a2a;--r:#DC2626;--rd:#7f1d1d;--y:#eab308;--yd:#713f12;--g:#22c55e;--gd:#064e3b;--t:#F0F0F0;--tm:#d1d5db;--tf:#6b7280}
  body{font-family:-apple-system,BlinkMacSystemFont,sans-serif;background:var(--bg);color:var(--t);min-height:100vh;padding-bottom:60px;-webkit-tap-highlight-color:transparent}

  /* Header + Nav (matches all other admin pages) */
  .top-header{background:var(--s);border-bottom:1px solid var(--b);padding:10px 16px;display:flex;align-items:center;gap:10px;position:sticky;top:0;z-index:100}
  .top-header img{height:40px;border-radius:6px;filter:drop-shadow(0 0 6px rgba(220,38,38,0.4))}
  .top-header .brand{font-size:16px;font-weight:900;letter-spacing:2px}
  .top-header .brand span{color:var(--r)}
  .top-header .sub{font-size:10px;color:var(--tf);margin-top:1px}
  nav{display:flex;gap:6px;padding:6px 14px;background:var(--bg);border-bottom:1px solid var(--b);overflow-x:auto;scrollbar-width:none;-webkit-overflow-scrolling:touch;font-size:11px}
  nav::-webkit-scrollbar{display:none}
  nav a{color:var(--tf);text-decoration:none;padding:4px 8px;border-radius:4px;white-space:nowrap;background:var(--s2)}
  nav a.active{color:var(--r);font-weight:700}

  .c{padding:12px;max-width:520px;margin:0 auto}
  .card{background:var(--s);border:1px solid var(--b);border-radius:10px;padding:14px;margin-bottom:10px}
  .card-title{font-size:10px;font-weight:700;color:var(--tf);text-transform:uppercase;letter-spacing:.08em;margin-bottom:10px}
  select{width:100%;padding:10px;background:var(--s2);border:1px solid var(--b);border-radius:8px;color:var(--t);font-size:15px;appearance:none}
  select:focus{outline:none;border-color:var(--r)}

  /* Hero summary */
  .hero{text-align:center;padding:16px 12px;border-radius:10px;margin-bottom:4px}
  .hero.green{background:var(--gd)} .hero.yellow{background:var(--yd)} .hero.red{background:var(--rd)}
  .hero .mv{font-size:13px;color:var(--tf);margin-bottom:2px}
  .hero .mv b{color:var(--tm);font-size:15px}
  .hero .target-label{font-size:11px;font-weight:600;color:var(--tm);text-transform:uppercase;letter-spacing:.05em;margin-top:8px}
  .hero .target-amount{font-size:48px;font-weight:800;letter-spacing:-.04em}
  .hero.green .target-amount{color:var(--g)} .hero.yellow .target-amount{color:var(--y)} .hero.red .target-amount{color:var(--r)}
  .hero .ceiling{font-size:13px;color:var(--tf);margin-top:4px}
  .hero .ceiling b{color:var(--y)}
  .hero .blended{font-size:13px;margin-top:6px;font-weight:700}
  .bar{height:6px;background:var(--s2);border-radius:3px;margin:8px 0 4px;overflow:hidden}
  .bar-fill{height:100%;border-radius:3px;transition:width .3s}
  .bar-labels{display:flex;justify-content:space-between;font-size:9px;color:var(--tf)}

  /* Part rows - desktop: single line. Mobile: two lines */
  .part{background:var(--s2);border:1px solid var(--b);border-radius:8px;padding:12px;margin-bottom:8px}
  .part-top{display:flex;align-items:center;gap:8px}
  .part-dot{width:12px;height:12px;border-radius:50%;flex-shrink:0}
  .part-dot.green{background:var(--g)} .part-dot.yellow{background:var(--y)} .part-dot.red{background:var(--r)}
  .part-name{font-size:14px;font-weight:600;flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .part-mv{font-size:12px;color:var(--tf);flex-shrink:0}
  .part-rm{width:28px;height:28px;border:1px solid var(--b);border-radius:6px;background:var(--s);color:var(--r);font-size:14px;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0}
  .part-bottom{display:flex;align-items:center;gap:10px;margin-top:8px;padding-top:8px;border-top:1px solid #222}
  .cogs-label{font-size:11px;color:var(--tf);flex-shrink:0}
  .cogs-input{width:70px;text-align:center;padding:10px 6px;background:var(--bg);border:2px solid var(--b);border-radius:8px;color:var(--t);font-size:18px;font-weight:700;flex-shrink:0}
  .cogs-input:focus{border-color:var(--r);outline:none}
  .part-pct{font-size:14px;font-weight:700;flex-shrink:0;margin-left:auto}
  .part-pct.green{color:var(--g)} .part-pct.yellow{color:var(--y)} .part-pct.red{color:var(--r)}
  .part-select{font-size:13px;padding:6px 8px;background:var(--s);border:1px solid var(--b);border-radius:6px;color:var(--t);flex:1;min-width:0;appearance:none}

  .add-btn{width:100%;padding:12px;background:var(--s2);border:1px dashed var(--b);border-radius:8px;color:var(--tf);font-size:13px;font-weight:600;cursor:pointer;margin-top:4px}

  /* Check Stock */
  .section-header{font-size:11px;font-weight:800;color:var(--tf);text-transform:uppercase;letter-spacing:.1em;padding:10px 14px 6px;background:var(--bg)}
  .stock-input{flex:1;padding:12px;background:var(--s2);border:1px solid var(--b);border-radius:8px;color:var(--t);font-size:16px;font-weight:600;letter-spacing:.05em}
  .stock-input:focus{outline:none;border-color:var(--r)}
  .stock-input::placeholder{color:var(--tf);font-weight:400;letter-spacing:0}
  .stock-btn{padding:12px 16px;border-radius:8px;border:none;font-size:13px;font-weight:700;cursor:pointer}
  .stock-btn:disabled{opacity:.4}
  .stock-btn.search{background:var(--r);color:#fff}
  .stock-btn.clear{background:var(--s2);color:var(--tf);border:1px solid var(--b)}
  .stock-result{margin-top:10px;border-radius:8px;padding:10px 12px}
  .stock-result.exact{background:var(--gd);border:1px solid #166534}
  .stock-result.variant{background:var(--yd);border:1px solid #854d0e}
  .stock-result.none{background:var(--s2);border:1px solid var(--b)}
  .stock-result-header{font-size:12px;font-weight:700;margin-bottom:6px}
  .stock-item{padding:6px 0;border-bottom:1px solid rgba(255,255,255,0.08);font-size:12px}
  .stock-item:last-child{border-bottom:none}
  .stock-item .si-title{font-weight:600;color:var(--t);line-height:1.3}
  .stock-item .si-meta{color:var(--tf);margin-top:2px;font-size:11px;display:flex;gap:8px}
  .stock-overstock{margin-top:6px;padding:6px 8px;background:rgba(234,179,8,0.1);border:1px solid rgba(234,179,8,0.3);border-radius:6px;font-size:11px;color:var(--y)}

  /* Breakdown */
  .brow{display:flex;justify-content:space-between;padding:7px 0;font-size:12px;border-bottom:1px solid #1f1f1f}
  .brow:last-child{border:none}
  .brow .bl{color:var(--tf)} .brow .bv{font-weight:600}

  /* Mobile: stack the bottom row items */
  @media(max-width:500px){
    .part-mv{font-size:11px}
    .hero .target-amount{font-size:42px}
  }
</style>
</head>
<body>

<div id="dh-nav"></div>
<script src="/admin/dh-nav.js?v=2"></script><script>dhNav('gate')</script>

<div class="c">
  <div class="section-header">CHECK STOCK</div>
  <div class="card">
    <div style="display:flex;gap:8px">
      <input type="text" class="stock-input" id="stockPN" placeholder="Enter part number to check stock..." autocomplete="off">
      <button class="stock-btn search" id="stockSearchBtn" onclick="checkStock()">Search</button>
      <button class="stock-btn clear" onclick="clearStock()">Clear</button>
    </div>
    <div id="stockResults"></div>
  </div>

  <div class="section-header">COGS CALCULATOR</div>
  <div class="card">
    <div class="card-title">Yard</div>
    <select id="yardSel" onchange="onYardChange()"><option value="">Loading yards...</option></select>
  </div>

  <div class="card" id="summaryCard" style="display:none">
    <div class="hero" id="hero">
      <div class="mv">Total Market Value: <b id="totalMV">$0</b></div>
      <div class="target-label">Max Parts Spend (Target)</div>
      <div class="target-amount" id="targetAmt">$0</div>
      <div class="ceiling">Absolute max: <b id="ceilingAmt">$0</b> (35% ceiling)</div>
      <div class="blended" id="blendedPct">0% COGS</div>
    </div>
    <div class="bar"><div class="bar-fill" id="barFill" style="width:0"></div></div>
    <div class="bar-labels"><span>0%</span><span style="color:var(--g)">25%</span><span style="color:var(--y)">35%</span><span>100%</span></div>
  </div>

  <div class="card">
    <div class="card-title">Parts at Register</div>
    <div id="partsList"></div>
    <button class="add-btn" onclick="addPart()">+ Add Part</button>
  </div>

  <div class="card" id="breakdownCard" style="display:none">
    <div class="card-title">Breakdown</div>
    <div id="breakdown"></div>
  </div>
</div>

<script>
let yards = [];
let yardProfile = null;
let partIdCounter = 0;

async function loadYards() {
  try {
    const r = await fetch('/cogs/yards');
    const d = await r.json();
    yards = d.yards || [];
    const sel = document.getElementById('yardSel');
    sel.innerHTML = '<option value="">Select a yard...</option>' +
      '<option value="custom">-- Custom Junkyard --</option>' +
      yards.map(y => '<option value="' + y.id + '">' + y.name + ' ($' + y.entry_fee + ' gate)</option>').join('');
  } catch(e) {
    document.getElementById('yardSel').innerHTML = '<option value="">Error loading yards</option>';
  }
}

async function onYardChange() {
  const id = document.getElementById('yardSel').value;
  if (!id) { yardProfile = null; document.getElementById('summaryCard').style.display = 'none'; document.getElementById('breakdownCard').style.display = 'none'; hideCustomYardInput(); return; }

  if (id === 'custom') {
    showCustomYardInput();
    yardProfile = {
      id: 'custom',
      name: 'Custom Junkyard',
      chain: 'custom',
      entryFee: 0,
      fixedOverhead: 0,
      cogsReference: getDefaultCogsReference(),
      defaultMarketValues: getDefaultMarketValues(),
    };
    document.getElementById('summaryCard').style.display = 'block';
    document.getElementById('breakdownCard').style.display = 'block';
    document.getElementById('partsList').innerHTML = '';
    partIdCounter = 0;
    addPart('ECM');
    addPart('BCM');
    return;
  }

  hideCustomYardInput();
  const r = await fetch('/cogs/yard-profile/' + id);
  const d = await r.json();
  if (!d.success) return;
  yardProfile = d;

  document.getElementById('summaryCard').style.display = 'block';
  document.getElementById('breakdownCard').style.display = 'block';

  document.getElementById('partsList').innerHTML = '';
  partIdCounter = 0;
  addPart('ECM');
  addPart('BCM');
}

function showCustomYardInput() {
  let el = document.getElementById('customYardWrap');
  if (!el) {
    el = document.createElement('div');
    el.id = 'customYardWrap';
    el.style.cssText = 'margin-top:10px';
    el.innerHTML = '<label style="font-size:11px;color:var(--tf);display:block;margin-bottom:4px">Yard Name (optional)</label>' +
      '<input type="text" id="customYardName" placeholder="e.g. Pull-A-Part Tampa" style="width:100%;padding:10px;background:var(--s2);border:1px solid var(--b);border-radius:8px;color:var(--t);font-size:14px" oninput="if(yardProfile)yardProfile.name=this.value||\'Custom Junkyard\'" />';
    document.getElementById('yardSel').parentNode.appendChild(el);
  }
  el.style.display = 'block';
}

function hideCustomYardInput() {
  const el = document.getElementById('customYardWrap');
  if (el) el.style.display = 'none';
}

function getDefaultCogsReference() {
  return {
    ECM: { label: 'ECM / Engine Computer', cogs: 0 },
    BCM: { label: 'BCM / Body Control', cogs: 0 },
    TCM: { label: 'TCM / Transmission Computer', cogs: 0 },
    ABS: { label: 'ABS Module', cogs: 0 },
    CLUSTER: { label: 'Instrument Cluster', cogs: 0 },
    RADIO: { label: 'Radio / Head Unit', cogs: 0 },
    AMPLIFIER: { label: 'Amplifier', cogs: 0 },
    HVAC: { label: 'HVAC Control Module', cogs: 0 },
    TPMS: { label: 'TPMS Module', cogs: 0 },
    SAS: { label: 'Steering Angle Sensor', cogs: 0 },
    OTHER: { label: 'Other Module', cogs: 0 },
  };
}

function getDefaultMarketValues() {
  return { ECM: 80, BCM: 60, TCM: 80, ABS: 50, CLUSTER: 60, RADIO: 50, AMPLIFIER: 40, HVAC: 30, TPMS: 30, SAS: 25, OTHER: 50 };
}

function getPartTypes() {
  if (!yardProfile) return [];
  return Object.entries(yardProfile.cogsReference).map(([key, val]) => ({
    type: key, label: val.label, cogs: val.cogs,
    marketValue: yardProfile.defaultMarketValues[key] || 50,
  }));
}

function addPart(defaultType) {
  partIdCounter++;
  const id = partIdCounter;
  const types = getPartTypes();
  const sel = defaultType ? types.find(t => t.type === defaultType) : types[0];
  if (!sel) return;

  const div = document.createElement('div');
  div.className = 'part';
  div.id = 'p' + id;
  div.innerHTML =
    '<div class="part-top">' +
      '<div class="part-dot green" id="dot' + id + '"></div>' +
      '<select class="part-select" id="type' + id + '" onchange="onTypeChange(' + id + ')">' +
        types.map(t => '<option value="' + t.type + '"' + (t.type === sel.type ? ' selected' : '') + ' data-cogs="' + t.cogs + '" data-mv="' + t.marketValue + '">' + t.label + '</option>').join('') +
      '</select>' +
      '<button class="part-rm" onclick="rmPart(' + id + ')">x</button>' +
    '</div>' +
    '<div class="part-bottom">' +
      '<span class="cogs-label">Market $</span>' +
      '<input type="number" class="cogs-input" id="mv' + id + '" value="' + sel.marketValue + '" min="0" step="5" inputmode="numeric" oninput="recalc()" />' +
      '<span class="cogs-label">COGS $</span>' +
      '<input type="number" class="cogs-input" id="cogs' + id + '" value="' + sel.cogs + '" min="0" step="1" inputmode="numeric" oninput="recalc()" />' +
      '<span class="part-pct green" id="pct' + id + '">0%</span>' +
    '</div>';

  document.getElementById('partsList').appendChild(div);
  recalc();
}

function onTypeChange(id) {
  const s = document.getElementById('type' + id);
  const opt = s.options[s.selectedIndex];
  document.getElementById('cogs' + id).value = opt.dataset.cogs;
  document.getElementById('mv' + id).value = opt.dataset.mv;
  recalc();
}

function rmPart(id) {
  document.getElementById('p' + id)?.remove();
  recalc();
}

function recalc() {
  if (!yardProfile) return;

  let totalMV = 0, totalCogs = 0;
  document.querySelectorAll('.part').forEach(p => {
    const id = p.id.replace('p', '');
    const mvEl = document.getElementById('mv' + id);
    const cogsEl = document.getElementById('cogs' + id);
    const pctEl = document.getElementById('pct' + id);
    const dotEl = document.getElementById('dot' + id);
    if (!mvEl || !cogsEl) return;

    const mv = parseFloat(mvEl.value) || 0;
    const cogs = parseFloat(cogsEl.value) || 0;
    totalMV += mv;
    totalCogs += cogs;

    const pct = mv > 0 ? (cogs / mv) * 100 : 0;
    pctEl.textContent = Math.round(pct) + '%';
    const c = pct <= 25 ? 'green' : pct <= 35 ? 'yellow' : 'red';
    pctEl.className = 'part-pct ' + c;
    dotEl.className = 'part-dot ' + c;
  });

  const overhead = yardProfile.fixedOverhead;
  const currentTotal = totalCogs + overhead;
  const blended = totalMV > 0 ? (currentTotal / totalMV) * 100 : 0;
  const target = Math.max(0, Math.round(totalMV * 0.30 - overhead));
  const ceiling = Math.max(0, Math.round(totalMV * 0.35 - overhead));
  const color = blended <= 25 ? 'green' : blended <= 35 ? 'yellow' : 'red';

  document.getElementById('totalMV').textContent = '$' + Math.round(totalMV);
  document.getElementById('targetAmt').textContent = ceiling <= 0 ? 'SKIP' : '$' + target;
  document.getElementById('ceilingAmt').textContent = '$' + ceiling;
  document.getElementById('blendedPct').textContent = blended.toFixed(1) + '% COGS';
  document.getElementById('blendedPct').style.color = color === 'green' ? 'var(--g)' : color === 'yellow' ? 'var(--y)' : 'var(--r)';
  document.getElementById('hero').className = 'hero ' + color;

  const fill = document.getElementById('barFill');
  fill.style.width = Math.min(100, blended) + '%';
  fill.style.background = color === 'green' ? 'var(--g)' : color === 'yellow' ? 'var(--y)' : 'var(--r)';

  document.getElementById('breakdown').innerHTML =
    '<div class="brow"><span class="bl">Gate fee</span><span class="bv">$' + yardProfile.entryFee + '</span></div>' +
    '<div class="brow"><span class="bl">Parts at register</span><span class="bv">$' + Math.round(totalCogs) + '</span></div>' +
    '<div class="brow" style="border-top:1px solid var(--b);padding-top:8px;margin-top:2px"><span class="bl" style="font-weight:600">Target (30%)</span><span class="bv" style="color:var(--g)">$' + target + '</span></div>' +
    '<div class="brow"><span class="bl" style="font-weight:600">Absolute max (35%)</span><span class="bv" style="color:var(--y)">$' + ceiling + '</span></div>' +
    '<div class="brow"><span class="bl" style="font-weight:600">Blended COGS</span><span class="bv" style="color:' + (color === 'green' ? 'var(--g)' : color === 'yellow' ? 'var(--y)' : 'var(--r)') + '">' + blended.toFixed(1) + '%</span></div>';
}

// ── CHECK STOCK ─────────────────────────────────────────────
document.getElementById('stockPN').addEventListener('keydown', function(e) {
  if (e.key === 'Enter') checkStock();
});

function checkStock() {
  var pn = document.getElementById('stockPN').value.trim();
  if (!pn || pn.length < 4) {
    document.getElementById('stockResults').innerHTML = '<div class="stock-result none"><div style="font-size:11px;color:var(--tf)">Enter at least 4 characters</div></div>';
    return;
  }
  var btn = document.getElementById('stockSearchBtn');
  btn.disabled = true; btn.textContent = 'Checking...';
  document.getElementById('stockResults').innerHTML = '';

  fetch('/cogs/check-stock?pn=' + encodeURIComponent(pn))
    .then(function(r) {
      if (!r.ok) throw new Error('Server error');
      return r.json();
    })
    .then(function(d) {
      btn.disabled = false; btn.textContent = 'Search';
      var h = '';

      if (d.totalExact > 0) {
        h += '<div class="stock-result exact">';
        h += '<div class="stock-result-header" style="color:var(--g)">\u2713 IN STOCK \u2014 ' + d.totalExact + ' exact match' + (d.totalExact > 1 ? 'es' : '') + '</div>';
        d.exact.forEach(function(item) {
          h += '<div class="stock-item">';
          h += '<div class="si-title">' + esc(item.title) + '</div>';
          h += '<div class="si-meta">';
          if (item.currentPrice) h += '<span style="color:var(--g);font-weight:700">$' + item.currentPrice.toFixed(2) + '</span>';
          h += '<span>Qty: ' + item.quantity + '</span>';
          h += '<a href="https://www.ebay.com/itm/' + esc(item.ebayItemId) + '" target="_blank" style="color:var(--tf);text-decoration:none">#' + esc(item.ebayItemId) + '</a>';
          h += '</div></div>';
        });
        h += '</div>';
      }

      if (d.totalVariants > 0) {
        h += '<div class="stock-result variant">';
        h += '<div class="stock-result-header" style="color:var(--y)">\u26A0 VARIANT' + (d.totalExact > 0 ? 'S' : ' FOUND') + ' \u2014 ' + d.totalVariants + ' similar part number' + (d.totalVariants > 1 ? 's' : '') + '</div>';
        d.variants.forEach(function(item) {
          h += '<div class="stock-item">';
          h += '<div class="si-title">' + esc(item.title) + '</div>';
          h += '<div class="si-meta">';
          if (item.currentPrice) h += '<span style="color:var(--g);font-weight:700">$' + item.currentPrice.toFixed(2) + '</span>';
          h += '<span>Qty: ' + item.quantity + '</span>';
          h += '</div>';
          if (item.variantNote) h += '<div style="font-size:10px;color:var(--y);margin-top:2px">' + esc(item.variantNote) + '</div>';
          h += '</div>';
        });
        h += '</div>';
      }

      if (d.totalExact === 0 && d.totalVariants === 0) {
        h += '<div class="stock-result none">';
        h += '<div style="font-size:13px;color:var(--tf)">No stock found for <b style="color:var(--t)">' + esc(d.searchPN) + '</b></div>';
        h += '<div style="font-size:11px;color:var(--tf);margin-top:4px">This part is not in our inventory. Safe to buy.</div>';
        h += '</div>';
      }

      if (d.overstock) {
        h += '<div class="stock-overstock">Tracked in Overstock Watch \u2014 ' + d.overstock.groupName + ' \u2014 ' + d.overstock.currentStock + ' in stock, restock at ' + d.overstock.restockTarget + '</div>';
      }

      document.getElementById('stockResults').innerHTML = h;
    })
    .catch(function(err) {
      btn.disabled = false; btn.textContent = 'Search';
      document.getElementById('stockResults').innerHTML = '<div class="stock-result none"><div style="color:var(--r);font-size:12px">Error: ' + (err.message || 'Failed') + '</div></div>';
    });
}

function clearStock() {
  document.getElementById('stockPN').value = '';
  document.getElementById('stockResults').innerHTML = '';
  document.getElementById('stockPN').focus();
}

function esc(s) { if (!s) return ''; var d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

loadYards();
</script>
</body>
</html>
```
---
## FILE: service/public/vin-scanner.html
```javascript
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="theme-color" content="#0a0a0a">
<title>DarkHawk — HAWK EYE</title>
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,sans-serif;background:#0a0a0a;color:#F0F0F0;min-height:100vh}
.container{padding:12px;max-width:600px;margin:0 auto}
.card{background:#141414;border:1px solid #2a2a2a;border-radius:10px;padding:14px;margin-bottom:10px}
.card-title{font-size:10px;font-weight:700;color:#6B7280;text-transform:uppercase;letter-spacing:0.06em;margin-bottom:8px}
.vin-input{width:100%;padding:12px;border:1px solid #333;border-radius:8px;font-size:18px;font-family:monospace;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;outline:none;background:#141414;color:#F0F0F0}
.vin-input:focus{border-color:#dc2626}
.vin-input::placeholder{color:#6B7280;font-size:13px;letter-spacing:0;font-weight:400}
.btn-row{display:flex;gap:8px;margin-top:10px}
.btn{padding:12px 16px;border-radius:8px;border:none;font-size:14px;font-weight:700;cursor:pointer}
.btn-red{background:#dc2626;color:#fff;flex:1}
.btn-red:disabled{opacity:.4}
.btn-cam{background:#1a1a1a;border:1px solid #333;font-size:20px;color:#d1d5db;padding:12px 16px}
.spinner{width:18px;height:18px;border:2px solid #333;border-top-color:#dc2626;border-radius:50%;animation:spin .7s linear infinite;display:inline-block}
@keyframes spin{to{transform:rotate(360deg)}}
.b{font-size:9px;font-weight:700;padding:2px 7px;border-radius:4px;text-transform:uppercase}
.b-gr{background:#064e3b;color:#16a34a}.b-yl{background:#713f12;color:#a16207}.b-or{background:#7c2d12;color:#c2410c}.b-rd{background:#7f1d1d;color:#dc2626}.b-gy{background:#1a1a1a;color:#9CA3AF}
table{width:100%;border-collapse:collapse;font-size:12px}
th{text-align:left;padding:5px 6px;color:#6B7280;font-size:9px;font-weight:600;text-transform:uppercase;border-bottom:1px solid #2a2a2a}
td{padding:6px;border-bottom:1px solid #1f1f1f}
.pg{color:#16a34a;font-weight:700}.py{color:#ca8a04;font-weight:700}.po{color:#ea580c;font-weight:700}.pr{color:#dc2626;font-weight:700}
.section-empty{color:#6B7280;font-size:12px;padding:10px 0;text-align:center}
.hist-link{display:block;text-align:center;padding:10px;font-size:11px;color:#6B7280;cursor:pointer;text-decoration:underline}
.h-row{display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #1f1f1f;cursor:pointer}
.h-vin{font-family:monospace;font-size:11px;font-weight:700}
.h-veh{font-size:10px;color:#9CA3AF}
.h-time{font-size:10px;color:#6B7280}
</style>
</head>
<body>
<div id="dh-nav"></div>
<script src="/admin/dh-nav.js?v=2"></script><script>dhNav('vin')</script>
<div class="container">
  <div class="card">
    <div class="card-title">Enter or Scan VIN</div>
    <input type="text" class="vin-input" id="vinInput" maxlength="17" placeholder="17-character VIN" autocomplete="off" spellcheck="false">
    <div class="btn-row">
      <button class="btn btn-cam" id="camBtn">📷</button>
      <button class="btn btn-red" id="decBtn" onclick="doScan()">Decode</button>
    </div>
    <div style="font-size:10px;color:#6B7280;margin-top:6px">Tip: check door jamb sticker if dash has glare</div>
    <div id="status" style="font-size:11px;color:#9CA3AF;margin-top:4px"></div>
  </div>
  <div id="results"></div>
  <div id="instantResearch" style="display:none">
    <div class="card" style="border-color:#dc2626;border-width:2px">
      <button onclick="runInstantResearch()" id="researchBtn" class="btn btn-red" style="width:100%;padding:14px;font-size:15px">Instant Research — What to Pull</button>
      <div id="researchResults"></div>
    </div>
  </div>
  <div class="card">
    <div class="card-title">Standalone Research</div>
    <input type="text" class="vin-input" id="researchInput" placeholder="2011 Toyota Sequoia 5.7L" style="font-size:14px;letter-spacing:0">
    <div class="btn-row">
      <button class="btn btn-red" id="standaloneBtn" onclick="runStandaloneResearch()" style="flex:1">Research Vehicle</button>
    </div>
    <div id="standaloneResults"></div>
  </div>
  <div id="histArea"><span class="hist-link" onclick="loadHistory(this)">Show Recent Scans</span></div>
</div>
<script>
function esc(s){if(!s)return '';var d=document.createElement('div');d.textContent=s;return d.innerHTML;}
var V=document.getElementById('vinInput');
V.focus();
V.addEventListener('keydown',function(e){if(e.key==='Enter')doScan()});

// Camera photo processing — Image+canvas, resize aggressively for mobile memory
async function processVinPhoto(file) {
  try {
    var url = URL.createObjectURL(file);
    var img = new Image();
    await new Promise(function(resolve, reject) { img.onload = resolve; img.onerror = function() { reject(new Error('Failed to load image')); }; img.src = url; });
    // Resize to max 1280px on longest side — enough for VIN reading
    var MAX_DIM = 1280;
    var w = img.naturalWidth, h = img.naturalHeight;
    if (w > MAX_DIM || h > MAX_DIM) {
      if (w > h) { h = Math.round(h * (MAX_DIM / w)); w = MAX_DIM; }
      else { w = Math.round(w * (MAX_DIM / h)); h = MAX_DIM; }
    }
    var canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    var ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, w, h);
    URL.revokeObjectURL(url); img.src = '';
    var b64 = canvas.toDataURL('image/jpeg', 0.7).split(',')[1];
    // If still too large (>1.5MB base64), reduce further
    if (b64.length > 1500000) {
      canvas.width = Math.round(w * 0.5); canvas.height = Math.round(h * 0.5);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      b64 = canvas.toDataURL('image/jpeg', 0.5).split(',')[1];
    }
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    canvas.width = 1; canvas.height = 1;
    return b64;
  } catch(err) {
    throw new Error('Could not process photo: ' + err.message);
  }
}

document.getElementById('camBtn').onclick=function(){
  var inp=document.createElement('input');
  inp.type='file';inp.accept='image/*';inp.capture='environment';
  inp.onchange=async function(e){
    var file=e.target.files[0];if(!file)return;
    document.getElementById('status').textContent='Reading VIN from photo...';
    document.getElementById('results').innerHTML='<div class="card" style="text-align:center;padding:16px"><div class="spinner"></div><div style="margin-top:6px;color:#6B7280;font-size:12px">Processing...</div></div>';
    try{
      var b64=await processVinPhoto(file);
      var r=await fetch('/vin/decode-photo',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({image:b64})}).then(function(r){return r.json()});
      b64=null;
      if(r.vin&&r.vin!=='UNREADABLE'&&r.vin.length>=11){
        V.value=r.vin;document.getElementById('status').textContent='VIN read: '+r.vin;doScan('camera');
      }else{
        document.getElementById('status').textContent='Could not read VIN. Try closer.';
        document.getElementById('results').innerHTML='<div class="card" style="text-align:center;color:#dc2626;font-weight:600">Could not read VIN<div style="color:#9CA3AF;font-size:12px;font-weight:400;margin-top:4px">Avoid glare, get closer, or try door jamb sticker.</div></div>';
      }
    }catch(err){
      document.getElementById('status').textContent='Error: '+err.message;
      document.getElementById('results').innerHTML='<div class="card" style="color:#dc2626">Error: '+err.message+'</div>';
    }
  };
  inp.click();
};

function doScan(src){
  var vin=V.value.trim().toUpperCase().replace(/[^A-HJ-NPR-Z0-9]/g,'');
  if(vin.length<11){document.getElementById('results').innerHTML='<div class="card" style="color:#dc2626;font-size:13px">Enter at least 11 characters</div>';return;}
  var btn=document.getElementById('decBtn');btn.disabled=true;btn.innerHTML='<div class="spinner" style="margin:0 auto"></div>';
  document.getElementById('results').innerHTML='<div class="card" style="text-align:center;padding:16px"><div class="spinner"></div><div style="margin-top:6px;color:#6B7280;font-size:12px">Decoding...</div></div>';
  fetch('/vin/scan',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({vin:vin,source:src||'manual'})})
  .then(function(r){return r.json()})
  .then(function(data){if(!data.success)throw new Error(data.error);render(data);})
  .catch(function(err){document.getElementById('results').innerHTML='<div class="card" style="color:#dc2626">Error: '+err.message+'</div>';})
  .finally(function(){btn.disabled=false;btn.textContent='Decode';});
}

function vd(v){return v>=250?'GREAT':v>=150?'GOOD':v>=100?'FAIR':'POOR'}
function vc(v){return v==='GREAT'?'b-gr':v==='GOOD'?'b-yl':v==='FAIR'?'b-or':'b-rd'}
function pc(v){return v>=250?'pg':v>=150?'py':v>=100?'po':'pr'}
function ta(ds){if(!ds)return'-';var m=Math.floor((Date.now()-new Date(ds).getTime())/60000);if(m<1)return'now';if(m<60)return m+'m';var h=Math.floor(m/60);if(h<24)return h+'h';return Math.floor(h/24)+'d'}

function render(data){
  var d=data.decoded||{},sh=data.salesHistory||[],cs=data.currentStock||[],mr=data.marketRef||[];
  var h='';
  // Vehicle header
  var hl=[d.year,d.make,data.baseModel||d.model].filter(Boolean).join(' ');
  var sp=[d.engine,d.engineType&&d.engineType!=='Gas'?d.engineType:null,d.drivetrain,d.trim].filter(Boolean).join(' · ');
  h+='<div class="card"><div style="font-size:20px;font-weight:900;letter-spacing:-0.03em">'+hl+'</div>';
  if(sp)h+='<div style="font-size:12px;font-weight:600;color:#d1d5db;margin-top:2px">'+sp+'</div>';
  h+='<div style="font-family:monospace;font-size:13px;color:#16a34a;font-weight:700;margin-top:4px">'+data.vin+'</div></div>';

  // Build unified parts list
  var pm={};
  sh.forEach(function(s){if(s.partType)pm[s.partType]={pt:s.partType,sold:s.sold,avg:s.avgPrice,last:s.lastSoldDate,title:s.sampleTitle,stk:0,mprice:0};});
  cs.forEach(function(c){if(!c.partType)return;if(pm[c.partType])pm[c.partType].stk=c.inStock;else pm[c.partType]={pt:c.partType,sold:0,avg:0,last:null,title:null,stk:c.inStock,mprice:c.avgPrice};});
  mr.filter(function(m){return!m.isRebuild&&m.partType}).forEach(function(m){
    if(pm[m.partType]){pm[m.partType].mprice=m.avgPrice;if(!pm[m.partType].stk)pm[m.partType].stk=m.inStock||0;}
    else pm[m.partType]={pt:m.partType,sold:m.yourSold||0,avg:m.yourAvg||m.avgPrice,last:null,title:null,stk:m.inStock||0,mprice:m.avgPrice};
  });

  var parts=[];
  for(var k in pm){var p=pm[k];if(p.pt&&p.pt!=='OTHER'&&p.pt!=='null'&&(p.avg>0||p.mprice>0||p.sold>0))parts.push(p);}
  parts.sort(function(a,b){return(b.avg||b.mprice)-(a.avg||a.mprice)});
  var tot=0;

  h+='<div class="card"><div class="card-title">Parts Intelligence</div>';
  if(parts.length>0){
    parts.forEach(function(p){
      var price=p.avg||p.mprice||0;var v=vd(price);tot+=price;
      var badge='';
      if(p.stk===0&&p.sold>=2)badge='<span class="b b-gr" style="font-size:9px">PULL THIS</span> ';
      else if(p.stk===0&&p.sold>=1)badge='<span class="b b-yl" style="font-size:9px">NEED</span> ';
      else if(p.stk>0)badge='<span class="b b-gy" style="font-size:9px">'+p.stk+' stk</span> ';
      var fresh='';if(p.last){var da=Math.floor((Date.now()-new Date(p.last).getTime())/86400000);fresh=da<=60?'✅':da<=90?'⚠️':'❌';}
      h+='<div style="padding:8px 0;border-bottom:1px solid #1f1f1f">';
      h+='<div style="display:flex;align-items:center;gap:5px;flex-wrap:wrap">'+badge+'<span class="b '+vc(v)+'">'+v+' $'+price+'</span> '+fresh+' <span style="font-size:13px;font-weight:700">['+p.pt+']</span></div>';
      if(p.title)h+='<div style="font-size:11px;color:#d1d5db;margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+(p.title||'').substring(0,65)+'</div>';
      h+='<div style="font-size:10px;color:#9CA3AF;margin-top:2px">'+p.stk+' in stock · '+p.sold+'x sold · Last '+ta(p.last)+'</div>';
      h+='</div>';
    });
  }else{h+='<div class="section-empty">No parts data for this vehicle yet</div>';}
  h+='</div>';

  // Est. Haul Value
  if(tot>0){
    var vc2=tot>=800?'#16a34a':tot>=500?'#ca8a04':tot>=250?'#ea580c':'#dc2626';
    h+='<div class="card" style="text-align:center"><div style="font-size:11px;color:#6B7280;text-transform:uppercase;letter-spacing:0.06em">Est. Haul Value</div><div style="font-size:28px;font-weight:800;color:'+vc2+';margin-top:2px">$'+tot+'</div>';
    var pc2=parts.filter(function(p){return p.stk===0&&p.sold>=2}).length;
    if(pc2>0)h+='<div style="font-size:11px;color:#16a34a;margin-top:2px">'+pc2+' part'+(pc2>1?'s':'')+' we need</div>';
    h+='</div>';
  }

  // Rebuild reference
  var rb=mr.filter(function(m){return m.isRebuild&&m.partType});
  if(rb.length>0){
    h+='<div class="card" style="opacity:0.5"><div class="card-title">Rebuild Reference</div>';
    rb.forEach(function(p){h+='<div style="display:flex;justify-content:space-between;padding:3px 0;font-size:11px;color:#6B7280"><span>[REBUILD] '+(p.sellers||[]).join(', ')+' — '+p.partType+'</span><span>'+(p.priceRange||'$'+p.avgPrice)+'</span></div>';});
    h+='</div>';
  }

  // Sales history — collapsed
  var vsh=sh.filter(function(p){return p.partType&&p.partType!=='OTHER'});
  if(vsh.length>0){
    h+='<div class="card"><details><summary style="cursor:pointer;font-size:10px;font-weight:700;color:#6B7280;text-transform:uppercase;letter-spacing:0.06em">Sales History ('+vsh.reduce(function(s,p){return s+p.sold},0)+' sold)</summary>';
    h+='<table style="margin-top:8px"><tr><th>Part</th><th>Sold</th><th>Avg $</th><th>Last</th></tr>';
    vsh.forEach(function(p){h+='<tr><td style="font-weight:600">'+p.partType+'</td><td>'+p.sold+'x</td><td class="'+pc(p.avgPrice)+'">$'+p.avgPrice+'</td><td style="font-size:10px;color:#9CA3AF">'+ta(p.lastSoldDate)+'</td></tr>';});
    h+='</table></details></div>';
  }

  // Scan Another
  h+='<div style="padding:0 0 12px"><button class="btn btn-red" style="width:100%;padding:12px;font-size:14px;" onclick="V.value=\'\';V.focus();document.getElementById(\'results\').innerHTML=\'\';document.getElementById(\'instantResearch\').style.display=\'none\';">Scan Another</button></div>';
  document.getElementById('results').innerHTML=h;

  // Auto-run instant research — show our data immediately
  var veh=[d.year,d.make,data.baseModel||d.model].filter(Boolean).join(' ');
  window._lastVehicle=veh;
  window._lastYear=d.year;window._lastMake=d.make;window._lastModel=data.baseModel||d.model;
  window._lastEngine=d.engine||null;
  window._lastDrivetrain=d.drivetrain||null;
  window._lastVin=data.vin||null;
  document.getElementById('instantResearch').style.display='block';
  document.getElementById('researchResults').innerHTML='';
  // Auto-trigger research
  runInstantResearch();
}

var _lastVehicle=null;
var _lastYear=null;var _lastMake=null;var _lastModel=null;
var _lastEngine=null;
var _lastDrivetrain=null;
var _lastVin=null;
async function runInstantResearch(){
  if(!_lastVehicle)return;
  var btn=document.getElementById('researchBtn');
  var out=document.getElementById('researchResults');
  btn.disabled=true;btn.textContent='Researching parts...';
  out.innerHTML='<div style="text-align:center;padding:16px"><div class="spinner"></div><div style="margin-top:6px;color:#6B7280;font-size:12px">Looking up parts for '+esc(_lastVehicle)+(_lastEngine?' '+esc(_lastEngine):'')+'...</div></div>';
  try{
    var url='/api/instant-research?vehicle='+encodeURIComponent(_lastVehicle+(_lastEngine?' '+_lastEngine:''));
    if(_lastDrivetrain)url+='&drivetrain='+encodeURIComponent(_lastDrivetrain);
    var r=await fetch(url).then(function(r){return r.json()});
    if(!r.parts||r.parts.length===0){
      out.innerHTML='<div style="color:#6B7280;font-size:12px;padding:10px;text-align:center">No parts data found for this vehicle</div>';
    }else{
      var h='<div style="margin-top:10px">';
      h+='<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px"><div style="font-size:10px;font-weight:700;color:#6B7280;text-transform:uppercase;letter-spacing:0.06em">Parts Intelligence'+(r.cached?' (cached)':'')+'</div>';
      if(r.totalEstimatedValue)h+='<div style="font-size:12px;font-weight:700;color:#22c55e">Est. $'+Math.round(r.totalEstimatedValue)+'</div>';
      h+='</div>';
      r.parts.forEach(function(p){
        var bc=p.badge==='GREAT'?'b-gr':p.badge==='GOOD'?'b-yl':p.badge==='FAIR'?'b-or':'b-rd';
        var bestPrice=p.market&&p.market.source==='cache'?p.market.avgPrice:p.yourDemand&&p.yourDemand.avgPrice>0?p.yourDemand.avgPrice:p.referencePrice||0;
        var yrLabel=p.yearRange?(p.yearRange.min===p.yearRange.max?p.yearRange.min:p.yearRange.min+'-'+p.yearRange.max):'';
        h+='<div style="padding:8px 0;border-bottom:1px solid #1f1f1f">';
        h+='<div style="display:flex;align-items:center;gap:5px;flex-wrap:wrap">';
        if(p.isMarked)h+='<span style="font-size:9px;font-weight:700;padding:1px 6px;border-radius:3px;background:#f59e0b;color:#000">MARKED</span>';
        h+='<span class="b '+bc+'">'+p.badge+(bestPrice>0?' $'+Math.round(bestPrice):'')+'</span>';
        h+='<span style="font-size:13px;font-weight:700">['+esc(p.partType)+']</span>';
        if(yrLabel)h+='<span style="font-size:10px;color:#6B7280">('+yrLabel+')</span>';
        h+='</div>';
        var demandStr=p.yourDemand&&p.yourDemand.salesCount>0?'Sold '+p.yourDemand.salesCount+'x @ avg $'+p.yourDemand.avgPrice+(p.yourDemand.lastSoldDate?' (last: '+ta(p.yourDemand.lastSoldDate)+')':''):'<span style="color:#6B7280">Never sold by us</span>';
        h+='<div style="font-size:10px;margin-top:2px">'+demandStr+'</div>';
        var stockStr=p.yourStock&&p.yourStock.count>0?p.yourStock.count+' in stock'+(p.yourStock.prices.length>0?' @ $'+p.yourStock.prices[0]:''):'<span style="color:#ef4444">Out of stock</span>';
        h+='<div style="font-size:10px;margin-top:1px">'+stockStr+'</div>';
        if(p.market&&p.market.source==='cache')h+='<div style="font-size:10px;margin-top:1px;color:#22c55e">Market avg $'+Math.round(p.market.avgPrice)+' ('+p.market.soldCount90d+' sold/90d)</div>';
        else h+='<div style="font-size:10px;margin-top:1px;color:#6B7280;font-style:italic">No market data available</div>';
        if(p.partNumberBase)h+='<div style="font-size:9px;color:#6B7280;margin-top:1px;font-family:monospace">'+esc(p.partNumberBase)+'</div>';
        h+='</div>';
      });
      h+='</div>';
      // Check if results are thin — show prominent "Research on eBay" button
      var richParts=r.parts?r.parts.filter(function(p){return p.yourDemand&&p.yourDemand.salesCount>0}):[];
      var isThin=!r.parts||r.parts.length<3||richParts.length===0;
      h+='<div id="apifyResearchArea" style="margin-top:8px;text-align:center">';
      if(isThin){
        h+='<div style="color:#eab308;font-size:11px;font-weight:600;margin-bottom:6px">Our data is thin for this vehicle — '+(r.parts?r.parts.length:0)+' parts found</div>';
        h+='<button onclick="runApifyResearch(\'VIN\')" id="apifyBtn" style="width:100%;padding:14px;border-radius:8px;border:2px solid #eab308;background:#422006;color:#eab308;font-size:15px;font-weight:700;cursor:pointer;font-family:inherit">🔍 Research on eBay (Apify)</button>';
      }else{
        h+='<button onclick="runApifyResearch(\'VIN\')" id="apifyBtn" style="padding:10px 16px;border-radius:8px;border:1px solid #333;background:#1a1a1a;color:#9CA3AF;font-size:12px;font-weight:600;cursor:pointer;font-family:inherit">🔍 Deeper eBay Research</button>';
      }
      h+='<div id="apifyResults"></div></div>';
      out.innerHTML=h;
    }
  }catch(err){
    out.innerHTML='<div style="color:#dc2626;font-size:12px;padding:10px">Research failed: '+err.message+'</div>';
  }
  btn.disabled=false;btn.textContent='Instant Research — What to Pull';
}

async function runStandaloneResearch(){
  var inp=document.getElementById('researchInput');
  var v=inp.value.trim();if(!v)return;
  // Parse year/make/model from input
  var vm=v.match(/^(\d{4})\s+(\S+)\s+(.+?)(?:\s+(\d+\.\d+L?.*))?$/);
  if(vm){_lastYear=parseInt(vm[1]);_lastMake=vm[2];_lastModel=vm[3].trim();_lastEngine=vm[4]||null;}
  _lastVehicle=v;_lastVin=null;
  var btn=document.getElementById('standaloneBtn');
  var out=document.getElementById('standaloneResults');
  btn.disabled=true;btn.textContent='Checking our data...';
  out.innerHTML='<div style="text-align:center;padding:16px"><div class="spinner"></div><div style="margin-top:6px;color:#6B7280;font-size:12px">Looking up '+esc(v)+' in our database...</div></div>';
  try{
    var r=await fetch('/api/instant-research?vehicle='+encodeURIComponent(v)).then(function(r){return r.json()});
    if(r.error){out.innerHTML='<div style="color:#dc2626;padding:10px;font-size:12px">'+esc(r.error)+'</div>';return;}
    var h='';
    var hasParts=r.parts&&r.parts.length>0;
    var richParts=hasParts?r.parts.filter(function(p){return p.yourDemand&&p.yourDemand.salesCount>0}):[];
    var isThin=!hasParts||r.parts.length<3||richParts.length===0;
    if(hasParts){
      h+='<div style="margin-top:10px">';
      if(r.totalValue)h+='<div style="display:flex;gap:10px;margin-bottom:8px;flex-wrap:wrap"><div style="background:#1a1a1a;border:1px solid #2a2a2a;border-radius:6px;padding:6px 10px;flex:1;text-align:center"><div style="font-size:9px;color:#6B7280;text-transform:uppercase">Total Value</div><div style="font-size:18px;font-weight:800;color:#22c55e">$'+r.totalValue+'</div></div><div style="background:#1a1a1a;border:1px solid #2a2a2a;border-radius:6px;padding:6px 10px;flex:1;text-align:center"><div style="font-size:9px;color:#6B7280;text-transform:uppercase">Est. Profit</div><div style="font-size:18px;font-weight:800;color:#22c55e">$'+r.totalProfit+'</div></div><div style="background:#1a1a1a;border:1px solid #2a2a2a;border-radius:6px;padding:6px 10px;flex:1;text-align:center"><div style="font-size:9px;color:#6B7280;text-transform:uppercase">Parts to Pull</div><div style="font-size:18px;font-weight:800;color:#dc2626">'+(r.pullCount||0)+'</div></div></div>';
      r.parts.forEach(function(p){
        var bc=p.badge==='GREAT'?'b-gr':p.badge==='GOOD'?'b-yl':p.badge==='FAIR'?'b-or':'b-rd';
        h+='<div style="padding:8px 0;border-bottom:1px solid #1f1f1f;display:flex;align-items:flex-start;gap:8px">';
        h+='<div style="font-size:16px;flex-shrink:0">'+(p.verdictIcon||'')+'</div>';
        h+='<div style="flex:1"><div style="display:flex;align-items:center;gap:5px;flex-wrap:wrap"><span class="b '+bc+'">'+p.badge+' $'+p.avgPrice+'</span><span style="font-size:13px;font-weight:700">['+esc(p.partType)+']</span></div>';
        h+='<div style="font-size:10px;color:#9CA3AF;margin-top:2px">'+p.soldCount+'x sold · $'+p.estProfit+' profit · ~$'+p.cogs+' cost · '+p.velocity+'</div>';
        if(p.partNumbers&&p.partNumbers.length>0)h+='<div style="font-size:9px;color:#6B7280;margin-top:1px;font-family:monospace">'+p.partNumbers.slice(0,3).join(', ')+'</div>';
        h+='</div><div style="font-weight:800;color:'+(p.verdict==='PULL'?'#22c55e':p.verdict==='RARE'?'#a855f7':'#9CA3AF')+';font-size:11px;white-space:nowrap">'+p.verdict+'</div></div>';
      });
      h+='</div>';
    }else{
      h+='<div style="color:#6B7280;padding:10px;font-size:12px;text-align:center">No parts data in our database for this vehicle'+(r.cached?' (cached)':'')+'</div>';
    }
    // Always show Apify button — prominent when thin, subtle when rich
    h+='<div style="margin-top:10px;text-align:center">';
    if(isThin){
      h+='<div style="color:#eab308;font-size:11px;font-weight:600;margin-bottom:6px">'+(hasParts?'Our data is thin — only '+r.parts.length+' parts found':'No data in our database — try eBay')+'</div>';
      h+='<button onclick="runApifyResearch(\'STANDALONE\')" style="width:100%;padding:14px;border-radius:8px;border:2px solid #eab308;background:#422006;color:#eab308;font-size:15px;font-weight:700;cursor:pointer;font-family:inherit">🔍 Research on eBay (Apify)</button>';
    }else{
      h+='<button onclick="runApifyResearch(\'STANDALONE\')" style="padding:10px 16px;border-radius:8px;border:1px solid #333;background:#1a1a1a;color:#9CA3AF;font-size:12px;font-weight:600;cursor:pointer;font-family:inherit">🔍 Deeper eBay Research (Apify)</button>';
    }
    h+='<div id="standaloneApifyResults"></div></div>';
    out.innerHTML=h;
  }catch(err){out.innerHTML='<div style="color:#dc2626;font-size:12px;padding:10px">Error: '+err.message+'</div>';}
  btn.disabled=false;btn.textContent='Research Vehicle';
}
document.getElementById('researchInput').addEventListener('keydown',function(e){if(e.key==='Enter')runStandaloneResearch()});

async function runApifyResearch(source) {
  if (!_lastYear || !_lastMake || !_lastModel) {
    alert('No vehicle data — decode a VIN or enter a vehicle first');
    return;
  }
  var outId = source === 'VIN' ? 'apifyResults' : 'standaloneApifyResults';
  var out = document.getElementById(outId);
  if (!out) return;
  out.innerHTML = '<div style="text-align:center;padding:16px"><div class="spinner"></div><div style="margin-top:6px;color:#eab308;font-size:12px;font-weight:600">Researching on eBay via Apify...</div><div style="color:#6B7280;font-size:10px;margin-top:2px">This takes 30-60 seconds</div></div>';

  try {
    var r = await fetch('/api/instant-research/apify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        year: _lastYear, make: _lastMake, model: _lastModel,
        engine: _lastEngine || null, trim: null,
        source: source, vin: _lastVin || null,
      }),
    }).then(function(r) { return r.json(); });

    if (!r.success) {
      out.innerHTML = '<div style="color:#dc2626;padding:10px;font-size:12px">' + esc(r.error || 'Research failed') + '</div>';
      return;
    }

    if (r.cached) {
      out.innerHTML = '<div style="color:#6B7280;font-size:10px;margin-bottom:6px">Cached results (researched within 7 days)</div>';
    } else {
      out.innerHTML = '';
    }

    var parts = r.parts || [];
    if (parts.length === 0) {
      out.innerHTML += '<div style="color:#6B7280;padding:10px;font-size:12px;text-align:center">No sellable parts found on eBay</div>';
      return;
    }

    var h = '<div style="margin-top:6px">';
    // Summary
    var s = r.summary || {};
    if (s.totalEstimatedValue) {
      var vc2 = s.totalEstimatedValue >= 800 ? '#22c55e' : s.totalEstimatedValue >= 400 ? '#eab308' : '#9CA3AF';
      h += '<div style="display:flex;gap:8px;margin-bottom:8px">';
      h += '<div style="flex:1;background:#1a1a1a;border:1px solid #2a2a2a;border-radius:6px;padding:6px 8px;text-align:center"><div style="font-size:9px;color:#6B7280;text-transform:uppercase">Est. Value</div><div style="font-size:16px;font-weight:800;color:' + vc2 + '">$' + Math.round(s.totalEstimatedValue) + '</div></div>';
      h += '<div style="flex:1;background:#1a1a1a;border:1px solid #2a2a2a;border-radius:6px;padding:6px 8px;text-align:center"><div style="font-size:9px;color:#6B7280;text-transform:uppercase">Parts</div><div style="font-size:16px;font-weight:800">' + s.partsFoundCount + '</div></div>';
      h += '<div style="flex:1;background:#1a1a1a;border:1px solid #2a2a2a;border-radius:6px;padding:6px 8px;text-align:center"><div style="font-size:9px;color:#6B7280;text-transform:uppercase">High Value</div><div style="font-size:16px;font-weight:800;color:#22c55e">' + (s.highValueCount || 0) + '</div></div>';
      h += '</div>';
    }

    // Parts list
    parts.forEach(function(p) {
      var tierColor = p.valueTier === 'HIGH' ? '#22c55e' : p.valueTier === 'MEDIUM' ? '#eab308' : '#6B7280';
      var tierBg = p.valueTier === 'HIGH' ? '#064e3b' : p.valueTier === 'MEDIUM' ? '#422006' : '#1f2937';
      h += '<div style="padding:8px 0;border-bottom:1px solid #1f1f1f">';
      h += '<div style="display:flex;align-items:center;gap:5px;flex-wrap:wrap">';
      h += '<span style="font-size:9px;font-weight:700;padding:2px 7px;border-radius:4px;background:' + tierBg + ';color:' + tierColor + '">' + p.valueTier + ' $' + p.avgSoldPrice + '</span>';
      h += '<span style="font-size:13px;font-weight:700">[' + esc(p.partType) + ']</span>';
      h += '</div>';
      h += '<div style="font-size:10px;color:#9CA3AF;margin-top:2px">' + p.soldCount + 'x sold · $' + p.minPrice + '-$' + p.maxPrice + ' range</div>';
      if (p.partNumbers && p.partNumbers.length > 0) h += '<div style="font-size:9px;color:#6B7280;margin-top:1px;font-family:monospace">' + p.partNumbers.slice(0, 3).join(', ') + '</div>';
      h += '</div>';
    });

    h += '</div>';
    // Sky Watch save status
    h += '<div style="text-align:center;padding:8px;font-size:11px;margin-top:4px">';
    if (s.highValueCount >= 1 || s.partsFoundCount >= 3) {
      h += '<span style="color:#22c55e;font-weight:600">✓ Saved to Sky Watch</span> · <a href="/admin/opportunities" style="color:#eab308;text-decoration:none">View →</a>';
    } else {
      h += '<span style="color:#6B7280">Results too thin to save (' + s.partsFoundCount + ' parts found)</span>';
    }
    h += ' · Enriched market_demand_cache with ' + parts.reduce(function(n, p) { return n + (p.partNumbers ? p.partNumbers.length : 0); }, 0) + ' PNs';
    h += '</div>';
    out.innerHTML += h;
  } catch (err) {
    out.innerHTML = '<div style="color:#dc2626;padding:10px;font-size:12px">Apify research failed: ' + esc(err.message) + '</div>';
  }
}

function loadHistory(el){
  if(el)el.textContent='Loading...';
  fetch('/vin/history?limit=10').then(function(r){return r.json()}).then(function(d){
    if(!d.success||!d.scans||!d.scans.length){document.getElementById('histArea').innerHTML='<div class="section-empty">No scans yet</div>';return;}
    var h='<div class="card"><div class="card-title">Recent Scans</div>';
    d.scans.forEach(function(s){
      var v=[s.year,s.make,s.model].filter(Boolean).join(' ');
      var eng=s.engine?' · '+s.engine:'';
      var dt=s.drivetrain?' · '+s.drivetrain:'';
      h+='<div class="h-row" onclick="V.value=\''+s.vin+'\';doScan()"><div><div class="h-vin">'+s.vin+'</div><div class="h-veh">'+(v||'Unknown')+'<span style="color:#6B7280;font-weight:400">'+eng+dt+'</span></div></div><div><div class="h-time">'+ta(s.scanned_at)+'</div></div></div>';
    });
    h+='</div>';
    document.getElementById('histArea').innerHTML=h;
  }).catch(function(){document.getElementById('histArea').innerHTML='<div class="section-empty">Could not load history</div>';});
}
</script>
</body>
</html>
```
---
## FILE: service/config/trim-tier-config.js
```javascript
'use strict';

/**
 * TRIM TIER CONFIGURATION
 *
 * Three tiers control how trim-dependent parts are scored:
 *   PREMIUM (1.0x) - Score all parts normally
 *   CHECK   (0.5x) - Puller verifies on-site
 *   BASE    (0.0x) - Suppress trim-dependent part scores
 *
 * If trim not found, default = CHECK (0.5x)
 */

const TIER = { PERFORMANCE: 1.3, PREMIUM: 1.0, CHECK: 0.5, BASE: 0.0 };

const TRIM_DEPENDENT_PARTS = [
  'amplifier', 'amp', 'premium radio', 'camera', 'parking sensor',
  'blind spot', 'heated seat', 'cooled seat', 'ventilated seat',
  'power liftgate', 'power running board', 'heads up display',
  'premium cluster', 'lane departure', 'adaptive cruise',
  'wireless charging', 'power folding mirror', 'memory seat',
  'surround view', 'trailer brake controller', 'panoramic sunroof',
];

const UNIVERSAL_PARTS = [
  'ecm', 'ecu', 'pcm', 'bcm', 'tcm', 'abs', 'tipm',
  'fuse box', 'fuse relay', 'throttle body', 'throttle',
  'steering module', 'steering control', 'power steering',
  'airbag', 'hvac', 'climate control', 'ignition',
  'window regulator', 'window motor', 'door lock', 'seat belt', 'wiper',
];

const TRIM_TIERS = {
  // BASE
  'xl': TIER.BASE, 's': TIER.BASE, 'work truck': TIER.BASE,
  'express': TIER.BASE, 'tradesman': TIER.BASE, 'st': TIER.CHECK,
  'willys': TIER.BASE, 'special service': TIER.BASE, 'hfe': TIER.BASE,
  'enforcer': TIER.BASE, 'l': TIER.BASE, 'le': TIER.BASE, 'ce': TIER.BASE,
  'dx': TIER.BASE, 'lx': TIER.BASE, 'lx-s': TIER.BASE, 'lx-p': TIER.BASE,
  'ls': TIER.BASE, 'wt': TIER.BASE, 'fleet': TIER.BASE,
  'value edition': TIER.BASE, 'blue': TIER.BASE, 'es': TIER.BASE,
  'gls': TIER.BASE,
  // CHECK
  'xlt': TIER.CHECK, 'se': TIER.CHECK, 'sel': TIER.CHECK, 'sxt': TIER.CHECK,
  'sport': TIER.CHECK, 'titanium': TIER.CHECK, 'ssv': TIER.CHECK,
  'slt': TIER.CHECK, 'big horn': TIER.CHECK, 'lone star': TIER.CHECK,
  'rt': TIER.CHECK, 'r/t': TIER.CHECK, 'gt': TIER.CHECK, 'touring': TIER.CHECK,
  'latitude': TIER.CHECK, 'altitude': TIER.CHECK, 'trailhawk': TIER.CHECK,
  'sahara': TIER.CHECK, 'laredo': TIER.CHECK,
  'xle': TIER.CHECK, 'xse': TIER.CHECK, 'sr5': TIER.CHECK,
  'trd sport': TIER.CHECK, 'trd off-road': TIER.CHECK,
  'ex': TIER.CHECK, 'ex-l': TIER.CHECK,
  'lt': TIER.CHECK, 'z71': TIER.CHECK, 'rst': TIER.CHECK, 'at4': TIER.CHECK,
  'trail boss': TIER.CHECK, 'custom': TIER.CHECK,
  'sv': TIER.CHECK, 'n line': TIER.CHECK, 'sx': TIER.CHECK,
  'preferred': TIER.CHECK, 'select': TIER.CHECK,
  'pursuit': TIER.CHECK, 'daytona': TIER.CHECK,
  'eco': TIER.CHECK, 'gl': TIER.CHECK,
  'outdoorsman': TIER.CHECK, 'sr': TIER.CHECK,
  // PREMIUM
  'lariat': TIER.PREMIUM, 'king ranch': TIER.PREMIUM,
  'platinum': TIER.PREMIUM, 'limited': TIER.PREMIUM,
  'raptor': TIER.PREMIUM, 'tremor': TIER.PREMIUM,
  'laramie': TIER.PREMIUM, 'laramie limited': TIER.PREMIUM,
  'laramie longhorn': TIER.PREMIUM, 'longhorn': TIER.PREMIUM,
  'rebel': TIER.PREMIUM, 'citadel': TIER.PREMIUM,
  'overland': TIER.PREMIUM, 'summit': TIER.PREMIUM,
  'rubicon': TIER.PREMIUM, 'srt': TIER.PREMIUM,
  'srt 392': TIER.PREMIUM, 'srt hellcat': TIER.PREMIUM,
  'high altitude': TIER.PREMIUM, 'trackhawk': TIER.PREMIUM,
  'trd pro': TIER.PREMIUM, '1794': TIER.PREMIUM, 'capstone': TIER.PREMIUM,
  'elite': TIER.PREMIUM, 'type r': TIER.PREMIUM,
  'ltz': TIER.PREMIUM, 'high country': TIER.PREMIUM,
  'denali': TIER.PREMIUM, 'premier': TIER.PREMIUM, 'at4x': TIER.PREMIUM,
  'sl': TIER.PREMIUM, 'calligraphy': TIER.PREMIUM,
  'grand touring': TIER.PREMIUM, 'signature': TIER.PREMIUM,
  'f sport': TIER.PREMIUM, 'luxury': TIER.PREMIUM,
  'premium': TIER.PREMIUM, 'prestige': TIER.PREMIUM,
  'sho': TIER.PREMIUM,
};

const MAKE_TRIM_OVERRIDES = {
  ram:    { 'st': TIER.BASE, 'sport': TIER.CHECK, 'outdoorsman': TIER.CHECK },
  honda:  { 'touring': TIER.PREMIUM },
  acura:  { 'touring': TIER.PREMIUM },
  subaru: { 'premium': TIER.CHECK, 'touring': TIER.PREMIUM, 'base': TIER.BASE },
  mazda:  { 'sport': TIER.BASE, 'gt': TIER.PREMIUM },
  nissan: { 'sv': TIER.CHECK, 'sr': TIER.CHECK },
  toyota: { 'sr': TIER.BASE },
};

const PREMIUM_BRANDS = [
  'lexus', 'acura', 'infiniti', 'cadillac', 'lincoln',
  'bmw', 'mercedes', 'mercedes-benz', 'audi', 'volvo',
  'buick', 'porsche', 'jaguar', 'land rover', 'mini',
];

function getTrimTier(make, trim) {
  if (!trim || !trim.trim()) {
    return { tier: 'CHECK', multiplier: TIER.CHECK, badge: 'CHECK TRIM', color: 'yellow' };
  }
  const makeLower = (make || '').toLowerCase().trim();
  const trimLower = trim.toLowerCase().trim();
  const isPremiumBrand = PREMIUM_BRANDS.includes(makeLower);

  let result = null;

  if (makeLower && MAKE_TRIM_OVERRIDES[makeLower]) {
    const override = MAKE_TRIM_OVERRIDES[makeLower][trimLower];
    if (override !== undefined) result = tierToResult(override);
  }
  if (!result && TRIM_TIERS[trimLower] !== undefined) result = tierToResult(TRIM_TIERS[trimLower]);

  if (!result) {
    const sortedKeys = Object.keys(TRIM_TIERS).sort((a, b) => b.length - a.length);
    for (const key of sortedKeys) {
      const pattern = new RegExp(`\\b${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
      if (pattern.test(trimLower)) {
        if (makeLower && MAKE_TRIM_OVERRIDES[makeLower]?.[key] !== undefined) {
          result = tierToResult(MAKE_TRIM_OVERRIDES[makeLower][key]);
        } else {
          result = tierToResult(TRIM_TIERS[key]);
        }
        break;
      }
    }
  }

  if (!result) result = { tier: 'CHECK', multiplier: TIER.CHECK, badge: 'CHECK TRIM', color: 'yellow' };

  // Premium brand floor: never fully suppress trim-dependent parts
  if (isPremiumBrand && result.tier === 'BASE') {
    result = { tier: 'CHECK', multiplier: TIER.CHECK, badge: 'CHECK TRIM', color: 'yellow' };
  }

  return result;
}

function isTrimDependent(partType) {
  if (!partType) return false;
  const pt = partType.toLowerCase().trim();
  for (const universal of UNIVERSAL_PARTS) { if (pt.includes(universal)) return false; }
  for (const dep of TRIM_DEPENDENT_PARTS) { if (pt.includes(dep)) return true; }
  return false;
}

function getPartScoreMultiplier(make, trim, partType) {
  if (!isTrimDependent(partType)) {
    return { multiplier: 1.0, reason: 'universal', badge: null };
  }
  const { tier, multiplier, badge, color } = getTrimTier(make, trim);
  return { multiplier, reason: `trim-dependent (${tier})`, badge, color };
}

function tierToResult(multiplier) {
  if (multiplier === TIER.PERFORMANCE) return { tier: 'PERFORMANCE', multiplier: 1.3, badge: 'PERFORMANCE', color: 'orange' };
  if (multiplier === TIER.PREMIUM) return { tier: 'PREMIUM', multiplier: 1.0, badge: 'PREMIUM TRIM', color: 'green' };
  if (multiplier === TIER.BASE) return { tier: 'BASE', multiplier: 0.0, badge: 'BASE TRIM', color: 'red' };
  return { tier: 'CHECK', multiplier: 0.5, badge: 'CHECK TRIM', color: 'yellow' };
}

module.exports = {
  TRIM_TIERS, MAKE_TRIM_OVERRIDES, TRIM_DEPENDENT_PARTS, UNIVERSAL_PARTS,
  PREMIUM_BRANDS, TIER, getTrimTier, isTrimDependent, getPartScoreMultiplier,
};
```
---
## FILE: service/models/TrimValueValidation.js
```javascript
'use strict';

const BaseModel = require('./BaseModel');

class TrimValueValidation extends BaseModel {
  static get tableName() {
    return 'trim_value_validation';
  }

  static get idColumn() {
    return 'id';
  }
}

module.exports = TrimValueValidation;
```
---
