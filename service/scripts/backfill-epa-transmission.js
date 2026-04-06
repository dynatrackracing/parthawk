'use strict';

/**
 * Backfill EPA transmission data into yard_vehicle — NO CORGI REQUIRED.
 *
 * Queries EPA data directly from vin_decoder.epa_transmission table.
 * Uses yard_vehicle.make/model/decoded_engine/decoded_trim (already populated).
 * Does NOT import LocalVinDecoder or any native module.
 *
 * Usage: DATABASE_URL=... node service/scripts/backfill-epa-transmission.js
 */

const { database } = require('../database/database');

// ── CHECK_MT models (from CLAUDE_RULES.md rule 27) ──
const CHECK_MT_MODELS = [
  'Corvette', 'Camaro', 'Mustang', 'Challenger',
  'WRX', 'BRZ', 'FR-S',
  '350Z', '370Z', 'MX-5', 'Miata',
  'Genesis Coupe', 'Veloster',
  'GTI', 'GTO', 'Solstice', 'Sky',
  'Lancer',
  'FJ Cruiser',
  'Tacoma', 'Frontier', 'Ranger', 'Wrangler',
];

const PERFORMANCE_TRIMS = /\b(ST|Si|Type R|Type S|SRT|SS|RS|Nismo|TRD|Sport|S\b|R-Line|GT(?:\s|$)|Turbo)\b/i;

// ── Model matching (copied from LocalVinDecoder.resolveTransmission) ──

function normalizeForMatch(s) {
  return (s || '').toLowerCase().replace(/[-\s]/g, '');
}

function epaModelMatches(epaModelClean, corgiModel, make) {
  if (!epaModelClean || !corgiModel) return false;
  var ea = normalizeForMatch(epaModelClean);
  var ca = normalizeForMatch(corgiModel);
  if (!ea || !ca) return false;
  if (ea === ca) return true;
  if (ca.includes(ea) || ea.includes(ca)) return true;
  if (/chevrolet|gmc/i.test(make)) {
    var eaStrip = ea.replace(/k15|c15|k10|c10/g, '1500').replace(/k25|c25|k20|c20/g, '2500').replace(/k35|c35|k30|c30/g, '3500').replace(/pickup/g, '');
    var caStrip = ca.replace(/pickup/g, '');
    if (eaStrip === caStrip || caStrip.includes(eaStrip) || eaStrip.includes(caStrip)) return true;
  }
  var eaBase = ea.replace(/(classic|limited|eco|hybrid|plugin)$/g, '').trim();
  if (eaBase && (ca.includes(eaBase) || eaBase.includes(ca))) return true;
  return false;
}

function mostCommon(arr) {
  var counts = {};
  for (var i = 0; i < arr.length; i++) {
    var v = arr[i] || '';
    counts[v] = (counts[v] || 0) + 1;
  }
  var best = null, bestCount = 0;
  for (var k in counts) {
    if (counts[k] > bestCount) { best = k; bestCount = counts[k]; }
  }
  return best || null;
}

// ── EPA resolver (standalone, no imports) ──

async function resolveTransmission(year, make, model, trim) {
  if (!year || !make || !model) return null;

  var makeLower = make.toLowerCase();
  var rows;
  try {
    var result = await database.raw(
      'SELECT trans_type, trans_speeds, trans_sub_type, model_clean FROM vin_decoder.epa_transmission WHERE year = ? AND LOWER(make) = ?',
      [year, makeLower]
    );
    rows = result.rows;
  } catch (e) {
    return null;
  }

  if (!rows || rows.length === 0) {
    if (makeLower === 'ram') {
      try {
        var result2 = await database.raw(
          'SELECT trans_type, trans_speeds, trans_sub_type, model_clean FROM vin_decoder.epa_transmission WHERE year = ? AND LOWER(make) = ?',
          [year, 'dodge']
        );
        rows = (result2.rows || []).filter(function(r) {
          return epaModelMatches(r.model_clean, 'Ram ' + model, 'Dodge') || epaModelMatches(r.model_clean, model, 'Dodge');
        });
      } catch (e) { return null; }
    }
    if (!rows || rows.length === 0) return null;
  }

  var matched = rows.filter(function(r) {
    return epaModelMatches(r.model_clean, model, make);
  });
  if (matched.length === 0) return null;

  var types = new Set(matched.map(function(r) { return r.trans_type; }));
  var hasManual = types.has('Manual');
  var hasAutomatic = types.has('Automatic');

  // TIER 1: EPA DEFINITIVE
  if (hasAutomatic && !hasManual) {
    var autoRows = matched.filter(function(r) { return r.trans_type === 'Automatic'; });
    var speeds = mostCommon(autoRows.map(function(r) { return r.trans_speeds; }));
    var subType = mostCommon(autoRows.map(function(r) { return r.trans_sub_type; })) || null;
    // Format nicely
    var label = speeds ? speeds + '-speed Automatic' : 'Automatic';
    if (subType === 'CVT') label = subType === 'CVT' ? 'CVT' : label;
    if (subType === 'AM-S') label = 'Automated Manual Transmission (AMT)';
    return { label: label, speeds: speeds, subType: subType, source: 'epa_definitive' };
  }
  if (hasManual && !hasAutomatic) {
    var manRows = matched.filter(function(r) { return r.trans_type === 'Manual'; });
    var speeds2 = mostCommon(manRows.map(function(r) { return r.trans_speeds; }));
    return { label: speeds2 ? speeds2 + '-speed Manual' : 'Manual/Standard', speeds: speeds2, subType: null, source: 'epa_definitive' };
  }

  // TIER 2: CHECK_MT models
  var modelUpper = model.toUpperCase();
  var isCheckMT = CHECK_MT_MODELS.some(function(m) { return modelUpper.includes(m.toUpperCase()); });
  if (isCheckMT) return { label: 'CHECK_MT', speeds: null, subType: null, source: 'epa_check_mt' };

  // Performance trim override
  if (trim && PERFORMANCE_TRIMS.test(trim)) {
    return { label: 'CHECK_MT', speeds: null, subType: null, source: 'epa_check_mt' };
  }

  // TIER 3: DEFAULT AUTOMATIC
  var autoRows2 = matched.filter(function(r) { return r.trans_type === 'Automatic'; });
  var speeds3 = mostCommon(autoRows2.map(function(r) { return r.trans_speeds; }));
  var subType2 = mostCommon(autoRows2.map(function(r) { return r.trans_sub_type; })) || null;
  var label2 = speeds3 ? speeds3 + '-speed Automatic' : 'Automatic';
  if (subType2 === 'CVT') label2 = 'CVT';
  return { label: label2, speeds: speeds3, subType: subType2, source: 'epa_default_auto' };
}

// ── Main ──

async function run() {
  console.log('Backfilling EPA transmission (no corgi required)...\n');

  // Get vehicles needing transmission
  const vehicles = await database('yard_vehicle')
    .where('active', true)
    .where(function() {
      this.whereNull('decoded_transmission')
        .orWhere('decoded_transmission', '');
    })
    .select('id', 'vin', 'year', 'make', 'model', 'decoded_engine', 'decoded_trim', 'decoded_transmission');

  console.log(`Vehicles to process: ${vehicles.length}\n`);

  let definitive = 0, checkMt = 0, defaultAuto = 0, noMatch = 0, errors = 0;

  for (let i = 0; i < vehicles.length; i++) {
    const v = vehicles[i];
    try {
      const year = parseInt(v.year) || 0;
      const make = (v.make || '').trim();
      const model = (v.model || '').trim();
      const trim = v.decoded_trim || null;
      if (!year || !make || !model) { noMatch++; continue; }

      const result = await resolveTransmission(year, make, model, trim);
      if (!result) { noMatch++; continue; }

      // Update yard_vehicle
      const patch = { decoded_transmission: result.label };
      if (result.speeds) patch.transmission_speeds = result.speeds;
      await database('yard_vehicle').where('id', v.id).update(patch);

      // Also update vin_cache if entry exists
      if (v.vin) {
        await database('vin_cache').where('vin', v.vin).update({
          transmission_style: result.label,
          transmission_speeds: result.speeds || null,
          trans_sub_type: result.subType || null,
          trans_source: result.source,
        }).catch(() => {}); // non-fatal
      }

      if (result.source === 'epa_definitive') definitive++;
      else if (result.source === 'epa_check_mt') checkMt++;
      else if (result.source === 'epa_default_auto') defaultAuto++;
    } catch (e) {
      errors++;
    }

    if ((i + 1) % 100 === 0) {
      console.log(`  ${i + 1}/${vehicles.length} — definitive:${definitive} check_mt:${checkMt} default_auto:${defaultAuto} no_match:${noMatch} errors:${errors}`);
    }
  }

  console.log(`\n=== Summary ===`);
  console.log(`Total processed: ${vehicles.length}`);
  console.log(`Definitive (epa_definitive): ${definitive}`);
  console.log(`CHECK_MT (epa_check_mt): ${checkMt}`);
  console.log(`Default Auto (epa_default_auto): ${defaultAuto}`);
  console.log(`No EPA match: ${noMatch}`);
  console.log(`Errors: ${errors}`);

  // Verify
  const remaining = await database.raw(`
    SELECT
      COUNT(*) FILTER (WHERE decoded_transmission IS NULL OR decoded_transmission = '') as no_trans,
      COUNT(*) FILTER (WHERE decoded_transmission = 'CHECK_MT') as check_mt,
      COUNT(*) FILTER (WHERE decoded_transmission ILIKE '%manual%' OR decoded_transmission ILIKE '%standard%') as manual,
      COUNT(*) FILTER (WHERE decoded_transmission ILIKE '%auto%' OR decoded_transmission ILIKE '%CVT%') as auto,
      COUNT(*) as total
    FROM yard_vehicle WHERE active = true
  `);
  console.log('\nFinal transmission breakdown:');
  console.table(remaining.rows);

  await database.destroy();
}

run().catch(e => { console.error(e); process.exit(1); });
