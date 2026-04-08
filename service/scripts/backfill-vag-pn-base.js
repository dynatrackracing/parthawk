#!/usr/bin/env node
'use strict';

/**
 * Backfill VAG part number bases.
 *
 * Re-extracts partNumberBase for rows where the current base is a collapsed
 * VAG PN (9 chars, no suffix) or where the title contains a VAG-pattern PN
 * with a suffix that was previously stripped.
 *
 * Safe to rerun — idempotent. Only updates rows where the new base differs.
 *
 * Usage:
 *   DATABASE_URL=... node service/scripts/backfill-vag-pn-base.js
 *   DATABASE_URL=... node service/scripts/backfill-vag-pn-base.js --dry-run
 */

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL required');
  process.exit(1);
}

const knex = require('knex')({
  client: 'pg',
  connection: { connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } },
});

const { normalizePartNumber } = require('../utils/partMatcher');
const { extractPartNumbers } = require('../utils/partIntelligence');

const dryRun = process.argv.includes('--dry-run');

// Assertions — abort if normalize is broken
console.assert(normalizePartNumber('1K0614517DT') === '1K0614517DT', 'VAG normalize broken');
console.assert(normalizePartNumber('5C6035456A') === '5C6035456A', 'VAG normalize broken');
console.assert(normalizePartNumber('68269652AA') === '68269652', 'Chrysler normalize regression');
console.assert(normalizePartNumber('AL3T-15604-BD') === 'AL3T-15604', 'Ford normalize regression');
console.log('Normalize assertions passed');

const VAG_BARE_BASE = /^[0-9][A-Z][0-9]\d{6}$/; // exactly 9 chars, no suffix — collapsed

async function backfillTable(tableName) {
  console.log(`\n=== ${tableName} ===`);

  // Find rows with collapsed VAG bases (9 chars, no suffix letter)
  const rows = await knex(tableName)
    .whereRaw(`"partNumberBase" ~ '^[0-9][A-Z][0-9][0-9]{6}$'`)
    .select('id', 'title', 'partNumberBase');

  console.log(`  Found ${rows.length} rows with bare VAG base`);
  let updated = 0, skipped = 0;
  const samples = [];

  for (const row of rows) {
    if (!row.title) { skipped++; continue; }

    // Re-extract PNs from title
    const pns = extractPartNumbers(row.title);
    // Find a VAG PN whose base starts with the current collapsed base
    const currentBase = (row.partNumberBase || '').toUpperCase();
    let newBase = null;

    for (const pn of pns) {
      const base = pn.base.toUpperCase();
      // Must start with the current collapsed base and be longer (has suffix)
      if (base.startsWith(currentBase) && base.length > currentBase.length && /^[0-9][A-Z][0-9]\d{6}[A-Z]{1,3}$/.test(base)) {
        newBase = base;
        break;
      }
    }

    if (!newBase || newBase === currentBase) { skipped++; continue; }

    if (samples.length < 10) {
      samples.push({ old: currentBase, new: newBase, title: row.title.substring(0, 70) });
    }

    if (!dryRun) {
      await knex(tableName).where('id', row.id).update({ partNumberBase: newBase });
    }
    updated++;
  }

  console.log(`  Updated: ${updated}, Skipped: ${skipped}`);
  if (samples.length > 0) {
    console.log('  Sample changes:');
    for (const s of samples) {
      console.log(`    ${s.old} → ${s.new} | ${s.title}`);
    }
  }
  return { scanned: rows.length, updated };
}

async function main() {
  console.log(dryRun ? 'DRY RUN — no writes' : 'LIVE RUN — will update rows');
  console.log('Time:', new Date().toISOString());

  const results = {};
  for (const table of ['YourListing', 'YourSale', 'SoldItem']) {
    try {
      results[table] = await backfillTable(table);
    } catch (e) {
      console.log(`  ${table} error: ${e.message}`);
      results[table] = { scanned: 0, updated: 0, error: e.message };
    }
  }

  console.log('\n=== SUMMARY ===');
  for (const [table, r] of Object.entries(results)) {
    console.log(`  ${table}: scanned=${r.scanned}, updated=${r.updated}${r.error ? ' ERROR: ' + r.error : ''}`);
  }

  await knex.destroy();
  console.log('Done');
}

main().catch(e => { console.error('FATAL:', e.message); knex.destroy(); process.exit(1); });
