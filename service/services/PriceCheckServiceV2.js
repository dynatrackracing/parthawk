/**
 * DARKHAWK — Price Check Service V2 (axios+cheerio edition)
 *
 * Replaces Playwright-based PriceCheckService with axios+cheerio scraper.
 * No Chromium needed, no OOM risk. Same pipeline.
 *
 * Pipeline:
 *   1. buildSearchQuery(title) → structured eBay search query
 *   2. scrapeSoldComps(query) → raw sold items from eBay
 *   3. filterRelevantItems(ourItem, scrapedItems) → only matching comps
 *   4. calculateMetrics(filtered, yourPrice) → verdict
 *
 * Usage:
 *   const priceCheck = require('./PriceCheckServiceV2');
 *   const result = await priceCheck.check(title, currentPrice);
 *
 * Dependencies: axios, cheerio (already in DarkHawk)
 */

'use strict';

const axios = require('axios');
const cheerio = require('cheerio');
const { buildSearchQuery, filterRelevantItems } = require('../scripts/smart-query-builder');

const EBAY_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Accept-Encoding': 'gzip, deflate, br',
};

/**
 * Scrape sold items from eBay search results using axios+cheerio.
 */
async function scrapeSoldComps(searchQuery, maxPages = 1) {
  const allItems = [];

  for (let page = 1; page <= maxPages; page++) {
    const url = `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(searchQuery)}&_sacat=6030&LH_Sold=1&LH_Complete=1&_sop=13&_ipg=60&_pgn=${page}`;

    try {
      const response = await axios.get(url, { headers: EBAY_HEADERS, timeout: 15000 });
      const $ = cheerio.load(response.data);
      const seen = new Set();

      // 2024+ eBay layout uses .s-card, not .s-item
      // Try both: ul.srp-results > li (card containers) and .s-item (legacy)
      $('ul.srp-results > li').each((_, el) => {
        try {
          const $el = $(el);
          // Card-based title
          let title = $el.find('.s-card__title').first().text().trim();
          if (!title) title = $el.find('.s-item__title').first().text().trim();
          title = title.replace(/Opens in a new window or tab$/i, '').trim();
          if (!title || title === 'Shop on eBay' || title === 'Results matching fewer words') return;

          // Card-based price
          let priceText = $el.find('.s-card__price').first().text().trim();
          if (!priceText) priceText = $el.find('.s-item__price').first().text().trim();
          const priceMatch = priceText.match(/\$([\d,]+\.?\d*)/);
          if (!priceMatch) return;
          const price = parseFloat(priceMatch[1].replace(',', ''));
          if (isNaN(price) || price <= 0) return;

          // Sold date
          const innerText = $el.text() || '';
          const soldMatch = innerText.match(/Sold\s+(\w+\s+\d+,?\s*\d*)/i);
          const soldDateText = soldMatch ? soldMatch[1] : null;

          const key = title.substring(0, 50) + price;
          if (seen.has(key)) return;
          seen.add(key);

          allItems.push({ title, price, soldDate: soldDateText || null });
        } catch (e) { /* skip */ }
      });

      // Fallback: parse from raw HTML/JSON if cheerio selectors fail
      if (allItems.length === 0 && page === 1) {
        const html = response.data;
        const itemRegex = /"title":"([^"]+)"/g;
        const priceRegex = /"price":{"value":"([\d.]+)"/g;
        const titles = [], prices = [];
        let m;
        while ((m = itemRegex.exec(html)) !== null) titles.push(m[1]);
        while ((m = priceRegex.exec(html)) !== null) prices.push(parseFloat(m[1]));
        const count = Math.min(titles.length, prices.length);
        for (let i = 0; i < count && i < 60; i++) {
          if (titles[i] && prices[i] > 0) allItems.push({ title: titles[i], price: prices[i], soldDate: null });
        }
      }
    } catch (err) {
      console.error(`Price check scrape error (page ${page}):`, err.message);
    }
  }

  return allItems;
}

/**
 * Calculate pricing metrics from filtered comps.
 */
function calculateMetrics(items, yourPrice) {
  if (items.length === 0) {
    return { count: 0, message: 'No comparable items found', verdict: 'NO_DATA' };
  }

  const prices = items.map(i => i.price).sort((a, b) => a - b);
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
  else verdict = 'AT MARKET';

  return {
    count,
    avg: Math.round(avg * 100) / 100,
    median: Math.round(median * 100) / 100,
    min, max,
    salesPerWeek: Math.round(salesPerWeek * 10) / 10,
    priceDiffPercent: Math.round(priceDiffPercent * 10) / 10,
    verdict,
    suggestedPrice: Math.round(median * 100) / 100,
  };
}

/**
 * Full price check pipeline.
 */
async function check(title, currentPrice) {
  const queryResult = buildSearchQuery(title);
  let scraped = await scrapeSoldComps(queryResult.query);

  // Retry once after 3s if eBay rate-limited us (0 results)
  if (scraped.length === 0) {
    await new Promise(r => setTimeout(r, 3000));
    scraped = await scrapeSoldComps(queryResult.query);
  }

  let filtered;
  if (queryResult.structured && queryResult.parts.partType) {
    const result = filterRelevantItems(queryResult.parts, scraped);
    filtered = result.items;
  } else {
    filtered = scraped;
  }

  const metrics = calculateMetrics(filtered, currentPrice);
  const topComps = filtered.slice(0, 5).map(item => ({
    title: item.title, price: item.price, soldDate: item.soldDate,
    relevanceScore: item.relevance?.score || null,
  }));

  return {
    searchQuery: queryResult.query,
    parts: queryResult.parts,
    structured: queryResult.structured,
    metrics, topComps,
    totalScraped: scraped.length,
    relevantCount: filtered.length,
    yourPrice: currentPrice,
  };
}

/**
 * Batch price check for multiple listings.
 */
async function batchCheck(listings, delayMs = 2000) {
  const results = [];
  for (let i = 0; i < listings.length; i++) {
    const listing = listings[i];
    try {
      const result = await check(listing.title, listing.price);
      results.push({ id: listing.id, ...result });
    } catch (err) {
      results.push({ id: listing.id, error: err.message, verdict: 'ERROR' });
    }
    if (i < listings.length - 1) await new Promise(r => setTimeout(r, delayMs));
  }
  return results;
}

/**
 * Quick market value lookup — just median + count, no full pipeline.
 */
async function quickMarketValue(title) {
  const queryResult = buildSearchQuery(title);
  const scraped = await scrapeSoldComps(queryResult.query);

  let items = scraped;
  if (queryResult.structured && queryResult.parts.partType) {
    const result = filterRelevantItems(queryResult.parts, scraped);
    items = result.items;
  }

  if (items.length === 0) return { medianPrice: null, soldCount: 0, confidence: 'none' };

  const prices = items.map(i => i.price).sort((a, b) => a - b);
  const median = prices.length % 2 === 0
    ? (prices[prices.length / 2 - 1] + prices[prices.length / 2]) / 2
    : prices[Math.floor(prices.length / 2)];

  return {
    medianPrice: Math.round(median * 100) / 100,
    soldCount: items.length,
    confidence: items.length >= 10 ? 'high' : items.length >= 5 ? 'medium' : 'low',
  };
}

module.exports = { check, batchCheck, quickMarketValue, scrapeSoldComps, calculateMetrics };
