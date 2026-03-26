'use strict';

const { database } = require('../database/database');
const { log } = require('../lib/logger');
const { parseTitle, matchPartToSales, loadModelsFromDB } = require('../utils/partMatcher');
const { modelMatches: piModelMatches, parseYearRange: piParseYear } = require('../utils/partIntelligence');

async function generateAlerts() {
  const startTime = Date.now();
  log.info('Generating scout alerts...');

  // Ensure models are loaded from Auto table before parsing
  await loadModelsFromDB();

  // 1. Get all active yard vehicles
  const vehicles = await database('yard_vehicle')
    .join('yard', 'yard.id', 'yard_vehicle.yard_id')
    .where('yard_vehicle.active', true)
    .where('yard.enabled', true)
    .select(
      'yard_vehicle.year', 'yard_vehicle.make', 'yard_vehicle.model',
      'yard_vehicle.color', 'yard_vehicle.row_number', 'yard_vehicle.date_added',
      'yard_vehicle.engine', 'yard_vehicle.drivetrain', 'yard_vehicle.trim_level',
      'yard.name as yard_name'
    );

  if (vehicles.length === 0) {
    log.info('No active yard vehicles — skipping alert generation');
    await saveMeta();
    return { alerts: 0 };
  }

  // 2. Gather parts we need from both sources
  const partsToMatch = [];

  // SCOUR STREAM (formerly HUNTERS PERCH) — manual want list
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
      if (!parsed || parsed.models.length === 0) continue; // MUST have a model
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

  // 3. Match parts against yard vehicles
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

  // 4. Wipe old alerts and insert new ones
  await database('scout_alerts').truncate();
  for (let i = 0; i < alerts.length; i += 50) {
    await database('scout_alerts').insert(alerts.slice(i, i + 50));
  }

  await saveMeta();

  const elapsed = Date.now() - startTime;
  log.info({ alertCount: alerts.length, partsChecked: partsToMatch.length, vehiclesInYards: vehicles.length, elapsed }, 'Scout alerts generated');
  return { alerts: alerts.length, partsChecked: partsToMatch.length, vehicles: vehicles.length, elapsed };
}

function scoreMatch(part, vehicle) {
  const vMake = (vehicle.make || '').toLowerCase();
  const vModel = (vehicle.model || '').toLowerCase();
  const vYear = parseInt(vehicle.year) || 0;

  // RULE 1: Make must match
  const makeMatch = part.make && vMake.includes(part.make.toLowerCase());
  if (!makeMatch) return {};

  // RULE 2: Model MUST match. No "no specific model" alerts.
  // If we can't find a model in the part title, don't generate an alert.
  if (part.models.length === 0) return {};

  let modelMatch = false;
  for (const m of part.models) {
    const mLower = m.toLowerCase();
    // Exact model match — check both directions but require word boundary
    // "challenger" must match "challenger", not "journey"
    // Use word-boundary regex to prevent "ram" matching "program"
    const re = new RegExp('\\b' + mLower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b');
    if (re.test(vModel) || re.test(vMake + ' ' + vModel)) {
      modelMatch = true;
      break;
    }
  }
  if (!modelMatch) return {};

  // RULE 3: Year must be WITHIN range. No fuzzy/close matching.
  // Wrong year = wrong part. A 2006 is NOT a 2007.
  if (part.yearStart && part.yearEnd && vYear > 0) {
    if (vYear < part.yearStart || vYear > part.yearEnd) return {};
  }
  // If part has no year range, allow match but note it
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
    // Model + year confirmed (or no year to check)
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
    // Shouldn't reach here due to early return above, but safety net
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
