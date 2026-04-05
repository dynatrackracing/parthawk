#!/usr/bin/env node
'use strict';

/**
 * backfill-transmission-drivetrain.js — Fill decoded_transmission and decoded_drivetrain
 * from vin_cache for yard_vehicles that are missing these fields.
 *
 * For vehicles not in vin_cache, re-decodes via LocalVinDecoder.
 *
 * Usage: DATABASE_URL="..." node service/scripts/backfill-transmission-drivetrain.js
 */

const { database } = require('../database/database');
const { decode: localDecode } = require('../lib/LocalVinDecoder');

async function main() {
  console.log('Backfilling decoded_transmission + decoded_drivetrain...\n');

  // 1. Vehicles missing decoded_transmission
  const needTrans = await database('yard_vehicle')
    .where('active', true)
    .whereNotNull('vin')
    .where('vin', '!=', '')
    .where(function() {
      this.whereNull('decoded_transmission').orWhere('decoded_transmission', '');
    })
    .select('id', 'vin');

  console.log(`Vehicles missing decoded_transmission: ${needTrans.length}`);

  // 2. Vehicles missing decoded_drivetrain
  const needDrive = await database('yard_vehicle')
    .where('active', true)
    .whereNotNull('vin')
    .where('vin', '!=', '')
    .where(function() {
      this.whereNull('decoded_drivetrain').orWhere('decoded_drivetrain', '');
    })
    .select('id', 'vin');

  console.log(`Vehicles missing decoded_drivetrain: ${needDrive.length}`);

  // Merge into one set
  const vinMap = new Map(); // vin → [ids]
  for (const v of [...needTrans, ...needDrive]) {
    if (!vinMap.has(v.vin)) vinMap.set(v.vin, new Set());
    vinMap.get(v.vin).add(v.id);
  }
  const uniqueVins = [...vinMap.keys()];
  console.log(`Unique VINs to process: ${uniqueVins.length}\n`);

  // 3. Load vin_cache for these VINs
  const cacheRows = await database('vin_cache')
    .whereIn('vin', uniqueVins)
    .select('vin', 'drivetrain', 'transmission_style');

  const cache = new Map();
  for (const r of cacheRows) cache.set(r.vin, r);

  let transUpdated = 0, driveUpdated = 0, reDecoded = 0, errors = 0;

  for (const vin of uniqueVins) {
    const ids = [...vinMap.get(vin)];
    const cached = cache.get(vin);

    let trans = cached?.transmission_style || null;
    let drive = cached?.drivetrain || null;

    // If cache doesn't have transmission, re-decode
    if (!trans) {
      try {
        const result = await localDecode(vin);
        if (result) {
          trans = result.transHint || null;
          drive = drive || result.drivetrain || null;
          reDecoded++;
        }
      } catch (e) {
        errors++;
      }
    }

    // Update yard_vehicle rows
    for (const id of ids) {
      const patch = {};
      if (trans) patch.decoded_transmission = trans;
      if (drive) patch.decoded_drivetrain = drive;
      if (Object.keys(patch).length > 0) {
        await database('yard_vehicle').where('id', id).update(patch);
        if (patch.decoded_transmission) transUpdated++;
        if (patch.decoded_drivetrain) driveUpdated++;
      }
    }
  }

  console.log(`\nResults:`);
  console.log(`  Transmission filled: ${transUpdated}`);
  console.log(`  Drivetrain filled: ${driveUpdated}`);
  console.log(`  Re-decoded from VIN: ${reDecoded}`);
  console.log(`  Errors: ${errors}`);

  // Verify
  const remaining = await database.raw(`
    SELECT
      COUNT(*) FILTER (WHERE decoded_transmission IS NULL OR decoded_transmission = '') as no_trans,
      COUNT(*) FILTER (WHERE decoded_drivetrain IS NULL OR decoded_drivetrain = '') as no_drive,
      COUNT(*) as total
    FROM yard_vehicle WHERE active = true
  `);
  console.log('\nRemaining gaps:');
  console.table(remaining.rows);

  process.exit(0);
}

main().catch(err => { console.error(err); process.exit(1); });
