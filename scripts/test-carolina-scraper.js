'use strict';

/**
 * Dry-run test for CarolinaPickNPullScraper
 * Scrapes Sandhills Pick N Pull (Fayetteville, closest at ~70mi)
 * Prints first 10 vehicles, does NOT write to DB.
 *
 * Usage: node scripts/test-carolina-scraper.js
 */

const path = require('path');
try { require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') }); } catch (e) {}

// We need to test just the fetchInventory method (no DB writes)
async function main() {
  // Quick check: can we load the scraper?
  const CarolinaPickNPullScraper = require('../service/scrapers/CarolinaPickNPullScraper');
  const scraper = new CarolinaPickNPullScraper();

  console.log('=== CAROLINA PICK N PULL — DRY RUN TEST ===');
  console.log('Location: Sandhills Pick N Pull (Fayetteville, location_id=10)');
  console.log('Time: ' + new Date().toISOString());
  console.log('');

  const vehicles = await scraper.fetchInventory('10', 'Sandhills Fayetteville');

  console.log('\nTotal vehicles found: ' + vehicles.length);
  console.log('\nFirst 10 vehicles:');
  vehicles.slice(0, 10).forEach((v, i) => {
    console.log('  ' + (i + 1) + '. ' + v.year + ' ' + v.make + ' ' + v.model + ' | row=' + (v.row || '-') + ' | added=' + (v.dateAdded || '-'));
  });

  // Stats
  const makes = {};
  for (const v of vehicles) {
    makes[v.make] = (makes[v.make] || 0) + 1;
  }
  console.log('\nVehicles by make:');
  Object.entries(makes).sort((a, b) => b[1] - a[1]).slice(0, 15).forEach(([make, count]) => {
    console.log('  ' + make + ': ' + count);
  });

  console.log('\n=== DRY RUN COMPLETE — no DB writes ===');
}

main().catch(err => {
  console.error('FATAL:', err.message);
  process.exit(1);
});
