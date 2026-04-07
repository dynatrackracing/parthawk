/**
 * TRIM DATA BACKFILL - Enrich Auto table from eBay TradingAPI
 * 
 * Reads your active listings from YourListing, calls GetItem on each
 * to fetch the ItemCompatibilityList (which includes Trim), then
 * updates matching Auto records with the trim values.
 * 
 * This is a ONE-TIME backfill. After this, new items should capture
 * trim during import.
 * 
 * Rate limit: eBay TradingAPI allows ~5,000 calls/day.
 * With 3,919 active listings and 500ms pacing = ~33 minutes.
 * 
 * Usage:
 *   cd C:\DarkHawk\parthawk-deploy
 *   set DATABASE_URL=postgresql://postgres:jOWykUhLuUbWSVASAAZZHqsDVfyqaFTN@switchyard.proxy.rlwy.net:12023/railway
 *   node backfill-trim-from-ebay.js
 * 
 * DRY RUN (no DB writes, just shows what would happen):
 *   node backfill-trim-from-ebay.js --dry-run
 * 
 * LIMIT (test with N items first):
 *   node backfill-trim-from-ebay.js --limit=10
 *   node backfill-trim-from-ebay.js --dry-run --limit=5
 */

'use strict';
require('dotenv').config();

const axios = require('axios');
const xml2js = require('xml2js');
const { v4: uuidv4 } = require('uuid');

const knex = require('knex')({
  client: 'pg',
  connection: process.env.DATABASE_URL,
  searchPath: ['public'],
});

// ─── CONFIG ───────────────────────────────────────────────────────
const DRY_RUN = process.argv.includes('--dry-run');
const LIMIT_ARG = process.argv.find(a => a.startsWith('--limit='));
const LIMIT = LIMIT_ARG ? parseInt(LIMIT_ARG.split('=')[1], 10) : null;
const PACE_MS = 600; // ms between API calls (safe for TradingAPI rate limit)

// ─── EBAY TRADING API ─────────────────────────────────────────────

function createHeaders() {
  return {
    'X-EBAY-API-COMPATIBILITY-LEVEL': '837',
    'X-EBAY-API-DEV-NAME': process.env.TRADING_API_DEV_NAME,
    'X-EBAY-API-APP-NAME': process.env.TRADING_API_APP_NAME,
    'X-EBAY-API-CERT-NAME': process.env.TRADING_API_CERT_NAME,
    'X-EBAY-API-SITEID': '0',
    'X-EBAY-API-CALL-NAME': 'GetItem',
    'Content-Type': 'text/xml',
    'User-Agent': 'DarkHawk/1.0',
    'X-EBAY-SDK-REQUEST-ID': uuidv4(),
  };
}

async function getItemCompatibility(ebayItemId) {
  const xml = `<?xml version="1.0" encoding="utf-8"?>
<GetItemRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  <RequesterCredentials>
    <eBayAuthToken>${process.env.TRADING_API_TOKEN}</eBayAuthToken>
  </RequesterCredentials>
  <IncludeItemCompatibilityList>true</IncludeItemCompatibilityList>
  <IncludeItemSpecifics>false</IncludeItemSpecifics>
  <ItemID>${ebayItemId}</ItemID>
</GetItemRequest>`;

  try {
    const response = await axios({
      method: 'POST',
      url: 'https://api.ebay.com/ws/api.dll',
      headers: createHeaders(),
      timeout: 15000,
      data: xml,
    });

    const parsed = await xml2js.parseStringPromise(response.data);
    return parsed;
  } catch (err) {
    return null;
  }
}

/**
 * Parse ItemCompatibilityList from GetItem response.
 * Returns array of { year, make, model, trim, engine }
 */
function parseCompatibility(parsed) {
  try {
    const item = parsed?.GetItemResponse?.Item?.[0];
    if (!item) return [];

    const compatList = item?.ItemCompatibilityList?.[0]?.Compatibility || [];
    const results = [];

    for (const compat of compatList) {
      const nameValues = compat?.NameValueList || [];
      const entry = {};

      for (const nv of nameValues) {
        const name = nv?.Name?.[0];
        const value = nv?.Value?.[0];
        if (!name || !value) continue;

        switch (name) {
          case 'Year': entry.year = parseInt(value, 10); break;
          case 'Make': entry.make = value; break;
          case 'Model': entry.model = value; break;
          case 'Trim': entry.trim = value; break;
          case 'Engine': entry.engine = value; break;
        }
      }

      // Only include entries that have at least year/make/model
      if (entry.year && entry.make && entry.model) {
        results.push(entry);
      }
    }

    return results;
  } catch (err) {
    return [];
  }
}

// ─── MAIN ─────────────────────────────────────────────────────────

async function run() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('  TRIM DATA BACKFILL FROM EBAY TRADINGAPI');
  console.log(DRY_RUN ? '  MODE: DRY RUN (no database writes)' : '  MODE: LIVE (will update Auto table)');
  if (LIMIT) console.log(`  LIMIT: ${LIMIT} items`);
  console.log('═══════════════════════════════════════════════════════════\n');

  // Check env vars
  if (!process.env.TRADING_API_TOKEN) {
    console.error('ERROR: TRADING_API_TOKEN not set. Need eBay Trading API credentials.');
    console.error('Required env vars: TRADING_API_DEV_NAME, TRADING_API_APP_NAME, TRADING_API_CERT_NAME, TRADING_API_TOKEN');
    await knex.destroy();
    return;
  }

  // Step 1: Get active listings with eBay item IDs
  let query = knex('YourListing')
    .select('ebayItemId', 'title')
    .where('listingStatus', 'Active')
    .whereNotNull('ebayItemId');

  if (LIMIT) query = query.limit(LIMIT);

  const listings = await query;
  console.log(`Found ${listings.length} active listings to process.\n`);

  if (listings.length === 0) {
    // Debug: show table structure
    const cols = await knex.raw(`
      SELECT column_name FROM information_schema.columns 
      WHERE table_name = 'YourListing' 
      ORDER BY ordinal_position
    `);
    console.log('YourListing columns:', cols.rows.map(r => r.column_name).join(', '));
    await knex.destroy();
    return;
  }

  // Step 2: Get current Auto table state
  const autosBefore = await knex('Auto')
    .count('* as total')
    .first();
  const autosWithTrim = await knex('Auto')
    .whereNotNull('trim')
    .where('trim', '!=', '')
    .count('* as count')
    .first();
  
  console.log(`Auto table before: ${autosBefore.total} records, ${autosWithTrim.count} with trim data.\n`);

  // Step 3: Process each listing
  let processed = 0;
  let apiErrors = 0;
  let noCompat = 0;
  let trimsFound = 0;
  let autosUpdated = 0;
  let newTrimsSet = new Set();

  for (const listing of listings) {
    processed++;
    const pct = ((processed / listings.length) * 100).toFixed(1);
    
    // Call eBay GetItem
    const result = await getItemCompatibility(listing.ebayItemId);
    
    if (!result) {
      apiErrors++;
      process.stdout.write(`\r  [${pct}%] ${processed}/${listings.length} | API errors: ${apiErrors} | Trims found: ${trimsFound}`);
      await new Promise(r => setTimeout(r, PACE_MS));
      continue;
    }

    // Parse compatibility list
    const compatEntries = parseCompatibility(result);

    if (compatEntries.length === 0) {
      noCompat++;
      process.stdout.write(`\r  [${pct}%] ${processed}/${listings.length} | API errors: ${apiErrors} | Trims found: ${trimsFound}`);
      await new Promise(r => setTimeout(r, PACE_MS));
      continue;
    }

    // Find entries with trim data
    const withTrim = compatEntries.filter(e => e.trim && e.trim.trim());

    if (withTrim.length > 0) {
      trimsFound += withTrim.length;

      for (const entry of withTrim) {
        newTrimsSet.add(entry.trim);

        if (!DRY_RUN) {
          // Update Auto records matching year/make/model with the trim value
          // Use case-insensitive model match since formats can vary
          const updated = await knex('Auto')
            .where('year', entry.year)
            .where('make', entry.make)
            .whereRaw('LOWER(model) = LOWER(?)', [entry.model])
            .where(function() {
              this.whereNull('trim').orWhere('trim', '');
            })
            .update({ trim: entry.trim });

          autosUpdated += updated;
        }
      }

      // Show sample for first few
      if (processed <= 5 || processed % 100 === 0) {
        const trimSample = withTrim.slice(0, 3).map(e => `${e.year} ${e.make} ${e.model} [${e.trim}]`).join(', ');
        console.log(`\n  Item ${listing.ebayItemId}: ${withTrim.length} compat entries with trim`);
        console.log(`    Sample: ${trimSample}`);
        console.log(`    Title: ${(listing.title || '').substring(0, 70)}`);
      }
    }

    process.stdout.write(`\r  [${pct}%] ${processed}/${listings.length} | API errors: ${apiErrors} | Trims found: ${trimsFound}`);
    await new Promise(r => setTimeout(r, PACE_MS));
  }

  console.log('\n');

  // Step 4: Results
  console.log('═══════════════════════════════════════════════════════════');
  console.log('  RESULTS');
  console.log('═══════════════════════════════════════════════════════════\n');
  console.log(`  Listings processed:     ${processed}`);
  console.log(`  API errors:             ${apiErrors}`);
  console.log(`  No compatibility data:  ${noCompat}`);
  console.log(`  Compat entries w/trim:  ${trimsFound}`);
  console.log(`  Auto records updated:   ${DRY_RUN ? '(dry run)' : autosUpdated}`);
  console.log(`  Distinct trim values:   ${newTrimsSet.size}`);

  if (newTrimsSet.size > 0) {
    console.log('\n  All trim values found:');
    const sorted = Array.from(newTrimsSet).sort();
    sorted.forEach(t => console.log(`    - ${t}`));
  }

  if (!DRY_RUN) {
    // Check Auto table after
    const autosAfter = await knex('Auto')
      .whereNotNull('trim')
      .where('trim', '!=', '')
      .count('* as count')
      .first();
    console.log(`\n  Auto table after: ${autosAfter.count} records with trim data (was ${autosWithTrim.count}).`);
  }

  console.log('\n═══════════════════════════════════════════════════════════');
  await knex.destroy();
}

run().catch(err => {
  console.error('Error:', err.message);
  console.error(err.stack);
  process.exit(1);
});
