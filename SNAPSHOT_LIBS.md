# DARKHAWK LIBS & CONFIG — 2026-04-01

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
