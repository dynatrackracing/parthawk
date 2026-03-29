'use strict';

/**
 * SCRAPE CAROLINA PICK N PULL — LOCAL ONLY
 *
 * Must run from residential IP (carolinapicknpull.com blocks datacenter IPs).
 * Scrapes all 3 locations: Fayetteville, Wilmington, Conway SC.
 *
 * Usage: DATABASE_URL=... node scripts/scrape-carolina.js
 */

const path = require('path');
try { require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') }); } catch (e) {}

const CarolinaPickNPullScraper = require('../service/scrapers/CarolinaPickNPullScraper');
const { enrichYard } = require('../service/services/PostScrapeService');

async function main() {
  console.log('=== CAROLINA PICK N PULL SCRAPE ===');
  console.log('Time: ' + new Date().toISOString());
  console.log('NOTE: Must run from local machine (site blocks datacenter IPs)\n');

  const scraper = new CarolinaPickNPullScraper();

  // Get yard records from DB
  const { database } = require('../service/database/database');
  const yards = await database('yard')
    .where('chain', 'Carolina PNP')
    .where('enabled', true)
    .orderBy('distance_from_base', 'asc');

  console.log('Found ' + yards.length + ' Carolina PNP yards\n');

  for (const yard of yards) {
    console.log('━━━ ' + yard.name + ' ━━━');
    try {
      const result = await scraper.scrapeYard(yard);
      console.log('  Result: ' + JSON.stringify(result));
      // Post-scrape enrichment: VIN decode + trim tier + scout alerts
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
