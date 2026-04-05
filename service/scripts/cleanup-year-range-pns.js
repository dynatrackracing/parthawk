'use strict';

/**
 * One-time cleanup: NULL out partNumberBase values that are concatenated year ranges.
 * e.g. "20012003", "20112014" — these are not real part numbers.
 *
 * Usage: node service/scripts/cleanup-year-range-pns.js
 */

const { database } = require('../database/database');

async function run() {
  const pattern = '^(19|20)\\d{2}(19|20)\\d{2}$';
  const tables = ['YourListing', 'YourSale', 'SoldItem'];

  for (const table of tables) {
    try {
      const result = await database(table)
        .whereRaw(`"partNumberBase" ~ '${pattern}'`)
        .update({ partNumberBase: null });
      console.log(`${table}: ${result} rows cleaned`);
    } catch (e) {
      console.log(`${table}: skipped (${e.message})`);
    }
  }

  await database.destroy();
  console.log('Done.');
}

run().catch(e => { console.error(e); process.exit(1); });
