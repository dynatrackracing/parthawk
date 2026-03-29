'use strict';

/**
 * SCRAPE U PULL & SAVE — ALL 4 KY/TN LOCATIONS
 *
 * Uses YardSmart AJAX API (no browser needed). Works from datacenter IPs.
 * Rate limited — 5s delay between locations.
 *
 * Usage: node scripts/scrape-upullandsave.js
 *   or:  DATABASE_URL=... node scripts/scrape-upullandsave.js
 */

const path = require('path');
try { require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') }); } catch (e) {}

const UPullAndSaveScraper = require('../service/scrapers/UPullAndSaveScraper');

async function main() {
  console.log('=== U PULL & SAVE SCRAPE ===');
  console.log('Time: ' + new Date().toISOString() + '\n');

  const { database } = require('../service/database/database');
  const scraper = new UPullAndSaveScraper();

  const yards = await database('yard')
    .where('chain', 'upullandsave')
    .where('enabled', true)
    .orderBy('distance_from_base', 'asc');

  console.log('Found ' + yards.length + ' U Pull & Save yards\n');

  for (const yard of yards) {
    console.log('━━━ ' + yard.name + ' ━━━');
    try {
      const result = await scraper.scrapeYard(yard);
      console.log('  Total: ' + result.total + ' | Inserted: ' + result.inserted + ' | Updated: ' + result.updated + ' | Deactivated: ' + (result.deactivated || 0));
    } catch (err) {
      console.error('  FAILED: ' + err.message);
    }
    // Rate limit delay between yards
    console.log('  Waiting 5s...\n');
    await new Promise(r => setTimeout(r, 5000));
  }

  console.log('=== SCRAPE COMPLETE ===');
  await database.destroy();
}

main().catch(err => {
  console.error('FATAL:', err.message);
  process.exit(1);
});
