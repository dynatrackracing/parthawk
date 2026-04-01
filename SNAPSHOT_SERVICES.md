# DARKHAWK SERVICES — 2026-04-01

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
