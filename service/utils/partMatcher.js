'use strict';

// DEPRECATED: Use partIntelligence.js instead. This file kept for backward compatibility.
// All new code should require('../utils/partIntelligence').

/**
 * Shared Part Number Recognition & Matching Utility
 *
 * Single source of truth for:
 *  - OEM part number extraction from titles
 *  - Part number normalization (suffix stripping)
 *  - Make/model/part-type parsing from titles
 *  - Matching against YourListing, YourSale, yard_vehicle
 *
 * Used by: HUNTERS PERCH, BONE PILE, SCOUT ALERTS, DAILY FEED, HAWK EYE
 */

const { database } = require('../database/database');
const { log } = require('../lib/logger');

// ============================================================
// OEM PART NUMBER PATTERNS
// ============================================================

const PN_PATTERNS = [
  // Chrysler/Mopar: 7-8 digits + 2-letter suffix (56029202AA, 68170467AD)
  { name: 'chrysler', re: /\b(\d{7,8}[A-Z]{2})\b/g },
  // Ford: letter-prefixed with dashes (AL3T-15604-BD, 7C3T-14B205-AA, BC3T-14B476-CG)
  { name: 'ford', re: /\b([A-Z0-9]{2,4}-[A-Z0-9]{4,6}-[A-Z0-9]{1,3})\b/g },
  // Honda/Acura: 5 digits-alphanumeric-alphanumeric (38200-SJC-A15, 39980-T3M-A9)
  { name: 'honda', re: /\b(\d{5}-[A-Z]{2,4}-[A-Z0-9]{1,4})\b/g },
  // Toyota/Lexus: 5 digits-5 alphanumeric (22030-50142, 47200-0C073)
  { name: 'toyota', re: /\b(\d{5}-[A-Z0-9]{4,6})\b/g },
  // Nissan: 5 alphanumeric-5 alphanumeric (284A1-1BA3A, MEC14-345)
  { name: 'nissan', re: /\b([A-Z0-9]{3,5}-[A-Z0-9]{3,5})\b/g },
  // GM: 8 pure digits (15802489, 12576729)
  { name: 'gm', re: /\b(\d{8})\b/g },
  // Bosch: starts with 0, 10 digits total (0280750119)
  { name: 'bosch', re: /\b(0\d{9})\b/g },
  // BMW: 7 digit number with optional letter prefix (1439383)
  { name: 'bmw', re: /\b(\d{7})\b/g },
];

// Year patterns to reject — these are NOT part numbers
const YEAR_RANGE_RE = /^\d{4}$/;
const FULL_YEAR_RE = /^(19|20)\d{2}$/;

/**
 * Extract all OEM part numbers from a title string.
 * Returns array of { raw, base, format }
 */
function extractPartNumbers(title) {
  if (!title) return [];
  const found = new Map(); // dedup by raw

  for (const pat of PN_PATTERNS) {
    const re = new RegExp(pat.re.source, pat.re.flags);
    let m;
    while ((m = re.exec(title)) !== null) {
      const raw = m[1].toUpperCase();
      // Reject year-like numbers
      if (YEAR_RANGE_RE.test(raw) && FULL_YEAR_RE.test(raw)) continue;
      // Reject short generic numbers that are likely years
      if (/^\d{4}$/.test(raw)) continue;
      // Reject if it's just a year range separator caught (2001-2007)
      if (/^\d{4}-\d{2,4}$/.test(raw)) continue;
      if (/^\d{2}-\d{2,4}$/.test(raw)) continue;
      // Nissan pattern is broad — require at least one letter in dash-separated PNs
      if (pat.name === 'nissan' && !/[A-Z]/i.test(raw)) continue;

      if (!found.has(raw)) {
        found.set(raw, {
          raw,
          base: normalizePartNumber(raw),
          format: pat.name
        });
      }
    }
  }

  // Dedup by base — if AL3T-15604-BD and AL3T-15604 both found, keep the longer one
  const byBase = new Map();
  for (const pn of found.values()) {
    const existing = byBase.get(pn.base);
    if (!existing || pn.raw.length > existing.raw.length) {
      byBase.set(pn.base, pn);
    }
  }
  return Array.from(byBase.values());
}

// ============================================================
// PART NUMBER NORMALIZATION (suffix stripping)
// ============================================================

const FORD_SUFFIX = /^([A-Z0-9]+-[A-Z0-9]+)-[A-Z]{1,2}$/;
const CHRYSLER_SUFFIX = /^(\d{7,})[A-Z]{2}$/;
const HONDA_SUFFIX = /^(\d{5}-[A-Z]{2,4})-[A-Z0-9]{1,4}$/;
const GENERIC_SUFFIX = /^(.{6,}?)[A-Z]{2}$/;

function normalizePartNumber(pn) {
  if (!pn || typeof pn !== 'string') return pn || null;
  pn = pn.trim().toUpperCase().replace(/\s+/g, '');
  if (pn.length < 4) return pn;

  // Ford: AL3T-15604-BD → AL3T-15604
  if (pn.includes('-')) {
    const ford = pn.match(FORD_SUFFIX);
    if (ford) return ford[1];
    const honda = pn.match(HONDA_SUFFIX);
    if (honda) return honda[1];
    return pn;
  }

  // Chrysler/GM: 68269652AA → 68269652
  const chrysler = pn.match(CHRYSLER_SUFFIX);
  if (chrysler) return chrysler[1];

  // Generic: strip trailing 2 alpha after 6+ chars
  const generic = pn.match(GENERIC_SUFFIX);
  if (generic) return generic[1];

  return pn;
}

// ============================================================
// VEHICLE / PART PARSING FROM TITLES
// Uses Auto table from database for model recognition
// ============================================================

const MAKES = [
  'ford','toyota','honda','acura','bmw','volvo','infiniti','mazda','lincoln',
  'land rover','saturn','dodge','chrysler','jeep','nissan','buick','pontiac',
  'hyundai','kia','jaguar','lexus','cadillac','mitsubishi','suzuki','geo',
  'chevrolet','chevy','mercedes','ram','volkswagen','vw','audi','subaru',
  'mercury','oldsmobile','plymouth','scion','fiat','hummer','genesis',
  'mini','porsche','saab','isuzu',
];

// Make aliases — map variant names to canonical make for model lookup
const MAKE_ALIASES = {
  'chevy': 'chevrolet', 'vw': 'volkswagen', 'ram': 'dodge',
};

// Model→Make reverse lookup for when title has model but no make word
// (e.g. "Charger 2012 ECM" — Charger implies Dodge)
const MODEL_IMPLIES_MAKE = {
  'charger': 'dodge', 'challenger': 'dodge', 'durango': 'dodge', 'dakota': 'dodge',
  'magnum': 'dodge', 'journey': 'dodge', 'dart': 'dodge', 'neon': 'dodge',
  'grand cherokee': 'jeep', 'wrangler': 'jeep', 'cherokee': 'jeep',
  'compass': 'jeep', 'patriot': 'jeep', 'liberty': 'jeep', 'renegade': 'jeep',
  'pacifica': 'chrysler', 'sebring': 'chrysler', 'pt cruiser': 'chrysler',
  'town country': 'chrysler', 'town & country': 'chrysler',
  'grand caravan': 'dodge', 'caravan': 'dodge',
  'f150': 'ford', 'f250': 'ford', 'f350': 'ford', 'f450': 'ford',
  'explorer': 'ford', 'expedition': 'ford', 'escape': 'ford', 'edge': 'ford',
  'ranger': 'ford', 'fusion': 'ford', 'focus': 'ford', 'mustang': 'ford',
  'taurus': 'ford', 'flex': 'ford', 'bronco': 'ford', 'econoline': 'ford',
  'transit': 'ford', 'transit connect': 'ford', 'five hundred': 'ford',
  'excursion': 'ford', 'windstar': 'ford', 'crown victoria': 'ford',
  'camry': 'toyota', 'corolla': 'toyota', 'tacoma': 'toyota', 'tundra': 'toyota',
  'sequoia': 'toyota', 'highlander': 'toyota', 'rav4': 'toyota', '4runner': 'toyota',
  'prius': 'toyota', 'sienna': 'toyota', 'avalon': 'toyota',
  'accord': 'honda', 'civic': 'honda', 'cr-v': 'honda', 'crv': 'honda',
  'pilot': 'honda', 'odyssey': 'honda', 'ridgeline': 'honda', 'fit': 'honda',
  'tsx': 'acura', 'tl': 'acura', 'mdx': 'acura', 'rdx': 'acura', 'ilx': 'acura',
  'pathfinder': 'nissan', 'titan': 'nissan', 'altima': 'nissan', 'sentra': 'nissan',
  'rogue': 'nissan', 'murano': 'nissan', 'frontier': 'nissan', 'xterra': 'nissan',
  'maxima': 'nissan', 'armada': 'nissan', 'nv200': 'nissan',
  'm35': 'infiniti', 'fx35': 'infiniti', 'q60': 'infiniti', 'g35': 'infiniti', 'qx4': 'infiniti',
  'silverado': 'chevrolet', 'tahoe': 'chevrolet', 'suburban': 'chevrolet',
  'equinox': 'chevrolet', 'traverse': 'chevrolet', 'malibu': 'chevrolet',
  'impala': 'chevrolet', 'camaro': 'chevrolet', 'trailblazer': 'chevrolet',
  'colorado': 'chevrolet', 'blazer': 'chevrolet', 'cobalt': 'chevrolet',
  'yukon': 'gmc', 'sierra': 'gmc', 'terrain': 'gmc', 'envoy': 'gmc', 'acadia': 'gmc',
  'optima': 'kia', 'forte': 'kia', 'soul': 'kia', 'sportage': 'kia',
  'sorento': 'kia', 'sedona': 'kia', 'rio': 'kia',
  'santa fe': 'hyundai', 'tucson': 'hyundai', 'elantra': 'hyundai', 'sonata': 'hyundai',
  'xc90': 'volvo', 'xc70': 'volvo', 's60': 'volvo', 'v70': 'volvo', 'c70': 'volvo',
  'gs300': 'lexus', 'is300': 'lexus', 'rx350': 'lexus', 'es350': 'lexus',
  'jetta': 'volkswagen', 'passat': 'volkswagen', 'golf': 'volkswagen',
  'forester': 'subaru', 'outback': 'subaru', 'impreza': 'subaru',
  'vue': 'saturn', 'ion': 'saturn', 'l100': 'saturn', 'aura': 'saturn',
  'mariner': 'mercury', 'mountaineer': 'mercury', 'grand marquis': 'mercury',
  'lacrosse': 'buick', 'lucerne': 'buick', 'enclave': 'buick',
  'escalade': 'cadillac', 'srx': 'cadillac',
  'town car': 'lincoln', 'navigator': 'lincoln',
  'solstice': 'pontiac', 'grand prix': 'pontiac', 'g6': 'pontiac',
  'montero': 'mitsubishi', 'endeavor': 'mitsubishi', 'outlander': 'mitsubishi',
  'grand vitara': 'suzuki', 'sidekick': 'suzuki',
  'p38': 'land rover', 'range rover': 'land rover', 'discovery': 'land rover',
  'xj6': 'jaguar', 'xk8': 'jaguar', 'xf': 'jaguar',
  'promaster': 'ram', 'ram 1500': 'ram', 'ram 2500': 'ram', 'ram 3500': 'ram',
  'mazda3': 'mazda', 'mazda6': 'mazda', 'miata': 'mazda', 'cx-5': 'mazda',
};

// DB-loaded model cache: { make: [models sorted longest first] }
let _dbModelsByMake = null;
let _dbModelsFlat = null; // flat array for fallback

// Fallback hardcoded models (used before DB loads or if Auto table is empty)
// Multi-word models MUST come before their single-word components
const FALLBACK_MODELS = [
  // Multi-word models first (sorted longest-first at runtime)
  'transit connect','five hundred','grand cherokee','grand caravan','grand vitara',
  'grand prix','grand am','grand marquis','town car','town country','town & country',
  'crown victoria','pt cruiser','land cruiser','fj cruiser','santa fe','santa cruz',
  'ram 1500','ram 2500','ram 3500','range rover',
  // Single-word models
  'challenger','charger','durango','journey','dakota','caravan','dart','magnum','ram',
  'wrangler','cherokee','compass','patriot','liberty','renegade',
  'f150','f250','f350','ranger','explorer','escape','edge','expedition','fusion','focus',
  'mustang','bronco','econoline','flex','transit','excursion','taurus',
  'camry','corolla','tacoma','tundra','sequoia','highlander','rav4','4runner','prius','sienna',
  'accord','civic','cr-v','crv','pilot','odyssey','ridgeline','fit','element','passport',
  'tsx','tl','mdx','rdx','ilx','rsx','integra',
  'pathfinder','titan','altima','sentra','rogue','murano','frontier','xterra','maxima','armada',
  'silverado','tahoe','suburban','equinox','traverse','malibu','impala','camaro','colorado',
  'yukon','sierra','terrain','envoy','acadia','trailblazer','blazer',
  'optima','forte','soul','sportage','sorento','sedona','rio','telluride',
  'santa fe','tucson','elantra','sonata','accent','palisade',
  'jetta','passat','golf','tiguan','beetle',
  'xc90','xc70','s60','s80','v70','c70',
  'forester','outback','impreza','wrx','legacy','crosstrek',
  'town car','navigator','mkz',
  'mariner','mountaineer','sable','grand marquis','milan',
  'lacrosse','lucerne','enclave','regal',
  'vue','ion','aura','l100',
  'pacifica','voyager','pt cruiser','sebring','300','200','promaster',
  'gs300','is300','rx350','es350','gx470',
  'm35','fx35','q60','q40','qx4','g35','g37',
  'mazda3','mazda6','cx-5','miata','tribute',
  'xj6','xk8','xf',
  'grand vitara','sidekick','tracker','metro',
  'montero','endeavor','outlander','eclipse',
  'p38','range rover','discovery',
  'nv200','nv2500','nv3500',
];

/**
 * Load models from the Auto database table and cache them.
 * Organized by make for efficient lookup.
 */
async function loadModelsFromDB() {
  if (_dbModelsByMake) return; // already loaded
  try {
    const rows = await database.raw('SELECT DISTINCT LOWER(make) as make, LOWER(model) as model FROM "Auto" ORDER BY make, model');
    const byMake = {};
    for (const row of (rows.rows || rows)) {
      const make = (row.make || '').trim();
      const model = (row.model || '').trim();
      if (!make || !model || model.length < 2) continue;
      if (!byMake[make]) byMake[make] = new Set();
      byMake[make].add(model);
    }
    // Sort each make's models longest-first (so "Grand Cherokee" matches before "Cherokee")
    _dbModelsByMake = {};
    const flat = new Set();
    for (const [make, models] of Object.entries(byMake)) {
      _dbModelsByMake[make] = [...models].sort((a, b) => b.length - a.length);
      for (const m of models) flat.add(m);
    }
    // Merge fallback models into flat list
    for (const m of FALLBACK_MODELS) flat.add(m);
    _dbModelsFlat = [...flat].sort((a, b) => b.length - a.length);
    log.info({ makes: Object.keys(byMake).length, totalModels: flat.size }, 'Loaded models from Auto table');
  } catch (e) {
    log.warn({ err: e.message }, 'Could not load models from Auto table, using fallback');
    _dbModelsFlat = [...FALLBACK_MODELS].sort((a, b) => b.length - a.length);
    _dbModelsByMake = {};
  }
}

/**
 * Get the model list — from DB if loaded, fallback otherwise.
 */
function getModels(forMake) {
  // If DB models loaded and we know the make, use make-specific list
  if (_dbModelsByMake && forMake) {
    const canonical = MAKE_ALIASES[forMake] || forMake;
    const makeModels = _dbModelsByMake[canonical];
    if (makeModels && makeModels.length > 0) return makeModels;
  }
  // Fallback to flat list
  return _dbModelsFlat || FALLBACK_MODELS;
}

// For backwards compatibility — expose as MODELS (flat list)
const MODELS = FALLBACK_MODELS;

// Part phrases — longest first for greedy matching
const PART_PHRASES = [
  'yaw rate sensor', 'yaw rate', 'ignition switch lock', 'ignition switch',
  'ignition lock', 'body control module', 'brake booster', 'brake accumulator',
  'abs pump assembly', 'abs pump', 'abs brake pump', 'throttle body assembly',
  'throttle body', 'oil cooler housing', 'oil cooler', 'intake manifold',
  'center console lid', 'center console', 'door control module', 'door module',
  'steering angle sensor', 'power steering pump', 'turn signal', 'wiper switch',
  'combo switch', 'spare tire donut', 'spare tire', 'gear shifter',
  'gear selector', 'floor shifter', 'rear window motor', 'window motor',
  'fan solenoid', 'camshaft set', 'transfer case control', 'transfer case module',
  'transfer case', 'rear door hinge', 'fuse relay box', 'fuse junction box',
  'fuse junction', 'fuse relay', 'fuse box', 'bose amp', 'amplifier',
  'window regulator', 'blower motor', 'ac compressor', 'radiator',
  'alternator', 'starter motor', 'starter', 'catalytic converter',
  'wheel bearing', 'strut assembly', 'control arm', 'tie rod',
  'haldex', 'tccm', 'ipdm', 'bcm', 'tipm', 'ecu', 'ecm', 'pcm', 'tcm', 'tcu',
  'abs', 'throttle', 'ignition', 'accumulator',
].sort((a, b) => b.length - a.length);

const STOP_WORDS = new Set([
  'oem','the','and','for','with','only','new','used','genuine','w','a','an',
  'in','on','of','to','or','set','left','right','upper','lower','rear','front',
  'driver','passenger','automatic','manual','electric','non-turbo','turbo',
  'plastic','dark','gray','black','blue','yellow','discount','prices','check',
  'get','plugs','good','shape','not','complete','combo','assembly','unused',
  'tire','needs','show','whiskers','wear','bolt','housing','block','unit',
  'smaller','sedan','coupe','dr','4dr','hybrid','lock','key','keys',
]);

/**
 * Parse a part title into structured components.
 * Returns { make, models[], partPhrase, partWords[], partNumbers[], yearStart, yearEnd }
 */
function parseTitle(title) {
  if (!title) return null;
  const titleLower = title.toLowerCase();

  // Extract year range
  let yearStart = null, yearEnd = null;
  const rangeMatch = title.match(/\b(19|20)(\d{2})\s*[-–]\s*(19|20)?(\d{2})\b/);
  if (rangeMatch) {
    yearStart = parseInt(rangeMatch[1] + rangeMatch[2]);
    const endDigits = rangeMatch[4];
    yearEnd = rangeMatch[3]
      ? parseInt(rangeMatch[3] + endDigits)
      : (endDigits.length === 2 ? parseInt(rangeMatch[1] + endDigits) : parseInt(endDigits));
  } else {
    const singleYear = title.match(/\b(19|20)\d{2}\b/);
    if (singleYear) { yearStart = parseInt(singleYear[0]); yearEnd = yearStart; }
    const shortRange = title.match(/\b(\d{2})\s*[-–]\s*(\d{2})\b/);
    if (shortRange && !rangeMatch) {
      const s = parseInt(shortRange[1]), e = parseInt(shortRange[2]);
      if (s >= 89 && s <= 99) yearStart = 1900 + s;
      else if (s >= 0 && s <= 30) yearStart = 2000 + s;
      if (e >= 89 && e <= 99) yearEnd = 1900 + e;
      else if (e >= 0 && e <= 30) yearEnd = 2000 + e;
    }
  }
  const plusMatch = title.match(/\b(19|20)(\d{2})\+/);
  if (plusMatch && !yearStart) {
    yearStart = parseInt(plusMatch[1] + plusMatch[2]);
    yearEnd = new Date().getFullYear();
  }

  // Extract make
  let make = null;
  for (const m of MAKES) {
    const re = new RegExp('\\b' + m.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i');
    if (re.test(titleLower)) { make = m; break; }
  }

  // Extract models — use DB-loaded models for the detected make
  // Also try all models if no make-specific list (handles "Charger ECM" with no "Dodge" in title)
  const modelList = getModels(make);
  const models = [];
  for (const model of modelList) {
    const re = new RegExp('\\b' + model.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i');
    if (re.test(titleLower)) models.push(model);
  }

  // If no make found but we found models, infer make from model
  if (!make && models.length > 0) {
    for (const m of models) {
      const implied = MODEL_IMPLIES_MAKE[m.toLowerCase()];
      if (implied) { make = implied; break; }
    }
  }

  // Extract part phrase
  let partPhrase = null;
  for (const phrase of PART_PHRASES) {
    if (titleLower.includes(phrase)) { partPhrase = phrase; break; } // already sorted longest first
  }

  // Fallback part words
  let partWords = [];
  if (!partPhrase) {
    const cleaned = title
      .replace(/\([^)]*\)/g, '')
      .replace(/\b[A-Z][A-Z0-9]+-[A-Z0-9]+(?:-[A-Z0-9]+)*\b/g, '')
      .replace(/\b\d+\b/g, '')
      .replace(/[^a-zA-Z\s]/g, ' ');
    const makesSet = new Set(MAKES);
    const modelsSet = new Set(MODELS);
    partWords = cleaned.split(/\s+/)
      .map(w => w.toLowerCase().trim())
      .filter(w => w.length >= 3 && !STOP_WORDS.has(w) && !makesSet.has(w) && !modelsSet.has(w));
    partWords = [...new Set(partWords)].slice(0, 3);
  }

  // Extract part numbers
  const partNumbers = extractPartNumbers(title);

  // Deduplicate models: if "transit connect" and "transit" both found,
  // remove "transit" because "transit connect" is more specific
  const dedupedModels = models.filter(m => {
    return !models.some(other => other !== m && other.includes(m));
  });

  return { make, models: dedupedModels, partPhrase, partWords, partNumbers, yearStart, yearEnd };
}

// ============================================================
// SIMILAR PART NUMBER DETECTION
// ============================================================

/**
 * Find listings/sales with part numbers that differ by only the last character.
 * Returns { listings: [{ title, pn }], sales: { count, avgPrice }, similarPN }
 */
async function findSimilarPartNumbers(partNumbers) {
  if (!partNumbers || partNumbers.length === 0) return null;

  const knex = database;
  const realPNs = partNumbers.filter(pn => /[A-Z]/i.test(pn.raw));
  if (realPNs.length === 0) return null;

  // For each PN, strip last char to get stem, search for stem + any single char
  const results = [];
  for (const pn of realPNs) {
    const raw = pn.raw;
    if (raw.length < 3) continue;
    const stem = raw.slice(0, -1); // everything except last char

    // Search listings with stem prefix
    const listings = await knex('YourListing')
      .where('listingStatus', 'Active')
      .andWhere('title', 'ilike', `%${stem}%`)
      .andWhereNot('title', 'ilike', `%${raw}%`) // exclude exact matches
      .select('title')
      .limit(10);

    // Filter: only keep if the actual matched PN differs by exactly the last char
    const similar = [];
    for (const l of listings) {
      // Find the PN in the listing title that starts with our stem
      const titleUpper = l.title.toUpperCase();
      const stemIdx = titleUpper.indexOf(stem);
      if (stemIdx === -1) continue;
      // Extract the character after the stem
      const nextChar = titleUpper[stemIdx + stem.length];
      if (!nextChar || /\s/.test(nextChar)) continue; // stem is at end, no difference
      // Verify it's just one char different (the PN ends right after)
      const afterPN = titleUpper[stemIdx + stem.length + 1];
      if (afterPN && /[A-Z0-9]/i.test(afterPN)) continue; // more than 1 char different
      const foundPN = stem + nextChar;
      if (foundPN !== raw) {
        similar.push({ title: l.title, similarPN: foundPN });
      }
    }

    if (similar.length === 0) continue;

    // Get sales data for the similar PN
    const similarPN = similar[0].similarPN;
    const salesData = await knex('YourSale')
      .where('title', 'ilike', `%${similarPN}%`)
      .select(
        knex.raw('COUNT(*) as count'),
        knex.raw('AVG("salePrice") as avg_price')
      ).first();

    results.push({
      originalPN: raw,
      similarPN,
      stockCount: similar.length,
      stockTitles: similar.slice(0, 3).map(s => s.title),
      soldCount: parseInt(salesData?.count) || 0,
      avgPrice: salesData?.avg_price ? Math.round(parseFloat(salesData.avg_price)) : null,
    });
  }

  return results.length > 0 ? results : null;
}

// ============================================================
// MATCHING FUNCTIONS
// ============================================================

/**
 * Extract year(s) from a listing title for year-range filtering.
 * Returns { start, end } or null.
 */
function extractYearsFromTitle(title) {
  const range = title.match(/\b(19|20)(\d{2})\s*[-–]\s*(19|20)?(\d{2})\b/);
  if (range) {
    const start = parseInt(range[1] + range[2]);
    const end = range[3] ? parseInt(range[3] + range[4]) : parseInt(range[1] + range[4]);
    return { start, end };
  }
  const single = title.match(/\b((?:19|20)\d{2})\b/);
  if (single) { const y = parseInt(single[1]); return { start: y, end: y }; }
  return null;
}

/**
 * Filter listing results by year overlap with want list year range.
 * A listing matches if its year range overlaps the want list year range.
 */
function filterByYear(listings, wantYearStart, wantYearEnd) {
  if (!wantYearStart || !wantYearEnd) return listings; // no year to filter on
  return listings.filter(l => {
    const ly = extractYearsFromTitle(l.title || '');
    if (!ly) return true; // can't determine listing year — keep it (conservative)
    // Check overlap: listing range overlaps want range
    return ly.start <= wantYearEnd && ly.end >= wantYearStart;
  });
}

/**
 * Match a part title against YourListing (active listings).
 * Priority: 1) Part number  2) Year + Model + Part type
 * Returns { stock, matchedTitles[], method, debug }
 */
async function matchPartToListings(partTitle) {
  const parsed = parseTitle(partTitle);
  if (!parsed) return { stock: 0, matchedTitles: [], method: 'none', debug: 'Could not parse title' };

  const knex = database;
  const yearLabel = (parsed.yearStart && parsed.yearEnd)
    ? (parsed.yearStart === parsed.yearEnd ? String(parsed.yearStart) : parsed.yearStart + '-' + parsed.yearEnd)
    : null;

  // Strategy 1: Part number match (highest confidence — don't fall back)
  const realPNs = (parsed.partNumbers || []).filter(pn => /[A-Z]/i.test(pn.raw));
  if (realPNs.length > 0) {
    let q = knex('YourListing').where('listingStatus', 'Active');
    q = q.where(function() {
      for (const pn of realPNs) {
        this.orWhere('title', 'ilike', `%${pn.raw}%`);
        if (pn.base !== pn.raw) this.orWhere('title', 'ilike', `%${pn.base}%`);
      }
    });
    const listings = await q.select('title').limit(20);
    const pnDebug = `PN: ${realPNs.map(p => p.raw).join(', ')}`;

    // Find similar PNs (last char differs)
    const similar = await findSimilarPartNumbers(parsed.partNumbers);

    // PN match is definitive — return result even if 0
    return {
      stock: listings.length,
      matchedTitles: listings.map(l => l.title),
      method: 'part_number',
      debug: `${pnDebug} (${listings.length} found)`,
      similar, // array of { originalPN, similarPN, stockCount, soldCount, avgPrice } or null
    };
  }

  // Strategy 2: Year + Model + Part phrase (requires all three)
  if (parsed.models.length > 0 && parsed.partPhrase) {
    let q = knex('YourListing').where('listingStatus', 'Active');
    q = q.where(function() {
      for (const model of parsed.models) this.orWhere('title', 'ilike', `%${model}%`);
    });
    q = q.andWhere('title', 'ilike', `%${parsed.partPhrase}%`);
    const allListings = await q.select('title').limit(50);
    const filtered = filterByYear(allListings, parsed.yearStart, parsed.yearEnd);
    const debug = [yearLabel, parsed.models.join('/'), '"' + parsed.partPhrase + '"'].filter(Boolean).join(' + ');
    return {
      stock: filtered.length,
      matchedTitles: filtered.slice(0, 10).map(l => l.title),
      method: 'model_phrase',
      debug: `${debug} (${filtered.length} found)`
    };
  }

  // Strategy 3: Year + Make + Part phrase
  if (parsed.make && parsed.partPhrase) {
    let q = knex('YourListing').where('listingStatus', 'Active');
    q = q.andWhere('title', 'ilike', `%${parsed.make}%`);
    q = q.andWhere('title', 'ilike', `%${parsed.partPhrase}%`);
    const allListings = await q.select('title').limit(50);
    const filtered = filterByYear(allListings, parsed.yearStart, parsed.yearEnd);
    const debug = [yearLabel, parsed.make, '"' + parsed.partPhrase + '"'].filter(Boolean).join(' + ');
    return {
      stock: filtered.length,
      matchedTitles: filtered.slice(0, 10).map(l => l.title),
      method: 'make_phrase',
      debug: `${debug} (${filtered.length} found)`
    };
  }

  // Strategy 4: Year + Model + fallback words
  if (parsed.models.length > 0 && parsed.partWords.length >= 2) {
    let q = knex('YourListing').where('listingStatus', 'Active');
    q = q.where(function() {
      for (const model of parsed.models) this.orWhere('title', 'ilike', `%${model}%`);
    });
    for (const w of parsed.partWords) q = q.andWhere('title', 'ilike', `%${w}%`);
    const allListings = await q.select('title').limit(50);
    const filtered = filterByYear(allListings, parsed.yearStart, parsed.yearEnd);
    const debug = [yearLabel, parsed.models.join('/'), '[' + parsed.partWords.join(', ') + ']'].filter(Boolean).join(' + ');
    return {
      stock: filtered.length,
      matchedTitles: filtered.slice(0, 10).map(l => l.title),
      method: 'model_words',
      debug: `${debug} (${filtered.length} found, approx)`
    };
  }

  return { stock: 0, matchedTitles: [], method: 'none', debug: 'No match criteria (need model + part type)' };
}

/**
 * Match a part title against YourSale.
 * Returns { count, avgPrice, lastSold, method, debug }
 */
async function matchPartToSales(partTitle) {
  const parsed = parseTitle(partTitle);
  if (!parsed) return { count: 0, avgPrice: null, lastSold: null, method: 'none' };

  const knex = database;

  // Build query using same strategy priority as listings
  let q = knex('YourSale');
  let method = 'none';
  let debug = '';

  const realPNs = (parsed.partNumbers || []).filter(pn => /[A-Z]/i.test(pn.raw));

  if (realPNs.length > 0) {
    q = q.where(function() {
      for (const pn of realPNs) {
        this.orWhere('title', 'ilike', `%${pn.raw}%`);
        if (pn.base !== pn.raw) this.orWhere('title', 'ilike', `%${pn.base}%`);
      }
    });
    method = 'part_number';
    debug = `PN: ${realPNs.map(p => p.raw).join(', ')}`;
  } else if (parsed.models.length > 0 && parsed.partPhrase) {
    q = q.where(function() {
      for (const model of parsed.models) this.orWhere('title', 'ilike', `%${model}%`);
    });
    q = q.andWhere('title', 'ilike', `%${parsed.partPhrase}%`);
    method = 'model_phrase';
    debug = `${parsed.models.join('/')} + "${parsed.partPhrase}"`;
  } else if (parsed.make && parsed.partPhrase) {
    q = q.andWhere('title', 'ilike', `%${parsed.make}%`);
    q = q.andWhere('title', 'ilike', `%${parsed.partPhrase}%`);
    method = 'make_phrase';
    debug = `${parsed.make} + "${parsed.partPhrase}"`;
  } else if (parsed.models.length > 0 && parsed.partWords.length >= 2) {
    q = q.where(function() {
      for (const model of parsed.models) this.orWhere('title', 'ilike', `%${model}%`);
    });
    for (const w of parsed.partWords) q = q.andWhere('title', 'ilike', `%${w}%`);
    method = 'model_words';
    debug = `${parsed.models.join('/')} + [${parsed.partWords.join(', ')}]`;
  } else {
    return { count: 0, avgPrice: null, lastSold: null, method: 'none', debug: 'No match criteria' };
  }

  const result = await q.select(
    knex.raw('AVG("salePrice") as avg_price'),
    knex.raw('MAX("soldDate") as last_sold'),
    knex.raw('COUNT(*) as sold_count')
  ).first();

  const count = parseInt(result?.sold_count) || 0;
  return {
    count,
    avgPrice: count > 0 ? Math.round(parseFloat(result.avg_price) || 0) : null,
    lastSold: count > 0 ? result.last_sold : null,
    method,
    debug
  };
}

/**
 * Match a part title against yard_vehicle table.
 * Returns array of { year, make, model, color, row, yard, daysAgo }
 */
async function matchPartToYardVehicles(partTitle) {
  const parsed = parseTitle(partTitle);
  if (!parsed || (!parsed.make && parsed.models.length === 0)) return [];

  const knex = database;
  let q = knex('yard_vehicle')
    .join('yard', 'yard.id', 'yard_vehicle.yard_id')
    .where('yard_vehicle.active', true)
    .where('yard.enabled', true);

  if (parsed.make) q = q.where('yard_vehicle.make', 'ilike', `%${parsed.make}%`);
  if (parsed.models.length > 0) {
    q = q.where(function() {
      for (const model of parsed.models) this.orWhere('yard_vehicle.model', 'ilike', `%${model}%`);
    });
  }
  if (parsed.yearStart) q = q.where('yard_vehicle.year', '>=', String(parsed.yearStart));
  if (parsed.yearEnd) q = q.where('yard_vehicle.year', '<=', String(parsed.yearEnd));

  const vehicles = await q.select(
    'yard_vehicle.year', 'yard_vehicle.make', 'yard_vehicle.model',
    'yard_vehicle.color', 'yard_vehicle.row_number', 'yard_vehicle.date_added',
    'yard_vehicle.engine', 'yard_vehicle.drivetrain', 'yard_vehicle.trim_level',
    'yard.name as yard_name'
  ).orderBy('yard_vehicle.date_added', 'desc').limit(20);

  return vehicles.map(v => {
    const daysAgo = v.date_added
      ? Math.floor((Date.now() - new Date(v.date_added).getTime()) / 86400000)
      : null;
    return {
      year: v.year, make: v.make, model: v.model, color: v.color,
      row: v.row_number || '?', yard: v.yard_name,
      engine: v.engine, drivetrain: v.drivetrain, trim: v.trim_level,
      daysAgo: daysAgo !== null ? (daysAgo <= 0 ? 'today' : daysAgo + 'd ago') : '?'
    };
  });
}

module.exports = {
  extractPartNumbers,
  extractYearsFromTitle,
  normalizePartNumber,
  parseTitle,
  findSimilarPartNumbers,
  matchPartToListings,
  matchPartToSales,
  matchPartToYardVehicles,
  loadModelsFromDB,
  MAKES,
  MODELS,
  PART_PHRASES,
};
