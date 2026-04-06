#!/usr/bin/env node
'use strict';

/**
 * Backfill vehicle_frequency from all yard_vehicle history.
 * Usage: DATABASE_URL=... node service/scripts/backfill-vehicle-frequency.js
 */

const { database } = require('../database/database');

async function run() {
  console.log('Backfilling vehicle_frequency from yard_vehicle history...\n');

  const rows = await database.raw(`
    SELECT make, model, COUNT(*) as total_seen,
      MIN(first_seen) as first_tracked_at,
      MAX(first_seen) as last_seen_at
    FROM yard_vehicle
    WHERE make IS NOT NULL AND model IS NOT NULL
    GROUP BY make, model
  `);

  let inserted = 0;
  for (const row of rows.rows) {
    const totalSeen = parseInt(row.total_seen);
    const first = new Date(row.first_tracked_at);
    const last = new Date(row.last_seen_at);
    const daysBetween = totalSeen <= 1 ? null :
      (last.getTime() - first.getTime()) / 86400000 / (totalSeen - 1);

    await database.raw(`
      INSERT INTO vehicle_frequency (make, model, total_seen, first_tracked_at, last_seen_at, avg_days_between, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, NOW())
      ON CONFLICT (make, model) DO UPDATE SET
        total_seen = EXCLUDED.total_seen,
        first_tracked_at = EXCLUDED.first_tracked_at,
        last_seen_at = EXCLUDED.last_seen_at,
        avg_days_between = EXCLUDED.avg_days_between,
        updated_at = NOW()
    `, [row.make, row.model, totalSeen, first, last, daysBetween]);
    inserted++;
  }

  console.log(`Inserted/updated: ${inserted} rows`);

  // Show samples
  const legendary = await database.raw(`SELECT make, model, total_seen, avg_days_between FROM vehicle_frequency WHERE total_seen = 1 ORDER BY make LIMIT 5`);
  console.log('\nSample LEGENDARY (1 sighting):');
  console.table(legendary.rows);

  const saturated = await database.raw(`SELECT make, model, total_seen, ROUND(avg_days_between::numeric, 2) as avg_days FROM vehicle_frequency ORDER BY avg_days_between ASC NULLS LAST LIMIT 5`);
  console.log('\nSample SATURATED (most frequent):');
  console.table(saturated.rows);

  await database.destroy();
}

run().catch(e => { console.error(e); process.exit(1); });
