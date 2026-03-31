'use strict';

/**
 * One-shot script: Scrape Pull-A-Part Knoxville
 * Same approach that worked for Birmingham.
 */

// Set DATABASE_URL so the app's database module connects to prod
process.env.DATABASE_URL = 'postgresql://postgres:jOWykUhLuUbWSVASAAZZHqsDVfyqaFTN@switchyard.proxy.rlwy.net:12023/railway';

const { database } = require('../service/database/database');
const PullAPartScraper = require('../service/scrapers/PullAPartScraper');

async function main() {
  // Step 1: Find Knoxville yard
  const yard = await database('yard').whereRaw("name ILIKE '%knoxville%'").first();
  if (!yard) {
    console.error('ERROR: No Knoxville yard found in database!');
    process.exit(1);
  }

  console.log('=== KNOXVILLE YARD RECORD ===');
  console.log('  id:             ', yard.id);
  console.log('  name:           ', yard.name);
  console.log('  chain:          ', yard.chain);
  console.log('  scrape_method:  ', yard.scrape_method);
  console.log('  enabled:        ', yard.enabled);
  console.log('  last_scraped:   ', yard.last_scraped);

  // Check current vehicle count
  const before = await database('yard_vehicle').where('yard_id', yard.id).where('active', true).count('* as count').first();
  console.log('  active vehicles:', before.count);

  // Step 2: Run the scrape
  console.log('\n=== STARTING PULL-A-PART KNOXVILLE SCRAPE ===');
  const scraper = new PullAPartScraper();
  const result = await scraper.scrapeYard(yard);

  console.log('\n=== SCRAPE RESULT ===');
  console.log(JSON.stringify(result, null, 2));

  // Step 3: Verify final count
  const after = await database('yard_vehicle').where('yard_id', yard.id).where('active', true).count('* as count').first();
  console.log('\n=== FINAL VEHICLE COUNT ===');
  console.log('  Before:', before.count);
  console.log('  After: ', after.count);

  await database.destroy();
}

main().catch(err => {
  console.error('FATAL:', err.message);
  process.exit(1);
});
