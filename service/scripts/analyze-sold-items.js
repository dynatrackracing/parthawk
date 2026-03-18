'use strict';

/**
 * Analyze Sold Items Pipeline
 *
 * The CORRECT data pipeline:
 * 1. Take YOUR listing title
 * 2. Search eBay SOLD items only (ignore active listings - they're noise)
 * 3. Scrape: sold price, sold date
 * 4. Calculate: avg price, velocity (sales/week), price distribution
 * 5. Compare to YOUR price and recommend
 *
 * Usage: node service/scripts/analyze-sold-items.js
 */

const { Model } = require('objection');
const { database } = require('../database/database');
Model.knex(database);

const { chromium } = require('playwright-extra');
const stealth = require('puppeteer-extra-plugin-stealth');
chromium.use(stealth());

const YourListing = require('../models/YourListing');

// Test items (mid-range $150-350)
const TEST_ITEM_IDS = [
  '277a7e1c-8ef7-43c8-8a58-4a93ce2db006', // Dodge Dakota ECU $215.91
  'f80f4bd6-f5d6-4e96-a304-19aae2119dc3', // Mercedes Fuse Box $179.90
  '8209f0ba-25c6-4d94-bfb9-4cda8d189dc3', // Hyundai/Kia ABS $179.90
  '38dbb3ae-83b0-4c8a-b09f-c9c93eff2e4e', // Jeep Commander ECU $159.90
  '0756d9f1-e970-43f9-ab1a-bc02e9e76a7e', // Dodge Ram AC Module $199.90
];

class SoldItemsAnalyzer {
  constructor() {
    this.browser = null;
    this.context = null;
  }

  async init() {
    this.browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
    this.context = await this.browser.newContext({
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      viewport: { width: 1920, height: 1080 },
    });
  }

  async close() {
    if (this.context) await this.context.close();
    if (this.browser) await this.browser.close();
  }

  /**
   * Search eBay for SOLD items matching the title
   */
  async scrapeSoldItems(searchTitle, maxPages = 3) {
    const page = await this.context.newPage();
    const allSoldItems = [];

    try {
      // Clean up title for search - keep important terms including part numbers
      // Preserve engine sizes like "4.7L", part numbers, etc.
      const noiseWords = ['oem', 'genuine', 'new', 'used', 'programmed', 'tested', 'working', 'assembly', 'unit', 'and', 'the', 'for'];
      let searchQuery = searchTitle
        .replace(/[,()]/g, ' ')  // Remove punctuation but keep periods for "4.7L"
        .replace(/\s+/g, ' ')
        .toLowerCase()
        .split(' ')
        .filter(w => w.length > 1 && !noiseWords.includes(w))
        .slice(0, 6) // Keep first 6 meaningful words (simpler query = more results)
        .join(' ')
        .trim();

      console.log(`  Searching: "${searchQuery}"`);

      for (let pageNum = 1; pageNum <= maxPages; pageNum++) {
        // eBay sold items URL
        const url = `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(searchQuery)}&_sacat=6030&LH_Sold=1&LH_Complete=1&_sop=13&_ipg=60&_pgn=${pageNum}`;

        console.log(`  Page ${pageNum}: ${url.substring(0, 100)}...`);
        await page.goto(url, { waitUntil: 'load', timeout: 45000 });
        // Wait for items to load - try multiple selectors
        try {
          await page.waitForSelector('.s-item__title, .str-item-card, .s-card__price', { timeout: 10000 });
        } catch (e) {
          // No primary selectors found, wait longer for "fewer words" section
        }
        // Wait for items to render - including "Results matching fewer words" section
        await page.waitForTimeout(2000);
        await page.keyboard.press('End');
        await page.waitForTimeout(1500);
        await page.keyboard.press('Home');
        await page.waitForTimeout(1000);

        // Debug: Check if we got results or an error page
        const pageTitle = await page.title();
        const resultCount = await page.evaluate(() => {
          const countEl = document.querySelector('.srp-controls__count-heading');
          return countEl ? countEl.textContent : 'no count found';
        });
        console.log(`    Page title: ${pageTitle.substring(0, 50)}`);
        console.log(`    Results: ${resultCount}`);

        // Extract sold items using new eBay card structure
        const items = await page.evaluate(() => {
          const results = [];
          const seen = new Set();

          // eBay uses s-card__price for prices - find them and walk up to card
          const priceEls = document.querySelectorAll('.s-card__price');

          priceEls.forEach((priceEl) => {
            try {
              // Walk up 5 levels from price to get to the actual listing card
              let card = priceEl.parentElement?.parentElement?.parentElement?.parentElement?.parentElement;
              if (!card) card = priceEl.closest('li');
              if (!card) return;

              // Parse everything from innerText (most reliable)
              const innerText = card.innerText?.replace(/\s+/g, ' ')?.trim() || '';
              const priceText = priceEl?.textContent?.trim() || '';

              // Skip "Shop on eBay" sponsored items
              if (innerText.includes('Shop on eBay')) return;

              // Extract sold date: "Sold Jan 30, 2026"
              const soldMatch = innerText.match(/Sold\s+(\w+\s+\d+,?\s*\d*)/i);
              if (!soldMatch) return; // Skip if no sold date

              const soldDateText = 'Sold ' + soldMatch[1];

              // Extract title: everything after "Sold DATE" and before the price or "(For:"
              let title = innerText;
              // Remove the "Sold DATE" prefix
              title = title.replace(/^.*?Sold\s+\w+\s+\d+,?\s*\d*\s*/i, '');
              // Remove price and everything after
              title = title.replace(/\$[\d,.]+.*$/, '').trim();
              // Remove "(For:" compatibility text at end
              title = title.replace(/\(For:.*$/i, '').trim();

              // Filter: must have sold date, no "View similar", no "Shop on eBay"
              if (!title || !priceText || !soldDateText.includes('Sold')) return;
              if (title.includes('View similar') || title === 'Shop on eBay') return;

              // Parse price (handle "to" ranges by taking first price)
              const cleanPrice = priceText.replace('to', ' ').split(' ')[0];
              const price = parseFloat(cleanPrice.replace(/[^0-9.]/g, ''));
              if (isNaN(price) || price <= 0) return;

              // Deduplicate by title+price
              const key = title.substring(0, 50) + price;
              if (seen.has(key)) return;
              seen.add(key);

              // Parse sold date
              const dateMatch = soldDateText.match(/Sold\s+(\w+\s+\d+,?\s*\d*)/i);
              const soldDate = dateMatch ? dateMatch[1] : null;

              results.push({
                title,
                soldPrice: price,
                soldDateText: soldDate,
              });
            } catch (e) {
              // Skip malformed items
            }
          });

          return results;
        });

        console.log(`    Found ${items.length} sold items`);
        const soldItems = items;
        allSoldItems.push(...soldItems);

        // Check if there are more pages
        const hasNextPage = await page.evaluate(() => {
          return !!document.querySelector('.pagination__next');
        });

        if (!hasNextPage || soldItems.length < 10) break;

        // Delay between pages
        await page.waitForTimeout(2000 + Math.random() * 2000);
      }
    } catch (err) {
      console.error(`  Error scraping: ${err.message}`);
    } finally {
      await page.close();
    }

    return allSoldItems;
  }

  /**
   * Calculate market metrics from sold items
   */
  calculateMetrics(soldItems, yourPrice) {
    if (soldItems.length === 0) {
      return {
        count: 0,
        message: 'No sold items found',
      };
    }

    const prices = soldItems.map(i => i.soldPrice).sort((a, b) => a - b);
    const count = prices.length;

    // Price statistics
    const sum = prices.reduce((a, b) => a + b, 0);
    const avg = sum / count;
    const median = count % 2 === 0
      ? (prices[count / 2 - 1] + prices[count / 2]) / 2
      : prices[Math.floor(count / 2)];
    const min = prices[0];
    const max = prices[prices.length - 1];
    const p10 = prices[Math.floor(count * 0.1)];
    const p90 = prices[Math.floor(count * 0.9)];

    // Estimate velocity (assume data spans ~30-60 days)
    // eBay shows ~90 days of sold history
    const estimatedDays = 60;
    const salesPerWeek = (count / estimatedDays) * 7;

    // Compare to your price
    const priceDiff = yourPrice - median;
    const priceDiffPercent = (priceDiff / median) * 100;

    let recommendation;
    let expectedDaysToSell;

    if (priceDiffPercent > 30) {
      recommendation = 'OVERPRICED';
      expectedDaysToSell = '30+ days (slow)';
    } else if (priceDiffPercent > 10) {
      recommendation = 'SLIGHTLY_HIGH';
      expectedDaysToSell = '14-30 days';
    } else if (priceDiffPercent < -20) {
      recommendation = 'UNDERPRICED';
      expectedDaysToSell = '1-3 days (quick flip)';
    } else if (priceDiffPercent < -5) {
      recommendation = 'GOOD_VALUE';
      expectedDaysToSell = '3-7 days';
    } else {
      recommendation = 'MARKET_PRICE';
      expectedDaysToSell = '7-14 days';
    }

    return {
      count,
      avgPrice: Math.round(avg * 100) / 100,
      medianPrice: Math.round(median * 100) / 100,
      minPrice: min,
      maxPrice: max,
      p10Price: p10,
      p90Price: p90,
      salesPerWeek: Math.round(salesPerWeek * 10) / 10,
      yourPrice,
      priceDiff: Math.round(priceDiff * 100) / 100,
      priceDiffPercent: Math.round(priceDiffPercent * 10) / 10,
      recommendation,
      expectedDaysToSell,
      suggestedPrice: Math.round(median * 100) / 100,
    };
  }
}

async function analyzeTestItems() {
  console.log('\n=== Sold Items Analysis Pipeline ===\n');

  // Get test listings
  const listings = await YourListing.query().whereIn('id', TEST_ITEM_IDS);
  console.log(`Found ${listings.length} test items\n`);

  const analyzer = new SoldItemsAnalyzer();
  await analyzer.init();

  const results = [];

  for (let i = 0; i < listings.length; i++) {
    const listing = listings[i];
    console.log(`[${i + 1}/${listings.length}] $${listing.currentPrice} - ${listing.title.substring(0, 50)}...`);

    // Scrape sold items
    const soldItems = await analyzer.scrapeSoldItems(listing.title);

    // Calculate metrics
    const metrics = analyzer.calculateMetrics(soldItems, listing.currentPrice);

    results.push({
      listing: {
        id: listing.id,
        title: listing.title,
        price: listing.currentPrice,
      },
      soldItemsCount: soldItems.length,
      metrics,
    });

    // Print summary
    console.log(`\n  === ANALYSIS ===`);
    console.log(`  Your Price: $${listing.currentPrice}`);
    console.log(`  Sold Items Found: ${metrics.count}`);
    if (metrics.count > 0) {
      console.log(`  Market Median: $${metrics.medianPrice}`);
      console.log(`  Price Range: $${metrics.minPrice} - $${metrics.maxPrice}`);
      console.log(`  Sales Velocity: ${metrics.salesPerWeek}/week`);
      console.log(`  Your Price vs Market: ${metrics.priceDiffPercent > 0 ? '+' : ''}${metrics.priceDiffPercent}%`);
      console.log(`  Recommendation: ${metrics.recommendation}`);
      console.log(`  Expected Days to Sell: ${metrics.expectedDaysToSell}`);
      if (metrics.recommendation !== 'MARKET_PRICE') {
        console.log(`  Suggested Price: $${metrics.suggestedPrice}`);
      }
    }
    console.log('');

    // Delay between items
    if (i < listings.length - 1) {
      console.log('  Waiting 5s...\n');
      await new Promise(r => setTimeout(r, 5000));
    }
  }

  await analyzer.close();

  // Summary
  console.log('\n=== SUMMARY ===\n');
  results.forEach(r => {
    const status = r.metrics.recommendation || 'NO_DATA';
    const emoji = {
      'OVERPRICED': '🔴',
      'SLIGHTLY_HIGH': '🟡',
      'MARKET_PRICE': '🟢',
      'GOOD_VALUE': '🟢',
      'UNDERPRICED': '🔵',
      'NO_DATA': '⚪',
    }[status] || '⚪';

    console.log(`${emoji} $${r.listing.price} - ${r.listing.title.substring(0, 40)}...`);
    if (r.metrics.count > 0) {
      console.log(`   Market: $${r.metrics.medianPrice} | ${r.metrics.salesPerWeek}/wk | ${status}`);
    } else {
      console.log(`   No market data found`);
    }
  });

  return results;
}

// Run
if (require.main === module) {
  const knexConfig = require('../database/knexfile');
  const migrationConfig = knexConfig[process.env.NODE_ENV || 'development'];

  database.migrate.latest(migrationConfig.migration)
    .then(() => analyzeTestItems())
    .then(() => {
      console.log('\nDone!');
      process.exit(0);
    })
    .catch(err => {
      console.error('Error:', err);
      process.exit(1);
    });
}

module.exports = { SoldItemsAnalyzer, analyzeTestItems };
