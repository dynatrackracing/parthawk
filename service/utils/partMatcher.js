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
  'f150','f250','f350','vue','tsx','ridgeline','xc90','xc70','coupe','m35',
  'sequoia','mazda6','town car','p38','dakota','durango','fusion','corolla',
  'gs300','charger','accord','srx','ranger','econoline','cr-v','crv','endeavor',
  'titan','pathfinder','qx4','grand vitara','tundra','lacrosse','lucerne',
  'grand prix','c70','s70','v70','miata','montero','xterra','santa fe',
  'xg350','xj6','xk8','explorer','transit','transit connect','fx35','ilx',
  'tl','escalade','grand cherokee','jetta','trailblazer','rav4','nv200',
  'nv2500','nv3500','pilot','flex','c230','prius','s550','rdx',
  'five hundred','solstice','tacoma','4runner','mdx','promaster','t100',
  'metro','sidekick','tracker','odyssey','caravan','dart','sienna',
  'pacifica','voyager','camaro','300','l100','q60','q40','ram',
  'civic','camry','highlander','rav4','sentra','altima','rogue','murano',
  'forester','outback','impreza','wrx','wrangler','compass','patriot',
  'equinox','traverse','malibu','impala','silverado','tahoe','suburban',
  'yukon','sierra','terrain','envoy','cobalt','cruze','sonic','spark',
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
// MATCHING FUNCTIONS
// ============================================================

/**
 * Match a part title against YourListing (active listings).
 * Returns { stock, matchedTitles[], method, debug }
 */
async function matchPartToListings(partTitle) {
  const parsed = parseTitle(partTitle);
  if (!parsed) return { stock: 0, matchedTitles: [], method: 'none', debug: 'Could not parse title' };

  const knex = database;

  // Strategy 1: Part number match (most accurate)
  if (parsed.partNumbers.length > 0) {
    const realPNs = parsed.partNumbers.filter(pn => /[A-Z]/i.test(pn.raw));
    if (realPNs.length > 0) {
      let q = knex('YourListing').where('listingStatus', 'Active');
      q = q.where(function() {
        for (const pn of realPNs) {
          this.orWhere('title', 'ilike', `%${pn.raw}%`);
          if (pn.base !== pn.raw) this.orWhere('title', 'ilike', `%${pn.base}%`);
        }
      });
      const listings = await q.select('title').limit(10);
      if (listings.length > 0) {
        return {
          stock: listings.length >= 10 ? await countQuery(knex, realPNs) : listings.length,
          matchedTitles: listings.map(l => l.title),
          method: 'part_number',
          debug: `PN: ${realPNs.map(p => p.raw).join(', ')}`
        };
      }
    }
  }

  // Strategy 2: Model + part phrase (best keyword match)
  if (parsed.models.length > 0 && parsed.partPhrase) {
    let q = knex('YourListing').where('listingStatus', 'Active');
    q = q.where(function() {
      for (const model of parsed.models) this.orWhere('title', 'ilike', `%${model}%`);
    });
    q = q.andWhere('title', 'ilike', `%${parsed.partPhrase}%`);
    const listings = await q.select('title').limit(10);
    return {
      stock: listings.length >= 10 ? await countFull(knex, parsed) : listings.length,
      matchedTitles: listings.map(l => l.title),
      method: 'model_phrase',
      debug: `${parsed.models.join('/')} + "${parsed.partPhrase}"`
    };
  }

  // Strategy 3: Make + part phrase
  if (parsed.make && parsed.partPhrase) {
    let q = knex('YourListing').where('listingStatus', 'Active');
    q = q.andWhere('title', 'ilike', `%${parsed.make}%`);
    q = q.andWhere('title', 'ilike', `%${parsed.partPhrase}%`);
    const listings = await q.select('title').limit(10);
    return {
      stock: listings.length,
      matchedTitles: listings.map(l => l.title),
      method: 'make_phrase',
      debug: `${parsed.make} + "${parsed.partPhrase}"`
    };
  }

  // Strategy 4: Model + fallback words
  if (parsed.models.length > 0 && parsed.partWords.length >= 2) {
    let q = knex('YourListing').where('listingStatus', 'Active');
    q = q.where(function() {
      for (const model of parsed.models) this.orWhere('title', 'ilike', `%${model}%`);
    });
    for (const w of parsed.partWords) q = q.andWhere('title', 'ilike', `%${w}%`);
    const listings = await q.select('title').limit(10);
    return {
      stock: listings.length,
      matchedTitles: listings.map(l => l.title),
      method: 'model_words',
      debug: `${parsed.models.join('/')} + [${parsed.partWords.join(', ')}] (approx)`
    };
  }

  return { stock: 0, matchedTitles: [], method: 'none', debug: 'No match criteria (need model + part type)' };
}

async function countQuery(knex, realPNs) {
  let q = knex('YourListing').where('listingStatus', 'Active');
  q = q.where(function() {
    for (const pn of realPNs) {
      this.orWhere('title', 'ilike', `%${pn.raw}%`);
      if (pn.base !== pn.raw) this.orWhere('title', 'ilike', `%${pn.base}%`);
    }
  });
  const [{ count }] = await q.count('* as count');
  return parseInt(count) || 0;
}

async function countFull(knex, parsed) {
  let q = knex('YourListing').where('listingStatus', 'Active');
  q = q.where(function() {
    for (const model of parsed.models) this.orWhere('title', 'ilike', `%${model}%`);
  });
  q = q.andWhere('title', 'ilike', `%${parsed.partPhrase}%`);
  const [{ count }] = await q.count('* as count');
  return parseInt(count) || 0;
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
  normalizePartNumber,
  parseTitle,
  matchPartToListings,
  matchPartToSales,
  matchPartToYardVehicles,
  MAKES,
  MODELS,
  PART_PHRASES,
};
