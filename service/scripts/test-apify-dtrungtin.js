#!/usr/bin/env node
/**
 * test-apify-dtrungtin.js
 *
 * Standalone test of the dtrungtin~ebay-items-scraper Apify actor.
 * Sends 3 eBay sold-item search URLs for "2019 Toyota Avalon" parts,
 * logs the raw output schema so we know exactly how to parse it.
 *
 * Usage:
 *   APIFY_TOKEN=apify_api_xxx node service/scripts/test-apify-dtrungtin.js
 */

'use strict';

const axios = require('axios');

const APIFY_TOKEN = process.env.APIFY_TOKEN;
if (!APIFY_TOKEN) {
  console.error('\n  ERROR: APIFY_TOKEN not set.');
  console.error('  Set it:  set APIFY_TOKEN=apify_api_xxx   (Windows)');
  console.error('           export APIFY_TOKEN=apify_api_xxx (bash)\n');
  process.exit(1);
}

const ACTOR = 'dtrungtin~ebay-items-scraper';
const ENDPOINT = `https://api.apify.com/v2/acts/${ACTOR}/run-sync-get-dataset-items?token=${APIFY_TOKEN}`;

// ── 1. Build test search URLs ──────────────────────────────────────

const searches = [
  '2019 Toyota Avalon ECM OEM',
  '2019 Toyota Avalon Amplifier OEM',
  '2019 Toyota Avalon BCM OEM',
];

const urls = searches.map(kw => {
  const encoded = encodeURIComponent(kw);
  return `https://www.ebay.com/sch/i.html?_nkw=${encoded}&_sacat=6030&LH_Complete=1&LH_Sold=1&rt=nc`;
});

console.log('═══════════════════════════════════════════════════════');
console.log('  dtrungtin~ebay-items-scraper  —  SCHEMA TEST');
console.log('═══════════════════════════════════════════════════════');
console.log('\nSearch URLs:');
urls.forEach((u, i) => console.log(`  [${i + 1}] ${searches[i]}\n      ${u}`));

// ── 2. Call the actor ──────────────────────────────────────────────

(async () => {
  const startTime = Date.now();
  console.log(`\nCalling Apify actor (sync, up to 5 min)...`);

  let items;
  try {
    const response = await axios.post(ENDPOINT, {
      startUrls: urls.map(u => ({ url: u })),
      proxyConfiguration: { useApifyProxy: true },
    }, {
      headers: { 'Content-Type': 'application/json' },
      timeout: 300000,
    });
    items = response.data;
  } catch (err) {
    console.error('\n  APIFY CALL FAILED');
    if (err.response) {
      console.error(`  Status: ${err.response.status}`);
      console.error(`  Body:`, JSON.stringify(err.response.data, null, 2).substring(0, 2000));
    } else {
      console.error(`  ${err.message}`);
    }
    process.exit(1);
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\nDone in ${elapsed}s — ${items.length} items returned.\n`);

  if (!items.length) {
    console.log('  No items returned. Actor may need different input format.');
    process.exit(0);
  }

  // ── 3. Raw output ────────────────────────────────────────────────

  console.log('═══════════════════════════════════════════════════════');
  console.log('  FIRST ITEM — FULL SCHEMA');
  console.log('═══════════════════════════════════════════════════════');
  console.log(JSON.stringify(items[0], null, 2));

  console.log('\n── ALL FIELD NAMES ──');
  const fieldNames = Object.keys(items[0]);
  console.log(fieldNames.join(', '));
  console.log(`(${fieldNames.length} fields)`);

  // Check for nested objects
  for (const key of fieldNames) {
    const val = items[0][key];
    if (val && typeof val === 'object' && !Array.isArray(val)) {
      console.log(`\n  Nested object "${key}":`, Object.keys(val).join(', '));
    }
    if (Array.isArray(val) && val.length > 0) {
      console.log(`\n  Array "${key}" (${val.length} items):`, typeof val[0] === 'object' ? Object.keys(val[0]).join(', ') : typeof val[0]);
    }
  }

  // ── 4. Per-item summary ──────────────────────────────────────────

  console.log('\n═══════════════════════════════════════════════════════');
  console.log('  ALL ITEMS — KEY FIELDS');
  console.log('═══════════════════════════════════════════════════════');

  // Detect price fields — look for any field containing "price" or "cost" or "amount"
  const priceFieldCandidates = fieldNames.filter(f =>
    /price|cost|amount|sold|bid|shipping/i.test(f)
  );
  console.log(`\nPrice-related fields: ${priceFieldCandidates.join(', ') || 'NONE FOUND'}`);

  // Detect origin/URL fields
  const urlFieldCandidates = fieldNames.filter(f =>
    /url|link|search|source|origin|query/i.test(f)
  );
  console.log(`URL/origin fields: ${urlFieldCandidates.join(', ') || 'NONE FOUND'}`);

  console.log('');
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const title = (item.title || item.name || item.itemTitle || 'NO_TITLE').substring(0, 80);

    // Try common price field names
    const price = item.price || item.soldPrice || item.currentPrice
      || item.sellingPrice || item.totalPrice || item.amount || 'NO_PRICE';

    const condition = item.condition || item.itemCondition || item.conditionText || '-';
    const itemUrl = item.url || item.itemUrl || item.link || '-';
    const origin = item.searchUrl || item.sourceUrl || item.startUrl || null;

    console.log(`[${String(i + 1).padStart(3)}] ${title}`);
    console.log(`      Price: ${price}  |  Condition: ${condition}`);
    if (origin) console.log(`      Origin: ${origin}`);
    console.log(`      URL: ${typeof itemUrl === 'string' ? itemUrl.substring(0, 90) : itemUrl}`);
  }

  // ── 5. Origin tracking ──────────────────────────────────────────

  console.log('\n═══════════════════════════════════════════════════════');
  console.log('  ORIGIN TRACKING');
  console.log('═══════════════════════════════════════════════════════');

  const originField = items[0].searchUrl || items[0].sourceUrl || items[0].startUrl || null;
  if (originField !== null && originField !== undefined) {
    console.log('Origin field found — grouping by source URL:');
    const byOrigin = {};
    for (const item of items) {
      const o = item.searchUrl || item.sourceUrl || item.startUrl || 'unknown';
      if (!byOrigin[o]) byOrigin[o] = [];
      byOrigin[o].push(item);
    }
    for (const [origin, group] of Object.entries(byOrigin)) {
      console.log(`\n  [${group.length} items] ${origin}`);
    }
  } else {
    console.log('No origin/searchUrl field detected — will need title-based matching.');

    // Attempt title-based grouping
    const groups = { ECM: [], Amplifier: [], BCM: [], Other: [] };
    for (const item of items) {
      const t = (item.title || '').toLowerCase();
      if (/\b(ecm|ecu|pcm|engine\s*control|engine\s*computer)\b/.test(t)) groups.ECM.push(item);
      else if (/\b(amp|amplifier|jbl|audio)\b/.test(t)) groups.Amplifier.push(item);
      else if (/\b(bcm|body\s*control)\b/.test(t)) groups.BCM.push(item);
      else groups.Other.push(item);
    }
    console.log('\nTitle-based grouping:');
    for (const [group, items] of Object.entries(groups)) {
      if (items.length > 0) console.log(`  ${group}: ${items.length} items`);
    }
  }

  // ── 6. Summary stats ────────────────────────────────────────────

  console.log('\n═══════════════════════════════════════════════════════');
  console.log('  SUMMARY STATS');
  console.log('═══════════════════════════════════════════════════════');
  console.log(`Total items: ${items.length}`);

  const prices = [];
  const noPriceItems = [];
  for (const item of items) {
    let p = item.price || item.soldPrice || item.currentPrice
      || item.sellingPrice || item.totalPrice || null;

    if (p === null || p === undefined) {
      noPriceItems.push(item.title || 'untitled');
      continue;
    }

    // Parse: could be "$59.99", "59.99", or 59.99
    const num = typeof p === 'number' ? p : parseFloat(String(p).replace(/[^0-9.]/g, ''));
    if (!isNaN(num) && num > 0) prices.push(num);
    else noPriceItems.push(item.title || 'untitled');
  }

  if (prices.length > 0) {
    const min = Math.min(...prices);
    const max = Math.max(...prices);
    const avg = prices.reduce((a, b) => a + b, 0) / prices.length;
    console.log(`Items with price: ${prices.length}`);
    console.log(`Price range: $${min.toFixed(2)} — $${max.toFixed(2)}`);
    console.log(`Average price: $${avg.toFixed(2)}`);
  } else {
    console.log('NO PARSEABLE PRICES FOUND');
  }

  if (noPriceItems.length > 0) {
    console.log(`\nItems WITHOUT price (${noPriceItems.length}):`);
    noPriceItems.slice(0, 5).forEach(t => console.log(`  - ${t.substring(0, 80)}`));
    if (noPriceItems.length > 5) console.log(`  ... and ${noPriceItems.length - 5} more`);
  }

  console.log('\n═══════════════════════════════════════════════════════');
  console.log('  TEST COMPLETE');
  console.log('═══════════════════════════════════════════════════════\n');
})();
