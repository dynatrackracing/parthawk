'use strict';

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
// ============================================================

const MAKES = [
  'ford','toyota','honda','acura','bmw','volvo','infiniti','mazda','lincoln',
  'land rover','saturn','dodge','chrysler','jeep','nissan','buick','pontiac',
  'hyundai','kia','jaguar','lexus','cadillac','mitsubishi','suzuki','geo',
  'chevrolet','chevy','mercedes','ram','volkswagen','vw','audi','subaru',
  'mercury','oldsmobile','plymouth','scion','fiat','hummer','genesis',
  'mini','porsche','saab','isuzu',
];

const MODELS = [
  // Ford
  'f150','f250','f350','f450','ranger','explorer','expedition','escape','edge',
  'fusion','focus','taurus','mustang','bronco','econoline','e-series','e series',
  'five hundred','flex','transit','transit connect','excursion','freestyle',
  'windstar','contour','crown victoria','thunderbird',
  // Toyota
  'camry','corolla','tacoma','tundra','sequoia','highlander','rav4','4runner',
  'prius','sienna','avalon','celica','matrix','yaris','venza','supra','fj cruiser',
  'land cruiser','t100',
  // Honda
  'accord','civic','cr-v','crv','pilot','odyssey','ridgeline','fit','hr-v',
  'element','insight','passport','prelude',
  // Acura
  'tsx','tl','mdx','rdx','ilx','rl','rsx','integra','cl','legend',
  // Nissan
  'pathfinder','titan','altima','sentra','rogue','murano','frontier','xterra',
  'maxima','versa','quest','armada','nv200','nv2500','nv3500','juke','leaf',
  // Infiniti
  'm35','m45','fx35','fx45','q60','q50','q40','qx4','qx56','qx60','g35','g37',
  // Dodge/Chrysler/Jeep/Ram
  'charger','challenger','durango','dakota','caravan','grand caravan','dart',
  'magnum','neon','stratus','avenger','journey','nitro',
  'grand cherokee','wrangler','compass','patriot','liberty','cherokee','renegade',
  'ram','ram 1500','ram 2500','ram 3500','promaster',
  'pacifica','voyager','town country','town & country','pt cruiser','sebring',
  '200','300',
  // GM
  'silverado','tahoe','suburban','equinox','traverse','malibu','impala',
  'camaro','corvette','cobalt','cruze','sonic','spark','trax','blazer','colorado',
  'yukon','sierra','terrain','envoy','acadia','canyon','savana','denali',
  'lacrosse','lucerne','enclave','encore','regal','verano','rendezvous',
  'solstice','g6','grand prix','grand am',
  // Kia/Hyundai
  'optima','forte','soul','sportage','sorento','sedona','rio','telluride',
  'santa fe','tucson','elantra','sonata','accent','veloster','genesis','xg350',
  'palisade','kona','venue','santa cruz',
  // Subaru
  'forester','outback','impreza','wrx','legacy','crosstrek','ascent','brz',
  // VW/Audi
  'jetta','passat','golf','tiguan','atlas','beetle','cc','touareg',
  'a4','a6','q5','q7','a3','a5','s4','tt',
  // BMW
  'x3','x5','x1','328i','335i','528i','530i','325i',
  // Mercedes
  's550','c230','c300','e350','ml350','gl450','cls','slk',
  // Volvo
  'xc90','xc70','xc60','s60','s80','v70','c70','s70','c30','v50',
  // Mazda
  'mazda3','mazda6','cx-5','cx-9','miata','rx-8','tribute','mpv',
  // Jaguar
  'xj6','xk8','xf','s-type','x-type',
  // Lexus
  'gs300','gs350','is300','is250','rx350','rx330','es350','es300','ls430','gx470',
  // Other
  'vue','l100','l200','l300','ion','aura','sky', // Saturn
  'sidekick','tracker','grand vitara','vitara','xl-7', // Suzuki/Geo
  'metro','prizm','storm', // Geo
  'town car','navigator','mkz','mkx','continental', // Lincoln
  'mountaineer','mariner','sable','villager','grand marquis','milan', // Mercury
  'p38','range rover','discovery','lr3','lr4','freelander', // Land Rover
  'montero','endeavor','outlander','eclipse','galant','lancer', // Mitsubishi
  'coupe','m35', // generic
];

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

  // Extract models
  const models = [];
  for (const model of MODELS) {
    const re = new RegExp('\\b' + model.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i');
    if (re.test(titleLower)) models.push(model);
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

  return { make, models, partPhrase, partWords, partNumbers, yearStart, yearEnd };
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
  MAKES,
  MODELS,
  PART_PHRASES,
};
