'use strict';

/**
 * Import all old PartHawk data from JSON exports.
 *
 * Usage: DATABASE_URL=postgres://... node service/scripts/import-all-data.js
 *
 * Reads from: C:\Users\atenr\Downloads\parthawk-update\parthawk-update\data\
 *   all-items.json    → Item table (21,221 competitor/reference items)
 *   all-listings.json → YourListing table (3,919 active listings)
 *   all-sales.json    → YourSale table (1,920 recent sales, deduped against existing 14K)
 */

const fs = require('fs');
const path = require('path');
const { database } = require('../database/database');
const { Model } = require('objection');
const { normalizePartNumber } = require('../lib/partNumberUtils');

Model.knex(database);

const DATA_DIR = path.resolve('C:/Users/atenr/Downloads/parthawk-update/parthawk-update/data');

async function importItems() {
  const filePath = path.join(DATA_DIR, 'all-items.json');
  if (!fs.existsSync(filePath)) { console.log('all-items.json not found'); return { imported: 0 }; }
  const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  console.log(`Items: ${raw.length} records to import`);

  let imported = 0, skipped = 0, errors = 0;
  for (const r of raw) {
    if (!r.ebayId) { errors++; continue; }
    try {
      const existing = await database('Item').where('ebayId', r.ebayId).first();
      if (existing) { skipped++; continue; }

      const partBase = r.manufacturerPartNumber ? normalizePartNumber(r.manufacturerPartNumber) : null;
      await database('Item').insert({
        id: r.id || r.ebayId,
        ebayId: r.ebayId,
        price: parseFloat(r.price) || 0,
        quantity: parseInt(r.quantity) || 1,
        title: r.title || null,
        categoryId: r.categoryId || '',
        categoryTitle: r.categoryTitle || '',
        seller: r.seller || '',
        manufacturerPartNumber: r.manufacturerPartNumber || null,
        manufacturerId: r.manufacturerId || null,
        pictureUrl: r.pictureUrl || null,
        processed: r.processed === true || r.processed === 'true',
        difficulty: r.difficulty ? parseInt(r.difficulty) : null,
        salesEase: r.salesEase ? parseInt(r.salesEase) : null,
        notes: r.notes || null,
        partNumberBase: partBase,
        createdAt: r.createdAt ? new Date(r.createdAt) : new Date(),
        updatedAt: r.updatedAt ? new Date(r.updatedAt) : new Date(),
      });
      imported++;
      if (imported % 500 === 0) console.log(`  Items: ${imported} imported, ${skipped} skipped...`);
    } catch (err) {
      if (err.message?.includes('duplicate') || err.message?.includes('unique')) skipped++;
      else { errors++; if (errors <= 3) console.error('  Item error:', err.message.substring(0, 100)); }
    }
  }
  console.log(`Items done: ${imported} imported, ${skipped} skipped, ${errors} errors`);
  return { imported, skipped, errors };
}

async function importListings() {
  const filePath = path.join(DATA_DIR, 'all-listings.json');
  if (!fs.existsSync(filePath)) { console.log('all-listings.json not found'); return { imported: 0 }; }
  const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  console.log(`Listings: ${raw.length} records to import`);

  let imported = 0, updated = 0, errors = 0;
  for (const r of raw) {
    const itemId = r.ebayItemId;
    if (!itemId) { errors++; continue; }
    try {
      const existing = await database('YourListing').where('ebayItemId', itemId).first();
      if (existing) {
        await database('YourListing').where('ebayItemId', itemId).update({
          title: r.title || existing.title,
          sku: r.sku || existing.sku,
          quantityAvailable: parseInt(r.quantityAvailable) || existing.quantityAvailable,
          currentPrice: parseFloat(r.currentPrice) || existing.currentPrice,
          listingStatus: r.listingStatus || existing.listingStatus,
          startTime: r.startTime ? new Date(r.startTime) : existing.startTime,
          viewItemUrl: r.viewItemUrl || existing.viewItemUrl,
          syncedAt: new Date(),
          updatedAt: new Date(),
        });
        updated++;
      } else {
        await database('YourListing').insert({
          ebayItemId: itemId,
          title: r.title || null,
          sku: r.sku || null,
          quantityAvailable: parseInt(r.quantityAvailable) || 1,
          currentPrice: parseFloat(r.currentPrice) || null,
          listingStatus: r.listingStatus || 'Active',
          startTime: r.startTime ? new Date(r.startTime) : new Date(),
          viewItemUrl: r.viewItemUrl || null,
          syncedAt: new Date(),
          createdAt: new Date(),
          updatedAt: new Date(),
        });
        imported++;
      }
      if ((imported + updated) % 500 === 0) console.log(`  Listings: ${imported} new, ${updated} updated...`);
    } catch (err) {
      if (err.message?.includes('duplicate') || err.message?.includes('unique')) updated++;
      else { errors++; if (errors <= 3) console.error('  Listing error:', err.message.substring(0, 100)); }
    }
  }
  console.log(`Listings done: ${imported} imported, ${updated} updated, ${errors} errors`);
  return { imported, updated, errors };
}

async function importSales() {
  const filePath = path.join(DATA_DIR, 'all-sales.json');
  if (!fs.existsSync(filePath)) { console.log('all-sales.json not found'); return { imported: 0 }; }
  const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  console.log(`Sales: ${raw.length} records to import (dedup against existing)`);

  let imported = 0, skipped = 0, errors = 0;
  for (const r of raw) {
    const orderId = r.ebayOrderId;
    if (!orderId) { errors++; continue; }
    try {
      const existing = await database('YourSale').where('ebayOrderId', orderId).first();
      if (existing) { skipped++; continue; }

      await database('YourSale').insert({
        ebayOrderId: orderId,
        ebayItemId: r.ebayItemId || null,
        title: r.title || null,
        sku: r.sku || null,
        quantity: parseInt(r.quantity) || 1,
        salePrice: parseFloat(r.salePrice) || null,
        soldDate: r.soldDate ? new Date(r.soldDate) : null,
        buyerUsername: r.buyerUsername || null,
        shippedDate: r.shippedDate ? new Date(r.shippedDate) : null,
        store: 'dynatrack',
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      imported++;
    } catch (err) {
      if (err.message?.includes('duplicate') || err.message?.includes('unique')) skipped++;
      else { errors++; if (errors <= 3) console.error('  Sale error:', err.message.substring(0, 100)); }
    }
  }
  console.log(`Sales done: ${imported} imported, ${skipped} skipped (already exist), ${errors} errors`);
  return { imported, skipped, errors };
}

async function run() {
  try {
    console.log('Running migrations...');
    await database.migrate.latest(database.client.config.migration);
    console.log('Migrations complete.\n');

    const itemResult = await importItems();
    const listingResult = await importListings();
    const salesResult = await importSales();

    // Verify counts
    const counts = {};
    for (const t of ['Item', 'YourListing', 'YourSale']) {
      const r = await database(t).count('* as cnt').first();
      counts[t] = parseInt(r?.cnt || 0);
    }
    console.log('\nFinal table counts:', counts);
  } catch (err) {
    console.error('Import failed:', err);
  } finally {
    await database.destroy();
  }
}

if (require.main === module) {
  run();
}

module.exports = { importItems, importListings, importSales };
