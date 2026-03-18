'use strict';

/**
 * Import script for dynatrack sales and listings export data.
 *
 * Usage:
 *   node service/scripts/import-dynatrack-data.js
 *
 * Reads:
 *   dynatrack-sales-export.json   — YourSale records
 *   dynatrack-listings-export.json — YourListing records
 *
 * Both files should be in the project root.
 * Skips records that already exist (by ebayOrderId / ebayItemId).
 */

const fs = require('fs');
const path = require('path');
const { database } = require('../database/database');
const { Model } = require('objection');

Model.knex(database);

const ROOT = path.resolve(__dirname, '../../');

async function importSales() {
  const filePath = path.join(ROOT, 'dynatrack-sales-export.json');
  if (!fs.existsSync(filePath)) {
    console.log('No dynatrack-sales-export.json found — skipping sales import');
    return { imported: 0, skipped: 0, errors: 0 };
  }

  const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  console.log(`Sales file loaded: ${raw.length} records`);

  let imported = 0, skipped = 0, errors = 0;

  for (const r of raw) {
    const orderId = r.ebayOrderId || r.orderId || r.orderNumber;
    if (!orderId) { errors++; continue; }

    try {
      const existing = await database('YourSale').where('ebayOrderId', orderId).first();
      if (existing) { skipped++; continue; }

      await database('YourSale').insert({
        ebayOrderId: orderId,
        ebayItemId: r.ebayItemId || r.itemId || null,
        title: r.title || null,
        sku: r.sku || r.customLabel || null,
        quantity: parseInt(r.quantity) || 1,
        salePrice: parseFloat(r.salePrice || r.price || 0) || null,
        soldDate: r.soldDate ? new Date(r.soldDate) : null,
        buyerUsername: r.buyerUsername || r.buyer || null,
        shippedDate: r.shippedDate ? new Date(r.shippedDate) : null,
        store: r.store || 'dynatrack',
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      imported++;
    } catch (err) {
      if (err.message.includes('duplicate') || err.message.includes('unique')) {
        skipped++;
      } else {
        errors++;
        if (errors <= 3) console.error('Sale insert error:', err.message);
      }
    }
  }

  console.log(`Sales import: ${imported} imported, ${skipped} skipped, ${errors} errors`);
  return { imported, skipped, errors };
}

async function importListings() {
  const filePath = path.join(ROOT, 'dynatrack-listings-export.json');
  if (!fs.existsSync(filePath)) {
    console.log('No dynatrack-listings-export.json found — skipping listings import');
    return { imported: 0, skipped: 0, errors: 0 };
  }

  const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  console.log(`Listings file loaded: ${raw.length} records`);

  let imported = 0, skipped = 0, errors = 0;

  for (const r of raw) {
    const itemId = r.ebayItemId || r.itemId;
    if (!itemId) { errors++; continue; }

    try {
      const existing = await database('YourListing').where('ebayItemId', itemId).first();
      if (existing) {
        // Update instead of skip — sync latest data
        await database('YourListing').where('ebayItemId', itemId).update({
          title: r.title || existing.title,
          sku: r.sku || r.customLabel || existing.sku,
          quantityAvailable: parseInt(r.quantityAvailable || r.quantity) || existing.quantityAvailable,
          currentPrice: parseFloat(r.currentPrice || r.price || 0) || existing.currentPrice,
          listingStatus: r.listingStatus || r.status || existing.listingStatus,
          startTime: r.startTime ? new Date(r.startTime) : existing.startTime,
          viewItemUrl: r.viewItemUrl || r.url || existing.viewItemUrl,
          syncedAt: new Date(),
          updatedAt: new Date(),
        });
        skipped++;
        continue;
      }

      await database('YourListing').insert({
        ebayItemId: itemId,
        title: r.title || null,
        sku: r.sku || r.customLabel || null,
        quantityAvailable: parseInt(r.quantityAvailable || r.quantity) || 1,
        currentPrice: parseFloat(r.currentPrice || r.price || 0) || null,
        listingStatus: r.listingStatus || r.status || 'Active',
        startTime: r.startTime ? new Date(r.startTime) : new Date(),
        viewItemUrl: r.viewItemUrl || r.url || null,
        syncedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      imported++;
    } catch (err) {
      if (err.message.includes('duplicate') || err.message.includes('unique')) {
        skipped++;
      } else {
        errors++;
        if (errors <= 3) console.error('Listing insert error:', err.message);
      }
    }
  }

  console.log(`Listings import: ${imported} imported, ${skipped} updated, ${errors} errors`);
  return { imported, skipped, errors };
}

async function run() {
  try {
    console.log('Running database migrations...');
    await database.migrate.latest(database.client.config.migration);

    console.log('\n=== Importing Sales ===');
    const salesResult = await importSales();

    console.log('\n=== Importing Listings ===');
    const listingsResult = await importListings();

    console.log('\n=== Summary ===');
    console.log('Sales:', salesResult);
    console.log('Listings:', listingsResult);

    // Verify counts
    const saleCount = await database('YourSale').count('* as cnt').first();
    const listingCount = await database('YourListing').count('* as cnt').first();
    console.log(`\nDB totals: ${saleCount.cnt} sales, ${listingCount.cnt} listings`);
  } catch (err) {
    console.error('Import failed:', err);
  } finally {
    await database.destroy();
  }
}

// Run if called directly
if (require.main === module) {
  run();
}

module.exports = { importSales, importListings };
