#!/usr/bin/env node
'use strict';

/**
 * Backfill vehicle_frequency with generation-aware grouping.
 * Splits existing make+model rows into make+model+gen_start+gen_end.
 * Uses trim_tier_reference for generation boundaries, falls back to decade grouping.
 *
 * Usage: DATABASE_URL=... node service/scripts/backfill-vehicle-frequency-gen.js
 */

const { database } = require('../database/database');

// Cache for generation lookups
const genCache = {};

async function getGeneration(make, model, year) {
  const key = `${make}|${model}|${year}`.toLowerCase();
  if (genCache[key]) return genCache[key];

  try {
    const match = await database('trim_tier_reference')
      .whereRaw('LOWER(make) = ?', [make.toLowerCase()])
      .whereRaw('LOWER(model) = ?', [model.toLowerCase()])
      .where('gen_start', '<=', year)
      .where('gen_end', '>=', year)
      .select('gen_start', 'gen_end')
      .first();

    if (match) {
      const result = { gen_start: match.gen_start, gen_end: match.gen_end };
      genCache[key] = result;
      return result;
    }
  } catch (e) { /* table may not exist */ }

  // Fallback: decade grouping
  const decadeStart = Math.floor(year / 10) * 10;
  const result = { gen_start: decadeStart, gen_end: decadeStart + 9 };
  genCache[key] = result;
  return result;
}

async function run() {
  console.log('Backfilling vehicle_frequency with generation-aware grouping...\n');

  // Add columns if needed
  try {
    await database.raw('ALTER TABLE vehicle_frequency ADD COLUMN IF NOT EXISTS gen_start INTEGER');
    await database.raw('ALTER TABLE vehicle_frequency ADD COLUMN IF NOT EXISTS gen_end INTEGER');
    await database.raw('CREATE UNIQUE INDEX IF NOT EXISTS idx_vf_make_model_gen ON vehicle_frequency (make, model, COALESCE(gen_start, 0), COALESCE(gen_end, 0))');
  } catch (e) { /* already exists */ }

  // Clear existing data (we'll rebuild completely)
  await database('vehicle_frequency').del();
  console.log('Cleared existing vehicle_frequency data.\n');

  // Get all yard_vehicles grouped by make+model+year
  const vehicles = await database.raw(`
    SELECT make, model, year::integer as year, COUNT(*) as cnt,
      MIN(first_seen) as first_seen, MAX(first_seen) as last_seen
    FROM yard_vehicle
    WHERE make IS NOT NULL AND model IS NOT NULL AND year IS NOT NULL
    GROUP BY make, model, year
    ORDER BY make, model, year
  `);

  console.log(`Processing ${vehicles.rows.length} make+model+year combos...\n`);

  // Aggregate by make+model+generation
  const genGroups = {};
  let resolved = 0;

  for (const row of vehicles.rows) {
    const year = parseInt(row.year);
    if (!year || year < 1970 || year > 2030) continue;

    const gen = await getGeneration(row.make, row.model, year);
    const key = `${row.make}|${row.model}|${gen.gen_start}|${gen.gen_end}`.toLowerCase();

    if (!genGroups[key]) {
      genGroups[key] = {
        make: row.make, model: row.model,
        gen_start: gen.gen_start, gen_end: gen.gen_end,
        total_seen: 0, first_seen: null, last_seen: null,
      };
    }

    const g = genGroups[key];
    g.total_seen += parseInt(row.cnt);
    const fs = new Date(row.first_seen);
    const ls = new Date(row.last_seen);
    if (!g.first_seen || fs < g.first_seen) g.first_seen = fs;
    if (!g.last_seen || ls > g.last_seen) g.last_seen = ls;
    resolved++;
  }

  // Insert into vehicle_frequency
  const entries = Object.values(genGroups);
  let inserted = 0;
  for (const g of entries) {
    const avgDays = g.total_seen <= 1 ? null :
      (g.last_seen.getTime() - g.first_seen.getTime()) / 86400000 / (g.total_seen - 1);

    await database.raw(`
      INSERT INTO vehicle_frequency (make, model, gen_start, gen_end, total_seen, first_tracked_at, last_seen_at, avg_days_between, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())
      ON CONFLICT ON CONSTRAINT vehicle_frequency_pkey DO UPDATE SET
        gen_start = EXCLUDED.gen_start, gen_end = EXCLUDED.gen_end,
        total_seen = EXCLUDED.total_seen, first_tracked_at = EXCLUDED.first_tracked_at,
        last_seen_at = EXCLUDED.last_seen_at, avg_days_between = EXCLUDED.avg_days_between,
        updated_at = NOW()
    `, [g.make, g.model, g.gen_start, g.gen_end, g.total_seen, g.first_seen, g.last_seen, avgDays]);
    inserted++;
  }

  console.log(`Inserted: ${inserted} generation-aware rows (from ${resolved} year combos)`);

  // Show samples
  const camry = await database.raw("SELECT make, model, gen_start, gen_end, total_seen, ROUND(avg_days_between::numeric, 2) as avg_days FROM vehicle_frequency WHERE LOWER(model) = 'camry' ORDER BY gen_start");
  console.log('\nCamry generations:');
  console.table(camry.rows);

  const total = await database.raw('SELECT COUNT(*) as cnt FROM vehicle_frequency');
  console.log('\nTotal rows:', total.rows[0].cnt);

  await database.destroy();
}

run().catch(e => { console.error(e); process.exit(1); });
