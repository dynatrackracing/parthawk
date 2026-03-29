'use strict';

/**
 * SCRAPE PICK-A-PART VIRGINIA — LOCAL ONLY
 *
 * Must run from residential IP (pickapartva.com Cloudflare-blocks datacenter IPs).
 * Covers 2 locations: Fredericksburg, Stafford.
 *
 * Usage: DATABASE_URL=... node scripts/scrape-pickapartva.js
 */

const path = require('path');
try { require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') }); } catch (e) {}

const PickAPartVAScraper = require('../service/scrapers/PickAPartVAScraper');

async function main() {
  console.log('=== PICK-A-PART VIRGINIA SCRAPE ===');
  console.log('Time: ' + new Date().toISOString());
  console.log('NOTE: Must run from local machine (site blocks datacenter IPs)\n');

  const { database } = require('../service/database/database');
  const scraper = new PickAPartVAScraper();

  const yards = await database('yard')
    .where('chain', 'pickapartva')
    .where('enabled', true)
    .orderBy('distance_from_base', 'asc');

  console.log('Found ' + yards.length + ' Pick-A-Part VA yards\n');

  for (const yard of yards) {
    console.log('━━━ ' + yard.name + ' ━━━');
    try {
      const result = await scraper.scrapeYard(yard);
      console.log('  Total: ' + result.total + ' | Inserted: ' + result.inserted + ' | Updated: ' + result.updated + ' | Deactivated: ' + (result.deactivated || 0));
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
