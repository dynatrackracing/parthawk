#!/usr/bin/env node
'use strict';

/**
 * fix-ford-pn-base.js — Backfill partNumberBase on all tables using fixed extractStructuredFields.
 *
 * The old extractStructuredFields stripped Ford PNs to generic position codes (12A650).
 * The fix keeps the vehicle prefix (7L3A12A650).
 *
 * Usage: DATABASE_URL="..." node service/scripts/fix-ford-pn-base.js
 * Rerunnable — only updates rows where the new base differs from the old one.
 */

const { database } = require('../database/database');
const { extractStructuredFields } = require('../utils/partIntelligence');

async function backfillTable(tableName, titleColumn = 'title') {
  const rows = await database(tableName)
    .whereNotNull(titleColumn)
    .whereNotNull('partNumberBase')
    .select('id', titleColumn, 'partNumberBase');

  let updated = 0;
  for (const row of rows) {
    const fields = extractStructuredFields(row[titleColumn]);
    if (fields.partNumberBase && fields.partNumberBase !== row.partNumberBase) {
      await database(tableName).where('id', row.id).update({ partNumberBase: fields.partNumberBase });
      updated++;
    }
  }
  console.log(`${tableName}: ${updated} of ${rows.length} rows updated`);
  return updated;
}

async function main() {
  console.log('Backfilling partNumberBase with fixed Ford PN extraction...\n');

  const t1 = await backfillTable('YourListing');
  const t2 = await backfillTable('YourSale');
  const t3 = await backfillTable('SoldItem');

  console.log(`\nTotal updated: ${t1 + t2 + t3}`);

  // Verify Ford ECMs are now distinct
  const check = await database.raw(`
    SELECT "partNumberBase", COUNT(*) as cnt
    FROM "YourListing"
    WHERE "listingStatus" = 'Active' AND title ILIKE '%12A650%'
    GROUP BY "partNumberBase" ORDER BY cnt DESC LIMIT 10
  `);
  console.log('\nFord ECM partNumberBase distribution (should be distinct, NOT all 12A650):');
  console.table(check.rows);

  process.exit(0);
}

main().catch(err => { console.error(err); process.exit(1); });
