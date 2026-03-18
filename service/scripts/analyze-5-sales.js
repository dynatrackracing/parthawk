'use strict';
require('dotenv').config();

const { Model } = require('objection');
const { database } = require('../database/database');
Model.knex(database);

const { chromium } = require('playwright-extra');
const stealth = require('puppeteer-extra-plugin-stealth');
chromium.use(stealth());

// 5 items you actually sold
const TEST_ITEMS = [
  { itemId: '286644559901', price: 143.91, title: 'Honda CR-V 2.4L A/T 2005-2006 Programmed ECU ECM Engine Module' },
  { itemId: '287102899658', price: 149.90, title: 'Programmed PT Cruiser 2006-2010 TIPM Fuse Box Power Module' },
  { itemId: '286881898164', price: 449.91, title: 'Dodge RAM 2500 3500 5.9L Programmed ECU ECM PCM Engine Control' },
  { itemId: '287073626024', price: 269.90, title: 'Ford Explorer 2014 2015 ABS Anti Lock Brake Pump Assembly' },
  { itemId: '287057700550', price: 189.90, title: 'BMW 323i 328i 528i 1999 2000 Electronic Throttle Body Assembly' },
];

async function scrapeSoldItems(page, searchTitle) {
  // Clean title for search
  const noiseWords = ['oem', 'genuine', 'programmed', 'assembly', 'module'];
  const searchQuery = searchTitle
    .replace(/[,()]/g, ' ')
    .replace(/\s+/g, ' ')
    .toLowerCase()
    .split(' ')
    .filter(w => w.length > 1 && !noiseWords.includes(w))
    .slice(0, 6)
    .join(' ')
    .trim();

  console.log(`  Search: "${searchQuery}"`);

  const url = `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(searchQuery)}&_sacat=6030&LH_Sold=1&LH_Complete=1&_sop=13&_ipg=60`;

  await page.goto(url, { waitUntil: 'load', timeout: 45000 });
  await page.waitForTimeout(3000);
  await page.keyboard.press('End');
  await page.waitForTimeout(1500);

  // Extract sold items
  const items = await page.evaluate(() => {
    const results = [];
    const seen = new Set();
    const priceEls = document.querySelectorAll('.s-card__price');

    priceEls.forEach((priceEl) => {
      try {
        let card = priceEl.parentElement?.parentElement?.parentElement?.parentElement?.parentElement;
        if (!card) return;

        const innerText = card.innerText?.replace(/\s+/g, ' ')?.trim() || '';
        const priceText = priceEl?.textContent?.trim() || '';

        if (innerText.includes('Shop on eBay')) return;

        const soldMatch = innerText.match(/Sold\s+(\w+\s+\d+,?\s*\d*)/i);
        if (!soldMatch) return;

        let title = innerText.replace(/^.*?Sold\s+\w+\s+\d+,?\s*\d*\s*/i, '');
        title = title.replace(/\$[\d,.]+.*$/, '').trim();
        title = title.replace(/\(For:.*$/i, '').trim();

        const cleanPrice = priceText.replace('to', ' ').split(' ')[0];
        const price = parseFloat(cleanPrice.replace(/[^0-9.]/g, ''));
        if (isNaN(price) || price <= 0) return;

        const key = title.substring(0, 50) + price;
        if (seen.has(key)) return;
        seen.add(key);

        results.push({ title, price, soldDate: soldMatch[1] });
      } catch (e) {}
    });

    return results;
  });

  return items;
}

function calculateMetrics(soldItems, yourPrice) {
  if (soldItems.length === 0) return { count: 0, message: 'No sold items found' };

  const prices = soldItems.map(i => i.price).sort((a, b) => a - b);
  const count = prices.length;
  const sum = prices.reduce((a, b) => a + b, 0);
  const avg = sum / count;
  const median = count % 2 === 0
    ? (prices[count / 2 - 1] + prices[count / 2]) / 2
    : prices[Math.floor(count / 2)];
  const min = prices[0];
  const max = prices[prices.length - 1];
  const salesPerWeek = (count / 60) * 7;
  const priceDiff = yourPrice - median;
  const priceDiffPercent = (priceDiff / median) * 100;

  let verdict;
  if (priceDiffPercent > 30) verdict = 'OVERPRICED';
  else if (priceDiffPercent > 10) verdict = 'SLIGHTLY HIGH';
  else if (priceDiffPercent < -20) verdict = 'UNDERPRICED';
  else if (priceDiffPercent < -5) verdict = 'GOOD VALUE';
  else verdict = 'MARKET PRICE';

  return { count, avg, median, min, max, salesPerWeek, priceDiffPercent, verdict };
}

async function analyze() {
  console.log('=== Analyzing 5 Items You Actually Sold ===\n');

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
    viewport: { width: 1920, height: 1080 },
  });
  const page = await context.newPage();

  const results = [];

  for (let i = 0; i < TEST_ITEMS.length; i++) {
    const item = TEST_ITEMS[i];
    console.log(`[${i + 1}/5] $${item.price} - ${item.title.substring(0, 50)}...`);

    const soldItems = await scrapeSoldItems(page, item.title);
    const metrics = calculateMetrics(soldItems, item.price);

    results.push({ item, metrics });

    if (metrics.count > 0) {
      console.log(`  Found: ${metrics.count} sold | Median: $${metrics.median.toFixed(2)} | Velocity: ${metrics.salesPerWeek.toFixed(1)}/wk`);
      console.log(`  Your price: $${item.price} (${metrics.priceDiffPercent > 0 ? '+' : ''}${metrics.priceDiffPercent.toFixed(1)}%) -> ${metrics.verdict}`);
    } else {
      console.log(`  No market data found`);
    }
    console.log('');

    if (i < TEST_ITEMS.length - 1) {
      await page.waitForTimeout(3000);
    }
  }

  await browser.close();

  // Summary
  console.log('=== SUMMARY ===\n');
  results.forEach(r => {
    const emoji = {
      'OVERPRICED': '[!]',
      'SLIGHTLY HIGH': '[~]',
      'MARKET PRICE': '[OK]',
      'GOOD VALUE': '[OK]',
      'UNDERPRICED': '[$$]',
    }[r.metrics.verdict] || '[?]';

    if (r.metrics.count > 0) {
      console.log(`${emoji} $${r.item.price} -> Market $${r.metrics.median.toFixed(2)} (${r.metrics.priceDiffPercent > 0 ? '+' : ''}${r.metrics.priceDiffPercent.toFixed(0)}%) | ${r.metrics.salesPerWeek.toFixed(1)}/wk | ${r.metrics.verdict}`);
    } else {
      console.log(`[?] $${r.item.price} -> No market data`);
    }
  });
}

analyze()
  .then(() => { console.log('\nDone!'); process.exit(0); })
  .catch(err => { console.error('Error:', err); process.exit(1); });
