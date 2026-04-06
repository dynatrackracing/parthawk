#!/usr/bin/env node
'use strict';

/**
 * backfill-vpic-trim.js — Fill decoded_trim + decoded_transmission from vPIC stored procedure.
 * NO CORGI REQUIRED — queries vpic.spVinDecode() directly via pg.
 *
 * Usage: DATABASE_URL=... node service/scripts/backfill-vpic-trim.js
 */

const { database } = require('../database/database');

// cleanDecodedTrim — copied from LocalVinDecoder.js (no native imports)
function cleanDecodedTrim(raw) {
  if (!raw) return null;
  var t = raw.trim();
  if (!t) return null;
  var JUNK_LIST = [
    'nfa','nfb','nfc','cma','std','sa','hev','phev',
    'n/a','na','unknown','standard','unspecified',
    'styleside','flareside','stepside','sportside',
    'crew','crew cab','regular cab','extended cab','supercab','supercrew','double cab','quad cab','king cab','access cab',
    'middle level','middle-low level','high level','low level',
    'middle grade','middle-low grade','high grade','low grade',
    'xdrive','sdrive','4matic','quattro',
    'leather','cloth','premium cloth',
    'f-series','f series',
  ];
  var lower = t.toLowerCase();
  for (var i = 0; i < JUNK_LIST.length; i++) {
    if (lower === JUNK_LIST[i]) return null;
  }
  t = t.replace(/\s*\([^)]*\)\s*/g, '').trim();
  t = t.replace(/\b[VIL][\-\s]?\d\b/gi, '').trim();
  t = t.replace(/\b\d\.\d[A-Z]?\s*(L|LITER)?\b/gi, '').trim();
  t = t.replace(/\bW\/LEA(THER)?\b/gi, '-L').trim();
  t = t.replace(/\bWITH\s+LEATHER\b/gi, '-L').trim();
  t = t.replace(/\bW\/NAV(I|IGATION)?\b/gi, '').trim();
  t = t.replace(/\bW\/RES\b/gi, '').trim();
  t = t.replace(/\bWITH\s+RES\b/gi, '').trim();
  t = t.replace(/\bWITH\s+NAV(IGATION)?\b/gi, '').trim();
  t = t.replace(/\s+\-/g, '-').replace(/\-\s+/g, '-').replace(/\s+/g, ' ').trim();
  if (/^[A-Z]{0,3}\d{2,3}[A-Z]?$/i.test(t)) return null;
  if (/^\d\.\d[a-z]{1,2}$/i.test(t)) return null;
  if (/,/.test(t)) t = t.split(',')[0].trim();
  if (/\//.test(t)) {
    var parts = t.split('/').map(function(p) { return p.trim(); }).filter(Boolean);
    t = parts[parts.length - 1];
  }
  if (!t || t.length < 2 || t.length > 30) return null;
  return t;
}

async function vpicDecode(vin) {
  try {
    var result = await database.raw("SELECT variable, value FROM vpic.spvindecode(?) WHERE value IS NOT NULL AND value != '' AND value != 'Not Applicable'", [vin]);
    if (!result || !result.rows || result.rows.length === 0) return null;
    var data = {};
    for (var i = 0; i < result.rows.length; i++) {
      var row = result.rows[i];
      if (row.variable && row.value) data[row.variable] = row.value.trim();
    }
    return {
      trim: data['Trim'] || data['Trim2'] || null,
      series: data['Series'] || data['Series2'] || null,
      transmissionStyle: data['Transmission Style'] || null,
      transmissionSpeeds: data['Transmission Speeds'] || null,
    };
  } catch (e) {
    return null;
  }
}

async function run() {
  console.log('Backfilling trim+transmission from vPIC (no corgi required)...\n');

  // Verify vPIC is available
  try {
    var test = await database.raw("SELECT count(*) as cnt FROM vpic.pattern");
    console.log('vPIC Pattern table:', test.rows[0].cnt, 'rows\n');
  } catch (e) {
    console.error('ERROR: vpic schema not found. Run the vPIC SQL restore first.');
    process.exit(1);
  }

  // Get vehicles needing trim
  const vehicles = await database('yard_vehicle')
    .where('active', true)
    .whereNotNull('vin')
    .where('vin', '!=', '')
    .where(function() {
      this.whereNull('decoded_trim').orWhere('decoded_trim', '');
    })
    .select('id', 'vin', 'make', 'decoded_trim', 'decoded_transmission');

  console.log(`Vehicles missing decoded_trim: ${vehicles.length}\n`);

  let trimResolved = 0, transResolved = 0, noMatch = 0, errors = 0;
  const trimByMake = {};

  for (let i = 0; i < vehicles.length; i++) {
    const v = vehicles[i];
    try {
      const vpic = await vpicDecode(v.vin);
      if (!vpic) { noMatch++; continue; }

      const patch = {};

      // Trim
      let newTrim = cleanDecodedTrim(vpic.trim) || cleanDecodedTrim(vpic.series) || null;
      if (newTrim) {
        patch.decoded_trim = newTrim;
        trimResolved++;
        const make = (v.make || 'UNKNOWN').toUpperCase();
        trimByMake[make] = (trimByMake[make] || 0) + 1;
      }

      // Transmission (only if currently null)
      if ((!v.decoded_transmission || v.decoded_transmission === '') && vpic.transmissionStyle) {
        patch.decoded_transmission = vpic.transmissionStyle;
        transResolved++;
      }

      if (Object.keys(patch).length > 0) {
        await database('yard_vehicle').where('id', v.id).update(patch);
        // Also update vin_cache if exists
        if (newTrim) {
          await database('vin_cache').where('vin', v.vin).update({ trim: newTrim }).catch(() => {});
        }
      } else {
        noMatch++;
      }
    } catch (e) {
      errors++;
    }

    if ((i + 1) % 100 === 0) {
      console.log(`  ${i + 1}/${vehicles.length} — trim:${trimResolved} trans:${transResolved} noMatch:${noMatch} errors:${errors}`);
    }
  }

  console.log(`\n=== Summary ===`);
  console.log(`Total processed: ${vehicles.length}`);
  console.log(`Trim resolved: ${trimResolved}`);
  console.log(`Transmission resolved: ${transResolved}`);
  console.log(`No vPIC match: ${noMatch}`);
  console.log(`Errors: ${errors}`);

  // Trim by make breakdown
  const sorted = Object.entries(trimByMake).sort((a, b) => b[1] - a[1]);
  console.log('\nTrim resolved by make:');
  for (const [make, cnt] of sorted) {
    console.log(`  ${make}: ${cnt}`);
  }

  // Final verification
  const verify = await database.raw(`
    SELECT make,
      COUNT(*) as total,
      COUNT(decoded_trim) as has_trim,
      ROUND(COUNT(decoded_trim)::numeric / COUNT(*)::numeric * 100, 1) as trim_pct
    FROM yard_vehicle WHERE active = true AND vin IS NOT NULL
    GROUP BY make ORDER BY total DESC LIMIT 15
  `);
  console.log('\nTrim coverage after backfill:');
  console.table(verify.rows);

  await database.destroy();
}

run().catch(e => { console.error(e); process.exit(1); });
