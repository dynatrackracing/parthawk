#!/usr/bin/env node
'use strict';

/**
 * Backfill decoded_cylinders on yard_vehicle from vPIC stored procedure.
 * Manual run only -- NOT auto-triggered by deploy.
 *
 * Usage:
 *   DATABASE_URL=... node service/scripts/backfill-decoded-cylinders.js
 *   DATABASE_URL=... node service/scripts/backfill-decoded-cylinders.js --dry-run
 */

if (!process.env.DATABASE_URL) { console.error('DATABASE_URL required'); process.exit(1); }

const knex = require('knex')({
  client: 'pg',
  connection: { connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } },
});

const dryRun = process.argv.includes('--dry-run');
const BATCH_SIZE = 500;

async function main() {
  console.log(dryRun ? 'DRY RUN' : 'LIVE RUN');
  console.log('Time:', new Date().toISOString());

  const rows = await knex('yard_vehicle')
    .where('active', true)
    .whereNull('decoded_cylinders')
    .whereNotNull('vin')
    .whereRaw("LENGTH(vin) = 17")
    .select('id', 'vin', 'year', 'make', 'model');

  console.log('Rows to process:', rows.length);
  let filled = 0, nullResult = 0, errors = 0;
  const batches = Math.ceil(rows.length / BATCH_SIZE);

  for (let b = 0; b < batches; b++) {
    const batch = rows.slice(b * BATCH_SIZE, (b + 1) * BATCH_SIZE);
    for (const row of batch) {
      try {
        const result = await knex.raw('SELECT variable, value FROM vpic.spvindecode(?)', [row.vin]);
        let cyl = null;
        for (const r of result.rows) {
          if (r.variable === 'Engine Number of Cylinders' && r.value) {
            cyl = parseInt(r.value);
            break;
          }
        }
        if (cyl && !isNaN(cyl) && cyl >= 1 && cyl <= 16) {
          if (!dryRun) {
            await knex('yard_vehicle').where('id', row.id).update({ decoded_cylinders: cyl });
          }
          filled++;
        } else {
          nullResult++;
        }
      } catch (e) {
        errors++;
      }
    }
    console.log('Batch ' + (b + 1) + '/' + batches + ': filled=' + filled + ' null=' + nullResult + ' errors=' + errors);
  }

  console.log('\n=== SUMMARY ===');
  console.log('Total processed:', rows.length);
  console.log('Filled:', filled);
  console.log('Null (vPIC has no cylinders):', nullResult);
  console.log('Errors:', errors);

  await knex.destroy();
  console.log('Done');
}

main().catch(e => { console.error('FATAL:', e.message); knex.destroy(); process.exit(1); });
