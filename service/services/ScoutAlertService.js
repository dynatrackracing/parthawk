'use strict';

const { database } = require('../database/database');
const { log } = require('../lib/logger');
const { parseTitle, matchPartToSales, loadModelsFromDB } = require('../utils/partMatcher');
const { modelMatches: piModelMatches, parseYearRange: piParseYear, extractPartNumbers: piExtractPNs, detectPartType } = require('../utils/partIntelligence');

// Concurrency guard — only one generateAlerts() at a time
let _running = false;

// Which vehicle attributes matter for confidence, by part type
const PART_TYPE_SENSITIVITY = {
  // Engine-sensitive — wrong engine = wrong part
  ECM: ['engine'], PCM: ['engine'], THROTTLE: ['engine'],
  // Transmission-sensitive
  TCM: ['engine', 'drivetrain'],
  // Drivetrain-sensitive — 2WD/4WD ABS modules differ
  ABS: ['drivetrain'],
  // Trim-sensitive — premium audio on certain trims only
  AMP: ['trim'], RADIO: ['trim'], NAV: ['trim'],
  // Universal — same part across all variants
  BCM: [], TIPM: [], CLUSTER: [], HEADLIGHT: [], TAILLIGHT: [],
  MIRROR: [], VISOR: [], SUNROOF: [], STEERING: [], CAMERA: [],
  BLIND_SPOT: [], HVAC: [], ALTERNATOR: [], STARTER: [], BLOWER: [],
  AIR_RIDE: [], REGULATOR: [], LIFTGATE: [], LOCK: [], PARK_SENSOR: [],
  CLOCK_SPRING: [], IGNITION: [], FUEL_MODULE: [],
};

// Model conflict pairs — one must NOT match the other
const MODEL_CONFLICTS = [
  ['cherokee', 'grand cherokee'],
  ['caravan', 'grand caravan'],
  ['transit', 'transit connect'],
  ['wrangler', 'gladiator'],
];

// Engine names for matching
const ENGINE_NAMES = ['hemi', 'ecoboost', 'coyote', 'pentastar', 'duratec', 'ecotec', 'skyactiv', 'vortec', 'duramax', 'powerstroke', 'triton'];

// Part exclusion — same as AttackListService.isExcludedPart()
function isExcludedPart(title) {
  const t = (title || '').toUpperCase();
  if (/\b(ENGINE|MOTOR) ASSEMBLY\b/.test(t)) return true;
  if (/\b(LONG|SHORT) BLOCK\b/.test(t)) return true;
  if (/\b(COMPLETE|CRATE|REMAN) ENGINE\b/.test(t)) return true;
  if (/\bENGINE BLOCK\b/.test(t)) return true;
  if (/\bCYLINDER HEAD\b/.test(t)) return true;
  if (/\b(PISTON|CRANKSHAFT|CONNECTING ROD|HEAD GASKET)\b/.test(t)) return true;
  if (/\b(OIL PAN|TIMING CHAIN|TIMING BELT|ROCKER ARM|LIFTER|PUSHROD)\b/.test(t)) return true;
  if (/\b(OIL PUMP|FLYWHEEL|FLEXPLATE)\b/.test(t)) return true;
  if (/\b(TRANSMISSION|TRANSAXLE) ASSEMBLY\b/.test(t)) return true;
  if (/\b(COMPLETE|REMAN) TRANSMISSION\b/.test(t)) return true;
  if (/\bFENDER\b/.test(t)) return true;
  if (/\bBUMPER (COVER|ASSEMBLY)\b/.test(t)) return true;
  if (/\bHOOD PANEL\b/.test(t)) return true;
  if (/\bDOOR SHELL\b/.test(t)) return true;
  if (/\b(QUARTER|ROCKER) PANEL\b/.test(t)) return true;
  if (/\b(BED SIDE|TRUCK BED|TRUNK LID|ROOF PANEL)\b/.test(t)) return true;
  return false;
}

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
  // Concurrency guard — skip if already running
  if (_running) {
    log.warn('generateAlerts already running — skipping');
    return { alerts: 0, skipped: true };
  }
  _running = true;

  try {
    return await _generateAlertsInner();
  } finally {
    _running = false;
  }
}

async function _generateAlertsInner() {
  const startTime = Date.now();
  log.info('Generating scout alerts...');

  // Disk space safety check — skip if DB over 4GB (on 5GB volume)
  try {
    const [{ db_size }] = await database.raw('SELECT pg_database_size(current_database()) as db_size');
    const sizeMB = Math.round(db_size / 1024 / 1024);
    log.info({ dbSizeMB: sizeMB }, 'DB size check');
    if (sizeMB > 4000) {
      log.error({ dbSizeMB: sizeMB }, 'DB over 4GB — skipping scout alert generation to prevent disk full crash');
      return { alerts: 0, skipped: true, reason: 'disk_full' };
    }
  } catch (e) {
    log.warn({ err: e.message }, 'Could not check DB size — proceeding anyway');
  }

  // Ensure models are loaded from Auto table before parsing
  await loadModelsFromDB();

  // 1. Get active yard vehicles from ELIGIBLE yards only:
  //    - Core yards (not on any flyway trip — scraped independently)
  //    - Yards on an ACTIVE flyway trip
  //    Excludes vehicles from completed/expired trips that haven't been cleaned up yet.
  const vehicles = await database('yard_vehicle')
    .join('yard', 'yard.id', 'yard_vehicle.yard_id')
    .where('yard_vehicle.active', true)
    .where('yard.enabled', true)
    .where(function() {
      // Core/local yards always generate alerts
      this.where('yard.is_core', true)
        // OR yards on an active Flyway trip
        .orWhereIn('yard.id',
          database('flyway_trip_yard')
            .join('flyway_trip', 'flyway_trip.id', 'flyway_trip_yard.trip_id')
            .where('flyway_trip.status', 'active')
            .select('flyway_trip_yard.yard_id')
        );
    })
    .select(
      'yard_vehicle.id as yard_vehicle_id',
      'yard_vehicle.year', 'yard_vehicle.make', 'yard_vehicle.model',
      'yard_vehicle.color', 'yard_vehicle.row_number', 'yard_vehicle.date_added',
      'yard_vehicle.engine', 'yard_vehicle.drivetrain', 'yard_vehicle.trim_level',
      'yard_vehicle.decoded_trim', 'yard_vehicle.decoded_engine',
      'yard_vehicle.decoded_drivetrain', 'yard_vehicle.decoded_transmission',
      'yard_vehicle.diesel', 'yard_vehicle.trim_tier', 'yard_vehicle.body_style',
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
      .where('soldDate', '>=', database.raw("NOW() - INTERVAL '90 days'"))
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
    // Stock filter — skip parts we already have listed
    const activeListings = await database('YourListing')
      .where('listingStatus', 'Active')
      .select('title');
    const stockPNs = new Set();
    for (const listing of activeListings) {
      const pns = piExtractPNs(listing.title || '');
      for (const pn of pns) {
        stockPNs.add(pn.normalized);
        if (pn.base !== pn.normalized) stockPNs.add(pn.base);
      }
    }

    let boneSkipped = 0;
    for (const part of seen.values()) {
      const salePNs = piExtractPNs(part.title || '');
      const hasStock = salePNs.some(pn => stockPNs.has(pn.normalized) || stockPNs.has(pn.base));
      if (!hasStock) {
        partsToMatch.push(part);
      } else {
        boneSkipped++;
      }
    }
    log.info({ bonePileTotal: seen.size, filtered: seen.size - boneSkipped, skippedInStock: boneSkipped, stockPNCount: stockPNs.size }, 'Bone pile stock filter');
  } catch (e) {
    log.warn({ err: e.message }, 'Failed to load bone pile data');
  }

  // THE MARK — active marks from Hunters Perch (highest priority)
  let markAlerts = [];
  try {
    const activeMarks = await database('the_mark')
      .where('active', true)
      .where(function() {
        this.where('needs_review', false).orWhereNull('needs_review');
      });
    if (activeMarks.length > 0) {
      markAlerts = matchMarksAgainstVehicles(activeMarks, vehicles);
      log.info({ markCount: activeMarks.length, alertsGenerated: markAlerts.length }, 'Mark matching complete');
    }
  } catch (e) {
    log.warn({ err: e.message }, 'Failed to load marks for alert generation');
  }

  // RESTOCK FLAGS — parts flagged for restock matched against yard vehicles
  try {
    const restockFlags = await database('restock_flag')
      .where('acknowledged', false)
      .select('part_number_base', 'title', 'avg_sold_price', 'sold_90d', 'active_stock', 'restock_score');

    for (const flag of restockFlags) {
      const parsed = parseTitle(flag.title);
      if (!parsed || parsed.models.length === 0) continue;
      partsToMatch.push({
        source: 'restock',
        title: flag.title,
        value: Math.round(parseFloat(flag.avg_sold_price) || 0),
        make: parsed.make,
        models: parsed.models,
        yearStart: parsed.yearStart,
        yearEnd: parsed.yearEnd,
      });
    }
    log.info({ restockFlags: restockFlags.length, matched: partsToMatch.filter(p => p.source === 'restock').length }, 'Restock flags loaded');
  } catch (e) {
    log.warn({ err: e.message }, 'Failed to load restock flags (table may not exist)');
  }

  // 3. Match want list / quarry parts against yard vehicles
  const alerts = [];
  for (const part of partsToMatch) {
    if (isExcludedPart(part.title)) continue;
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

  // 4. Snapshot claimed alerts before wipe so we can restore them
  const claimedAlerts = await database('scout_alerts')
    .where('claimed', true)
    .whereNot('source', 'OVERSTOCK')
    .select('source', 'source_title', 'vehicle_year', 'vehicle_make', 'vehicle_model', 'yard_name', 'claimed_by', 'claimed_at');
  const claimedKeys = new Set(
    claimedAlerts.map(a => [a.source, a.source_title, a.vehicle_year, (a.vehicle_make || '').toLowerCase(), (a.vehicle_model || '').toLowerCase(), (a.yard_name || '').toLowerCase()].join('|'))
  );

  // Transaction: delete + insert atomically (crash between them won't leave table empty)
  await database.transaction(async (trx) => {
    await trx('scout_alerts').whereNot('source', 'OVERSTOCK').del();
    for (let i = 0; i < alerts.length; i += 50) {
      await trx('scout_alerts').insert(alerts.slice(i, i + 50));
    }
  });

  // Restore claimed status for alerts that still match (outside txn — non-critical)
  if (claimedKeys.size > 0) {
    try {
      const newAlerts = await database('scout_alerts')
        .whereNot('source', 'OVERSTOCK')
        .select('id', 'source', 'source_title', 'vehicle_year', 'vehicle_make', 'vehicle_model', 'yard_name');

      const toRestore = [];
      for (const a of newAlerts) {
        const key = [a.source, a.source_title, a.vehicle_year, (a.vehicle_make || '').toLowerCase(), (a.vehicle_model || '').toLowerCase(), (a.yard_name || '').toLowerCase()].join('|');
        if (claimedKeys.has(key)) {
          toRestore.push(a.id);
        }
      }

      if (toRestore.length > 0) {
        for (let i = 0; i < toRestore.length; i += 50) {
          await database('scout_alerts')
            .whereIn('id', toRestore.slice(i, i + 50))
            .update({ claimed: true, claimed_at: new Date().toISOString() });
        }
        log.info({ restored: toRestore.length, totalClaimed: claimedKeys.size }, 'Restored claimed status for persisted alerts');
      }
    } catch (e) {
      log.warn({ err: e.message }, 'Failed to restore claimed status (non-fatal)');
    }
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
    const parsed = getMarkVehicle(mark);
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
 * Get structured vehicle data from a mark row.
 * Reads from the structured columns (year_start, year_end, make, model)
 * populated at insert time. Engine is still extracted from title since
 * we don't store it structured.
 */
function getMarkVehicle(mark) {
  const title = mark.originalTitle || '';
  const engineMatch = title.match(/\b(\d\.\d)[\s-]?[lL]?\b/);
  const engineStr = engineMatch ? engineMatch[1] + 'L' : null;

  const titleLower = title.toLowerCase();
  let engineName = null;
  if (/hemi/.test(titleLower)) engineName = 'HEMI';
  else if (/ecoboost/.test(titleLower)) engineName = 'EcoBoost';
  else if (/coyote/.test(titleLower)) engineName = 'Coyote';
  else if (/pentastar/.test(titleLower)) engineName = 'Pentastar';

  // Model: structured column is a single string, but scoreMarkMatch expects an array
  const models = mark.model ? [mark.model] : [];

  return {
    make: mark.make || null,
    models: models,
    yearStart: mark.year_start || null,
    yearEnd: mark.year_end || null,
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

  // RULE 3: Year is a HARD GATE — no year on mark or vehicle = no match
  if (!parsed.yearStart || !parsed.yearEnd) return {};
  if (vYear <= 0) return {};
  if (vYear < parsed.yearStart || vYear > parsed.yearEnd) return {};

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

// Extract engine displacement from a string like "3.6L V6" → "3.6"
function extractDisplacement(s) {
  if (!s) return null;
  const m = s.match(/(\d+\.\d)\s*L/i);
  return m ? m[1] : null;
}

// Extract cylinder count from a string like "V8" or "I4"
function extractCylinders(s) {
  if (!s) return null;
  const m = s.match(/\b[VvIi](\d)\b/);
  return m ? parseInt(m[1]) : null;
}

// Extract named engine from a string
function extractEngineName(s) {
  if (!s) return null;
  const lower = s.toLowerCase();
  for (const name of ENGINE_NAMES) {
    if (lower.includes(name)) return name;
  }
  return null;
}

// Check for model conflicts — "Cherokee" must NOT match "Grand Cherokee"
function hasModelConflict(partModels, vehicleModel) {
  const vm = (vehicleModel || '').toLowerCase().replace(/[-]/g, ' ').trim();
  for (const pm of partModels) {
    const pmLower = pm.toLowerCase().replace(/[-]/g, ' ').trim();
    for (const [a, b] of MODEL_CONFLICTS) {
      // If part is the short name and vehicle is the long name (or vice versa), conflict
      if ((pmLower === a && vm.includes(b)) || (pmLower === b && vm.includes(a) && !vm.includes(b))) return true;
      if ((pmLower === a && !vm.includes(b) && vm.includes(a)) && pmLower !== vm) continue; // not a conflict
    }
  }
  return false;
}

function scoreMatch(part, vehicle) {
  const vMake = (vehicle.make || '').toLowerCase();
  const vModel = (vehicle.model || '').toLowerCase();
  const vYear = parseInt(vehicle.year) || 0;

  // RULE 1: Make must match
  const makeMatch = part.make && vMake.includes(part.make.toLowerCase());
  if (!makeMatch) return {};

  // RULE 2: Model MUST match (word-boundary)
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

  // RULE 2b: Model conflict check — Cherokee ≠ Grand Cherokee, etc.
  if (hasModelConflict(part.models, vehicle.model)) return {};

  // RULE 3: Year must be within range
  const hasYearRange = part.yearStart && part.yearEnd;
  if (hasYearRange && vYear > 0) {
    if (vYear < part.yearStart || vYear > part.yearEnd) return {};
  }

  // RULE 4: Part-type-sensitive attribute verification
  const titleLower = (part.title || '').toLowerCase();
  const partType = detectPartType(part.title) || null;
  const sensitivity = partType ? (PART_TYPE_SENSITIVITY[partType] || ['engine']) : ['engine'];
  const notes = [];
  let worstConfidence = 'high';

  function downgrade(level, reason) {
    notes.push(reason);
    if (level === 'low' || (level === 'medium' && worstConfidence === 'high')) {
      worstConfidence = level;
    }
  }

  // ENGINE CHECK — for engine-sensitive parts
  if (sensitivity.includes('engine')) {
    const partDisp = extractDisplacement(part.title);
    const partCyl = extractCylinders(part.title);
    const partEngine = extractEngineName(part.title);
    const hasPartEngine = partDisp || partCyl || partEngine;

    if (hasPartEngine) {
      const vEngine = (vehicle.decoded_engine || vehicle.engine || '').toLowerCase();
      const hasVehicleEngine = vEngine && vEngine !== 'n/a' && vEngine.length > 1;

      if (hasVehicleEngine) {
        const vDisp = extractDisplacement(vEngine);
        const vCyl = extractCylinders(vEngine);
        const vEngineName = extractEngineName(vEngine);

        let mismatch = false;
        // Displacement mismatch
        if (partDisp && vDisp && partDisp !== vDisp) mismatch = true;
        // Cylinder count mismatch (V8 vs V6)
        if (!mismatch && partCyl && vCyl && partCyl !== vCyl) mismatch = true;
        // Named engine mismatch (HEMI vs Pentastar)
        if (!mismatch && partEngine && vEngineName && partEngine !== vEngineName) mismatch = true;

        if (mismatch) {
          downgrade('low', 'Engine mismatch: part requires ' + (partDisp ? partDisp + 'L' : '') + (partEngine ? ' ' + partEngine : '') + ', vehicle has ' + vEngine);
        } else {
          notes.push('Engine verified: ' + vEngine);
        }
      } else {
        downgrade('medium', 'Engine not decoded — verify at yard');
      }
    }
  }

  // DRIVETRAIN CHECK — for drivetrain-sensitive parts
  if (sensitivity.includes('drivetrain')) {
    const part4wd = /\b(4wd|4x4|awd)\b/i.test(titleLower);
    const part2wd = /\b(2wd|fwd|rwd)\b/i.test(titleLower);
    const hasPartDrive = part4wd || part2wd;

    if (hasPartDrive) {
      const vDrive = (vehicle.decoded_drivetrain || vehicle.drivetrain || '').toLowerCase();
      const hasVehicleDrive = vDrive && vDrive.length > 1;

      if (hasVehicleDrive) {
        const v4wd = /4wd|4x4|awd/i.test(vDrive);
        if ((part4wd && !v4wd) || (part2wd && v4wd)) {
          downgrade('low', 'Drivetrain mismatch: part is ' + (part4wd ? '4WD/AWD' : '2WD') + ', vehicle is ' + vDrive);
        }
      } else {
        downgrade('medium', 'Drivetrain not decoded — verify at yard');
      }
    }
  }

  // TRIM CHECK — for trim-sensitive parts (premium audio, etc.)
  if (sensitivity.includes('trim')) {
    const premiumAudio = /\b(bose|alpine|harman|kardon|b&o|bang|olufsen|jbl|beats|infinity|burmester|meridian|mark levinson)\b/i;
    const hasPremiumInTitle = premiumAudio.test(titleLower);

    if (hasPremiumInTitle) {
      const vTrim = (vehicle.decoded_trim || vehicle.trim_level || '').toLowerCase();
      const vTier = (vehicle.trim_tier || '').toUpperCase();
      const hasVehicleTrim = vTrim && vTrim.length > 1;

      if (hasVehicleTrim || vTier) {
        const isBaseTrim = vTier === 'BASE' || /\b(work|fleet|tradesman|ls\b|w\/t|wt\b)/i.test(vTrim);
        if (isBaseTrim) {
          downgrade('low', 'Premium audio part on base trim vehicle');
        }
      } else {
        downgrade('medium', 'Trim not decoded — verify audio package at yard');
      }
    }
  }

  if (!hasYearRange) notes.push('No year range — verify fitment');

  return { confidence: worstConfidence, notes: notes.length > 0 ? notes.join('; ') : null };
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
