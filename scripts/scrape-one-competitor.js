'use strict';

// Manual single-competitor backfill. Usage:
//   node scripts/scrape-one-competitor.js <seller> [maxPages]
// Uses existing SoldItemsManager.scrapeCompetitor() path — same as
// CompetitorDripRunner — so Clean Pipe extraction + dedup + $100 floor
// + consecutiveDupes logic all apply.
//
// Does NOT hit SoldItemsScraper directly. Does NOT bypass manager logic.
//
// Prints: scrapeCompetitor() return value + SoldItem row delta for the seller.

require('dotenv').config();
const { Model } = require('objection');
const { database } = require('../service/database/database');
Model.knex(database);

const SoldItemsManager = require('../service/managers/SoldItemsManager');
const SoldItem = require('../service/models/SoldItem');

(async () => {
  const seller = process.argv[2];
  const maxPages = parseInt(process.argv[3] || '2', 10);
  if (!seller) {
    console.error('Usage: node scripts/scrape-one-competitor.js <seller> [maxPages]');
    process.exit(1);
  }

  const before = await SoldItem.query().where('seller', seller).count('* as count').first();
  console.log(`Rows for ${seller} BEFORE: ${before.count}`);

  const manager = new SoldItemsManager();
  try {
    const result = await manager.scrapeCompetitor({
      seller,
      categoryId: '0',
      maxPages,
      enrichCompatibility: false,
    });
    console.log('scrapeCompetitor result:', JSON.stringify(result, null, 2));

    const after = await SoldItem.query().where('seller', seller).count('* as count').first();
    console.log(`Rows for ${seller} AFTER: ${after.count}`);
    console.log(`DELTA: +${after.count - before.count}`);
  } finally {
    try { await manager.scraper.closeBrowser(); } catch (e) {}
  }

  process.exit(0);
})().catch(err => {
  console.error('FATAL:', err);
  process.exit(1);
});
