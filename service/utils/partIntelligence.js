/**
 * partIntelligence.js — Unified matching engine for DarkHawk
 *
 * ONE module for: PN extraction, stock counting, model matching, year parsing.
 * Used by: DAILY FEED, HAWK EYE, BONE PILE, HUNTERS PERCH, SCOUT ALERTS.
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
  if (/^\d{7,10}[A-Z]{2}$/.test(pn)) return pn.slice(0, -2);
  if (/^[A-Z]\d{7,9}[A-Z]{2}$/.test(pn)) return pn.slice(0, -2);
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
