'use strict';

/**
 * BUILD TRIM CATALOG
 *
 * Post-scrape script that populates trim_catalog from eBay Taxonomy API.
 * Only catalogs year/make/model combos that appear in yard_vehicle.
 * Safe to run repeatedly - skips already-cataloged combos.
 *
 * Usage: node build-trim-catalog.js
 * Requires: DATABASE_URL env var, TRADING_API_APP_NAME, TRADING_API_CERT_NAME
 */

const knex = require('knex');
const EbayAuthToken = require('ebay-oauth-nodejs-client');
const axios = require('axios').default;
const path = require('path');
const { getTrimTier } = require('./service/config/trim-tier-config');

// Load .env if present
try { require('dotenv').config({ path: path.resolve(__dirname, '.env') }); } catch (e) {}

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('DATABASE_URL is required');
  process.exit(1);
}

const db = knex({
  client: 'pg',
  connection: {
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  },
  pool: { min: 1, max: 3 },
});

// Body style patterns to strip from trim raw values
const BODY_PATTERNS = [
  /\s+(crew cab|extended cab|standard cab|regular cab|double cab|quad cab|mega cab|access cab|king cab|supercrew|supercab|super cab)/i,
  /\s+(pickup|sedan|coupe|suv|wagon|van|convertible|hatchback|minivan|crossover)/i,
  /\s+\d-door/i,
];

function parseTrimRaw(trimRaw) {
  let trimName = trimRaw.trim();
  let bodyStyle = null;

  // Extract body style from the end of the string
  for (const pattern of BODY_PATTERNS) {
    const match = trimName.match(pattern);
    if (match) {
      const idx = match.index;
      if (!bodyStyle) bodyStyle = trimName.substring(idx).trim();
      trimName = trimName.substring(0, idx).trim();
    }
  }

  // Clean up remaining trim name
  trimName = trimName.replace(/\s+/g, ' ').trim();
  if (!trimName) trimName = trimRaw.trim();

  return { trimName, bodyStyle };
}

async function ensureTables() {
  const hasCatalog = await db.schema.hasTable('trim_catalog');
  if (!hasCatalog) {
    console.log('Creating trim_catalog table...');
    await db.schema.createTable('trim_catalog', (table) => {
      table.increments('id').primary();
      table.integer('year').notNullable();
      table.text('make').notNullable();
      table.text('model').notNullable();
      table.text('trim_raw').notNullable();
      table.text('trim_name').notNullable();
      table.text('body_style');
      table.text('tier').notNullable();
      table.timestamp('created_at').notNullable().defaultTo(db.fn.now());
    });
    await db.raw('CREATE INDEX IF NOT EXISTS idx_trim_catalog_ymm ON trim_catalog (year, make, model)');
    await db.raw('CREATE INDEX IF NOT EXISTS idx_trim_catalog_tier ON trim_catalog (tier)');
    await db.raw('CREATE UNIQUE INDEX IF NOT EXISTS idx_trim_catalog_unique ON trim_catalog (year, make, model, trim_raw)');
  }

  const hasTracked = await db.schema.hasTable('trim_catalog_tracked');
  if (!hasTracked) {
    console.log('Creating trim_catalog_tracked table...');
    await db.schema.createTable('trim_catalog_tracked', (table) => {
      table.increments('id').primary();
      table.integer('year').notNullable();
      table.text('make').notNullable();
      table.text('model').notNullable();
      table.integer('trim_count').defaultTo(0);
      table.timestamp('cataloged_at').notNullable().defaultTo(db.fn.now());
    });
    await db.raw('CREATE UNIQUE INDEX IF NOT EXISTS idx_trim_tracked_ymm ON trim_catalog_tracked (year, make, model)');
  }
}

async function getOAuthToken() {
  const clientId = process.env.TRADING_API_APP_NAME;
  const clientSecret = process.env.TRADING_API_CERT_NAME;
  const redirectUri = process.env.REDIRECT_URL;

  if (!clientId || !clientSecret) {
    throw new Error('TRADING_API_APP_NAME and TRADING_API_CERT_NAME required for OAuth');
  }

  const ebayAuthToken = new EbayAuthToken({
    clientId,
    clientSecret,
    redirectUri: redirectUri || 'https://auth.ebay.com/oauth2/authorize',
  });

  const response = await ebayAuthToken.getApplicationToken('PRODUCTION');
  const parsed = JSON.parse(response);
  if (!parsed.access_token) {
    throw new Error('Failed to get OAuth application token: ' + JSON.stringify(parsed));
  }
  return parsed.access_token;
}

async function fetchTrimsFromEbay(token, year, make, model) {
  const url = 'https://api.ebay.com/commerce/taxonomy/v1/category_tree/100/get_compatibility_property_values';
  const params = {
    compatibility_property: 'Trim',
    category_id: '33563',
    filter: `Year:{${year}},Make:{${make}},Model:{${model}}`,
  };

  try {
    const response = await axios.get(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
      },
      params,
      timeout: 10000,
    });

    const values = response.data?.compatibilityPropertyValues || [];
    return values.map(v => v.value).filter(Boolean);
  } catch (err) {
    if (err.response?.status === 404) {
      // No trims found for this combo - normal
      return [];
    }
    if (err.response?.status === 400) {
      // Invalid combo - skip
      return [];
    }
    throw err;
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
  console.log('=== BUILD TRIM CATALOG ===');
  console.log('Time:', new Date().toISOString());

  await ensureTables();

  // Get unique year/make/model from yard_vehicle
  let yardCombos;
  try {
    yardCombos = await db('yard_vehicle')
      .select('year', 'make', 'model')
      .whereNotNull('year')
      .whereNotNull('make')
      .whereNotNull('model')
      .where('year', '>=', 2005)
      .groupBy('year', 'make', 'model')
      .orderBy('year', 'desc');
  } catch (e) {
    console.error('Could not read yard_vehicle table:', e.message);
    await db.destroy();
    return;
  }

  console.log(`Found ${yardCombos.length} unique year/make/model combos in yards`);

  // Get already-tracked combos
  const tracked = await db('trim_catalog_tracked').select('year', 'make', 'model');
  const trackedSet = new Set(tracked.map(t => `${t.year}|${t.make}|${t.model}`));

  // Filter to only new combos
  const newCombos = yardCombos.filter(c => !trackedSet.has(`${c.year}|${c.make}|${c.model}`));
  console.log(`${newCombos.length} new combos to catalog (${trackedSet.size} already tracked)`);

  if (newCombos.length === 0) {
    console.log('Nothing new to catalog. Done.');
    await db.destroy();
    return;
  }

  // Get OAuth token
  let token;
  try {
    token = await getOAuthToken();
    console.log('OAuth application token acquired');
  } catch (err) {
    console.error('Failed to get OAuth token:', err.message);
    await db.destroy();
    return;
  }

  let totalInserted = 0;
  let totalCombos = 0;
  let errors = 0;

  for (const combo of newCombos) {
    const { year, make, model } = combo;
    try {
      const trimValues = await fetchTrimsFromEbay(token, year, make, model);

      let insertedForCombo = 0;
      for (const trimRaw of trimValues) {
        const { trimName, bodyStyle } = parseTrimRaw(trimRaw);
        const { tier } = getTrimTier(make, trimName);

        try {
          await db('trim_catalog').insert({
            year,
            make,
            model,
            trim_raw: trimRaw,
            trim_name: trimName,
            body_style: bodyStyle,
            tier,
          }).onConflict(db.raw('(year, make, model, trim_raw)')).ignore();
          insertedForCombo++;
        } catch (insertErr) {
          // Duplicate - skip
        }
      }

      // Mark as tracked
      await db('trim_catalog_tracked').insert({
        year,
        make,
        model,
        trim_count: trimValues.length,
        cataloged_at: new Date(),
      }).onConflict(db.raw('(year, make, model)')).ignore();

      totalInserted += insertedForCombo;
      totalCombos++;

      if (trimValues.length > 0) {
        console.log(`  ${year} ${make} ${model}: ${trimValues.length} trims (${insertedForCombo} new)`);
      }

      // Pace API calls - 500ms between requests
      await sleep(500);
    } catch (err) {
      console.error(`  ERROR ${year} ${make} ${model}: ${err.message}`);
      errors++;
      // If auth error, try to refresh token
      if (err.response?.status === 401) {
        try {
          token = await getOAuthToken();
          console.log('  Refreshed OAuth token');
        } catch (refreshErr) {
          console.error('  Failed to refresh token, aborting');
          break;
        }
      }
      await sleep(1000);
    }
  }

  console.log('\n=== TRIM CATALOG COMPLETE ===');
  console.log(`Combos processed: ${totalCombos}`);
  console.log(`Trims inserted: ${totalInserted}`);
  console.log(`Errors: ${errors}`);

  // Print tier distribution
  try {
    const dist = await db('trim_catalog').select('tier').count('* as count').groupBy('tier');
    console.log('\nTier distribution:');
    for (const row of dist) {
      console.log(`  ${row.tier}: ${row.count}`);
    }
    const total = await db('trim_catalog').count('* as count').first();
    console.log(`  TOTAL: ${total.count}`);
  } catch (e) {}

  await db.destroy();
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
