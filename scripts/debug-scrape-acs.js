'use strict';

/**
 * Debug scrape: run SoldItemsManager.scrapeCompetitor() locally for autocircuitsolutions
 * against production Railway Postgres. 1 page max. Reports:
 *   1. allItems.length from scrapeSoldItems()
 *   2. Whether SoldItemsManager inserts or discards items
 *   3. Final DB row count for seller='autocircuitsolutions'
 *
 * READ-ONLY on SoldItemSeller (does NOT update lastScrapedAt or itemsScraped).
 * DOES insert into SoldItem (upsert on conflict).
 */

// Bootstrap: set DATABASE_URL for production
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://postgres:jOWykUhLuUbWSVASAAZZHqsDVfyqaFTN@switchyard.proxy.rlwy.net:12023/railway';

const { database } = require('../service/database/database');
const SoldItemsScraper = require('../service/ebay/SoldItemsScraper');
const { v4: uuidv4 } = require('uuid');
const { extractStructuredFields } = require('../service/utils/partIntelligence');

const SELLER = 'autocircuitsolutions';

(async () => {
  console.log('=== DEBUG SCRAPE: autocircuitsolutions ===\n');

  // Step 0: count before
  const beforeCount = await database('SoldItem').where('seller', SELLER).count('* as count').first();
  console.log(`[BEFORE] SoldItem rows for ${SELLER}: ${beforeCount.count}`);

  // Step 1: Scrape via Playwright (1 page)
  const scraper = new SoldItemsScraper();
  let items = [];
  try {
    items = await scraper.scrapeSoldItems({
      seller: SELLER,
      categoryId: '0',
      maxPages: 1,
    });
    console.log(`\n[SCRAPER] scrapeSoldItems returned: ${items.length} items`);
    if (items.length > 0) {
      console.log('[SCRAPER] First 5 items:');
      items.slice(0, 5).forEach((item, i) => {
        console.log(`  ${i+1}. id=${item.ebayItemId} price=$${item.soldPrice} date=${item.soldDate || 'NULL'} title=${(item.title||'').substring(0,60)}`);
      });
    }
  } catch (err) {
    console.error('[SCRAPER] FAILED:', err.message);
  } finally {
    try { await scraper.closeBrowser(); } catch(e) {}
  }

  if (items.length === 0) {
    console.log('\n[RESULT] Scraper returned 0 items — nothing to insert.');
    const afterCount = await database('SoldItem').where('seller', SELLER).count('* as count').first();
    console.log(`[AFTER] SoldItem rows for ${SELLER}: ${afterCount.count}`);
    await database.destroy();
    return;
  }

  // Step 2: Run the same insert logic as SoldItemsManager.scrapeCompetitor()
  console.log('\n[INSERT] Running SoldItemsManager insert logic...');
  let stored = 0;
  let skippedPrice = 0;
  let skippedNoId = 0;
  let dupes = 0;
  let consecutiveDupes = 0;
  let errors = 0;

  for (const item of items) {
    try {
      if (consecutiveDupes >= 10) {
        console.log(`[INSERT] Stopping early — 10 consecutive dupes reached`);
        break;
      }

      if (!item.ebayItemId) {
        skippedNoId++;
        continue;
      }

      const price = parseFloat(item.soldPrice) || 0;
      if (price < 100) {
        skippedPrice++;
        continue;
      }

      const now = new Date();
      const toInsert = {
        id: uuidv4(),
        ebayItemId: item.ebayItemId,
        title: item.title,
        soldPrice: item.soldPrice,
        soldDate: item.soldDate ? new Date(item.soldDate) : now,
        categoryId: '0',
        categoryTitle: null,
        seller: item.seller || SELLER,
        condition: item.condition,
        pictureUrl: item.pictureUrl,
        compatibility: null,
        manufacturerPartNumber: null,
        interchangeNumbers: null,
        scrapedAt: now,
      };

      const cpFields = extractStructuredFields(toInsert.title);
      toInsert.partNumberBase = cpFields.partNumberBase || null;
      toInsert.partType = cpFields.partType || 'OTHER';
      toInsert.extractedMake = cpFields.extractedMake || null;
      toInsert.extractedModel = cpFields.extractedModel || null;

      const existing = await database('SoldItem').where('ebayItemId', item.ebayItemId).first();
      if (existing) {
        dupes++;
        consecutiveDupes++;
        continue;
      }
      consecutiveDupes = 0;

      await database('SoldItem')
        .insert(toInsert)
        .onConflict('ebayItemId')
        .merge();

      stored++;
    } catch (err) {
      console.error(`[INSERT] Error on ${item.ebayItemId}: ${err.message}`);
      errors++;
    }
  }

  console.log(`\n[INSERT SUMMARY]`);
  console.log(`  Scraped:       ${items.length}`);
  console.log(`  Stored:        ${stored}`);
  console.log(`  Skipped <$100: ${skippedPrice}`);
  console.log(`  Skipped no ID: ${skippedNoId}`);
  console.log(`  Dupes:         ${dupes}`);
  console.log(`  Errors:        ${errors}`);

  const afterCount = await database('SoldItem').where('seller', SELLER).count('* as count').first();
  console.log(`\n[AFTER] SoldItem rows for ${SELLER}: ${afterCount.count}`);

  await database.destroy();
  console.log('\nDone.');
})().catch(async (err) => {
  console.error('FATAL:', err);
  try { await database.destroy(); } catch(e) {}
  process.exit(1);
});
