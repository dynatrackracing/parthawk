#!/usr/bin/env node
'use strict';

/**
 * CSV BACKFILL — Import eBay Orders Report CSVs into YourSale
 *
 * Usage:
 *   node service/scripts/csv-backfill-sales.js --dry-run    (default, preview only)
 *   node service/scripts/csv-backfill-sales.js --execute     (actually insert)
 *
 * Reads 5 eBay Orders Report CSVs from the Downloads folder.
 * Deduplicates against existing YourSale records by ebayItemId.
 * Assigns store based on Item Number prefix.
 */

const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse/sync');
const { v4: uuidv4 } = require('uuid');

// Load .env
try { require('dotenv').config({ path: path.resolve(__dirname, '../../.env') }); } catch (e) {}

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('DATABASE_URL is required');
  process.exit(1);
}

const knex = require('knex')({
  client: 'pg',
  connection: { connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } },
  pool: { min: 1, max: 3 },
});

const EXECUTE = process.argv.includes('--execute');
const DRY_RUN = !EXECUTE;

// CSV files — in the Downloads folder (parent of parthawk-deploy)
const CSV_DIR = path.resolve(__dirname, '../../../../');
const CSV_FILES = [
  'eBay-OrdersReport-Mar-17-2026-17_47_58-0700-11294078063.csv',
  'eBay-OrdersReport-Mar-17-2026-17_48_21-0700-13289108147.csv',
  'eBay-OrdersReport-Mar-17-2026-17_53_16-0700-13289109021.csv',
  'eBay-OrdersReport-Mar-17-2026-17_51_33-0700-12305963929.csv',
  'eBay-OrdersReport-Mar-17-2026-17_51_53-0700-12305963994.csv',
];

// Month name → number
const MONTHS = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

function parseEbayDate(dateStr) {
  if (!dateStr || !dateStr.trim()) return null;
  // Format: "Mar-17-26" → March 17, 2026
  const parts = dateStr.trim().split('-');
  if (parts.length !== 3) return null;
  const monthNum = MONTHS[parts[0].toLowerCase()];
  if (monthNum === undefined) return null;
  const day = parseInt(parts[1]);
  let year = parseInt(parts[2]);
  if (isNaN(day) || isNaN(year)) return null;
  // 2-digit year: 90+ = 1990s, else 2000s
  if (year < 100) year = year >= 90 ? 1900 + year : 2000 + year;
  return new Date(year, monthNum, day);
}

function parsePrice(priceStr) {
  if (!priceStr) return null;
  const cleaned = priceStr.replace(/[$,]/g, '').trim();
  const val = parseFloat(cleaned);
  return isNaN(val) ? null : val;
}

function determineStore(itemNumber, customLabel) {
  if (customLabel && /autolumen/i.test(customLabel)) return 'autolumen';
  if (!itemNumber) return 'dynatrack';
  if (itemNumber.startsWith('397')) return 'autolumen';
  // DynaTrack item numbers start with 286, 287, or other
  return 'dynatrack';
}

function parseCSVFile(filePath) {
  const raw = fs.readFileSync(filePath, 'utf-8');

  // Remove BOM if present
  const content = raw.replace(/^\uFEFF/, '');

  // Split into lines, skip row 1 (empty commas) and row 3 (empty)
  const lines = content.split('\n');
  if (lines.length < 4) return [];

  // Row 2 is the header, rows 4+ are data
  // Reconstruct CSV from header + data rows
  const headerLine = lines[1];
  const dataLines = lines.slice(3).filter(l => l.trim());
  const csvContent = [headerLine, ...dataLines].join('\n');

  const records = parse(csvContent, {
    columns: true,
    skip_empty_lines: true,
    relax_column_count: true,
    bom: true,
    quote: '"',
    escape: '"',
  });

  return records;
}

async function main() {
  console.log('═══════════════════════════════════════════════════');
  console.log('  CSV BACKFILL — eBay Orders → YourSale');
  console.log(`  Mode: ${DRY_RUN ? 'DRY RUN (preview only)' : '🔴 EXECUTE (writing to DB)'}`);
  console.log('═══════════════════════════════════════════════════\n');

  // Get existing ebayItemIds for dedup
  console.log('Loading existing YourSale records for dedup...');
  const existing = await knex('YourSale').select('ebayItemId');
  const existingIds = new Set(existing.map(r => r.ebayItemId));
  console.log(`  ${existingIds.size} existing records\n`);

  const stats = {
    totalParsed: 0,
    totalInserted: 0,
    totalSkippedDupes: 0,
    totalSkippedInvalid: 0,
    byStore: { dynatrack: 0, autolumen: 0 },
    byFile: {},
    dates: [],
  };

  const toInsert = [];

  for (const csvFile of CSV_FILES) {
    const filePath = path.join(CSV_DIR, csvFile);
    if (!fs.existsSync(filePath)) {
      console.log(`  ⚠ File not found: ${csvFile}`);
      stats.byFile[csvFile] = { parsed: 0, error: 'not found' };
      continue;
    }

    console.log(`  Parsing: ${csvFile}`);
    let records;
    try {
      records = parseCSVFile(filePath);
    } catch (err) {
      console.log(`    ❌ Parse error: ${err.message}`);
      stats.byFile[csvFile] = { parsed: 0, error: err.message };
      continue;
    }

    let fileParsed = 0, fileDupes = 0, fileInvalid = 0, fileNew = 0;

    for (const row of records) {
      fileParsed++;
      stats.totalParsed++;

      const itemNumber = (row['Item Number'] || '').trim();
      const soldFor = parsePrice(row['Sold For']);
      const saleDate = parseEbayDate(row['Sale Date']);

      // Skip invalid rows
      if (!itemNumber || !soldFor || soldFor <= 0 || !saleDate) {
        fileInvalid++;
        stats.totalSkippedInvalid++;
        continue;
      }

      // Dedup
      if (existingIds.has(itemNumber)) {
        fileDupes++;
        stats.totalSkippedDupes++;
        continue;
      }

      // Mark as seen to prevent intra-CSV dupes
      existingIds.add(itemNumber);

      const orderNumber = (row['Order Number'] || '').trim();
      const title = (row['Item Title'] || '').trim();
      const sku = (row['Custom Label'] || '').trim() || null;
      const quantity = parseInt(row['Quantity']) || 1;
      const buyerUsername = (row['Buyer Username'] || '').trim() || null;
      const store = determineStore(itemNumber, sku);

      toInsert.push({
        id: uuidv4(),
        ebayOrderId: orderNumber || null,
        ebayItemId: itemNumber,
        title,
        sku,
        quantity,
        salePrice: soldFor,
        soldDate: saleDate,
        buyerUsername,
        shippedDate: null,
        store,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      stats.byStore[store] = (stats.byStore[store] || 0) + 1;
      stats.dates.push(saleDate);
      fileNew++;
    }

    stats.byFile[csvFile] = { parsed: fileParsed, dupes: fileDupes, invalid: fileInvalid, new: fileNew };
    console.log(`    ${fileParsed} rows | ${fileNew} new | ${fileDupes} dupes | ${fileInvalid} invalid`);
  }

  console.log('\n═══════════════════════════════════════════════════');
  console.log('  SUMMARY');
  console.log('═══════════════════════════════════════════════════');
  console.log(`  Total parsed:          ${stats.totalParsed}`);
  console.log(`  New (to insert):       ${toInsert.length}`);
  console.log(`  Skipped (duplicates):  ${stats.totalSkippedDupes}`);
  console.log(`  Skipped (invalid):     ${stats.totalSkippedInvalid}`);
  console.log(`  By store:`);
  Object.entries(stats.byStore).forEach(([s, c]) => console.log(`    ${s}: ${c}`));

  if (stats.dates.length > 0) {
    const sorted = stats.dates.sort((a, b) => a - b);
    console.log(`  Date range:            ${sorted[0].toISOString().slice(0, 10)} → ${sorted[sorted.length - 1].toISOString().slice(0, 10)}`);
  }

  console.log('\n  Per file:');
  Object.entries(stats.byFile).forEach(([f, s]) => {
    const name = f.substring(0, 50);
    console.log(`    ${name}: ${s.parsed || 0} parsed, ${s.new || 0} new, ${s.dupes || 0} dupes, ${s.invalid || 0} invalid${s.error ? ' ERROR: ' + s.error : ''}`);
  });

  if (DRY_RUN) {
    console.log('\n  ⏸  DRY RUN — no data written. Run with --execute to insert.');
  } else {
    console.log(`\n  Inserting ${toInsert.length} records in batches of 100...`);
    let inserted = 0;
    for (let i = 0; i < toInsert.length; i += 100) {
      const batch = toInsert.slice(i, i + 100);
      try {
        await knex('YourSale').insert(batch);
        inserted += batch.length;
        if ((i + 100) % 1000 === 0 || i + 100 >= toInsert.length) {
          console.log(`    Inserted ${Math.min(i + 100, toInsert.length)}/${toInsert.length}...`);
        }
      } catch (err) {
        console.log(`    ❌ Batch ${i}-${i + batch.length}: ${err.message.substring(0, 80)}`);
      }
    }
    stats.totalInserted = inserted;
    console.log(`  ✅ Inserted: ${inserted}`);
  }

  // Final count
  const finalCount = await knex('YourSale').count('* as count').first();
  console.log(`\n  Final YourSale count: ${finalCount.count}`);
  console.log('═══════════════════════════════════════════════════\n');

  await knex.destroy();
}

main().catch(err => {
  console.error('FATAL:', err.message);
  process.exit(1);
});
