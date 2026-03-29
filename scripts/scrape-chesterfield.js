'use strict';

/**
 * SCRAPE CHESTERFIELD AUTO PARTS — ALL 3 VA LOCATIONS
 *
 * Uses Playwright to interact with search form. Works from datacenter IPs.
 * Can also be triggered via POST /yards/scrape/:id from DarkHawk UI.
 *
 * Usage: node scripts/scrape-chesterfield.js
 *   or:  DATABASE_URL=... node scripts/scrape-chesterfield.js
 */

const path = require('path');
try { require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') }); } catch (e) {}

const ChesterfieldScraper = require('../service/scrapers/ChesterfieldScraper');
const { enrichYard } = require('../service/services/PostScrapeService');

async function main() {
  console.log('=== CHESTERFIELD AUTO PARTS SCRAPE ===');
  console.log('Time: ' + new Date().toISOString() + '\n');

  const { database } = require('../service/database/database');
  const scraper = new ChesterfieldScraper();

  const yards = await database('yard')
    .where('chain', 'chesterfield')
    .where('enabled', true)
    .orderBy('distance_from_base', 'asc');

  console.log('Found ' + yards.length + ' Chesterfield yards\n');

  for (const yard of yards) {
    console.log('━━━ ' + yard.name + ' ━━━');
    try {
      const result = await scraper.scrapeYard(yard);
      console.log('  Total: ' + result.total + ' | Inserted: ' + result.inserted + ' | Updated: ' + result.updated + ' | Deactivated: ' + (result.deactivated || 0));
      console.log('  Running enrichment...');
      const enrichStats = await enrichYard(yard.id);
      console.log('  Enriched: ' + enrichStats.vinsDecoded + ' VINs, ' + enrichStats.trimsTiered + ' trims, ' + enrichStats.errors + ' errors');
    } catch (err) {
      console.error('  FAILED: ' + err.message);
    }
    console.log('');
  }

  console.log('=== SCRAPE COMPLETE ===');
  await database.destroy();
}

main().catch(err => {
  console.error('FATAL:', err.message);
  process.exit(1);
});
