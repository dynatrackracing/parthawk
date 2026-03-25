'use strict';

const { database } = require('../database/database');
const { log } = require('../lib/logger');

const MAKES_LIST = [
  'ford','toyota','honda','acura','bmw','volvo','infiniti','mazda','lincoln',
  'land rover','saturn','dodge','chrysler','jeep','nissan','buick','pontiac',
  'hyundai','kia','jaguar','lexus','cadillac','mitsubishi','suzuki','geo',
  'chevrolet','chevy','mercedes','ram',
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
];

function parseVehicleFromTitle(title) {
  const titleLower = title.toLowerCase();
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

  let foundMake = null;
  for (const make of MAKES_LIST) {
    const re = new RegExp('\\b' + make.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i');
    if (re.test(titleLower)) { foundMake = make; break; }
  }

  const foundModels = [];
  for (const model of MODELS) {
    const re = new RegExp('\\b' + model.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i');
    if (re.test(titleLower)) foundModels.push(model);
  }

  if (!foundMake && foundModels.length === 0) return null;
  return { make: foundMake, models: foundModels, yearStart, yearEnd };
}

async function generateAlerts() {
  const startTime = Date.now();
  log.info('Generating scout alerts...');

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

  // HUNTERS PERCH — manual want list
  const wantList = await database('restock_want_list').where({ active: true });
  for (const item of wantList) {
    const parsed = parseVehicleFromTitle(item.title);
    if (parsed) {
      // Get avg price from YourSale for this item
      let avgPrice = null;
      try {
        const sale = await database('YourSale')
          .where('title', 'ilike', `%${(parsed.models[0] || parsed.make || '').substring(0, 15)}%`)
          .select(database.raw('AVG("salePrice") as avg'))
          .first();
        if (sale && sale.avg) avgPrice = Math.round(parseFloat(sale.avg));
      } catch (e) { /* ignore */ }

      partsToMatch.push({
        source: 'hunters_perch',
        title: item.title,
        value: avgPrice,
        ...parsed
      });
    }
  }

  // BONE PILE — recently sold items with low/no stock
  try {
    const bonePileSales = await database('YourSale')
      .where('soldDate', '>=', database.raw("NOW() - INTERVAL '60 days'"))
      .whereNotNull('title')
      .whereRaw('"salePrice"::numeric >= 50')
      .select('title', 'salePrice');

    // Group by approximate title
    const seen = new Map();
    for (const sale of bonePileSales) {
      const parsed = parseVehicleFromTitle(sale.title);
      if (!parsed) continue;
      const key = (parsed.make || '') + '|' + (parsed.models[0] || '') + '|' + sale.title.substring(0, 40);
      if (!seen.has(key)) {
        seen.set(key, {
          source: 'bone_pile',
          title: sale.title,
          value: Math.round(parseFloat(sale.salePrice) || 0),
          ...parsed
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

  // Insert in batches of 50
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

  // Check make match
  const makeMatch = part.make && vMake.includes(part.make.toLowerCase());
  if (!makeMatch) return {};

  // Check model match
  let modelMatch = false;
  if (part.models.length > 0) {
    for (const m of part.models) {
      if (vModel.includes(m.toLowerCase()) || m.toLowerCase().includes(vModel)) {
        modelMatch = true;
        break;
      }
    }
  }
  if (!modelMatch && part.models.length > 0) return {};

  // Check year range
  let yearMatch = 'none';
  if (part.yearStart && part.yearEnd) {
    if (vYear >= part.yearStart && vYear <= part.yearEnd) {
      yearMatch = 'exact';
    } else if (vYear >= part.yearStart - 2 && vYear <= part.yearEnd + 2) {
      yearMatch = 'close';
    } else {
      return {};
    }
  } else if (!part.yearStart) {
    yearMatch = 'unknown';
  }

  // Build confidence
  let confidence;
  const notes = [];

  if (modelMatch && yearMatch === 'exact') {
    confidence = 'high';
  } else if (modelMatch && yearMatch === 'close') {
    confidence = 'medium';
    notes.push('Year is close but outside listed range');
  } else if (modelMatch && yearMatch === 'unknown') {
    confidence = 'medium';
    notes.push('Year range not specified in part title');
  } else if (!modelMatch && part.models.length === 0) {
    // Make-only match (no model specified in part)
    if (yearMatch === 'exact') confidence = 'medium';
    else if (yearMatch === 'close') confidence = 'low';
    else confidence = 'low';
    notes.push('No specific model in part title — verify model at yard');
  } else {
    confidence = 'low';
  }

  // Engine/trim notes
  const titleLower = (part.title || '').toLowerCase();
  if (/v8|5\.7|hemi/.test(titleLower) && !vehicle.engine) {
    notes.push('Verify V8/HEMI engine at yard');
  }
  if (/v6|3\.5|3\.8/.test(titleLower) && !vehicle.engine) {
    notes.push('Verify V6 engine at yard');
  }
  if (/4x4|awd|4wd/.test(titleLower) && !vehicle.drivetrain) {
    notes.push('Verify 4x4/AWD drivetrain at yard');
  }
  if (/type.?s|sport|limited|touring/i.test(titleLower) && !vehicle.trim_level) {
    notes.push('Verify trim level at yard');
  }

  return { confidence, notes: notes.length > 0 ? notes.join('; ') : null };
}

async function saveMeta() {
  const now = new Date().toISOString();
  try {
    await database('scout_alerts_meta').insert({ key: 'last_generated', value: now })
      .onConflict('key').merge();
  } catch (e) {
    // Fallback for databases without onConflict
    await database('scout_alerts_meta').where('key', 'last_generated').del();
    await database('scout_alerts_meta').insert({ key: 'last_generated', value: now });
  }
}

module.exports = { generateAlerts };
