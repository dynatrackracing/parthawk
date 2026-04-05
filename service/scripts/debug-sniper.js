#!/usr/bin/env node
/**
 * debug-sniper.js — Diagnose why PriceCheckServiceV2 returns 0 results
 *
 * Replicates the exact HTTP request + parsing that V2 does, logs everything.
 * Usage: node service/scripts/debug-sniper.js
 */

'use strict';

const axios = require('axios');
const cheerio = require('cheerio');

const TEST_PN = '22928326'; // Camaro SS rear differential — known high-value part
const QUERY = `"${TEST_PN}"`; // Quoted exact match, same as sniper

const EBAY_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Accept-Encoding': 'gzip, deflate, br',
};

const url = `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(QUERY)}&_sacat=6030&LH_Sold=1&LH_Complete=1&_sop=13&_ipg=60`;

(async () => {
  console.log('═══════════════════════════════════════════');
  console.log('  SNIPER DIAGNOSTIC — PriceCheckServiceV2');
  console.log('═══════════════════════════════════════════');
  console.log('Test PN:', TEST_PN);
  console.log('Query:', QUERY);
  console.log('URL:', url);
  console.log('');

  // ── Test 1: Exact same request as V2 ──────────────────

  console.log('── TEST 1: axios with V2 headers ──');
  let response;
  try {
    response = await axios.get(url, { headers: EBAY_HEADERS, timeout: 15000 });
    console.log('Status:', response.status);
    console.log('Content-Type:', response.headers['content-type']);
    console.log('Response size:', typeof response.data === 'string' ? response.data.length : JSON.stringify(response.data).length, 'chars');
  } catch (err) {
    console.log('AXIOS FAILED:', err.message);
    if (err.response) {
      console.log('Status:', err.response.status);
      console.log('Headers:', JSON.stringify(err.response.headers, null, 2));
      response = err.response;
    } else {
      process.exit(1);
    }
  }

  const html = typeof response.data === 'string' ? response.data : '';
  console.log('');

  // ── Test 2: Check for blocking signals ────────────────

  console.log('── TEST 2: Blocking signals ──');
  const signals = {
    'captcha': /captcha/i.test(html),
    'robot': /robot/i.test(html),
    'challenge': /challenge/i.test(html),
    'blocked': /blocked/i.test(html),
    'Please verify': /Please verify/i.test(html),
    'Access Denied': /Access Denied/i.test(html),
    'unusual traffic': /unusual traffic/i.test(html),
  };
  let blocked = false;
  for (const [signal, found] of Object.entries(signals)) {
    if (found) { console.log('  ⚠️  FOUND:', signal); blocked = true; }
  }
  if (!blocked) console.log('  ✓ No blocking signals detected');
  console.log('');

  // ── Test 3: Check for expected HTML structure ─────────

  console.log('── TEST 3: Expected HTML selectors ──');
  const $ = cheerio.load(html);
  const checks = {
    'ul.srp-results': $('ul.srp-results').length,
    'ul.srp-results > li': $('ul.srp-results > li').length,
    '.s-card__title': $('.s-card__title').length,
    '.s-card__price': $('.s-card__price').length,
    '.s-item__title': $('.s-item__title').length,
    '.s-item__price': $('.s-item__price').length,
    '.srp-river-results': $('.srp-river-results').length,
    '.srp-controls__count': $('.srp-controls__count').length,
  };
  for (const [selector, count] of Object.entries(checks)) {
    console.log('  ' + selector + ': ' + count + (count > 0 ? ' ✓' : ''));
  }

  // Result count text
  const resultCountText = $('.srp-controls__count').text().trim();
  if (resultCountText) console.log('  Result count text: "' + resultCountText + '"');

  console.log('');

  // ── Test 4: Raw HTML snippet ──────────────────────────

  console.log('── TEST 4: First 2000 chars of response ──');
  console.log(html.substring(0, 2000));
  console.log('\n... (truncated)\n');

  // ── Test 5: V2 cheerio parsing (exact same logic) ────

  console.log('── TEST 5: V2 cheerio parsing ──');
  const items = [];
  const seen = new Set();

  $('ul.srp-results > li').each((_, el) => {
    try {
      const $el = $(el);
      let title = $el.find('.s-card__title').first().text().trim();
      if (!title) title = $el.find('.s-item__title').first().text().trim();
      title = title.replace(/Opens in a new window or tab$/i, '').trim();
      if (!title || title === 'Shop on eBay' || title === 'Results matching fewer words') return;

      let priceText = $el.find('.s-card__price').first().text().trim();
      if (!priceText) priceText = $el.find('.s-item__price').first().text().trim();
      const priceMatch = priceText.match(/\$([\d,]+\.?\d*)/);
      if (!priceMatch) return;
      const price = parseFloat(priceMatch[1].replace(',', ''));
      if (isNaN(price) || price <= 0) return;

      const key = title.substring(0, 50) + price;
      if (seen.has(key)) return;
      seen.add(key);

      items.push({ title: title.substring(0, 80), price });
    } catch (e) { /* skip */ }
  });

  console.log('V2 parsing found:', items.length, 'items');
  items.slice(0, 5).forEach((item, i) => {
    console.log('  [' + (i + 1) + '] $' + item.price + ' — ' + item.title);
  });
  console.log('');

  // ── Test 6: JSON fallback parsing (V2's fallback) ────

  console.log('── TEST 6: JSON regex fallback parsing ──');
  const titleRegex = /"title":"([^"]+)"/g;
  const priceRegex = /"price":{"value":"([\d.]+)"/g;
  const titles = [], prices = [];
  let m;
  while ((m = titleRegex.exec(html)) !== null) titles.push(m[1]);
  while ((m = priceRegex.exec(html)) !== null) prices.push(parseFloat(m[1]));
  console.log('JSON titles found:', titles.length);
  console.log('JSON prices found:', prices.length);
  if (titles.length > 0) {
    const count = Math.min(titles.length, prices.length, 5);
    for (let i = 0; i < count; i++) {
      console.log('  [' + (i + 1) + '] $' + (prices[i] || '?') + ' — ' + titles[i].substring(0, 80));
    }
  }
  console.log('');

  // ── Test 7: Alternate selectors (2025+ eBay) ─────────

  console.log('── TEST 7: Alternate selector hunt ──');
  // Look for any elements with price-like text
  const allPriceEls = $('[class*="price"]');
  console.log('Elements with "price" in class:', allPriceEls.length);
  allPriceEls.slice(0, 3).each((_, el) => {
    const classes = $(el).attr('class') || '';
    const text = $(el).text().trim().substring(0, 60);
    console.log('  class="' + classes.substring(0, 60) + '" → "' + text + '"');
  });

  const allTitleEls = $('[class*="title"]');
  console.log('Elements with "title" in class:', allTitleEls.length);
  allTitleEls.slice(0, 3).each((_, el) => {
    const classes = $(el).attr('class') || '';
    const text = $(el).text().trim().substring(0, 60);
    console.log('  class="' + classes.substring(0, 60) + '" → "' + text + '"');
  });

  // Look for any $ amounts in the page
  const dollarMatches = html.match(/\$[\d,]+\.?\d*/g) || [];
  console.log('Dollar amounts in HTML:', dollarMatches.length);
  if (dollarMatches.length > 0) console.log('  Samples:', dollarMatches.slice(0, 10).join(', '));
  console.log('');

  // ── Test 8: Minimal fetch (no custom headers) ────────

  console.log('── TEST 8: Basic fetch (no special headers) ──');
  try {
    const resp2 = await axios.get(url, { timeout: 15000 });
    console.log('Status:', resp2.status);
    console.log('Size:', resp2.data.length, 'chars');
    const $2 = cheerio.load(resp2.data);
    console.log('ul.srp-results > li:', $2('ul.srp-results > li').length);
    console.log('.s-card__title:', $2('.s-card__title').length);
    console.log('.s-item__title:', $2('.s-item__title').length);
    const blocked2 = /captcha|robot|challenge|blocked|verify/i.test(resp2.data);
    console.log('Blocking signals:', blocked2 ? 'YES' : 'none');
  } catch (err) {
    console.log('Basic fetch failed:', err.message);
  }

  console.log('\n═══════════════════════════════════════════');
  console.log('  DIAGNOSTIC COMPLETE');
  console.log('═══════════════════════════════════════════');
})();
