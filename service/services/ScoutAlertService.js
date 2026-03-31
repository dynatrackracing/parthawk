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
