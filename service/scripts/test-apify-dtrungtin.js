#!/usr/bin/env node
/**
 * test-apify-dtrungtin.js
 *
 * Standalone test of the caffein.dev/ebay-sold-listings Apify actor.
 * (Replaces dtrungtin~ebay-items-scraper which requires a $50/mo rental.)
 *
 * Sends 3 eBay sold-item keyword searches for "2019 Toyota Avalon" parts,
 * logs the raw output schema so we know exactly how to parse it.
 *
 * Actor: caffein.dev~ebay-sold-listings
 * Pricing: pay-per-result ($0.004/result) — no monthly rental
 * Input: { keyword: "search terms", maxResults: N }
 * Output: structured sold listing data with soldPrice, totalPrice, etc.
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

const ACTOR = 'caffein.dev~ebay-sold-listings';
const ENDPOINT = `https://api.apify.com/v2/acts/${ACTOR}/run-sync-get-dataset-items?token=${APIFY_TOKEN}&timeout=120`;

// ── 1. Test searches ───────────────────────────────────────────────

const searches = [
  { label: 'ECM', keyword: '2019 Toyota Avalon ECM OEM' },
  { label: 'Amplifier', keyword: '2019 Toyota Avalon Amplifier OEM' },
  { label: 'BCM', keyword: '2019 Toyota Avalon BCM OEM' },
];

console.log('═══════════════════════════════════════════════════════');
console.log('  caffein.dev/ebay-sold-listings  —  SCHEMA TEST');
console.log('═══════════════════════════════════════════════════════');
console.log(`\nActor: ${ACTOR}`);
console.log(`Searches: ${searches.length}`);
searches.forEach((s, i) => console.log(`  [${i + 1}] ${s.keyword}`));

// ── 2. Call the actor for each search ──────────────────────────────

(async () => {
  const allItems = [];
  const bySearch = {};
  const overallStart = Date.now();

  for (const search of searches) {
    console.log(`\n── Running: "${search.keyword}" ──`);
    const startTime = Date.now();

    try {
      const response = await axios.post(ENDPOINT, {
        keyword: search.keyword,
        maxResults: 30,
        categoryId: '0',       // All Categories (6030 not in allowed list)
      }, {
        headers: { 'Content-Type': 'application/json' },
        timeout: 180000,
      });

      const items = response.data || [];
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      console.log(`  ✓ ${items.length} items in ${elapsed}s`);

      // Tag each item with which search produced it
      for (const item of items) {
        item._searchLabel = search.label;
        item._searchKeyword = search.keyword;
      }
      allItems.push(...items);
      bySearch[search.label] = items;

    } catch (err) {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      if (err.response) {
        console.error(`  ✗ FAILED (${elapsed}s) — ${err.response.status}: ${JSON.stringify(err.response.data).substring(0, 200)}`);
      } else {
        console.error(`  ✗ FAILED (${elapsed}s) — ${err.message}`);
      }
      bySearch[search.label] = [];
    }
  }

  const totalElapsed = ((Date.now() - overallStart) / 1000).toFixed(1);
  console.log(`\n═══════════════════════════════════════════════════════`);
  console.log(`  TOTAL: ${allItems.length} items across ${searches.length} searches in ${totalElapsed}s`);
  console.log(`═══════════════════════════════════════════════════════`);

  if (!allItems.length) {
    console.log('\n  No items returned. Check actor input format.');
    process.exit(0);
  }

  // ── 3. Raw schema output ─────────────────────────────────────────

  console.log('\n═══════════════════════════════════════════════════════');
  console.log('  FIRST ITEM — FULL SCHEMA');
  console.log('═══════════════════════════════════════════════════════');

  // Remove our injected fields for schema display
  const sampleItem = { ...allItems[0] };
  delete sampleItem._searchLabel;
  delete sampleItem._searchKeyword;
  console.log(JSON.stringify(sampleItem, null, 2));

  console.log('\n── ALL FIELD NAMES ──');
  const fieldNames = Object.keys(sampleItem);
  console.log(fieldNames.join(', '));
  console.log(`(${fieldNames.length} fields)`);

  // Check for nested objects/arrays
  for (const key of fieldNames) {
    const val = sampleItem[key];
    if (val && typeof val === 'object' && !Array.isArray(val)) {
      console.log(`\n  Nested object "${key}":`, Object.keys(val).join(', '));
    }
    if (Array.isArray(val) && val.length > 0) {
      console.log(`\n  Array "${key}" (${val.length} items):`, typeof val[0] === 'object' ? Object.keys(val[0]).join(', ') : typeof val[0]);
    }
  }

  // ── 4. Per-item detail ───────────────────────────────────────────

  console.log('\n═══════════════════════════════════════════════════════');
  console.log('  ALL ITEMS — KEY FIELDS');
  console.log('═══════════════════════════════════════════════════════');

  // Detect price/url fields
  const priceFields = fieldNames.filter(f => /price|cost|amount|sold|bid|shipping|total/i.test(f));
  const urlFields = fieldNames.filter(f => /url|link|search|source|origin/i.test(f));
  console.log(`\nPrice-related fields: ${priceFields.join(', ') || 'NONE'}`);
  console.log(`URL/origin fields: ${urlFields.join(', ') || 'NONE'}`);

  console.log('');
  for (let i = 0; i < allItems.length; i++) {
    const item = allItems[i];
    const title = (item.title || 'NO_TITLE').substring(0, 75);
    const soldPrice = item.soldPrice || 'N/A';
    const totalPrice = item.totalPrice || 'N/A';
    const shipping = item.shippingPrice || 'N/A';
    const endedAt = item.endedAt ? item.endedAt.substring(0, 10) : 'N/A';
    const seller = item.sellerUsername || 'N/A';
    const url = (item.url || 'N/A').substring(0, 60);

    console.log(`[${String(i + 1).padStart(3)}] [${item._searchLabel}] ${title}`);
    console.log(`      Sold: $${soldPrice}  Ship: $${shipping}  Total: $${totalPrice}  |  ${endedAt}  |  ${seller}`);
    console.log(`      ${url}`);
  }

  // ── 5. Per-search grouping ───────────────────────────────────────

  console.log('\n═══════════════════════════════════════════════════════');
  console.log('  RESULTS BY SEARCH QUERY');
  console.log('═══════════════════════════════════════════════════════');

  for (const [label, items] of Object.entries(bySearch)) {
    const prices = items.map(i => parseFloat(String(i.soldPrice || '0').replace(/[^0-9.]/g, ''))).filter(p => p > 0);
    const avg = prices.length > 0 ? (prices.reduce((a, b) => a + b, 0) / prices.length) : 0;
    console.log(`\n  ${label}: ${items.length} items`);
    if (prices.length > 0) {
      console.log(`    Price range: $${Math.min(...prices).toFixed(2)} — $${Math.max(...prices).toFixed(2)}`);
      console.log(`    Average sold price: $${avg.toFixed(2)}`);
    }
    // Show first 3 titles
    items.slice(0, 3).forEach(item => {
      console.log(`    • ${(item.title || '').substring(0, 70)} — $${item.soldPrice}`);
    });
  }

  // ── 6. Summary stats ────────────────────────────────────────────

  console.log('\n═══════════════════════════════════════════════════════');
  console.log('  SUMMARY STATS');
  console.log('═══════════════════════════════════════════════════════');
  console.log(`Total items: ${allItems.length}`);

  const allPrices = [];
  const noPriceItems = [];
  for (const item of allItems) {
    const p = item.soldPrice;
    if (p === null || p === undefined || p === '') {
      noPriceItems.push(item.title || 'untitled');
      continue;
    }
    const num = typeof p === 'number' ? p : parseFloat(String(p).replace(/[^0-9.]/g, ''));
    if (!isNaN(num) && num > 0) allPrices.push(num);
    else noPriceItems.push(item.title || 'untitled');
  }

  if (allPrices.length > 0) {
    console.log(`Items with soldPrice: ${allPrices.length}`);
    console.log(`Price range: $${Math.min(...allPrices).toFixed(2)} — $${Math.max(...allPrices).toFixed(2)}`);
    console.log(`Average: $${(allPrices.reduce((a, b) => a + b, 0) / allPrices.length).toFixed(2)}`);
  } else {
    console.log('NO PARSEABLE PRICES FOUND');
  }

  if (noPriceItems.length > 0) {
    console.log(`\nItems WITHOUT soldPrice (${noPriceItems.length}):`);
    noPriceItems.slice(0, 5).forEach(t => console.log(`  - ${t.substring(0, 80)}`));
    if (noPriceItems.length > 5) console.log(`  ... and ${noPriceItems.length - 5} more`);
  }

  // ── 7. Schema mapping for integration ────────────────────────────

  console.log('\n═══════════════════════════════════════════════════════');
  console.log('  FIELD MAPPING FOR INTEGRATION');
  console.log('═══════════════════════════════════════════════════════');
  console.log(`
  Actor output field  →  Our internal field
  ─────────────────────────────────────────
  title               →  title
  soldPrice           →  price (parse to float)
  totalPrice          →  totalPrice (sold + shipping)
  shippingPrice       →  shippingCost
  endedAt             →  soldDate
  url                 →  ebayUrl
  itemId              →  ebayItemId
  sellerUsername       →  seller
  sellerFeedbackScore  →  sellerFeedback
  categoryId          →  ebayCategory
  soldCurrency        →  currency
  `);

  console.log('═══════════════════════════════════════════════════════');
  console.log('  TEST COMPLETE');
  console.log(`  Cost estimate: ~$${(allItems.length * 0.004).toFixed(3)} (${allItems.length} × $0.004/result)`);
  console.log('═══════════════════════════════════════════════════════\n');
})();
