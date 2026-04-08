#!/usr/bin/env node
'use strict';

/**
 * One-time backfill: fill NULL date_added from createdAt::date.
 * After this, all active yard_vehicle rows have a date_added value.
 *
 * Usage:
 *   DATABASE_URL=... node service/scripts/backfill-date-added-from-createdat.js
 *   DATABASE_URL=... node service/scripts/backfill-date-added-from-createdat.js --dry-run
 */

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL required');
  process.exit(1);
}

const knex = require('knex')({
  client: 'pg',
  connection: { connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } },
});

const dryRun = process.argv.includes('--dry-run');

async function main() {
  console.log(dryRun ? 'DRY RUN' : 'LIVE RUN');

  // Find all rows with NULL date_added
  const nullRows = await knex('yard_vehicle')
    .whereNull('date_added')
    .select('id', 'yard_id', 'year', 'make', 'model', 'createdAt');

  console.log('Rows with NULL date_added:', nullRows.length);
  if (nullRows.length === 0) {
    console.log('Nothing to backfill');
    await knex.destroy();
    return;
  }

  // Group by yard for reporting
  const byYard = {};
  for (const r of nullRows) {
    byYard[r.yard_id] = (byYard[r.yard_id] || 0) + 1;
  }

  // Get yard names
  const yards = await knex('yard').select('id', 'name');
  const yardNames = {};
  for (const y of yards) yardNames[y.id] = y.name;

  console.log('\nPer-yard NULL counts:');
  for (const [yardId, count] of Object.entries(byYard)) {
    console.log('  ' + (yardNames[yardId] || yardId).padEnd(30) + count);
  }

  if (!dryRun) {
    // Bulk update: SET date_added = createdAt::date WHERE date_added IS NULL
    const result = await knex.raw(`
      UPDATE yard_vehicle
      SET date_added = "createdAt"::date
      WHERE date_added IS NULL
    `);
    console.log('\nUpdated:', result.rowCount, 'rows');
  } else {
    console.log('\nWould update', nullRows.length, 'rows');
  }

  // Verify
  const remaining = await knex('yard_vehicle').whereNull('date_added').count('* as c').first();
  console.log('Remaining NULL date_added:', remaining.c);

  await knex.destroy();
  console.log('Done');
}

main().catch(e => { console.error('FATAL:', e.message); knex.destroy(); process.exit(1); });
