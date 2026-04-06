'use strict';

/**
 * Backfill EPA transmission data into yard_vehicle.
 * Phase A: Delete vin_cache entries with null transmission to force re-decode.
 * Phase B: Re-decode yard_vehicles missing decoded_transmission or with CHECK_MT.
 *
 * Usage: DATABASE_URL=... node service/scripts/backfill-epa-transmission.js
 */

const { database } = require('../database/database');
const { decode } = require('../lib/LocalVinDecoder');

async function run() {
  // Phase A: Flush vin_cache entries with no transmission (forces full re-decode with EPA)
  const deleted = await database('vin_cache')
    .whereNull('transmission_style')
    .orWhere('transmission_style', '')
    .del();
  console.log(`Phase A: Deleted ${deleted} vin_cache entries with null transmission_style`);

  // Phase B: Re-decode yard_vehicles
  const vehicles = await database('yard_vehicle')
    .whereNotNull('vin')
    .where('active', true)
    .where(function() {
      this.whereNull('decoded_transmission')
        .orWhere('decoded_transmission', '')
        .orWhere('decoded_transmission', 'CHECK_MT');
    })
    .select('id', 'vin', 'decoded_transmission')
    .limit(10000);

  console.log(`Phase B: ${vehicles.length} vehicles to process`);

  let updated = 0, skipped = 0, errors = 0;
  let autoCount = 0, manualCount = 0, checkMtCount = 0;

  for (let i = 0; i < vehicles.length; i++) {
    try {
      const v = vehicles[i];
      const result = await decode(v.vin);
      if (!result || !result.transHint) {
        skipped++;
        continue;
      }

      const patch = {
        decoded_transmission: result.transHint,
        updatedAt: new Date(),
      };
      if (result.transSpeeds) patch.transmission_speeds = result.transSpeeds;

      await database('yard_vehicle').where('id', v.id).update(patch);
      updated++;

      if (result.transHint === 'Automatic') autoCount++;
      else if (result.transHint === 'Manual') manualCount++;
      else if (result.transHint === 'CHECK_MT') checkMtCount++;
    } catch (e) {
      errors++;
    }

    if ((i + 1) % 100 === 0) {
      console.log(`  Progress: ${i + 1}/${vehicles.length} — ${updated} updated, ${skipped} skipped, ${errors} errors`);
    }
  }

  console.log(`\nPhase B complete:`);
  console.log(`  Updated: ${updated} (${autoCount} Automatic, ${manualCount} Manual, ${checkMtCount} CHECK_MT)`);
  console.log(`  Skipped: ${skipped} (no EPA data)`);
  console.log(`  Errors: ${errors}`);

  await database.destroy();
}

run().catch(e => { console.error(e); process.exit(1); });
