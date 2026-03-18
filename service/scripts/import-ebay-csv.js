'use strict';

/**
 * eBay Orders CSV Import Script
 * Usage: node service/scripts/import-ebay-csv.js <csv-file> <store-name>
 * Example: node service/scripts/import-ebay-csv.js dynatrack-orders.csv dynatrack
 *          node service/scripts/import-ebay-csv.js autolumen-orders.csv autolumen
 */

const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse/sync');
const dotenv = require('dotenv');
dotenv.config();

const { database } = require('../database/database');
const { Model } = require('objection');

function parsePrice(str) {
  if (!str) return null;
  return parseFloat(str.replace(/[$,]/g, '')) || null;
}

function parseDate(str) {
  if (!str || str.trim() === '') return null;
  const d = new Date(str);
  return isNaN(d.getTime()) ? null : d;
}

async function importCSV(filePath, storeName) {
  console.log(`\n=== PartHawk eBay CSV Import ===`);
  console.log(`File: ${filePath}`);
  console.log(`Store: ${storeName}`);

  if (!fs.existsSync(filePath)) {
    console.error(`File not found: ${filePath}`);
    process.exit(1);
  }

  const content = fs.readFileSync(filePath, 'utf-8').replace(/^\uFEFF/, ''); // strip BOM

  // Find the header row (skip blank first rows)
  const lines = content.split('\n');
  let headerIndex = 0;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes('Sales Record Number')) {
      headerIndex = i;
      break;
    }
  }

  const csvContent = lines.slice(headerIndex).join('\n');

  let records;
  try {
    records = parse(csvContent, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
      relax_column_count: true,
    });
  } catch (err) {
    console.error('Failed to parse CSV:', err.message);
    process.exit(1);
  }

  console.log(`\nParsed ${records.length} records from CSV`);

  Model.knex(database);
  await database.migrate.latest(database.client.config.migration);

  let imported = 0;
  let skipped = 0;
  let errors = 0;

  for (const row of records) {
    const orderId = row['Order Number'];
    if (!orderId || orderId.trim() === '') continue;

    const salePrice = parsePrice(row['Sold For']);
    const shippingPrice = parsePrice(row['Shipping And Handling']);
    const soldDate = parseDate(row['Sale Date']);
    const shippedDate = parseDate(row['Shipped On Date']);

    try {
      // Check if already imported
      const existing = await database('YourSale')
        .where('ebayOrderId', orderId)
        .first();

      if (existing) {
        skipped++;
        continue;
      }

      await database('YourSale').insert({
        ebayOrderId: orderId,
        ebayItemId: row['Item Number'] || null,
        title: row['Item Title'] || null,
        sku: row['Custom Label'] || null,
        quantity: parseInt(row['Quantity']) || 1,
        salePrice: salePrice,
        soldDate: soldDate,
        buyerUsername: row['Buyer Username'] || null,
        shippedDate: shippedDate,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      imported++;

      if (imported % 100 === 0) {
        console.log(`  Imported ${imported} records...`);
      }

    } catch (err) {
      errors++;
      if (errors <= 5) {
        console.error(`  Error on order ${orderId}:`, err.message);
      }
    }
  }

  console.log(`\n=== Import Complete ===`);
  console.log(`Store: ${storeName}`);
  console.log(`Imported: ${imported}`);
  console.log(`Skipped (already exists): ${skipped}`);
  console.log(`Errors: ${errors}`);
  console.log(`Total processed: ${records.length}`);

  await database.destroy();
}

// Main
const args = process.argv.slice(2);
if (args.length < 2) {
  console.log('Usage: node service/scripts/import-ebay-csv.js <csv-file> <store-name>');
  console.log('Example: node service/scripts/import-ebay-csv.js ./dynatrack.csv dynatrack');
  process.exit(1);
}

importCSV(args[0], args[1]).catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
