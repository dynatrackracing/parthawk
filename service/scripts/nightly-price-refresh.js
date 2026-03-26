#!/usr/bin/env node
/**
 * DARKHAWK — Nightly Price Refresh
 *
 * Pre-warms market_demand_cache with the EXACT keys that the attack list
 * enrichment reads via MarketPricingService.getCachedPrice().
 *
 * PRIMARY scraper: Playwright stealth (local PC only — eBay blocks axios).
 * FALLBACK: PriceCheckServiceV2 (axios+cheerio) if Playwright unavailable.
 *
 * Offset tracking: stores last offset in price-refresh-state.json so each
 * run picks up where the last left off. 100 parts/night at ~7s/part ≈ 12 min.
 * Full 1176-key coverage every ~12 days.
 *
 * Schedule: 4 AM daily via run-price-refresh.bat
 * Usage:   node service/scripts/nightly-price-refresh.js [--limit N] [--test] [--reset]
 */

'use strict';

const path = require('path');
const fs = require('fs');
process.chdir(path.resolve(__dirname, '..', '..'));
require('dotenv').config();

const { database } = require('../database/database');
const { buildSearchQuery, cachePrice } = require('../services/MarketPricingService');
const { extractPartNumbers } = require('../utils/partIntelligence');

const STATE_FILE = path.resolve(__dirname, '..', '..', 'price-refresh-state.json');
const DAYS_BACK = 180;

// Parse CLI args
const args = process.argv.slice(2);
const testMode = args.includes('--test');
const resetMode = args.includes('--reset');
const limitIdx = args.indexOf('--limit');
const MAX_PARTS = limitIdx >= 0 ? parseInt(args[limitIdx + 1]) || 100 : (testMode ? 10 : 100);

// ── Playwright scraper (local-PC primary) ─────────────────────
let _browser = null;
let _page = null;
let _playwrightAvailable = false;

async function initPlaywright() {
  try {
    const { chromium } = require('playwright-extra');
    const stealth = require('puppeteer-extra-plugin-stealth');
    chromium.use(stealth());

    _browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
    });
    const context = await _browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      viewport: { width: 1280, height: 720 },
    });
    _page = await context.newPage();
    _playwrightAvailable = true;
    console.log('   Playwright: OK (stealth browser launched)\n');
  } catch (e) {
    console.log('   Playwright: UNAVAILABLE (' + e.message.substring(0, 80) + ')');
    console.log('   Falling back to axios+cheerio (may get rate-limited)\n');
    _playwrightAvailable = false;
  }
}

async function closePlaywright() {
  if (_browser) {
    try { await _browser.close(); } catch (e) {}
    _browser = null;
    _page = null;
  }
}

/**
 * Scrape eBay sold comps using Playwright stealth.
 * Returns [{ title, price, soldDate }] or empty array.
 */
async function scrapeSoldCompsPlaywright(searchQuery) {
  if (!_page || _page.isClosed()) {
    // Page crashed — reopen
    if (_browser) {
      try {
        const context = await _browser.newContext({
          userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          viewport: { width: 1280, height: 720 },
        });
        _page = await context.newPage();
      } catch (e) {
        return [];
      }
    } else {
      return [];
    }
  }

  const url = `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(searchQuery)}&_sacat=6030&LH_Sold=1&LH_Complete=1&_sop=13&_ipg=60`;

  try {
    await _page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await _page.waitForTimeout(2000);
    // Scroll to trigger lazy loading
    await _page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await _page.waitForTimeout(1000);

    const items = await _page.evaluate(() => {
      const results = [];
      const seen = new Set();

      // 2024+ eBay: .s-card layout inside ul.srp-results > li
      document.querySelectorAll('ul.srp-results > li').forEach(el => {
        try {
          const innerText = el.innerText || '';
          if (innerText.includes('Shop on eBay') || innerText.includes('Results matching fewer words')) return;

          // Title: .s-card__title or .s-item__title
          let title = '';
          const cardTitle = el.querySelector('.s-card__title');
          const itemTitle = el.querySelector('.s-item__title');
          title = (cardTitle?.textContent || itemTitle?.textContent || '').trim();
          title = title.replace(/Opens in a new window or tab$/i, '').trim();
          if (!title) return;

          // Price: .s-card__price or .s-item__price
          const cardPrice = el.querySelector('.s-card__price');
          const itemPrice = el.querySelector('.s-item__price');
          const priceText = (cardPrice?.textContent || itemPrice?.textContent || '').trim();
          const priceMatch = priceText.match(/\$([\d,]+\.?\d*)/);
          if (!priceMatch) return;
          const price = parseFloat(priceMatch[1].replace(',', ''));
          if (isNaN(price) || price <= 0) return;

          // Sold date
          const soldMatch = innerText.match(/Sold\s+(\w+\s+\d+,?\s*\d*)/i);
          const soldDate = soldMatch ? soldMatch[1] : null;

          const key = title.substring(0, 50) + price;
          if (seen.has(key)) return;
          seen.add(key);

          results.push({ title, price, soldDate });
        } catch (e) {}
      });

      return results;
    });

    return items;
  } catch (err) {
    // Navigation error, timeout, etc — return empty, don't crash
    return [];
  }
}

/**
 * Calculate metrics from scraped items (same logic as PriceCheckServiceV2).
 */
function calculateMetrics(items) {
  if (!items || items.length === 0) return null;

  const prices = items.map(i => i.price).sort((a, b) => a - b);
  const count = prices.length;
  const sum = prices.reduce((a, b) => a + b, 0);
  const avg = sum / count;
  const median = count % 2 === 0
    ? (prices[count / 2 - 1] + prices[count / 2]) / 2
    : prices[Math.floor(count / 2)];
  const salesPerWeek = (count / 60) * 7; // ~60 results per page = ~60 days

  return {
    count,
    avg: Math.round(avg * 100) / 100,
    median: Math.round(median * 100) / 100,
    min: prices[0],
    max: prices[prices.length - 1],
    salesPerWeek: Math.round(salesPerWeek * 10) / 10,
  };
}

// ── V2 fallback (axios+cheerio) ───────────────────────────────
let priceCheckV2 = null;
try {
  priceCheckV2 = require('../services/PriceCheckServiceV2');
} catch (e) {}

async function scrapeWithFallback(searchQuery) {
  // Primary: Playwright stealth
  if (_playwrightAvailable) {
    const items = await scrapeSoldCompsPlaywright(searchQuery);
    if (items.length > 0) {
      return calculateMetrics(items);
    }
  }

  // Fallback: V2 axios+cheerio
  if (priceCheckV2) {
    try {
      const v2Result = await priceCheckV2.check(searchQuery, 0);
      if (v2Result && v2Result.metrics && v2Result.metrics.count > 0) {
        return {
          count: v2Result.metrics.count,
          avg: v2Result.metrics.avg,
          median: v2Result.metrics.median,
          min: v2Result.metrics.min,
          max: v2Result.metrics.max,
          salesPerWeek: v2Result.metrics.salesPerWeek,
        };
      }
    } catch (e) {}
  }

  return null;
}

// ── State / delay helpers ─────────────────────────────────────
function loadState() {
  try {
    if (fs.existsSync(STATE_FILE)) {
      return JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'));
    }
  } catch (e) {}
  return { offset: 0, lastRun: null, totalKeys: 0 };
}

function saveState(state) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

function delay() {
  const ms = 5000 + Math.floor(Math.random() * 2000 + 1000);
  return new Promise(r => setTimeout(r, ms));
}

// ── Main ──────────────────────────────────────────────────────
async function main() {
  console.log('═══════════════════════════════════════════');
  console.log('DARKHAWK — Nightly Price Refresh');
  console.log(new Date().toISOString());
  if (testMode) console.log('** TEST MODE — limit ' + MAX_PARTS + ' parts **');
  console.log('═══════════════════════════════════════════\n');

  // Initialize Playwright browser
  await initPlaywright();

  // Load offset state
  let state = loadState();
  if (resetMode) {
    state = { offset: 0, lastRun: null, totalKeys: 0 };
    console.log('   Offset reset to 0\n');
  }

  // Step 1: Get distinct cache keys from YourSale
  console.log('1. Querying distinct part combos from YourSale (last ' + DAYS_BACK + ' days)...');

  const combos = await database.raw(`
    SELECT
      title,
      "salePrice",
      COUNT(*) OVER (PARTITION BY SUBSTRING(title FROM 1 FOR 80)) as combo_count
    FROM "YourSale"
    WHERE "soldDate" > NOW() - INTERVAL '${DAYS_BACK} days'
      AND title IS NOT NULL
      AND "salePrice" > 50
    ORDER BY combo_count DESC
  `);

  const rows = combos.rows || combos;

  // Deduplicate by cache key
  const seen = new Map();
  for (const row of rows) {
    const title = (row.title || '').trim();
    if (!title) continue;

    const price = parseFloat(row.salePrice) || 0;
    const sq = buildSearchQuery({ title, year: null, make: null, model: null, partType: null });

    if (!seen.has(sq.cacheKey)) {
      seen.set(sq.cacheKey, {
        query: sq.query,
        method: sq.method,
        cacheKey: sq.cacheKey,
        count: 1,
        totalPrice: price,
        sampleTitle: title,
      });
    } else {
      const entry = seen.get(sq.cacheKey);
      entry.count++;
      entry.totalPrice += price;
    }
  }

  // Sort by frequency — stable order for offset tracking
  const allKeys = Array.from(seen.values()).sort((a, b) => b.count - a.count);
  const totalKeys = allKeys.length;

  // Apply offset
  let offset = state.offset || 0;
  if (offset >= totalKeys) offset = 0;

  const slice = allKeys.slice(offset, offset + MAX_PARTS);
  const nextOffset = (offset + slice.length >= totalKeys) ? 0 : offset + slice.length;

  console.log('   Found ' + rows.length + ' sales → ' + totalKeys + ' unique cache keys');
  console.log('   Offset: ' + offset + ' → ' + nextOffset + ' (processing ' + slice.length + ')');
  if (state.lastRun) console.log('   Last run: ' + state.lastRun);
  console.log();

  if (slice.length === 0) {
    console.log('   No parts to refresh. Exiting.');
    await closePlaywright();
    await database.destroy();
    return;
  }

  // Step 2: Check which keys are already fresh
  let alreadyCached = 0;
  const toRefresh = [];
  for (const part of slice) {
    try {
      const existing = await database('market_demand_cache')
        .where('part_number_base', part.cacheKey)
        .whereRaw("last_updated > NOW() - INTERVAL '24 hours'")
        .first();
      if (existing && parseFloat(existing.ebay_avg_price) > 0) {
        alreadyCached++;
        continue;
      }
    } catch (e) {}
    toRefresh.push(part);
  }

  console.log('   Already fresh (< 24h): ' + alreadyCached);
  console.log('   Need refresh: ' + toRefresh.length + '\n');

  // Step 3: Scrape comps (Playwright primary, V2 fallback)
  let refreshed = 0, failed = 0, skipped = 0;
  let playwrightHits = 0, v2Hits = 0;

  for (let i = 0; i < toRefresh.length; i++) {
    const part = toRefresh[i];

    try {
      const label = (part.sampleTitle || part.query).substring(0, 50);
      process.stdout.write(`\r   [${i + 1}/${toRefresh.length}] ${label}...`);

      const result = await scrapeWithFallback(part.query);

      if (!result || result.count === 0) {
        skipped++;
        await delay();
        continue;
      }

      // Track which scraper succeeded
      if (_playwrightAvailable) playwrightHits++;
      else v2Hits++;

      await cachePrice(part.cacheKey, {}, result);
      refreshed++;
    } catch (err) {
      failed++;
      if (failed <= 5) console.error(`\n   ERROR on "${part.cacheKey}": ${err.message}`);
    }

    if (i < toRefresh.length - 1) await delay();
  }

  // Step 4: Save offset state
  state.offset = nextOffset;
  state.lastRun = new Date().toISOString();
  state.totalKeys = totalKeys;
  state.lastRefreshed = refreshed;
  state.lastSkipped = skipped;
  state.lastFailed = failed;
  saveState(state);

  // Step 5: Cleanup + Summary
  await closePlaywright();

  const { rows: [stats] } = await database.raw(`
    SELECT COUNT(*) as total, COUNT(CASE WHEN ebay_avg_price > 0 THEN 1 END) as with_price
    FROM market_demand_cache
  `);

  const coverage = totalKeys > 0 ? Math.round((parseInt(stats.with_price) / totalKeys) * 100) : 0;
  const daysToFull = toRefresh.length > 0 ? Math.ceil(totalKeys / MAX_PARTS) : '∞';

  console.log('\n\n═══════════════════════════════════════════');
  console.log('COMPLETE');
  console.log('  Scraper:       ' + (_playwrightAvailable ? 'Playwright stealth' : 'axios+cheerio'));
  console.log('  Window:        ' + offset + '-' + (offset + slice.length) + ' of ' + totalKeys);
  console.log('  Already fresh: ' + alreadyCached);
  console.log('  Refreshed:     ' + refreshed);
  console.log('  Skipped:       ' + skipped + ' (no comps found)');
  console.log('  Failed:        ' + failed);
  console.log('  Next offset:   ' + nextOffset);
  console.log('  Cache total:   ' + stats.total + ' entries (' + stats.with_price + ' with prices)');
  console.log('  Coverage:      ' + coverage + '% (' + daysToFull + ' days to full cycle)');
  console.log('═══════════════════════════════════════════');

  await database.destroy();
}

main().catch(async err => {
  console.error('FATAL:', err);
  await closePlaywright();
  process.exit(1);
});
