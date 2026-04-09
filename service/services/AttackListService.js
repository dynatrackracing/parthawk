'use strict';

const { log } = require('../lib/logger');
const { database } = require('../database/database');
const { getPlatformMatches } = require('../lib/platformMatch');
const { extractPartNumbers: piExtractPNs, vehicleYearMatchesPart: piYearMatch, modelMatches: piModelMatches, parseYearRange: piParseYearRange, stripRevisionSuffix: piStripSuffix } = require('../utils/partIntelligence');
const { getPartScoreMultiplier } = require('../config/trim-tier-config');
const { daysSinceSetET, setDateLabel, hoursSinceLastScrape } = require('../utils/dateHelpers');
const { classifyPowertrain } = require('../lib/LocalVinDecoder');
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
  const t = (title || '').toUpperCase();
  // Complete engines & internals
  if (/\b(ENGINE|MOTOR) ASSEMBLY\b/.test(t)) return true;
  if (/\b(LONG|SHORT) BLOCK\b/.test(t)) return true;
  if (/\b(COMPLETE|CRATE|REMAN) ENGINE\b/.test(t)) return true;
  if (/\bENGINE BLOCK\b/.test(t)) return true;
  if (/\bCYLINDER HEAD\b/.test(t)) return true;
  if (/\b(PISTON|CRANKSHAFT|CONNECTING ROD|HEAD GASKET)\b/.test(t)) return true;
  if (/\b(OIL PAN|TIMING CHAIN|TIMING BELT|ROCKER ARM|LIFTER|PUSHROD)\b/.test(t)) return true;
  if (/\b(OIL PUMP|FLYWHEEL|FLEXPLATE)\b/.test(t)) return true;
  // Complete transmissions (NOT modules — TCM is sellable)
  if (/\b(TRANSMISSION|TRANSAXLE) ASSEMBLY\b/.test(t)) return true;
  if (/\b(COMPLETE|REMAN) TRANSMISSION\b/.test(t)) return true;
  // Body panels
  if (/\bFENDER\b/.test(t)) return true;
  if (/\bBUMPER (COVER|ASSEMBLY)\b/.test(t)) return true;
  if (/\bHOOD PANEL\b/.test(t)) return true;
  if (/\bDOOR SHELL\b/.test(t)) return true;
  if (/\b(QUARTER|ROCKER) PANEL\b/.test(t)) return true;
  if (/\b(BED SIDE|TRUCK BED|TRUNK LID|ROOF PANEL)\b/.test(t)) return true;
  // Airbags/SRS — not sellable (clock springs ARE sellable, don't catch here)
  if (/\b(AIRBAG|AIR\s*BAG)\b/.test(t)) return true;
  if (/\bSRS\s*(MODULE|SENSOR|UNIT)\b/.test(t)) return true;
  if (/\bSUPPLEMENTAL\s*RESTRAINT\b/.test(t)) return true;
  return false;
}

/**
 * Extract trim/engine/transmission specifics from a part title.
 * Returns null if no specifics detected, otherwise { trim, forcedInduction, transmission, diesel }.
 */
function extractPartSpecifics(title) {
  if (!title) return null;
  const t = title.toUpperCase();
  let trim = null, forcedInduction = null, transmission = null, diesel = false;

  // Performance trim indicators — word-boundary to avoid false positives
  // "ST" needs careful handling: must be word boundary, not inside "STEERING", "START", "STOCK" etc.
  if (/\bST\b/.test(t) && !/STEER|START|STOCK|STABIL|STANDARD|STRUT|STRAP|STATOR/.test(t)) trim = 'ST';
  if (/\b(RS)\b/.test(t) && !/SENSOR/.test(t)) trim = 'RS';
  if (/\bSS\b/.test(t)) trim = 'SS';
  if (/\bSRT[- ]?[0-9]*\b/.test(t)) trim = 'SRT';
  if (/\bTYPE[- ]?[RS]\b/.test(t)) trim = t.match(/TYPE[- ]?([RS])/)[0].replace(/[- ]/g, ' ');
  if (/\b(SI)\b/.test(t) && !/SIGNAL|SILICON|SIDE|SIT/.test(t)) trim = 'Si';
  if (/\bTRD\b/.test(t)) trim = 'TRD';
  if (/\bNISMO\b/.test(t)) trim = 'Nismo';
  if (/\bAMG\b/.test(t)) trim = 'AMG';
  if (/\bSHELBY\b/.test(t)) trim = 'Shelby';
  if (/\bRAPTOR\b/.test(t)) trim = 'Raptor';
  if (/\bTRAIL BOSS\b/.test(t)) trim = 'Trail Boss';
  if (/\bZR2\b/.test(t)) trim = 'ZR2';
  if (/\bS[- ]?LINE\b/.test(t)) trim = 'S-Line';
  if (/\bR[- ]?LINE\b/.test(t)) trim = 'R-Line';
  // GT: only flag when paired with specific makes (Ford, VW, Pontiac) — too generic otherwise
  if (/\bGT\b/.test(t) && /\b(MUSTANG|FOCUS|GOLF|GTO|PONTIAC)\b/.test(t)) trim = 'GT';

  // Forced induction indicators
  if (/\bECOBOOST\b/.test(t)) forcedInduction = 'EcoBoost';
  else if (/\bTWIN\s*TURBO\b/.test(t)) forcedInduction = 'Twin Turbo';
  else if (/\bTURBOCHARGED\b/.test(t)) forcedInduction = 'Turbocharged';
  else if (/\bSUPERCHARGED?\b/.test(t)) forcedInduction = 'Supercharged';
  else if (/\bTFSI\b/.test(t)) forcedInduction = 'TFSI';
  else if (/\bTSI\b/.test(t) && !/TRANSMIS/.test(t)) forcedInduction = 'TSI';
  // "2.0T" or "1.5T" pattern — T suffix means turbo
  else if (/\b\d+\.\d[T]\b/.test(t)) forcedInduction = 'Turbo';
  // Bare "TURBO" — but not "TURBO TIMER", "TURBOCHARGER" (the actual turbo part itself is generic)
  else if (/\bTURBO\b/.test(t) && !/TURBOCHARGER|TURBO TIMER|TURBO ACTUATOR|TURBO WASTEGATE/.test(t)) forcedInduction = 'Turbo';

  // Transmission indicators
  if (/\bMANUAL TRANS(MISSION)?\b/.test(t)) transmission = 'manual';
  else if (/\bMT\b/.test(t) && /TRANS|CLUTCH|SHIFT|GEAR/.test(t)) transmission = 'manual';
  else if (/\bDCT\b/.test(t) || /\bDUAL CLUTCH\b/.test(t) || /\bPOWERSHIFT\b/.test(t)) transmission = 'automatic';
  else if (/\bCVT\b/.test(t) && !/BOOT/.test(t)) transmission = 'automatic';
  else if (/\bAUTOMATIC TRANS(MISSION)?\b/.test(t)) transmission = 'automatic';

  // Diesel indicators
  if (/\bDIESEL\b/.test(t)) diesel = true;
  if (/\bTDI\b/.test(t)) diesel = true;
  if (/\bDURAMAX\b/.test(t)) diesel = true;
  if (/\bCUMMINS\b/.test(t)) diesel = true;
  if (/\bPOWER\s*STROKE\b/.test(t)) diesel = true;
  if (/\bECODIESEL\b/.test(t)) diesel = true;

  if (!trim && !forcedInduction && !transmission && !diesel) return null;
  return { trim, forcedInduction, transmission, diesel };
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

// CONSERVATIVE_SELL_ESTIMATES removed — was producing misleading data.
// Price chain: market_demand_cache → Item.price (frozen reference) → no price.

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

// Compound model → base model(s) for fuzzy matching.
// Returns array of model names to try (in order).
// NEVER collapse protected pairs (Cherokee≠Grand Cherokee, Transit≠Transit Connect, Caravan≠Grand Caravan).
const COMPOUND_MODEL_MAP = {
  'f-250 super duty': ['f-250 super duty', 'f-250', 'f250'],
  'f-350 super duty': ['f-350 super duty', 'f-350', 'f350'],
  'f-450 super duty': ['f-450 super duty', 'f-450'],
  'f-550 super duty': ['f-550 super duty', 'f-550'],
  'e-350 super duty': ['e-350 super duty', 'e-350', 'e350'],
  'explorer sport trac': ['explorer sport trac', 'explorer'],
  'explorer sport': ['explorer sport', 'explorer'],
  'grand cherokee l': ['grand cherokee l', 'grand cherokee'],
  'wrangler unlimited': ['wrangler unlimited', 'wrangler'],
  'f250 super duty': ['f250 super duty', 'f-250', 'f250'],
  'f350 super duty': ['f350 super duty', 'f-350', 'f350'],
};

// Get all model variants to try for a given vehicle model
function getModelVariants(model) {
  if (!model) return [model];
  const lower = model.toLowerCase().replace(/[-]/g, ' ').replace(/\s+/g, ' ').trim();
  const mapped = COMPOUND_MODEL_MAP[lower];
  if (mapped) return mapped;
  // Also try dash/no-dash variants for F-series
  const noDash = lower.replace(/-/g, '');
  const withDash = lower.replace(/^(f)(\d)/i, '$1-$2');
  const variants = [lower];
  if (noDash !== lower) variants.push(noDash);
  if (withDash !== lower && withDash !== noDash) variants.push(withDash);
  return variants;
}

/**
 * Normalize a make name to canonical Auto-table form. Case-insensitive.
 */
function normalizeMake(make) {
  if (!make) return null;
  const lower = make.toLowerCase().trim();
  return MAKE_ALIASES[lower] || null;
}

/**
 * Part category price floors — electronic parts below these thresholds aren't worth pulling
 * after COGS, fees, and labor. Parts not listed have NO floor (mechanical/low-COGS items).
 */
const PART_PRICE_FLOORS = {
  'ABS': 150, 'ECU': 100, 'ECM': 100, 'TCM': 100, 'BCM': 100,
  'TIPM': 100, 'CLUSTER': 100, 'RADIO': 100, 'THROTTLE': 100,
  'AMP': 100, 'AMPLIFIER': 100, 'HVAC': 100,
  'NAV': 100, 'CAMERA': 100,
};

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
  if (t.includes('RADIO') || t.includes('HEAD UNIT') || t.includes('INFOTAINMENT') || t.includes('STEREO') || t.includes('RECEIVER')) return 'RADIO';
  if (t.includes('THROTTLE')) return 'THROTTLE';
  if (t.includes('STEERING') || t.includes('EPS')) return 'STEERING';
  if (t.includes('TRANSFER CASE') || t.includes('XFER CASE')) return null; // never pull these
  if (t.includes('WINDOW') && (t.includes('REGULATOR') || t.includes('MOTOR'))) return 'REGULATOR';
  if (t.includes('MIRROR')) return 'MIRROR';
  if (t.includes('SUNROOF') || t.includes('MOONROOF') || t.includes('MOON ROOF') || t.includes('SUN ROOF')) return 'SUNROOF';
  if (t.includes('FUEL PUMP DRIVER') || t.includes('FUEL PUMP MODULE') || t.includes('FUEL PUMP CONTROL')) return 'FUEL_MODULE';
  // Extended part types — reduce OTHER chips
  if (t.includes('CAMERA') || t.includes('BACKUP CAM') || t.includes('MONOCULAR')) return 'CAMERA';
  if ((t.includes('CLIMATE') || t.includes('HVAC') || t.includes('HEATER')) && t.includes('CONTROL')) return 'HVAC';
  if (t.includes('HEADLIGHT') || t.includes('HEAD LIGHT') || t.includes('XENON') || t.includes('HID')) return 'HEADLIGHT';
  if (t.includes('TAIL LIGHT') || t.includes('TAILLIGHT') || t.includes('TAIL LAMP')) return 'TAILLIGHT';
  if (t.includes('BLIND SPOT') || t.includes('RADAR')) return 'BLIND_SPOT';
  if (t.includes('PARK ASSIST') || t.includes('PARKING SENSOR')) return 'PARK_SENSOR';
  if (t.includes('AIR RIDE') || t.includes('AIR SUSPENSION') || t.includes('SUSPENSION COMP')) return 'AIR_RIDE';
  if (t.includes('CLOCK SPRING') || t.includes('CLOCKSPRING')) return 'CLOCK_SPRING';
  if (t.includes('DOOR LOCK') || t.includes('LATCH') || t.includes('KEYLESS ENTRY')) return 'LOCK';
  if (t.includes('IGNITION') || t.includes('KEY') || t.includes('IMMOBILIZER')) return 'IGNITION';
  if ((t.includes('LIFTGATE') || t.includes('TAILGATE') || t.includes('HATCH')) && (t.includes('MOTOR') || t.includes('MODULE') || t.includes('ACTUATOR'))) return 'LIFTGATE';
  if (t.includes('HMI') || t.includes('HUMAN INTERFACE') || t.includes('MULTIMEDIA')) return 'HMI';
  if (t.includes('SAM') && t.includes('MODULE')) return 'SAM';
  if (t.includes('SEAT BELT') || t.includes('SEATBELT') || t.includes('PRETENSIONER')) return 'SEAT_BELT';
  if (t.includes('ALTERNATOR')) return 'ALTERNATOR';
  if (t.includes('STARTER')) return 'STARTER';
  if (t.includes('BLOWER MOTOR')) return 'BLOWER';
  if (t.includes('NAVIGATION') || (t.includes('NAV') && t.includes('MODULE'))) return 'NAV';
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
   * Batch load scout alert signals for a set of yard vehicles.
   * Returns Map: "year|make|model|yardName" → maxMatchScore.
   */
  async loadScoutAlertSignals(yardName) {
    const signals = new Map();
    try {
      const rows = await database('scout_alerts')
        .where('match_score', '>=', SCOUT_ALERT_TIER_THRESHOLD)
        .where('yard_name', yardName)
        .select('vehicle_year', 'vehicle_make', 'vehicle_model')
        .max('match_score as max_score')
        .groupBy('vehicle_year', 'vehicle_make', 'vehicle_model');
      for (const r of rows) {
        const key = [r.vehicle_year, (r.vehicle_make || '').toUpperCase(), (r.vehicle_model || '').toUpperCase()].join('|');
        signals.set(key, parseInt(r.max_score) || 0);
      }
    } catch (e) { /* scout_alerts may not exist */ }
    return signals;
  }

  /**
   * Generate attack list for a specific yard.
   * Returns ALL scored vehicles sorted by score descending.
   */
  async getAttackList(yardId, options = {}) {
    const { daysBack = 90 } = options;

    this.log.info({ yardId, daysBack }, 'Generating attack list');

    const vehicles = await database('yard_vehicle')
      .where('yard_id', yardId)
      .where('active', true)
      .orderBy('date_added', 'desc');

    if (!vehicles.length) {
      return { vehicles: [], scored_at: new Date().toISOString(), total: 0 };
    }

    const inventoryIndex = await this.buildInventoryIndex();
    const cutoff = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000);
    const salesIndex = await this.buildSalesIndex(cutoff);
    const { byMakeModel: stockIdx, byPartNumber: stockPNs } = await this.buildStockIndex();
    const _blockedSvc = require('./BlockedCompsService');
    const { soldKeys: _soldKeys } = await _blockedSvc.getBlockedSet();

    const scored = vehicles.map(v =>
      this.scoreVehicle(v, inventoryIndex, salesIndex, stockIdx, {}, stockPNs, undefined, undefined, undefined, _soldKeys)
    );
    // Sort: highest total extractable value first, max single part tiebreaker
    scored.sort((a, b) => {
      const valDiff = (b.est_value || 0) - (a.est_value || 0);
      if (valDiff !== 0) return valDiff;
      return (b.max_part_value || 0) - (a.max_part_value || 0);
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

      // Load blocked comps set to exclude from match pool
      const blockedComps = require('./BlockedCompsService');
      const { compIds: blockedCompIds } = await blockedComps.getBlockedSet();

      for (const row of rows) {
        if (blockedCompIds.has(String(row.itemId))) continue; // Blocked comp — skip entirely

        const key = `${row.make.toLowerCase()}|${row.model.toLowerCase()}|${row.year}`;
        if (!index[key]) {
          index[key] = { items: [], count: 0, totalValue: 0, avgPrice: 0 };
        }
        const entry = index[key];
        if (!entry.items.some(i => i.itemId === row.itemId)) {
          const isRebuild = row.seller === 'pro-rebuild' || row.isRepair === true;
          // Price chain: market_demand_cache → Item.price (frozen reference) → no price
          const resolved = row.manufacturerPartNumber ? cacheIndex.get(row.manufacturerPartNumber) : null;
          let effectivePrice, priceSource;
          if (resolved && resolved.price > 0 && resolved.source !== 'none') {
            effectivePrice = resolved.price;
            priceSource = resolved.source; // 'market_cache'
          } else if (parseFloat(row.price) > 0) {
            effectivePrice = parseFloat(row.price);
            priceSource = 'item_reference';
          } else {
            effectivePrice = 0;
            priceSource = 'none';
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
          if (!isRebuild || (row.title && /\b(ECM|ECU|PCM|ENGINE\s*CONTROL)\b/i.test(row.title))) {
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
        .select('title', 'salePrice', 'soldDate', 'extractedMake', 'extractedModel', 'partType as cpPartType');

      for (const sale of sales) {
        const title = (sale.title || '');
        const price = parseFloat(sale.salePrice) || 0;

        // Use Clean Pipe columns first, title parsing fallback
        let make = sale.extractedMake || null;
        if (!make) {
          const titleLower = title.toLowerCase();
          for (const [alias, canonical] of Object.entries(MAKE_ALIASES)) {
            if (titleLower.includes(alias)) { make = canonical; break; }
          }
        }
        if (!make) continue;

        let model = sale.extractedModel || null;
        if (!model) model = this.extractModelFromTitle(title, make);
        if (!model) continue;

        const partType = (sale.cpPartType && sale.cpPartType !== 'OTHER') ? sale.cpPartType : (detectPartType(title) || 'OTHER');
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
    const range = piParseYearRange(title);
    if (!range) return { start: 0, end: 0 };
    return { start: range.start, end: range.end };
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
        .select('title', 'sku', 'quantityAvailable', 'partNumberBase', 'extractedMake', 'extractedModel');

      const { normalizePartNumber } = require('../lib/partNumberUtils');

      for (const listing of listings) {
        const qty = parseInt(listing.quantityAvailable) || 1;
        const title = listing.title || '';

        // Index by make|model — use Clean Pipe columns first, title parsing fallback
        let make = listing.extractedMake || null;
        if (!make) {
          const titleLower = title.toLowerCase();
          for (const [alias, canonical] of Object.entries(MAKE_ALIASES)) {
            if (titleLower.includes(alias)) { make = canonical; break; }
          }
        }
        if (make) {
          let model = listing.extractedModel || null;
          if (!model) model = this.extractModelFromTitle(title, make);
          if (model) {
            const key = `${make.toLowerCase()}|${model.toLowerCase()}`;
            byMakeModel[key] = (byMakeModel[key] || 0) + qty;
          }
        }

        // Index by part number — dedup: each listing contributes qty ONCE per unique PN
        // Also track full raw PNs per base key for exact vs base match detection
        const pnsForListing = new Set();
        const fullPNsForListing = new Set(); // raw full PNs before base normalization

        if (listing.partNumberBase && listing.partNumberBase.length >= 5) {
          pnsForListing.add(listing.partNumberBase.toUpperCase());
        }
        if (listing.sku) {
          const base = normalizePartNumber(listing.sku);
          if (base && base.length >= 5) pnsForListing.add(base.toUpperCase());
          fullPNsForListing.add(listing.sku.toUpperCase().replace(/[\s.\-]/g, ''));
        }
        const pns = piExtractPNs(title);
        for (const pn of pns) {
          if (pn.base && pn.base.length >= 5) pnsForListing.add(pn.base.toUpperCase());
          fullPNsForListing.add(pn.normalized);
        }

        for (const pn of pnsForListing) {
          if (!byPartNumber[pn]) byPartNumber[pn] = { total: 0, fullPNs: new Set() };
          byPartNumber[pn].total += qty;
          for (const fpn of fullPNsForListing) byPartNumber[pn].fullPNs.add(fpn);
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
    // Try all model variants (e.g. "F-250 Super Duty" → also try "F-250", "F250")
    const candidates = [];
    const modelVariants = getModelVariants(model);
    for (const m of allMakes) {
      for (let y = year - 1; y <= year + 1; y++) {
        for (const mv of modelVariants) {
          const key = `${m.toLowerCase()}|${mv}|${y}`;
          const match = inventoryIndex[key];
          if (match) {
            for (const item of match.items) {
              if (!candidates.some(p => p.itemId === item.itemId)) candidates.push(item);
            }
          }
        }
      }
    }

    // Bidirectional fuzzy model match with ±1 year if no exact hits
    if (candidates.length === 0) {
      const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const makesLower = allMakes.map(m => m.toLowerCase());
      for (const mv of modelVariants) {
        const mvNorm = mv.replace(/[-]/g, ' ').trim();
        const mvRe = new RegExp('\\b' + esc(mvNorm) + '\\b', 'i');
        for (const [key, entry] of Object.entries(inventoryIndex)) {
          const [iMake, iModel, iYear] = key.split('|');
          const iYearNum = parseInt(iYear);
          if (iYearNum < year - 1 || iYearNum > year + 1) continue;
          if (!makesLower.includes(iMake)) continue;
          const iModelNorm = iModel.replace(/[-]/g, ' ').trim();
          // Direction 1: vehicle model regex against inventory model
          const dir1 = mvRe.test(iModelNorm);
          // Direction 2: inventory model regex against vehicle model
          const iRe = new RegExp('\\b' + esc(iModelNorm) + '\\b', 'i');
          const dir2 = iRe.test(mvNorm);
          if (dir1 || dir2) {
            for (const item of entry.items) {
              if (!candidates.some(p => p.itemId === item.itemId)) candidates.push(item);
            }
          }
        }
        if (candidates.length > 0) break; // stop trying variants once we find matches
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
  scoreVehicle(vehicle, inventoryIndex, salesIndex, stockIndex, platformIndex = {}, stockPartNumbers = {}, markIndex = { byPN: new Map(), byTitle: new Set() }, intelIndex = { wantPNs: new Set(), flagPNs: new Set() }, frequencyMap = {}, soldKeys = new Set()) {
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
    // Try all model variants for compound models (F-250 Super Duty → also try F-250)
    const candidateKeys = new Set();
    const salesModelVariants = getModelVariants(model);
    for (const m of allMakes) {
      for (const mv of salesModelVariants) {
        const exactKey = `${m.toLowerCase()}|${mv}`;
        if (salesIndex[exactKey]) candidateKeys.add(exactKey);
      }
      // Bidirectional fuzzy: check each sales model against each vehicle model variant
      for (const sKey of Object.keys(salesIndex)) {
        if (!sKey.startsWith(m.toLowerCase() + '|')) continue;
        const sModel = sKey.split('|')[1];
        if (!sModel) continue;
        for (const mv of salesModelVariants) {
          if (piModelMatches(sModel, mv) || piModelMatches(mv, sModel)) {
            candidateKeys.add(sKey);
            break;
          }
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

    // Current stock from YourListing — match by make+model using model variants
    let stock = 0;
    const stockModelVariants = getModelVariants(model);
    const seenStockKeys = new Set();
    for (const m of allMakes) {
      // Exact keys for all model variants
      for (const mv of stockModelVariants) {
        const stockKey = `${m.toLowerCase()}|${mv}`;
        if (stockIndex[stockKey] && !seenStockKeys.has(stockKey)) {
          stock += stockIndex[stockKey];
          seenStockKeys.add(stockKey);
        }
      }
      // Bidirectional fuzzy for edge cases
      const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      for (const mv of stockModelVariants) {
        const mvNorm = mv.replace(/[-]/g, ' ').trim();
        const mvRe = new RegExp('\\b' + esc(mvNorm) + '\\b', 'i');
        for (const [sk, sv] of Object.entries(stockIndex)) {
          if (seenStockKeys.has(sk)) continue;
          if (!sk.startsWith(m.toLowerCase() + '|')) continue;
          const sModel = sk.split('|')[1];
          const sModelNorm = (sModel || '').replace(/[-]/g, ' ').trim();
          const iRe = new RegExp('\\b' + esc(sModelNorm) + '\\b', 'i');
          if (mvRe.test(sModelNorm) || iRe.test(mvNorm)) {
            stock += sv;
            seenStockKeys.add(sk);
          }
        }
        if (stock > 0) break;
      }
    }

    const partCount = matchedParts.length;
    const avgPrice = salesDemand.avgPrice > 0 ? salesDemand.avgPrice
      : (partCount > 0 ? matchedParts.reduce((sum, p) => sum + p.price, 0) / partCount : 0);

    // Helper: resolve stock count + match type from byPartNumber index
    function resolveStock(pn, stockPNs) {
      if (!pn || !stockPNs) return { count: 0, matchType: 'none' };
      const entry = stockPNs[pn.toUpperCase()];
      if (!entry) return { count: 0, matchType: 'none' };
      const total = typeof entry === 'number' ? entry : entry.total;
      if (!total) return { count: 0, matchType: 'none' };
      // Check if the lookup PN itself appears as a full PN in the index (exact match)
      // or if it only matches via base normalization
      const pnUp = pn.toUpperCase();
      if (typeof entry === 'object' && entry.fullPNs) {
        const isExact = entry.fullPNs.has(pnUp);
        return { count: total, matchType: isExact ? 'exact' : 'base' };
      }
      return { count: total, matchType: 'exact' };
    }

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
      let ptStockMatch = 'none';
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
          const r = resolveStock(pn, stockPartNumbers);
          if (r.count > 0) { ptStock = r.count; ptStockMatch = r.matchType; break; }
        }
        // Only fall back to base if exact found nothing
        if (ptStock === 0) {
          for (const pn of basePNs) {
            const r = resolveStock(pn, stockPartNumbers);
            if (r.count > 0) { ptStock = r.count; ptStockMatch = r.matchType === 'exact' ? 'base' : r.matchType; break; }
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
        stockMatchType: ptStockMatch,
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

      if (p.isRebuild && p.partType !== 'ECM') {
        // Group rebuild parts by partType+seller (ECM/ECU/PCM from pro-rebuild treated as normal)
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
        let ptStockMatch = 'none';
        if (basePn && stockPartNumbers) {
          const r = resolveStock(basePn, stockPartNumbers);
          ptStock = r.count;
          ptStockMatch = r.matchType;
        }
        mergedByBase[key] = {
          itemId: p.itemId, title: p.title, category: p.category,
          partNumber: p.partNumber, partType: p.partType,
          price: Math.round(p.price), priceSource: p.priceSource || 'estimate',
          in_stock: ptStock, stockMatchType: ptStockMatch, sold_90d: 0,
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

    // === TRIM/ENGINE/TRANS SPECIFICS CHECK ===
    // Flag parts whose title indicates a specific trim, turbo, trans, or diesel
    // that doesn't match this vehicle's VIN-decoded attributes.
    const vehicleTrimRaw = (cleanNHTSATrim(vehicle.decoded_trim) || cleanNHTSATrim(vehicle.trim_level) || vehicle.trim || '').toUpperCase();
    const vehicleEngineRaw = (vehicle.engine || vehicle.decoded_engine || '').toUpperCase();
    const vehicleTransRaw = (vehicle.decoded_transmission || '').toUpperCase();
    const vehicleIsDiesel = vehicle.diesel || /DIESEL|DURAMAX|CUMMINS|POWERSTROKE|POWER STROKE|TDI|ECODIESEL/i.test(vehicleEngineRaw);
    const vehicleHasTurbo = /TURBO|ECOBOOST|TSI|TFSI|SUPERCHARG|TWIN.?TURBO|BI.?TURBO/i.test(vehicleEngineRaw);

    for (const p of filteredParts) {
      const specifics = extractPartSpecifics(p.title || '');
      if (!specifics) continue;

      // TRIM: part mentions a performance trim, vehicle must have it
      if (specifics.trim) {
        if (!vehicleTrimRaw.includes(specifics.trim.toUpperCase())) {
          p.specMismatch = true;
          p.mismatchReason = `Part is for ${specifics.trim} trim`;
        }
      }

      // FORCED INDUCTION: part says Turbo/EcoBoost, vehicle engine must indicate turbo
      if (specifics.forcedInduction && !p.specMismatch) {
        if (!vehicleHasTurbo) {
          p.specMismatch = true;
          p.mismatchReason = `Part requires ${specifics.forcedInduction} engine`;
        }
      }

      // TRANSMISSION: part says Manual/MT, vehicle trans must match
      if (specifics.transmission && !p.specMismatch) {
        if (vehicleTransRaw) {
          if (specifics.transmission === 'manual' && /AUTO|CVT/i.test(vehicleTransRaw) && !/MANUAL/i.test(vehicleTransRaw)) {
            p.specMismatch = true;
            p.mismatchReason = 'Part is for manual transmission';
          }
          if (specifics.transmission === 'automatic' && /MANUAL/i.test(vehicleTransRaw) && !/AUTO|CVT|DCT|DUAL/i.test(vehicleTransRaw)) {
            p.specMismatch = true;
            p.mismatchReason = 'Part is for automatic transmission';
          }
        }
      }

      // DIESEL: part is for diesel, vehicle is not diesel
      if (specifics.diesel && !p.specMismatch) {
        if (!vehicleIsDiesel) {
          p.specMismatch = true;
          p.mismatchReason = 'Part is for diesel engine';
        }
      }
    }

    // Sort parts: highest price first, then NOVEL before RESTOCK before STOCKED at equal price
    const noveltyOrder = { NOVEL: 0, RESTOCK: 1, STOCKED: 2 };
    filteredParts.sort((a, b) => {
      const priceDiff = (b.price || 0) - (a.price || 0);
      if (priceDiff !== 0) return priceDiff;
      return (noveltyOrder[a.noveltyTier] || 2) - (noveltyOrder[b.noveltyTier] || 2);
    });

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

    // === INTEL SOURCE TAGGING: mark, quarry, stream, overstock, sold, flag ===
    // Priority: mark > quarry > stream. Overstock is independent (warning).
    for (const p of filteredParts) {
      const pnUpper = (p.partNumber || '').toUpperCase();
      const pnBase = (p.partNumberBase || pnUpper).toUpperCase();
      const sources = [];

      // MARK (priority 1)
      if ((pnBase && markIndex.byPN.has(pnBase)) || (pnUpper && markIndex.byPN.has(pnUpper))) {
        p.isMarked = true;
        sources.push('mark');
      }

      // QUARRY / STREAM (priority 2/3) — from intelIndex
      if (pnBase || pnUpper) {
        const key = pnBase || pnUpper;
        if (intelIndex.quarryPNs && intelIndex.quarryPNs.has(key)) {
          if (!p.isMarked) sources.push('quarry');
        } else if (intelIndex.streamPNs && intelIndex.streamPNs.has(key)) {
          if (!p.isMarked) sources.push('stream');
        } else if (intelIndex.wantPNs && intelIndex.wantPNs.has(key)) {
          // Legacy fallback
          if (!p.isMarked) sources.push('restock');
        }
      }

      // OVERSTOCK (independent warning — always show if matched)
      if ((pnBase && intelIndex.overstockPNs && intelIndex.overstockPNs.has(pnBase)) ||
          (pnUpper && intelIndex.overstockPNs && intelIndex.overstockPNs.has(pnUpper))) {
        p.overstockWarning = true;
        sources.push('overstock');
      }

      // FLAG
      if (pnUpper && intelIndex.flagPNs && intelIndex.flagPNs.has(pnUpper)) sources.push('flag');

      // SOLD = this part type was sold for this make/model in the sales window
      const pt = (p.partType || '').toUpperCase();
      if (pt && salesDemand.partTypes[pt] && salesDemand.partTypes[pt].count > 0) sources.push('sold');

      p.intelSources = sources.length > 0 ? sources : null;
    }

    // === PRICE FLOOR CHECK: flag parts below category floor ===
    for (const p of filteredParts) {
      const pt = (p.partType || '').toUpperCase();
      const floor = PART_PRICE_FLOORS[pt];
      if (floor && (p.price || 0) < floor) {
        p.belowFloor = true;
        p.priceFloor = floor;
      } else {
        p.belowFloor = false;
        p.priceFloor = floor || null;
      }
    }

    // === SOLD BLOCK FILTER — remove sold parts blocked for this exact vehicle ===
    if (soldKeys && soldKeys.size > 0) {
      const blockedComps = require('./BlockedCompsService');
      for (let i = filteredParts.length - 1; i >= 0; i--) {
        const p = filteredParts[i];
        if (p.priceSource !== 'sold') continue;
        const key = blockedComps.makeSoldKey(p.partType, year, make, model);
        if (soldKeys.has(key)) filteredParts.splice(i, 1);
      }
    }

    // === PART NOVELTY — boost scoring value for parts we've never had or need to restock ===
    for (const p of filteredParts) {
      const stock = p.in_stock || 0;
      const sold = p.sold_90d || 0;
      if (stock === 0 && sold === 0) {
        p.noveltyTier = 'NOVEL';
        p.noveltyBoost = 20;
        p._scoringValue = Math.round((p.price || 0) * 1.20);
      } else if (stock === 0 && sold > 0) {
        p.noveltyTier = 'RESTOCK';
        p.noveltyBoost = 10;
        p._scoringValue = Math.round((p.price || 0) * 1.10);
      } else {
        p.noveltyTier = 'STOCKED';
        p.noveltyBoost = 0;
        p._scoringValue = p.price || 0;
      }
    }

    // === TOTAL VALUE: sum of novelty-boosted scoring values for eligible parts ===
    const totalValue = filteredParts.filter(p => !p.belowFloor && !p.specMismatch).reduce((sum, p) => sum + (p._scoringValue || p.price || 0), 0);

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
    // Bonus: intel-backed parts boost vehicle score
    const intelMatchCount = filteredParts.filter(p => p.intelSources && p.intelSources.some(s => s === 'mark' || s === 'quarry' || s === 'stream' || s === 'restock')).length;
    for (const p of filteredParts) {
      if (!p.intelSources) continue;
      if (p.intelSources.includes('mark')) score = Math.round(score * 1.15);
      else if (p.intelSources.includes('quarry')) score = Math.round(score * 1.10);
      else if (p.intelSources.includes('stream') || p.intelSources.includes('restock')) score = Math.round(score * 1.05);
    }

    // === STOCK PENALTY SCALING — more stock = harder suppression ===
    // Max in_stock across all parts on this vehicle
    const maxStock = filteredParts.reduce((mx, p) => Math.max(mx, p.in_stock || 0), 0);
    if (maxStock === 1) score = Math.round(score * 0.95);       // -5%
    else if (maxStock === 2) score = Math.round(score * 0.85);  // -15%
    else if (maxStock === 3) score = Math.round(score * 0.70);  // -30%
    else if (maxStock === 4) score = Math.round(score * 0.50);  // -50%
    else if (maxStock >= 5) score = Math.round(score * 0.30);   // -70%

    // === FRESH ARRIVAL BONUS — LKQ set date in ET (doctrine: date_added is canon) ===
    const _daysSinceSet = daysSinceSetET(vehicle);
    if (_daysSinceSet !== null) {
      if (_daysSinceSet <= 3) score = Math.round(score * 1.10);       // +10%
      else if (_daysSinceSet <= 7) score = Math.round(score * 1.05);  // +5%
      else if (_daysSinceSet <= 14) score = Math.round(score * 1.02); // +2%
    }

    // === COGS YARD FACTOR — cheaper yards get slight boost ===
    if (vehicle._yardCostFactor) {
      score = Math.round(score * (1 + vehicle._yardCostFactor));
    }

    // === VEHICLE ATTRIBUTE BOOSTS — desirable configs score higher ===
    let attributeBoost = 0;
    const boostReasons = [];
    const vTrimTier = (vehicle.trim_tier || '').toUpperCase();
    const vDrive = (vehicle.decoded_drivetrain || vehicle.drivetrain || '').toUpperCase();
    const vTrans = (vehicle.decoded_transmission || '').toUpperCase();
    const is4wd = /4WD|4X4|AWD/.test(vDrive);
    const isManual = /MANUAL|STANDARD/.test(vTrans) || vTrans === 'CHECK_MT';

    // Hybrid/PHEV/EV detection — uses model name + engine_type + trim fallback
    const _pwt = classifyPowertrain(vehicle.engine_type, vehicle.make, vehicle.model, vehicle.decoded_trim || vehicle.trim_level);
    if (_pwt.isElectric) { attributeBoost += 25; boostReasons.push('ELECTRIC'); }
    else if (_pwt.isPHEV) { attributeBoost += 20; boostReasons.push('PHEV'); }
    else if (_pwt.isHybrid) { attributeBoost += 15; boostReasons.push('HYBRID'); }

    if (vTrimTier === 'PERFORMANCE') { attributeBoost += 20; boostReasons.push('PERFORMANCE'); }
    else if (vTrimTier === 'PREMIUM') { attributeBoost += 10; boostReasons.push('PREMIUM'); }
    if (vehicle.diesel) { attributeBoost += 15; boostReasons.push('DIESEL'); }
    if (is4wd && isManual) { attributeBoost += 12; boostReasons.push('4WD+MT'); }
    else if (isManual) { attributeBoost += 8; boostReasons.push('MANUAL'); }
    else if (is4wd) { attributeBoost += 5; boostReasons.push('4WD'); }

    if (attributeBoost > 0) {
      score = Math.round(score * (1 + attributeBoost / 100));
    }

    // === VEHICLE RARITY — generation-aware frequency + trim-driven overrides ===
    // Try generation-specific key first, fall back to make|model
    const vYear = parseInt(vehicle.year) || 0;
    let freqData = null;
    // Look for generation-specific match via trim_tier_reference gen ranges
    for (const [fk, fv] of Object.entries(frequencyMap)) {
      if (!fv.gen_start || !fv.gen_end) continue;
      if (fk.startsWith(`${make}|${model}`.toLowerCase() + '|') &&
          vYear >= fv.gen_start && vYear <= fv.gen_end) {
        freqData = fv;
        break;
      }
    }
    if (!freqData) freqData = frequencyMap[`${make}|${model}`.toLowerCase()];

    const avgDays = freqData ? parseFloat(freqData.avg_days_between) : null;
    const totalSeen = freqData ? parseInt(freqData.total_seen) : 0;

    // Frequency-based rarity tier
    let rarityTier = 'NORMAL', rarityBoost = 0, rarityColor = '#2ECC40', rarityPulses = false;
    let rarityReason = '';

    // Minimum-data guard: how many days of tracking data do we have?
    const trackingDays = freqData && freqData.first_tracked_at && freqData.last_seen_at
      ? (new Date(freqData.last_seen_at).getTime() - new Date(freqData.first_tracked_at).getTime()) / 86400000
      : 0;
    // With <30d of data, cap at UNCOMMON. With <60d, cap at RARE. 60+ = full tiers.
    const maxTierRank = trackingDays >= 60 ? 6 : trackingDays >= 30 ? 5 : 4; // 6=LEGENDARY, 5=RARE, 4=UNCOMMON

    if (totalSeen <= 1 || avgDays === null) {
      rarityTier = 'LEGENDARY'; rarityBoost = 30; rarityColor = '#FFD700'; rarityPulses = true;
      rarityReason = totalSeen <= 1 ? '1 sighting' : 'No frequency data';
    } else if (avgDays >= 180) {
      rarityTier = 'LEGENDARY'; rarityBoost = 30; rarityColor = '#FFD700'; rarityPulses = true;
      rarityReason = `~${Math.round(avgDays)}d avg`;
    } else if (avgDays >= 90) {
      rarityTier = 'RARE'; rarityBoost = 20; rarityColor = '#C39BD3'; rarityPulses = true;
      rarityReason = `~${Math.round(avgDays)}d avg`;
    } else if (avgDays >= 45) {
      rarityTier = 'UNCOMMON'; rarityBoost = 10; rarityColor = '#3498DB';
      rarityReason = `~${Math.round(avgDays)}d avg`;
    } else if (avgDays >= 15) {
      rarityTier = 'NORMAL'; rarityBoost = 0; rarityColor = '#2ECC40';
      rarityReason = `~${Math.round(avgDays)}d avg`;
    } else if (avgDays >= 7) {
      rarityTier = 'COMMON'; rarityBoost = -5; rarityColor = '#FF8C00';
      rarityReason = `~${Math.round(avgDays)}d avg`;
    } else {
      rarityTier = 'SATURATED'; rarityBoost = -15; rarityColor = 'rgba(140,50,50,0.45)';
      rarityReason = `~${(avgDays || 0).toFixed(1)}d avg`;
    }

    // Apply minimum-data cap — prevent wild claims with thin tracking data
    const RARITY_TIERS_ORDERED = ['SATURATED', 'COMMON', 'NORMAL', 'UNCOMMON', 'RARE', 'LEGENDARY'];
    const tierRank = RARITY_TIERS_ORDERED.indexOf(rarityTier) + 1;
    if (tierRank > maxTierRank && totalSeen > 1) {
      const cappedTier = RARITY_TIERS_ORDERED[maxTierRank - 1];
      rarityTier = cappedTier;
      rarityBoost = cappedTier === 'UNCOMMON' ? 10 : cappedTier === 'RARE' ? 20 : rarityBoost;
      rarityColor = cappedTier === 'UNCOMMON' ? '#3498DB' : cappedTier === 'RARE' ? '#C39BD3' : rarityColor;
      rarityPulses = cappedTier === 'RARE';
      rarityReason += ` (${Math.round(trackingDays)}d data)`;
    }

    // Trim-driven rarity FLOOR — overrides only RAISE, never lower
    const RARITY_RANK = { LEGENDARY: 6, RARE: 5, UNCOMMON: 4, NORMAL: 3, COMMON: 2, SATURATED: 1 };
    const currentRank = RARITY_RANK[rarityTier] || 3;

    let trimFloorTier = null, trimFloorBoost = 0, trimFloorReason = '';
    if (vTrimTier === 'PERFORMANCE') {
      trimFloorTier = 'LEGENDARY'; trimFloorBoost = 30; trimFloorReason = 'PERFORMANCE trim';
    } else if (vTrimTier === 'PREMIUM') {
      trimFloorTier = 'RARE'; trimFloorBoost = 20; trimFloorReason = 'PREMIUM trim';
    }
    if (!trimFloorTier && is4wd && isManual) {
      trimFloorTier = 'RARE'; trimFloorBoost = 20; trimFloorReason = '4WD+MT';
    }
    if (!trimFloorTier && vehicle.diesel) {
      trimFloorTier = 'RARE'; trimFloorBoost = 20; trimFloorReason = 'DIESEL';
    }

    // Apply floor: use whichever tier is HIGHER
    if (trimFloorTier) {
      const floorRank = RARITY_RANK[trimFloorTier] || 3;
      if (floorRank > currentRank) {
        rarityTier = trimFloorTier;
        rarityBoost = trimFloorBoost;
        rarityReason = trimFloorReason;
        rarityColor = trimFloorTier === 'LEGENDARY' ? '#FFD700' : '#C39BD3';
        rarityPulses = trimFloorTier === 'LEGENDARY' || trimFloorTier === 'RARE';
      }
    }

    if (rarityBoost !== 0) {
      score = Math.round(score * (1 + rarityBoost / 100));
    }

    score = Math.max(0, score); // uncapped — scores over 100 indicate boosted vehicles

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
      daysSinceSet: _daysSinceSet, setDateLabel: setDateLabel(vehicle),
      vin: vehicle.vin || null,
      engine: formatEngineDisplay(vehicle.engine),
      engine_type: vehicle.engine_type || null,
      drivetrain: vehicle.drivetrain || null,
      decoded_drivetrain: vehicle.decoded_drivetrain || null,
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
      attributeBoost: attributeBoost > 0 ? attributeBoost : null,
      boostReasons: boostReasons.length > 0 ? boostReasons : null,
      rarityTier, rarityColor, rarityPulses, rarityReason,
      rarityAvgDays: avgDays != null ? Math.round(avgDays * 10) / 10 : null,
      rarityTotalSeen: totalSeen,
      rarityBoost: rarityBoost !== 0 ? rarityBoost : null,
      est_value: totalValue,
      max_part_value: filteredParts.filter(p => !p.belowFloor).length > 0 ? Math.max(...filteredParts.filter(p => !p.belowFloor).map(p => p.price || 0)) : 0,
      matched_parts: filteredParts.length,
      intel_match_count: intelMatchCount,
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
    const _blockedSvc2 = require('./BlockedCompsService');
    const { soldKeys: _soldKeys2 } = await _blockedSvc2.getBlockedSet();

    const scored = vehicles.map(v =>
      this.scoreVehicle(v, inventoryIndex, salesIndex, stockIndex, platformIndex, stockPartNumbers, undefined, undefined, undefined, _soldKeys2)
    );

    scored.sort((a, b) => {
      const valDiff = (b.est_value || 0) - (a.est_value || 0);
      if (valDiff !== 0) return valDiff;
      return (b.max_part_value || 0) - (a.max_part_value || 0);
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

    // Load persistent vehicle frequency data for rarity scoring (generation-aware)
    const frequencyMap = {};
    try {
      const freqRows = await database('vehicle_frequency').select('make', 'model', 'gen_start', 'gen_end', 'avg_days_between', 'total_seen');
      for (const row of freqRows) {
        // Key by make|model|gen_start|gen_end for generation-specific lookup
        if (row.gen_start && row.gen_end) {
          frequencyMap[`${row.make}|${row.model}|${row.gen_start}|${row.gen_end}`.toLowerCase()] = row;
        }
        // Also keep make|model fallback for vehicles without generation data
        const mmKey = `${row.make}|${row.model}`.toLowerCase();
        if (!frequencyMap[mmKey]) frequencyMap[mmKey] = row;
      }
    } catch (e) { /* table may not exist yet */ }

    // Build mark index from the_mark for score boosting
    let markIndex = { byPN: new Map(), byTitle: new Set() };
    try {
      const marks = await database('the_mark').where('active', true).select('normalizedTitle', 'partNumber');
      for (const m of marks) {
        if (m.partNumber) markIndex.byPN.set(m.partNumber.toUpperCase(), true);
        if (m.normalizedTitle) markIndex.byTitle.add(m.normalizedTitle);
      }
    } catch (e) { /* the_mark may not exist */ }

    // Build intel index for source badges (quarry, stream, overstock, flags)
    const intelIndex = { wantPNs: new Set(), quarryPNs: new Set(), streamPNs: new Set(), overstockPNs: new Set(), flagPNs: new Set() };
    try {
      const wants = await database('restock_want_list').where('active', true).select('title', 'part_number', 'auto_generated');
      const { extractPartNumbers: eiPNs } = require('../utils/partIntelligence');
      const { normalizePartNumber } = require('../lib/partNumberUtils');
      for (const w of wants) {
        const pns = [];
        // Use part_number column if available (more reliable)
        if (w.part_number) {
          const norm = normalizePartNumber(w.part_number);
          if (norm) pns.push(norm.toUpperCase());
        }
        // Also extract from title as fallback
        const extracted = eiPNs(w.title || '');
        for (const pn of extracted) {
          const key = (pn.base || pn.normalized || '').toUpperCase();
          if (key) pns.push(key);
        }
        const targetSet = w.auto_generated ? intelIndex.quarryPNs : intelIndex.streamPNs;
        for (const pn of pns) {
          targetSet.add(pn);
          intelIndex.wantPNs.add(pn); // Legacy compat
        }
      }
    } catch (e) { /* table may not exist */ }
    try {
      const flags = await database('restock_flag').where('acknowledged', false).select('title');
      const { extractPartNumbers: eiPNs } = require('../utils/partIntelligence');
      for (const f of flags) {
        const pns = eiPNs(f.title || '');
        for (const pn of pns) intelIndex.flagPNs.add((pn.base || pn.normalized || '').toUpperCase());
      }
    } catch (e) { /* table may not exist */ }
    // Overstock PNs — parts we have too many of
    try {
      const overItems = await database('overstock_group_item')
        .join('overstock_group', 'overstock_group.id', 'overstock_group_item.group_id')
        .where('overstock_group.status', 'active')
        .where('overstock_group_item.is_active', true)
        .select('overstock_group_item.title');
      const { extractPartNumbers: eiPNs } = require('../utils/partIntelligence');
      for (const o of overItems) {
        const pns = eiPNs(o.title || '');
        for (const pn of pns) intelIndex.overstockPNs.add((pn.base || pn.normalized || '').toUpperCase());
      }
    } catch (e) { /* table may not exist */ }

    // Load hidden parts — parts blacklisted from all intel
    const hiddenPNs = new Set();
    try {
      const hiddenRows = await database('hidden_parts').select('part_number_base');
      for (const h of hiddenRows) {
        if (h.part_number_base) hiddenPNs.add(h.part_number_base.toUpperCase());
      }
    } catch (e) { /* table may not exist */ }
    // Remove hidden PNs from all intel sets
    for (const pn of hiddenPNs) {
      intelIndex.wantPNs.delete(pn);
      intelIndex.quarryPNs.delete(pn);
      intelIndex.streamPNs.delete(pn);
      intelIndex.flagPNs.delete(pn);
      markIndex.byPN.delete(pn);
    }

    // Load sold block keys once for all vehicles
    const _blockedSvc3 = require('./BlockedCompsService');
    const { soldKeys: _soldKeys3 } = await _blockedSvc3.getBlockedSet();

    // 7-day retention: show vehicles last seen within 7 days
    const retentionCutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const activeOnly = options.activeOnly === true;

    const results = [];
    for (const yard of yards) {
      let vQuery = database('yard_vehicle')
        .where('yard_id', yard.id)
        .orderBy('date_added', 'desc');

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

      // COGS yard factor — cheaper yards get a slight boost
      const entryFee = parseFloat(yard.entry_fee) || 2;
      const taxRate = parseFloat(yard.tax_rate) || 0.07;
      const costIndex = (entryFee / 2) * (1 + taxRate) / (1 + 0.07);
      let yardCostFactor = 0;
      if (costIndex <= 0.8) yardCostFactor = 0.05;       // cheap yard +5%
      else if (costIndex <= 1.0) yardCostFactor = 0;      // baseline
      else if (costIndex <= 1.3) yardCostFactor = -0.03;  // somewhat expensive -3%
      else yardCostFactor = -0.05;                         // expensive -5%

      // Attach yard cost factor to vehicles before scoring
      for (const v of vehicles) v._yardCostFactor = yardCostFactor;

      const scored = vehicles.map(v =>
        this.scoreVehicle(v, inventoryIndex, salesIndex, stockIndex, platformIndex, stockPartNumbers, markIndex, intelIndex, frequencyMap, _soldKeys3)
      );
      // Sort: active first, then highest total value, then max single part tiebreaker
      scored.sort((a, b) => {
        if (a.is_active !== b.is_active) return a.is_active ? -1 : 1;
        const valDiff = (b.est_value || 0) - (a.est_value || 0);
        if (valDiff !== 0) return valDiff;
        return (b.max_part_value || 0) - (a.max_part_value || 0);
      });

      const _staleHours = await hoursSinceLastScrape(database, yard.id);
      results.push({
        yard: {
          id: yard.id,
          name: yard.name,
          chain: yard.chain,
          distance_from_base: yard.distance_from_base,
          visit_frequency: yard.visit_frequency,
          last_scraped: yard.last_scraped,
          lastScrapedHoursAgo: Math.round(_staleHours * 10) / 10,
          isStale: _staleHours > 18,
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

// Clears all part-matching caches. Called on block/unblock so changes
// take effect on the very next request instead of waiting for TTL expiry.
AttackListService.invalidateInventoryCache = function() {
  _inventoryIndexCache = null;
  _inventoryIndexCacheTime = 0;
  _salesIndexCache = null;
  _salesIndexCacheTime = 0;
  _stockIndexCache = null;
  _stockIndexCacheTime = 0;
};

module.exports = AttackListService;
