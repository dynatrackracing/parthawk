#!/usr/bin/env node
'use strict';

/**
 * Backfill vin_cache with is_hybrid / is_phev / is_electric flags.
 * Uses classifyPowertrain() from LocalVinDecoder against stored data.
 *
 * Usage:
 *   DATABASE_URL=... node service/scripts/backfill-hybrid-flags.js
 *   DATABASE_URL=... node service/scripts/backfill-hybrid-flags.js --dry-run
 */

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL required');
  process.exit(1);
}

const knex = require('knex')({
  client: 'pg',
  connection: { connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } },
});

const { classifyPowertrain } = require('../lib/LocalVinDecoder');

const dryRun = process.argv.includes('--dry-run');

// Sanity assertions
const t1 = classifyPowertrain(null, 'Toyota', 'Prius', null);
console.assert(t1.isHybrid === true, 'Prius should be hybrid');
const t2 = classifyPowertrain(null, 'Tesla', 'Model 3', null);
console.assert(t2.isElectric === true, 'Tesla should be electric');
const t3 = classifyPowertrain(null, 'Toyota', 'Camry', null);
console.assert(t3.isHybrid === false && t3.isElectric === false, 'Gas Camry should be Gas');
const t4 = classifyPowertrain(null, 'Toyota', 'RAV4 Prime', null);
console.assert(t4.isPHEV === true, 'RAV4 Prime should be PHEV');
console.log('Assertions passed');

async function main() {
  console.log(dryRun ? 'DRY RUN' : 'LIVE RUN');

  // Get all vin_cache rows
  const rows = await knex('vin_cache').select('vin', 'make', 'model', 'trim', 'fuel_type');
  console.log('Total vin_cache rows:', rows.length);

  const stats = { hybrid: 0, phev: 0, electric: 0, gas: 0 };
  const byMake = {};
  const updates = [];

  for (const row of rows) {
    const pwt = classifyPowertrain(row.fuel_type, row.make, row.model, row.trim);
    if (pwt.isHybrid || pwt.isPHEV || pwt.isElectric) {
      const makeKey = row.make || '?';
      if (!byMake[makeKey]) byMake[makeKey] = { hybrid: 0, phev: 0, electric: 0 };
      if (pwt.isElectric) { stats.electric++; byMake[makeKey].electric++; }
      else if (pwt.isPHEV) { stats.phev++; byMake[makeKey].phev++; }
      else { stats.hybrid++; byMake[makeKey].hybrid++; }
      updates.push({ vin: row.vin, is_hybrid: pwt.isHybrid, is_phev: pwt.isPHEV, is_electric: pwt.isElectric });
    } else {
      stats.gas++;
    }
  }

  console.log('\nClassification:', JSON.stringify(stats));
  console.log('\nPer-make breakdown:');
  for (const [make, counts] of Object.entries(byMake).sort((a, b) => (b[1].hybrid + b[1].phev + b[1].electric) - (a[1].hybrid + a[1].phev + a[1].electric))) {
    console.log('  ' + make.padEnd(18) + 'HYBRID=' + counts.hybrid + ' PHEV=' + counts.phev + ' EV=' + counts.electric);
  }

  if (!dryRun && updates.length > 0) {
    console.log('\nUpdating ' + updates.length + ' rows...');
    for (const u of updates) {
      await knex('vin_cache').where('vin', u.vin).update({
        is_hybrid: u.is_hybrid,
        is_phev: u.is_phev,
        is_electric: u.is_electric,
      });
    }
    console.log('Done');
  } else if (dryRun) {
    console.log('\nWould update ' + updates.length + ' rows');
  }

  await knex.destroy();
}

main().catch(e => { console.error('FATAL:', e.message); knex.destroy(); process.exit(1); });
