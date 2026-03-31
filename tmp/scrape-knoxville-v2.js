'use strict';

/**
 * Knoxville scrape v2 — extended timeouts for large makes (Ford, Chevy, Toyota, etc.)
 * Pull-A-Part API is slow for makes with 100+ vehicles at a location.
 */

process.env.DATABASE_URL = 'postgresql://postgres:jOWykUhLuUbWSVASAAZZHqsDVfyqaFTN@switchyard.proxy.rlwy.net:12023/railway';

const { database } = require('../service/database/database');
const { v4: uuidv4 } = require('uuid');

const YARD_ID = '85b227e1-27b0-4b23-b24b-7366ef1f319e';
const LOCATION_ID = 10; // Knoxville

async function main() {
  // Check before count
  const before = await database('yard_vehicle').where('yard_id', YARD_ID).where('active', true).count('* as count').first();
  console.log('Before scrape — active vehicles:', before.count);

  let chromium;
  try {
    const pw = require('playwright');
    chromium = pw.chromium;
  } catch (err) {
    console.error('Playwright not installed');
    process.exit(1);
  }

  const vehicles = [];
  const browser = await chromium.launch({
    headless: false,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage',
           '--window-position=-2400,-2400', '--window-size=800,600'],
  });

  try {
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    });
    const page = await context.newPage();

    await page.goto('https://www.pullapart.com/inventory/', {
      waitUntil: 'domcontentloaded', timeout: 30000
    });
    await page.waitForTimeout(10000); // extra wait for JS init

    const hasApi = await page.evaluate(() =>
      !!(window.apiEndpoints && window.apiEndpoints.get('PullAPartInventoryServiceBaseUrl'))
    );
    if (!hasApi) {
      console.error('API endpoints not available — page did not load correctly');
      await browser.close();
      process.exit(1);
    }

    // Get all makes
    const makes = await Promise.race([
      page.evaluate(async () => {
        const base = window.apiEndpoints.get('PullAPartInventoryServiceBaseUrl');
        const r = await fetch(base + '/Make/');
        return r.json();
      }),
      new Promise((_, rej) => setTimeout(() => rej(new Error('Makes fetch timeout')), 30000))
    ]);

    const commonMakes = makes.filter(m => !m.rareFind);
    console.log('Total makes to scrape:', commonMakes.length);

    let completed = 0;
    let failed = 0;

    for (const make of commonMakes) {
      try {
        const models = await Promise.race([
          page.evaluate(async (makeID) => {
            const base = window.apiEndpoints.get('PullAPartInventoryServiceBaseUrl');
            const r = await fetch(base + '/Model?makeID=' + makeID);
            return r.json();
          }, make.makeID),
          new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 30000))
        ]);

        if (!Array.isArray(models) || models.length === 0) { completed++; continue; }
        const modelIds = models.map(m => m.modelID);

        // 180 second timeout for large makes
        const searchResult = await Promise.race([
          page.evaluate(async (params) => {
            const base = window.apiEndpoints.get('PullAPartInventoryServiceBaseUrl');
            const r = await fetch(base + '/Vehicle/Search', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                Locations: [params.locationId],
                MakeID: params.makeID,
                Models: params.modelIds,
                Years: params.years
              })
            });
            if (!r.ok) return { error: r.status };
            return r.json();
          }, {
            locationId: LOCATION_ID,
            makeID: make.makeID,
            modelIds,
            years: Array.from({ length: 65 }, (_, i) => 2026 - i)
          }),
          new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 180000))
        ]);

        if (searchResult && searchResult.error) { completed++; continue; }
        if (!Array.isArray(searchResult)) { completed++; continue; }

        let makeCount = 0;
        for (const locationResult of searchResult) {
          const allVehicles = [
            ...(locationResult.exact || []),
            ...(locationResult.other || []),
          ];
          for (const v of allVehicles) {
            vehicles.push({
              year: String(v.modelYear),
              make: titleCase(v.makeName),
              model: titleCase(v.modelName),
              vin: v.vin || null,
              row: v.row ? String(v.row) : null,
              dateAdded: v.dateYardOn ? v.dateYardOn.split('T')[0] : null,
            });
            makeCount++;
          }
        }

        completed++;
        if (makeCount > 0) {
          console.log(`  [${completed}/${commonMakes.length}] ${make.makeName}: ${makeCount} vehicles`);
        }

        await page.waitForTimeout(200);
      } catch (err) {
        failed++;
        completed++;
        console.log(`  [${completed}/${commonMakes.length}] ${make.makeName}: TIMEOUT/ERROR`);
      }
    }

    console.log(`\nAPI scrape done. ${completed} makes processed, ${failed} failed, ${vehicles.length} raw vehicles`);

  } finally {
    await browser.close();
  }

  // Deduplicate
  const seen = new Set();
  const deduped = [];
  for (const v of vehicles) {
    const key = v.vin || `${v.year}-${v.make}-${v.model}-${v.row}`;
    if (!seen.has(key)) {
      seen.add(key);
      deduped.push(v);
    }
  }
  console.log('After dedup:', deduped.length, 'vehicles');

  if (deduped.length === 0) {
    console.log('No vehicles scraped — aborting DB write');
    await database.destroy();
    return;
  }

  // Mark existing as inactive
  await database('yard_vehicle').where('yard_id', YARD_ID).where('active', true)
    .update({ active: false, updatedAt: new Date() });

  let inserted = 0, updated = 0;
  for (const v of deduped) {
    try {
      const existing = await database('yard_vehicle')
        .where('yard_id', YARD_ID).where('year', v.year)
        .where('make', v.make).where('model', v.model).first();
      if (existing) {
        const upd = {
          row_number: v.row || existing.row_number,
          date_added: v.dateAdded || existing.date_added,
          active: true, last_seen: new Date(),
          scraped_at: new Date(), updatedAt: new Date(),
        };
        if (v.vin && v.vin.length >= 11) upd.vin = v.vin;
        await database('yard_vehicle').where('id', existing.id).update(upd);
        updated++;
      } else {
        await database('yard_vehicle').insert({
          id: uuidv4(), yard_id: YARD_ID, year: v.year, make: v.make, model: v.model,
          trim: null, color: null, row_number: v.row || null,
          vin: v.vin || null, date_added: v.dateAdded || null,
          active: true, first_seen: new Date(), last_seen: new Date(),
          scraped_at: new Date(), createdAt: new Date(), updatedAt: new Date(),
        });
        inserted++;
      }
    } catch (err) {
      // skip duplicates
    }
  }

  await database('yard').where('id', YARD_ID).update({ last_scraped: new Date(), updatedAt: new Date() });

  const after = await database('yard_vehicle').where('yard_id', YARD_ID).where('active', true).count('* as count').first();

  console.log('\n=== KNOXVILLE SCRAPE COMPLETE ===');
  console.log('  Inserted:', inserted);
  console.log('  Updated: ', updated);
  console.log('  Total active vehicles:', after.count);

  await database.destroy();
}

function titleCase(str) {
  if (!str) return str;
  return str.toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
}

main().catch(err => {
  console.error('FATAL:', err.message);
  process.exit(1);
});
