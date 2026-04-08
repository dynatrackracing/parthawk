'use strict';

const { database } = require('../database/database');
const { log } = require('../lib/logger');
const { parseTitle, matchPartToSales, loadModelsFromDB } = require('../utils/partMatcher');
const { modelMatches: piModelMatches, parseYearRange: piParseYear, extractPartNumbers: piExtractPNs, detectPartType } = require('../utils/partIntelligence');
const { isReliable, detectNamedEngine, NAMED_ENGINES, getCeiling } = require('../lib/decoderCapability');

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
  // Additional universal part types (body/interior — no engine/drivetrain sensitivity)
  HANDLE: [], SWITCH: [], MOLDING: [], EMBLEM: [], COVER: [], PANEL: [],
  SENSOR: [], RELAY: [], BRACKET: [], HARNESS: [], DOOR_MODULE: [],
  WIPER_MODULE: [], SEAT_MODULE: [], BLEND_DOOR: [], TRAILER_MODULE: [],
  LANE_ASSIST: [], ADAPTIVE_CRUISE: [], ROLLOVER_SENSOR: [], YAW_SENSOR: [],
  OCCUPANT_SENSOR: [],
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
          match_score: match.match_score || null,
          match_reasons: match.match_reasons ? JSON.stringify(match.match_reasons) : '[]',
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
          match_score: match.match_score || null,
          match_reasons: match.match_reasons ? JSON.stringify(match.match_reasons) : '[]',
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

  // RULE 4: Numeric scoring via computeMatchScore (same as non-mark path)
  const partType = mark.partType || detectPartType(mark.originalTitle) || null;
  const result = computeMatchScore(mark.originalTitle, vehicle, partType);
  const confidence = result.score >= 75 ? 'high' : result.score >= 55 ? 'medium' : 'low';

  if (vehicle.decoded_trim) result.reasons.push('Trim: ' + vehicle.decoded_trim);
  if (mark.partType) result.reasons.push('Part: ' + mark.partType);

  return { confidence, notes: result.reasons.join('; '), match_score: result.score, match_reasons: result.reasons };
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

// ═══════════════════════════════════════════════════════════════
// NUMERIC MATCH SCORING (0-100) — Deploy A, 2026-04-08
// ═══════════════════════════════════════════════════════════════

function _extractCylFromTitle(title) {
  if (!title) return null;
  const m = title.match(/\bV(\d{1,2})\b/i) || title.match(/\bI(\d)\b/) || title.match(/\b(\d)-?cyl/i) || title.match(/\b(\d)\s*cylinder/i);
  return m ? parseInt(m[1]) : null;
}

function _extractDriveFromTitle(title) {
  if (!title) return null;
  const t = title.toUpperCase();
  if (/\b4WD\b|\b4X4\b|\bFOUR WHEEL DRIVE\b/.test(t)) return '4WD';
  if (/\bAWD\b|\bALL WHEEL DRIVE\b/.test(t)) return 'AWD';
  if (/\b2WD\b|\b4X2\b/.test(t)) return '2WD';
  if (/\bFWD\b|\bFRONT WHEEL DRIVE\b/.test(t)) return 'FWD';
  if (/\bRWD\b|\bREAR WHEEL DRIVE\b/.test(t)) return 'RWD';
  return null;
}

function _extractPremiumAudio(title) {
  if (!title) return null;
  const m = title.match(/\b(Bose|B&O|Bang\s*&?\s*Olufsen|Alpine|JBL|Harman\s*Kardon|Mark\s*Levinson|Burmester|Meridian|Infinity|Beats)\b/i);
  return m ? m[1] : null;
}

function _extractDieselMarker(title) {
  if (!title) return false;
  return /\b(Diesel|TDI|Duramax|Cummins|Power\s*Stroke|PowerStroke|EcoDiesel)\b/i.test(title);
}

const PN_EXACT_YEAR_TYPES = new Set(['ECM','PCM','ECU','BCM','TIPM','ABS','TCM','TCU','AMP','RADIO','CLUSTER','THROTTLE','FUSE','JUNCTION']);

function computeMatchScore(wantTitle, vehicleData, partType) {
  const ENGINE_SENSITIVE_TYPES = new Set(['ECM', 'PCM', 'ECU', 'TCM', 'TCU', 'THROTTLE']);
  const reasons = [];
  let score = ENGINE_SENSITIVE_TYPES.has(partType) ? 55 : 50;
  reasons.push(ENGINE_SENSITIVE_TYPES.has(partType)
    ? 'YMM match (engine-sensitive): +55'
    : 'YMM match: +50');

  const sensitivity = partType ? (PART_TYPE_SENSITIVITY[partType] || []) : [];
  const vMake = (vehicleData.make || '').toUpperCase();

  // --- PHASE 3: YEAR PROXIMITY ---
  if (PN_EXACT_YEAR_TYPES.has(partType)) {
    const yr = piParseYear(wantTitle);
    const vYear = parseInt(vehicleData.year) || 0;
    if (yr && vYear) {
      const span = yr.end - yr.start;
      if (span === 0 && vYear === yr.start) { score += 10; reasons.push('Year exact: +10'); }
      else if (span <= 1) { score += 5; reasons.push('Year range tight: +5'); }
      else if (span >= 4) { score -= 5; reasons.push('Year range broad (' + (span+1) + 'yr): -5'); }
    }
  }

  // --- PHASE 4: ENGINE PATH ---
  if (sensitivity.includes('engine')) {
    const titleCyl = _extractCylFromTitle(wantTitle);
    const namedEng = detectNamedEngine(wantTitle);
    const titleDisp = extractDisplacement(wantTitle);

    const vCyl = vehicleData.decoded_cylinders ? parseInt(vehicleData.decoded_cylinders) : null;
    const vEngStr = (vehicleData.decoded_engine || vehicleData.engine || '');
    const vDisp = extractDisplacement(vEngStr);

    // Cylinder check
    if (titleCyl && vCyl) {
      if (titleCyl === vCyl) { score += 25; reasons.push('Cylinders match (V' + vCyl + '): +25'); }
      else { score -= 50; reasons.push('Cylinder mismatch (part V' + titleCyl + ', vehicle V' + vCyl + '): -50'); }
    } else if (titleCyl && !vCyl) {
      reasons.push('Cylinders unknown on vehicle: 0');
    }

    // Named engine check
    if (namedEng) {
      const eng = NAMED_ENGINES[namedEng] || NAMED_ENGINES[namedEng.replace(/\s+/g, '')];
      if (eng) {
        const makeMatch = eng.makes.includes(vMake);
        if (makeMatch && vDisp) {
          const vDispNum = parseFloat(vDisp);
          const dispMatch = eng.displacements.some(d => Math.abs(d - vDispNum) < 0.25);
          if (dispMatch) { score += 30; reasons.push('Named engine match (' + namedEng + '): +30'); }
          else { score -= 30; reasons.push('Named engine displacement mismatch (' + namedEng + '): -30'); }
        } else if (!makeMatch) {
          score -= 60; reasons.push('Named engine make mismatch (' + namedEng + ' not on ' + vMake + '): -60');
        }
      }
    }

    // Displacement check (only if no named engine and no cylinder match already applied large delta)
    if (!namedEng && titleDisp && vDisp) {
      const td = parseFloat(titleDisp), vd = parseFloat(vDisp);
      if (Math.abs(td - vd) < 0.25) { score += 25; reasons.push('Displacement match (' + vDisp + 'L): +25'); }
      else { score -= 50; reasons.push('Displacement mismatch (part ' + titleDisp + 'L, vehicle ' + vDisp + 'L): -50'); }
    } else if (!namedEng && titleDisp && !vDisp) {
      score -= 10; reasons.push('Engine unknown on vehicle: -10');
    }
  }

  // --- PHASE 5: DIESEL PATH ---
  if (_extractDieselMarker(wantTitle)) {
    if (vehicleData.diesel === true) { score += 35; reasons.push('Diesel match: +35'); }
    else if (vehicleData.diesel === false) { score -= 80; reasons.push('Gas vehicle, diesel part: -80'); }
    else { score -= 20; reasons.push('Vehicle diesel flag unknown: -20'); }
  }

  // --- PHASE 6: DRIVETRAIN PATH ---
  if (sensitivity.includes('drivetrain')) {
    score += 10; reasons.push('ABS drivetrain-sensitive: +10');
    const titleDrive = _extractDriveFromTitle(wantTitle);
    if (titleDrive) {
      const vDrive = (vehicleData.decoded_drivetrain || vehicleData.drivetrain || '').toUpperCase();
      if (vDrive) {
        const v4wd = /4WD|4X4|AWD/.test(vDrive);
        const p4wd = titleDrive === '4WD' || titleDrive === 'AWD';
        if ((p4wd && v4wd) || (!p4wd && !v4wd)) { score += 25; reasons.push('Drivetrain match: +25'); }
        else { score -= 50; reasons.push('Drivetrain mismatch (part ' + titleDrive + ', vehicle ' + vDrive + '): -50'); }
      } else {
        if (isReliable(vMake, 'drivetrain')) { score -= 15; reasons.push('Drivetrain unknown: -15'); }
        else { reasons.push('Drivetrain not encoded for ' + vMake + ': 0'); }
      }
    }
  }

  // --- PHASE 7: TRIM PATH ---
  if (sensitivity.includes('trim')) {
    const brand = _extractPremiumAudio(wantTitle);
    if (brand) {
      const vTier = (vehicleData.trim_tier || '').toUpperCase();
      if (vTier === 'PREMIUM') { score += 30; reasons.push('Premium trim match (' + brand + '): +30'); }
      else if (vTier === 'PERFORMANCE') { score += 25; reasons.push('Performance trim (' + brand + '): +25'); }
      else if (vTier === 'BASE') { score -= 40; reasons.push('Premium audio on base trim: -40'); }
      else {
        if (isReliable(vMake, 'trim')) { score -= 10; reasons.push('Trim unknown: -10'); }
        else { reasons.push('Trim not encoded for ' + vMake + ': 0'); }
      }
    }
  }

  // --- PHASE 8: CLAMP TO CEILING ---
  const hasPremiumBrand = !!_extractPremiumAudio(wantTitle);
  const ceiling = getCeiling(partType, hasPremiumBrand);
  if (score > ceiling) { score = ceiling; reasons.push('Capped at ' + partType + ' ceiling: ' + ceiling); }
  if (score < 0) score = 0;
  if (score > 100) score = 100;

  return { score, reasons, ceiling, hardGated: false, gateReason: null };
}

// Legacy wrapper — maintains backward compat return shape
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

  // RULE 3: Year hard gate
  const hasYearRange = part.yearStart && part.yearEnd;
  if (!hasYearRange) return {}; // Year hard gate: no year = no match
  if (vYear > 0 && (vYear < part.yearStart || vYear > part.yearEnd)) return {};

  // RULE 4: Numeric scoring via computeMatchScore
  const partType = detectPartType(part.title) || null;
  const result = computeMatchScore(part.title, vehicle, partType);

  // Convert to legacy shape + new fields
  const confidence = result.score >= 75 ? 'high' : result.score >= 55 ? 'medium' : 'low';
  return {
    confidence,
    notes: result.reasons.join('; '),
    match_score: result.score,
    match_reasons: result.reasons,
  };
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
