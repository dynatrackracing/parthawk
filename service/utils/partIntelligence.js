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

// Use normalizePartNumber from partMatcher for canonical base computation
const { normalizePartNumber: _normPN } = require('./partMatcher');

/**
 * Compute base PN using the canonical normalizer (keeps Ford prefix, strips only revision suffix).
 * Falls back to stripRevisionSuffix for dashless PNs.
 */
function computeBase(raw) {
  if (!raw) return raw;
  // If the raw PN has dashes, use normalizePartNumber (handles Ford/Toyota/Honda properly)
  if (raw.includes('-')) {
    const normed = _normPN(raw);
    // normalizePartNumber keeps dashes — strip them for the base
    return normed ? normed.replace(/-/g, '') : stripRevisionSuffix(raw.toUpperCase().replace(/[\s.\-]/g, ''));
  }
  // Dashless: use stripRevisionSuffix
  return stripRevisionSuffix(raw.toUpperCase().replace(/[\s.]/g, ''));
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
    // Ford 3-segment dash: 7L3A-12A650-GJH, AL3T-15604-BD, BL3T-19H332-AB
    /\b[A-Z0-9]{3,5}-[A-Z0-9]{4,7}-[A-Z]{1,3}\b/gi,
    // Ford 3-segment dashless: 7L3A12A650GJH, AL3T15604BD
    /\b[A-Z0-9]{3,5}[0-9][A-Z][0-9]{3,5}[A-Z]{1,3}\b/gi,
    // Ford 2-segment dash: AL3Z-12A650, 7L3Z-12A650
    /\b[A-Z0-9]{3,5}-[A-Z0-9]{4,7}\b/gi,
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
      candidates.push({ raw, normalized, base: computeBase(raw) });
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

// ═══════════════════════════════════════════════════════════════
// STRUCTURED FIELD EXTRACTION — Clean Pipe Phase A
// ═══════════════════════════════════════════════════════════════

/**
 * detectPartType(title) — Detect part type from title.
 * Self-contained copy matching AttackListService.detectPartType().
 */
function detectPartType(title) {
  var t = (title || '').toUpperCase();
  if (t.includes('TCM') || t.includes('TCU') || t.includes('TRANSMISSION CONTROL')) return 'TCM';
  if (t.includes('BCM') || t.includes('BODY CONTROL')) return 'BCM';
  if (t.includes('ECM') || t.includes('ECU') || t.includes('PCM') || t.includes('ENGINE CONTROL') || t.includes('ENGINE COMPUTER')) return 'ECM';
  if (t.includes('ABS') || t.includes('ANTI LOCK') || t.includes('ANTI-LOCK') || t.includes('BRAKE MODULE')) return 'ABS';
  if (t.includes('TIPM') || t.includes('FUSE BOX') || t.includes('JUNCTION') || t.includes('RELAY BOX') || t.includes('IPDM')) return 'TIPM';
  if (t.includes('AMPLIFIER') || t.includes('AMP ') || t.includes(' AMP') || t.includes('BOSE') || t.includes('HARMAN') || t.includes('ALPINE') || t.includes('JBL')) return 'AMP';
  if (t.includes('CLUSTER') || t.includes('SPEEDOMETER') || t.includes('INSTRUMENT') || t.includes('GAUGE')) return 'CLUSTER';
  if (t.includes('RADIO') || t.includes('HEAD UNIT') || t.includes('INFOTAINMENT') || t.includes('STEREO') || t.includes('RECEIVER')) return 'RADIO';
  if (t.includes('THROTTLE')) return 'THROTTLE';
  if (t.includes('STEERING') || t.includes('EPS')) return 'STEERING';
  if (t.includes('WINDOW') && (t.includes('REGULATOR') || t.includes('MOTOR'))) return 'REGULATOR';
  if (t.includes('MIRROR')) return 'MIRROR';
  if (t.includes('SUNROOF') || t.includes('MOONROOF') || t.includes('SUN ROOF')) return 'SUNROOF';
  if (t.includes('FUEL PUMP DRIVER') || t.includes('FUEL PUMP MODULE') || t.includes('FUEL PUMP CONTROL')) return 'FUEL_MODULE';
  if (t.includes('CAMERA') || t.includes('BACKUP CAM') || t.includes('MONOCULAR')) return 'CAMERA';
  if ((t.includes('CLIMATE') || t.includes('HVAC') || t.includes('HEATER')) && t.includes('CONTROL')) return 'HVAC';
  if (t.includes('HEADLIGHT') || t.includes('HEAD LIGHT') || t.includes('XENON') || t.includes('HID')) return 'HEADLIGHT';
  if (t.includes('TAIL LIGHT') || t.includes('TAILLIGHT') || t.includes('TAIL LAMP')) return 'TAILLIGHT';
  if (t.includes('BLIND SPOT') || t.includes('RADAR')) return 'BLIND_SPOT';
  if (t.includes('PARK ASSIST') || t.includes('PARKING SENSOR')) return 'PARK_SENSOR';
  if (t.includes('AIR RIDE') || t.includes('AIR SUSPENSION')) return 'AIR_RIDE';
  if (t.includes('CLOCK SPRING') || t.includes('CLOCKSPRING')) return 'CLOCK_SPRING';
  if (t.includes('DOOR LOCK') || t.includes('LATCH') || t.includes('KEYLESS ENTRY')) return 'LOCK';
  if (t.includes('IGNITION') || t.includes('IMMOBILIZER')) return 'IGNITION';
  if ((t.includes('LIFTGATE') || t.includes('TAILGATE') || t.includes('HATCH')) && (t.includes('MOTOR') || t.includes('MODULE') || t.includes('ACTUATOR'))) return 'LIFTGATE';
  if (t.includes('ALTERNATOR')) return 'ALTERNATOR';
  if (t.includes('STARTER')) return 'STARTER';
  if (t.includes('BLOWER MOTOR')) return 'BLOWER';
  if (t.includes('NAVIGATION') || (t.includes('NAV') && t.includes('MODULE'))) return 'NAV';
  if (t.includes('SUN VISOR') || t.includes('SUNVISOR') || t.includes('SUN-VISOR')) return 'VISOR';
  return null;
}

// Make normalization — title case, matching corgi VIN decoder output
var MAKE_NORMALIZE = {
  'chevrolet': 'Chevrolet', 'chevy': 'Chevrolet', 'dodge': 'Dodge', 'ram': 'Ram',
  'chrysler': 'Chrysler', 'jeep': 'Jeep', 'ford': 'Ford', 'gmc': 'GMC',
  'toyota': 'Toyota', 'honda': 'Honda', 'nissan': 'Nissan', 'bmw': 'BMW',
  'mercedes': 'Mercedes-Benz', 'mercedes-benz': 'Mercedes-Benz', 'mazda': 'Mazda',
  'kia': 'Kia', 'hyundai': 'Hyundai', 'subaru': 'Subaru', 'mitsubishi': 'Mitsubishi',
  'infiniti': 'Infiniti', 'lexus': 'Lexus', 'acura': 'Acura', 'cadillac': 'Cadillac',
  'buick': 'Buick', 'lincoln': 'Lincoln', 'volvo': 'Volvo', 'audi': 'Audi',
  'volkswagen': 'Volkswagen', 'vw': 'Volkswagen', 'mini': 'Mini', 'pontiac': 'Pontiac',
  'saturn': 'Saturn', 'mercury': 'Mercury', 'scion': 'Scion', 'land rover': 'Land Rover',
  'porsche': 'Porsche', 'jaguar': 'Jaguar', 'saab': 'Saab', 'fiat': 'Fiat',
  'genesis': 'Genesis', 'suzuki': 'Suzuki', 'isuzu': 'Isuzu', 'oldsmobile': 'Oldsmobile',
  'hummer': 'Hummer', 'plymouth': 'Plymouth', 'datsun': 'Datsun', 'renault': 'Renault',
};

// Multi-word models must come before their single-word components
var MODEL_PATTERNS = [
  // Multi-word (check first — Grand Cherokee BEFORE Cherokee)
  'Grand Cherokee', 'Grand Caravan', 'Grand Prix', 'Grand Marquis', 'Grand Vitara',
  'Town & Country', 'Town and Country', 'Transit Connect',
  'Crown Victoria', 'Monte Carlo', 'El Camino', 'Park Avenue',
  'Land Cruiser', 'Rav4', 'RAV4', '4Runner',
  'Santa Fe', 'Wrangler Unlimited',
  'PT Cruiser', 'Pt Cruiser',
  'CR-V', 'CR-Z', 'HR-V', 'BR-V',
  'C-Max', 'E-Series', 'F-Super Duty',
  'Seville', 'Deville', 'DeVille',
  'XC90', 'XC60', 'XC70', 'XC40', 'S60', 'S80', 'S40', 'V60', 'V70',
  'IS250', 'IS350', 'ES350', 'ES300', 'GS350', 'GS300', 'LS460', 'LS430', 'RX350', 'RX330', 'RX300', 'GX470', 'GX460', 'LX570', 'LX470', 'NX200', 'NX300',
  'TL', 'TLX', 'TSX', 'MDX', 'RDX', 'RSX', 'ZDX', 'ILX', 'CDX', 'RL',
  'G35', 'G37', 'G25', 'M35', 'M45', 'M37', 'Q50', 'Q60', 'Q70', 'QX4', 'QX56', 'QX60', 'QX80', 'FX35', 'FX45', 'EX35',
  '3 Series', '5 Series', '7 Series', 'X3', 'X5', 'X1', 'X6', 'X4', 'Z3', 'Z4',
  // Trucks with tonnage
  'Silverado 3500', 'Silverado 2500', 'Silverado 1500',
  'Sierra 3500', 'Sierra 2500', 'Sierra 1500',
  'Ram 3500', 'Ram 2500', 'Ram 1500',
  'F-350', 'F-250', 'F-150', 'F350', 'F250', 'F150',
  'E-150', 'E-250', 'E-350', 'E150', 'E250', 'E350',
  // Single-word models
  'Silverado', 'Sierra', 'Tahoe', 'Suburban', 'Yukon', 'Avalanche', 'Colorado', 'Canyon',
  'Equinox', 'Traverse', 'Trailblazer', 'Blazer', 'Trax', 'Envoy', 'Acadia', 'Terrain',
  'Enclave', 'Encore', 'LaCrosse', 'Regal', 'Verano', 'Lucerne', 'LeSabre', 'Rendezvous',
  'Impala', 'Malibu', 'Cruze', 'Cobalt', 'Sonic', 'Spark', 'Bolt', 'Camaro', 'Corvette',
  'Escalade', 'CTS', 'ATS', 'XTS', 'SRX', 'XT5', 'XT4', 'CT5', 'CT4',
  'Navigator', 'Aviator', 'Corsair', 'Nautilus', 'Continental', 'MKZ', 'MKX', 'MKC', 'MKT',
  'Explorer', 'Expedition', 'Escape', 'Edge', 'Flex', 'Fusion', 'Focus', 'Taurus',
  'Mustang', 'Ranger', 'Bronco', 'Maverick', 'Excursion', 'Windstar', 'Freestar', 'Freestyle',
  'Charger', 'Challenger', 'Durango', 'Dakota', 'Magnum', 'Caliber', 'Avenger', 'Dart',
  'Caravan', 'Journey', 'Nitro', 'Neon', 'Stratus', 'Sebring', 'Intrepid', '300', '200',
  'Cherokee', 'Wrangler', 'Compass', 'Renegade', 'Gladiator', 'Liberty', 'Commander', 'Patriot',
  'Pacifica', 'Voyager', 'Aspen',
  'Camry', 'Corolla', 'Prius', 'Avalon', 'Celica', 'Solara', 'Yaris', 'Matrix', 'Echo',
  'Highlander', 'Sequoia', 'Sienna', 'Venza', 'Tacoma', 'Tundra',
  'Civic', 'Accord', 'Pilot', 'Passport', 'Odyssey', 'Ridgeline', 'Element', 'Fit', 'Insight',
  'Altima', 'Maxima', 'Sentra', 'Versa', 'Rogue', 'Murano', 'Pathfinder', 'Frontier',
  'Armada', 'Titan', 'Juke', 'Kicks', 'Xterra', '350Z', '370Z',
  'Sonata', 'Elantra', 'Tucson', 'Veloster', 'Accent', 'Genesis', 'Azera', 'Veracruz',
  'Sportage', 'Sorento', 'Optima', 'Forte', 'Soul', 'Rio', 'Telluride', 'Seltos', 'Stinger',
  'Outback', 'Forester', 'Impreza', 'Legacy', 'Crosstrek', 'Ascent', 'WRX', 'BRZ', 'Tribeca',
  'Lancer', 'Outlander', 'Eclipse', 'Galant', 'Montero', 'Endeavor',
  'Jetta', 'Passat', 'Beetle', 'Tiguan', 'Atlas', 'Golf', 'GTI', 'CC', 'Touareg', 'Routan',
  'Cooper',
  'Mazda3', 'Mazda6', 'CX-5', 'CX-9', 'CX-7', 'CX-3', 'MX-5', 'Tribute', 'Protege',
  '3', '5', '6', 'RX-8',
  'Montego', 'Mariner', 'Mountaineer', 'Sable', 'Milan',
  '280ZX', 'Stanza', 'Pulsar',
];

function extractMake(titleLower) {
  // Check multi-word makes first
  var multiWord = ['land rover', 'mercedes-benz'];
  for (var i = 0; i < multiWord.length; i++) {
    if (titleLower.includes(multiWord[i])) return MAKE_NORMALIZE[multiWord[i]];
  }
  // Then single-word makes via word boundary
  var keys = Object.keys(MAKE_NORMALIZE);
  for (var k = 0; k < keys.length; k++) {
    var key = keys[k];
    if (key.includes(' ')) continue; // skip multi-word, already checked
    var re = new RegExp('\\b' + key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i');
    if (re.test(titleLower)) return MAKE_NORMALIZE[key];
  }
  return null;
}

function extractModel(title, make) {
  if (!title || !make) return null;
  var titleUpper = title.toUpperCase();
  // Try multi-word patterns first, then single-word
  for (var i = 0; i < MODEL_PATTERNS.length; i++) {
    var pattern = MODEL_PATTERNS[i];
    var patUpper = pattern.toUpperCase();
    var re = new RegExp('\\b' + patUpper.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b');
    if (re.test(titleUpper)) {
      // Return title-case version from patterns array
      return pattern;
    }
  }
  return null;
}

/**
 * extractStructuredFields(title) — Clean Pipe Phase A
 *
 * Extracts normalized structured data from any eBay listing title.
 * Used at WRITE TIME on YourListing, YourSale, SoldItem inserts/updates.
 *
 * Returns: { partNumberBase, partType, extractedMake, extractedModel }
 * All values are nullable. Make/model output in title case to match corgi VIN decoder.
 */
function extractStructuredFields(title) {
  if (!title) return { partNumberBase: null, partType: null, extractedMake: null, extractedModel: null };

  // A) Part number base
  var pns = extractPartNumbers(title);
  var partNumberBase = pns.length > 0 ? pns[0].base : null;

  // B) Part type
  var partType = detectPartType(title);

  // C) Make
  var titleLower = title.toLowerCase();
  var extractedMake = extractMake(titleLower);

  // D) Model (only if make was found)
  var extractedModel = extractModel(title, extractedMake);

  return { partNumberBase: partNumberBase, partType: partType, extractedMake: extractedMake, extractedModel: extractedModel };
}

// ═══════════════════════════════════════════════════════════════
// SNIPER PN CLEANUP — Clean Pipe Phase E1
// ═══════════════════════════════════════════════════════════════

// Known make/model names that are NOT part numbers
var JUNK_WORDS = new Set([
  'SILVERADO','TAHOE','SUBURBAN','YUKON','SIERRA','CAMARO','CORVETTE','IMPALA','MALIBU',
  'EQUINOX','TRAVERSE','TRAILBLAZER','BLAZER','COLORADO','CANYON','ACADIA','TERRAIN',
  'ENCLAVE','ENCORE','ESCALADE','AVALANCHE','ENVOY','DENALI',
  'CAMRY','COROLLA','HIGHLANDER','SEQUOIA','TACOMA','TUNDRA','PRIUS','SIENNA','AVALON',
  'CIVIC','ACCORD','PILOT','ODYSSEY','RIDGELINE','ELEMENT','PASSPORT',
  'MUSTANG','EXPLORER','EXPEDITION','ESCAPE','EDGE','FUSION','FOCUS','RANGER','BRONCO',
  'CHARGER','CHALLENGER','DURANGO','DAKOTA','MAGNUM','WRANGLER','CHEROKEE','COMPASS',
  'RENEGADE','GLADIATOR','LIBERTY','COMMANDER','PATRIOT','PACIFICA','JOURNEY','CALIBER',
  'ALTIMA','MAXIMA','SENTRA','ROGUE','MURANO','PATHFINDER','FRONTIER','ARMADA','TITAN',
  'SONATA','ELANTRA','TUCSON','SPORTAGE','SORENTO','OPTIMA','FORTE','SOUL',
  'OUTBACK','FORESTER','IMPREZA','LEGACY','CROSSTREK','ASCENT',
  'JETTA','PASSAT','BEETLE','TIGUAN','GOLF','TOUAREG',
  'LANCER','OUTLANDER','ECLIPSE','GALANT',
  'NAVIGATOR','AVIATOR','CORSAIR','NAUTILUS',
  'RX400H','RX350','IS250','GS350','ES350','LS460','GX470','NX200',
  'FORD','CHEVY','CHEVROLET','DODGE','CHRYSLER','JEEP','RAM','TOYOTA','HONDA','NISSAN',
  'BMW','MAZDA','KIA','HYUNDAI','SUBARU','MITSUBISHI','INFINITI','LEXUS','ACURA',
  'CADILLAC','BUICK','LINCOLN','VOLVO','AUDI','VOLKSWAGEN','PONTIAC','SATURN','MERCURY',
  'MODULE','CONTROL','ASSEMBLY','TESTED','PROGRAMMED','GENUINE','REPLACEMENT',
]);

/**
 * sanitizePartNumberForSearch(pn) — Clean Pipe Phase E1
 *
 * Takes a raw partNumberBase and returns a clean, searchable version.
 * Returns null if the PN is junk (not searchable on eBay).
 */
function sanitizePartNumberForSearch(pn) {
  if (!pn) return null;

  // A) Normalize: strip dashes, spaces, dots, uppercase
  var norm = pn.replace(/[\s\-\.]/g, '').toUpperCase();

  // B) Reject junk
  if (norm.length < 5) return null;
  if (norm.length > 20) return null;
  if (JUNK_WORDS.has(norm)) return null;
  // Purely numeric year (4 digits, 1900-2099)
  if (/^\d{4}$/.test(norm) && parseInt(norm) >= 1900 && parseInt(norm) <= 2099) return null;
  // Purely numeric and too short (< 6 digits)
  if (/^\d+$/.test(norm) && norm.length < 6) return null;
  // Only letters, no digits — likely a word not a PN
  if (/^[A-Z]+$/.test(norm)) return null;
  // Looks like a VIN (17 chars alphanumeric)
  if (norm.length === 17 && /^[A-HJ-NPR-Z0-9]+$/.test(norm)) return null;

  // C) Ford ECU suffix stripping
  var ford12A650 = norm.indexOf('12A650');
  if (ford12A650 >= 0) {
    norm = norm.substring(0, ford12A650 + 6); // keep through "12A650"
  }
  var ford14A067 = norm.indexOf('14A067');
  if (ford14A067 >= 0) {
    norm = norm.substring(0, ford14A067 + 6); // keep through "14A067"
  }

  // D) Final length check after stripping
  if (norm.length < 5) return null;

  return norm;
}

/**
 * deduplicatePNQueue(entries) — Clean Pipe Phase E1
 *
 * Takes an array of {base, raw, price, ...} objects.
 * Sanitizes PNs, removes junk, deduplicates (keeps highest price).
 * Returns filtered, deduped array with sanitized .base values.
 */
function deduplicatePNQueue(entries) {
  var groups = {};
  for (var i = 0; i < entries.length; i++) {
    var entry = entries[i];
    var clean = sanitizePartNumberForSearch(entry.base);
    if (!clean) continue;
    if (!groups[clean] || (entry.price || 0) > (groups[clean].price || 0)) {
      groups[clean] = { base: clean, raw: entry.raw, price: entry.price, sampleTitle: entry.sampleTitle };
    }
  }
  var result = [];
  var keys = Object.keys(groups);
  for (var k = 0; k < keys.length; k++) {
    result.push(groups[keys[k]]);
  }
  return result;
}

module.exports = {
  extractPartNumbers,
  stripRevisionSuffix,
  parseYearRange,
  vehicleYearMatchesPart,
  modelMatches,
  buildStockIndex,
  lookupStockFromIndex,
  extractStructuredFields,
  detectPartType,
  sanitizePartNumberForSearch,
  deduplicatePNQueue,
};
