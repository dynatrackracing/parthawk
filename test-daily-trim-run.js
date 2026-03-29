/**
 * SIMULATE DAILY TRIM CATALOG RUN
 *
 * Pulls recent yard_vehicle entries (last 48hrs matching scrape filter),
 * finds unique year/make/model combos, hits eBay Taxonomy for each,
 * and shows results WITHOUT writing to DB.
 *
 * Usage:
 *   node test-daily-trim-run.js
 */

'use strict';
require('dotenv').config();

const axios = require('axios');
const EbayAuthToken = require('ebay-oauth-nodejs-client');

const knex = require('knex')({
  client: 'pg',
  connection: process.env.DATABASE_URL,
  searchPath: ['public'],
});

function titleCase(str) {
  if (!str) return str;
  return str.toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
}

async function getToken() {
  const ebayAuthToken = new EbayAuthToken({
    clientId: process.env.TRADING_API_APP_NAME,
    clientSecret: process.env.TRADING_API_CERT_NAME,
    redirectUri: process.env.REDIRECT_URL,
  });
  const response = await ebayAuthToken.getApplicationToken('PRODUCTION');
  const { access_token } = JSON.parse(response);
  return access_token;
}

async function getTrims(token, year, make, model) {
  try {
    const response = await axios({
      method: 'GET',
      url: 'https://api.ebay.com/commerce/taxonomy/v1/category_tree/100/get_compatibility_property_values',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      params: {
        compatibility_property: 'Trim',
        category_id: 33563,
        filter: `Year:${year},Make:${make},Model:${model}`,
      },
    });
    return { success: true, trims: response.data?.compatibilityPropertyValues || [] };
  } catch (err) {
    return { success: false, status: err.response?.status, error: err.response?.data?.errors?.[0]?.message || err.message };
  }
}

async function run() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('  SIMULATE DAILY TRIM CATALOG RUN');
  console.log('═══════════════════════════════════════════════════════════\n');

  // Get all yard vehicles from last 48hrs (matches scrape filter)
  const recentVehicles = await knex('yard_vehicle')
    .select('year', 'make', 'model')
    .whereNotNull('year')
    .whereNotNull('make')
    .whereNotNull('model')
    .where('year', '>=', 1996)
    .whereRaw("scraped_at >= NOW() - INTERVAL '48 hours'")
    .groupBy('year', 'make', 'model')
    .orderBy(['make', 'model', 'year']);

  // Also get ALL combos for comparison
  const allCombos = await knex('yard_vehicle')
    .select('year', 'make', 'model')
    .whereNotNull('year')
    .whereNotNull('make')
    .whereNotNull('model')
    .where('year', '>=', 1996)
    .groupBy('year', 'make', 'model');

  const recent = recentVehicles.map(c => ({ year: c.year, make: titleCase(c.make), model: titleCase(c.model) }));
  const all = allCombos.map(c => ({ year: c.year, make: titleCase(c.make), model: titleCase(c.model) }));

  console.log(`Total unique combos in yard_vehicle: ${all.length}`);
  console.log(`Combos from last 48hrs: ${recent.length}`);
  console.log('');

  // Use recent if available, otherwise sample from all
  let testCombos = recent.length > 0 ? recent : all.slice(0, 30);
  const source = recent.length > 0 ? 'last 48hrs' : 'random sample of 30';
  console.log(`Testing ${testCombos.length} combos (${source}):\n`);

  // Show raw values from DB for debugging
  const rawSample = await knex('yard_vehicle')
    .select('year', 'make', 'model')
    .whereNotNull('year')
    .whereNotNull('make')
    .limit(5);
  console.log('Raw DB values (first 5):');
  rawSample.forEach(r => console.log(`  year=${r.year} make="${r.make}" model="${r.model}"`));
  console.log('');

  // Get token
  let token;
  try {
    token = await getToken();
    console.log('✅ OAuth token acquired\n');
  } catch (err) {
    console.error('❌ Token failed:', err.message);
    await knex.destroy();
    return;
  }

  // Test each combo
  const successes = [];
  const failures = [];

  for (const c of testCombos) {
    const result = await getTrims(token, c.year, c.make, c.model);

    if (result.success) {
      successes.push({ ...c, trimCount: result.trims.length });
      console.log(`  ✅ ${c.year} ${c.make} ${c.model} → ${result.trims.length} trims`);
    } else {
      failures.push({ ...c, status: result.status, error: result.error });
      console.log(`  ❌ ${c.year} ${c.make} ${c.model} → ${result.status}: ${result.error}`);
    }

    await new Promise(r => setTimeout(r, 500));
  }

  // Summary
  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('  RESULTS');
  console.log('═══════════════════════════════════════════════════════════\n');
  console.log(`  Tested:     ${testCombos.length}`);
  console.log(`  Succeeded:  ${successes.length}`);
  console.log(`  Failed:     ${failures.length}`);

  if (failures.length > 0) {
    console.log('\n  FAILURES:');
    failures.forEach(f => {
      console.log(`    ${f.year} ${f.make} ${f.model} → ${f.status}: ${f.error}`);
    });
  }

  if (successes.length > 0) {
    const avgTrims = (successes.reduce((sum, s) => sum + s.trimCount, 0) / successes.length).toFixed(1);
    console.log(`\n  Average trims per vehicle: ${avgTrims}`);

    const zeroTrims = successes.filter(s => s.trimCount === 0);
    if (zeroTrims.length > 0) {
      console.log(`\n  Vehicles with 0 trims (eBay has no trim data):`);
      zeroTrims.forEach(z => console.log(`    ${z.year} ${z.make} ${z.model}`));
    }
  }

  console.log('\n═══════════════════════════════════════════════════════════');
  await knex.destroy();
}

run().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
