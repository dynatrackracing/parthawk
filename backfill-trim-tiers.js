'use strict';

/**
 * BACKFILL TRIM TIERS
 *
 * Re-runs TrimTierService.lookup() on all yard_vehicle records to populate
 * trim_tier, audio_brand, expected_parts, and cult from the 1,049-entry
 * trim_tier_reference table. Does NOT call NHTSA — uses existing decoded data.
 *
 * Safe to re-run after CSV data updates.
 *
 * Usage: node backfill-trim-tiers.js
 */

const knex = require('knex');
const path = require('path');
const TrimTierService = require('./service/services/TrimTierService');

try { require('dotenv').config({ path: path.resolve(__dirname, '.env') }); } catch (e) {}

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('DATABASE_URL is required');
  process.exit(1);
}

const db = knex({
  client: 'pg',
  connection: { connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } },
  pool: { min: 1, max: 3 },
});

function titleCase(str) {
  if (!str) return str;
  return str.toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
}

async function main() {
  console.log('=== BACKFILL TRIM TIERS ===');
  console.log('Time:', new Date().toISOString());

  const total = await db('yard_vehicle').count('* as c').first();
  console.log(`Total yard_vehicle records: ${total.c}\n`);

  const BATCH = 50;
  let offset = 0;
  let processed = 0, updated = 0, noMatch = 0;
  let cultCount = 0;
  const tierCounts = { BASE: 0, CHECK: 0, PREMIUM: 0, PERFORMANCE: 0 };
  let audioBrandCount = 0;

  while (true) {
    const batch = await db('yard_vehicle')
      .select('id', 'year', 'make', 'model',
              'trim', 'trim_level', 'decoded_trim',
              'engine', 'decoded_engine',
              'drivetrain', 'decoded_drivetrain',
              'decoded_transmission', 'trim_tier')
      .orderBy('id')
      .limit(BATCH)
      .offset(offset);

    if (batch.length === 0) break;

    let batchUpdated = 0;

    for (const v of batch) {
      processed++;

      if (!v.year || !v.make || !v.model) continue;

      const year = parseInt(v.year) || 0;
      const make = titleCase(v.make);
      const model = titleCase(v.model);
      const trimName = v.decoded_trim || v.trim_level || v.trim || null;
      const engine = v.decoded_engine || v.engine || null;
      const transmission = v.decoded_transmission || null;
      const dt = v.decoded_drivetrain || v.drivetrain || null;

      const result = await TrimTierService.lookup(year, make, model, trimName, engine, transmission, dt);

      if (!result) {
        noMatch++;
        continue;
      }

      const updateData = {};
      let shouldUpdate = false;

      // Update trim_tier if currently null or if we have a confident trim match
      if (!v.trim_tier || (trimName && !result.engineInferred)) {
        updateData.trim_tier = result.tierString;
        shouldUpdate = true;
      }

      // Always update these enrichment fields
      if (result.audioBrand) { updateData.audio_brand = result.audioBrand; shouldUpdate = true; }
      if (result.expectedParts) { updateData.expected_parts = result.expectedParts; shouldUpdate = true; }
      if (result.cult) { updateData.cult = true; shouldUpdate = true; }
      // Fill in transmission from reference when NHTSA didn't provide it
      if (result.transmission && !v.decoded_transmission) {
        updateData.decoded_transmission = result.transmission;
        shouldUpdate = true;
      }

      if (shouldUpdate) {
        await db('yard_vehicle').where('id', v.id).update(updateData);
        batchUpdated++;
        updated++;
      }

      if (result.cult) cultCount++;
      if (result.tierString && tierCounts[result.tierString] !== undefined) tierCounts[result.tierString]++;
      if (result.audioBrand) audioBrandCount++;
    }

    offset += BATCH;
    if (batchUpdated > 0 || offset % 500 === 0) {
      console.log(`  Processed ${offset}... updated ${batchUpdated} in this batch (${updated} total)`);
    }
  }

  console.log('\n=== BACKFILL COMPLETE ===');
  console.log(`Total processed:    ${processed}`);
  console.log(`Updated:            ${updated}`);
  console.log(`No match:           ${noMatch}`);
  console.log(`Cult vehicles:      ${cultCount}`);
  console.log(`With audio brand:   ${audioBrandCount}`);
  console.log(`Tier breakdown:`);
  Object.entries(tierCounts).forEach(([t, c]) => console.log(`  ${t}: ${c}`));

  await db.destroy();
}

main().catch(err => {
  console.error('FATAL:', err.message);
  process.exit(1);
});
