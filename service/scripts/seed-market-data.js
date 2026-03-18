'use strict';

/**
 * Seed Market Data Script
 *
 * Runs market research for common auto parts keywords to populate
 * the database with real competitor listings and sold items data.
 *
 * Usage: node service/scripts/seed-market-data.js [--quick|--full]
 */

// Initialize database connection first
const { Model } = require('objection');
const { database } = require('../database/database');
Model.knex(database);

const MarketResearchManager = require('../managers/MarketResearchManager');
const { log } = require('../lib/logger');

// Common auto parts keywords for research
// These are typical items sold in the auto parts recycling business
const AUTO_PARTS_KEYWORDS = [
  // Engine components
  'ECU engine computer module',
  'throttle body assembly',
  'mass air flow sensor MAF',
  'ignition coil pack',
  'fuel injector set',
  'alternator OEM',
  'starter motor',
  'power steering pump',
  'AC compressor',
  'water pump',

  // Transmission
  'transmission control module TCM',
  'automatic transmission solenoid',
  'shift cable assembly',

  // Body / Interior
  'headlight assembly OEM',
  'tail light assembly',
  'side mirror power',
  'door handle exterior',
  'window regulator motor',
  'instrument cluster speedometer',
  'radio stereo unit',
  'climate control panel',

  // Suspension / Steering
  'control arm assembly',
  'strut shock absorber',
  'tie rod end',
  'wheel hub bearing',
  'brake caliper',
  'ABS module pump',

  // Electrical
  'fuse box relay panel',
  'wiring harness engine',
  'body control module BCM',
  'airbag module SRS',
];

// Quick seed uses fewer keywords and pages
const QUICK_KEYWORDS = [
  'ECU engine computer module',
  'headlight assembly OEM',
  'instrument cluster speedometer',
  'ABS module pump',
  'body control module BCM',
];

async function seedMarketData(options = {}) {
  const {
    quick = false,
    maxActivePages = 2,
    maxSoldPages = 3,
    categoryId = '6030', // Auto Parts category
  } = options;

  const keywords = quick ? QUICK_KEYWORDS : AUTO_PARTS_KEYWORDS;
  const manager = new MarketResearchManager();

  const results = {
    totalKeywords: keywords.length,
    processed: 0,
    totalActiveListings: 0,
    totalSoldItems: 0,
    errors: [],
  };

  console.log(`\n=== Market Data Seeding ===`);
  console.log(`Mode: ${quick ? 'QUICK' : 'FULL'}`);
  console.log(`Keywords to process: ${keywords.length}`);
  console.log(`Max active pages per keyword: ${maxActivePages}`);
  console.log(`Max sold pages per keyword: ${maxSoldPages}`);
  console.log(`Category ID: ${categoryId}\n`);

  for (let i = 0; i < keywords.length; i++) {
    const keyword = keywords[i];
    console.log(`[${i + 1}/${keywords.length}] Researching: "${keyword}"...`);

    try {
      const research = await manager.researchByKeywords({
        keywords: keyword,
        categoryId,
        maxActivePages: quick ? 1 : maxActivePages,
        maxSoldPages: quick ? 2 : maxSoldPages,
      });

      results.processed++;
      results.totalActiveListings += research.activeListings;
      results.totalSoldItems += research.soldItems;

      console.log(`    Found ${research.activeListings} competitors, ${research.soldItems} sold items`);

      // Delay between searches to avoid rate limiting
      if (i < keywords.length - 1) {
        const delay = quick ? 5000 : 10000;
        console.log(`    Waiting ${delay / 1000}s before next search...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    } catch (err) {
      console.error(`    ERROR: ${err.message}`);
      results.errors.push({ keyword, error: err.message });
    }
  }

  // Close browser
  await manager.scraper.closeBrowser();

  console.log(`\n=== Seeding Complete ===`);
  console.log(`Keywords processed: ${results.processed}/${results.totalKeywords}`);
  console.log(`Total competitor listings: ${results.totalActiveListings}`);
  console.log(`Total sold items: ${results.totalSoldItems}`);
  if (results.errors.length > 0) {
    console.log(`Errors: ${results.errors.length}`);
    results.errors.forEach(e => console.log(`  - ${e.keyword}: ${e.error}`));
  }

  return results;
}

// CLI execution
if (require.main === module) {
  const args = process.argv.slice(2);
  const quick = args.includes('--quick');
  const full = args.includes('--full');
  const knexConfig = require('../database/knexfile');
  const migrationConfig = knexConfig[process.env.NODE_ENV || 'development'];

  // Run migrations first
  database.migrate.latest(migrationConfig.migration)
    .then(() => {
      console.log('Database migrations complete.');
      return seedMarketData({ quick: quick && !full });
    })
    .then(results => {
      console.log('\nDone!');
      process.exit(0);
    })
    .catch(err => {
      console.error('Fatal error:', err);
      process.exit(1);
    });
}

module.exports = { seedMarketData, AUTO_PARTS_KEYWORDS, QUICK_KEYWORDS };
