'use strict';
require('dotenv').config();

const { Model } = require('objection');
const { database } = require('../database/database');
Model.knex(database);

const { chromium } = require('playwright-extra');
const stealth = require('puppeteer-extra-plugin-stealth');
chromium.use(stealth());

const { buildSearchQuery } = require('./smart-query-builder');
const { filterRelevantItems } = require('./relevance-scorer');

// 15 diverse items from actual sales
const TEST_ITEMS = [
  { itemId: '286894598514', price: 190.00, title: 'Mitsubishi Montero 3.0L 2002-2004 ECU ECM Engine Control Key Immobilzer MR578042' },
  { itemId: '286901850364', price: 299.90, title: 'Ford Edge Lincoln MKX 2011-2014 ABS Anti Lock Brake Pump Assembly CT43-2C405-AB' },
  { itemId: '286895847064', price: 149.90, title: 'Audi 8T A5 S5 B8 A4 2008-2012 Bang & Ofulsen Radio Amplifier Amp 8T0 035 223AN' },
  { itemId: '287043425996', price: 240.00, title: 'Hyundai Accent 2006-2011 ECU ECM PCM Engine Control Module 39132-26BL0' },
  { itemId: '286884495438', price: 251.91, title: 'BMW F10 535XI 2011-2016 Harman/Becker HIFI Radio Stereo Amplifier Amp 9243496' },
  { itemId: '286861479783', price: 279.90, title: 'Dodge Charger Chrysler 300 2011-2014 3.6L 5.7L Power Steering Pump 68059524AI' },
  { itemId: '286924225955', price: 359.90, title: 'Honda Pilot 3.5L 2WD 2012-2015 ABS Anti Lock Brake Pump Assembly SZBA1' },
  { itemId: '286921782267', price: 279.90, title: 'Mazda 5 2010-2015 ABS Anti Lock Brake Pump MOD Assembly OEM C513-437AZ-B' },
  { itemId: '286909836416', price: 179.90, title: 'Honda CRV 2012-2014 Electric Power Steering EPS Control Module 39980-T0G-A0' },
  { itemId: '286889036617', price: 149.90, title: '2001-2005 XG300 XG350  Throttle Body Assembly OEM  E0T70472' },
  { itemId: '287077931343', price: 299.90, title: 'Lexus GS300 1998-2005 ABS Anti Lock Brake Booster Master Cylinder OEM' },
  { itemId: '286895847051', price: 189.91, title: 'Kia Sportage 2021 Windshield Lane Assist Departure Camera OEM 99211-F1000' },
  { itemId: '286867998467', price: 132.93, title: 'Toyota Highlander 2004-2007 HVAC A/C Climate Control Module 84010-48180' },
  { itemId: '286879852206', price: 161.91, title: 'Mazda 3 2010-2013 Bose Radio Stereo Audio Amplifier Amp BBM466A20' },
  { itemId: '286893897038', price: 59.90, title: 'Chevy Tahoe GMC Yukon Suburban 2007-2009 Fuse Box Relay Junction 15092625' },
];

async function scrapeSoldItems(page, title) {
  // Use smart query builder instead of naive title cleaning
  const queryResult = buildSearchQuery(title);
  const searchQuery = queryResult.query;

  console.log(`  Search: "${searchQuery}"`);
  if (queryResult.structured) {
    console.log(`  Parts: ${JSON.stringify(queryResult.parts)}`);
  }

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
  console.log('=== Analyzing ' + TEST_ITEMS.length + ' Items with Smart Query + Relevance Scoring ===\n');

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
    viewport: { width: 1920, height: 1080 },
  });
  const page = await context.newPage();

  const results = [];

  for (let i = 0; i < TEST_ITEMS.length; i++) {
    const item = TEST_ITEMS[i];
    console.log(`[${i + 1}/${TEST_ITEMS.length}] $${item.price} - ${item.title.substring(0, 50)}...`);

    // Get structured data from title for relevance scoring
    const queryResult = buildSearchQuery(item.title);
    const ourItem = {
      title: item.title,
      make: queryResult.parts.make,
      model: queryResult.parts.model,
      years: queryResult.parts.years,
      partType: queryResult.parts.partType,
    };

    // Scrape sold items
    const scrapedItems = await scrapeSoldItems(page, item.title);
    console.log(`  Raw scraped: ${scrapedItems.length} items`);

    // Filter for relevance
    const filtered = filterRelevantItems(ourItem, scrapedItems);
    console.log(`  After filtering: ${filtered.relevant}/${filtered.total} items (avg score: ${filtered.avgScore.toFixed(1)})`);

    // Calculate metrics on filtered items only
    const relevantItems = filtered.items.map(i => ({ title: i.title, price: i.price, soldDate: i.soldDate }));
    const metrics = calculateMetrics(relevantItems, item.price);

    results.push({ item, ourItem, metrics, filtered });

    if (metrics.count > 0) {
      console.log(`  Market: Median $${metrics.median.toFixed(2)} | Range $${metrics.min.toFixed(2)}-$${metrics.max.toFixed(2)} | ${metrics.salesPerWeek.toFixed(1)}/wk`);
      console.log(`  Your price: $${item.price} (${metrics.priceDiffPercent > 0 ? '+' : ''}${metrics.priceDiffPercent.toFixed(1)}%) -> ${metrics.verdict}`);
    } else {
      console.log(`  No relevant market data found`);
    }

    // Show top 3 relevant items for debugging
    if (filtered.items.length > 0) {
      console.log(`  Top matches:`);
      filtered.items.slice(0, 3).forEach((match, j) => {
        const r = match.relevance;
        console.log(`    ${j + 1}. $${match.price} - ${match.title.substring(0, 40)}... (score ${r.score})`);
      });
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

    const partInfo = r.ourItem.partType ? r.ourItem.partType : 'unknown';
    const vehicleInfo = [r.ourItem.make, r.ourItem.model, r.ourItem.years].filter(Boolean).join(' ') || 'unknown';

    if (r.metrics.count > 0) {
      console.log(`${emoji} ${partInfo} (${vehicleInfo})`);
      console.log(`   Your: $${r.item.price} | Market: $${r.metrics.median.toFixed(2)} (${r.metrics.priceDiffPercent > 0 ? '+' : ''}${r.metrics.priceDiffPercent.toFixed(0)}%) | ${r.metrics.count} comps | ${r.metrics.verdict}`);
    } else {
      console.log(`[?] ${partInfo} (${vehicleInfo})`);
      console.log(`   Your: $${r.item.price} | No relevant market data`);
    }
    console.log('');
  });
}

analyze()
  .then(() => { console.log('Done!'); process.exit(0); })
  .catch(err => { console.error('Error:', err); process.exit(1); });
