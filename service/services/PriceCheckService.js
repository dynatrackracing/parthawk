'use strict';

const path = require('path');
// Use default Playwright browser path (system-installed) — don't override to .pw-browsers
const { chromium } = require('playwright-extra');
const stealth = require('puppeteer-extra-plugin-stealth');
chromium.use(stealth());

const { buildSearchQuery } = require('../scripts/smart-query-builder');
const { filterRelevantItems } = require('../scripts/relevance-scorer');
const PriceCheck = require('../models/PriceCheck');

// Persistent browser + page — launch once, reuse across all requests
let _browser = null;
let _page = null;

async function getPage() {
  if (_page && !_page.isClosed()) {
    return _page;
  }
  if (!_browser || !_browser.isConnected()) {
    _browser = await chromium.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
      ],
    });
    _browser.on('disconnected', () => { _browser = null; _page = null; });
  }
  const context = await _browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 720 },
  });
  _page = await context.newPage();
  return _page;
}

class PriceCheckService {
  /**
   * Check price for a listing, using cache if available
   */
  async checkPrice(listingId, title, currentPrice, forceRefresh = false) {
    // Check cache first (unless force refresh)
    if (!forceRefresh && listingId) {
      const cached = await PriceCheck.getRecent(listingId);
      if (cached) {
        return {
          cached: true,
          checkedAt: cached.checkedAt,
          ...this.formatResult(cached),
        };
      }
    }

    // Run the pipeline
    const result = await this.runPipeline(title, currentPrice);

    // Save to cache
    if (listingId) {
      await PriceCheck.saveCheck(listingId, title, currentPrice, result);
    }

    return {
      cached: false,
      checkedAt: new Date(),
      ...result,
    };
  }

  /**
   * Run the full price check pipeline
   */
  async runPipeline(title, yourPrice) {
    // 1. Build search query
    const queryResult = buildSearchQuery(title);
    const searchQuery = queryResult.query;
    const parts = queryResult.parts;

    // 2. Scrape sold items
    const scrapedItems = await this.scrapeSoldItems(searchQuery);

    // 3. Filter for relevance — SKIP if this was a PN search
    let filtered;
    if (queryResult.pnSearch) {
      filtered = { items: scrapedItems, total: scrapedItems.length, relevant: scrapedItems.length, filtered: 0 };
    } else {
      const ourItem = {
        title,
        make: parts.make,
        model: parts.model,
        years: parts.years,
        partType: parts.partType,
      };
      filtered = filterRelevantItems(ourItem, scrapedItems);
    }

    // 4. Calculate metrics
    const metrics = this.calculateMetrics(filtered.items, yourPrice);

    // 5. Get top comps
    const topComps = filtered.items.slice(0, 5).map(item => ({
      title: item.title,
      price: item.price,
      soldDate: item.soldDate,
      score: item.relevance?.score,
    }));

    return {
      searchQuery,
      parts,
      metrics,
      topComps,
      totalScraped: scrapedItems.length,
      relevantCount: filtered.relevant,
      avgScore: filtered.avgScore,
    };
  }

  /**
   * Scrape sold items from eBay using a persistent page to minimize memory.
   * If the page crashes, reset and retry once.
   */
  async scrapeSoldItems(searchQuery) {
    try {
      return await this._doScrape(searchQuery);
    } catch (err) {
      // Page/browser crashed — reset everything and retry
      _page = null;
      if (_browser) {
        try { await _browser.close(); } catch (e) {}
        _browser = null;
      }
      return this._doScrape(searchQuery);
    }
  }

  async _doScrape(searchQuery) {
    const page = await getPage();
    const url = `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(searchQuery)}&_sacat=6030&LH_Sold=1&LH_Complete=1&_sop=13&_ipg=60`;

    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(2000);
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(1000);

    return page.evaluate(() => {
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
  }

  /**
   * Calculate pricing metrics
   */
  calculateMetrics(items, yourPrice) {
    if (items.length === 0) {
      return { count: 0, message: 'No comparable items found' };
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
    else verdict = 'MARKET PRICE';

    return { count, avg, median, min, max, salesPerWeek, priceDiffPercent, verdict };
  }

  /**
   * Format cached result to match pipeline output
   */
  formatResult(cached) {
    return {
      searchQuery: cached.searchQuery,
      parts: {
        partType: cached.partType,
        make: cached.make,
        model: cached.model,
        years: cached.years,
      },
      metrics: {
        count: cached.compCount,
        median: parseFloat(cached.marketMedian),
        min: parseFloat(cached.marketMin),
        max: parseFloat(cached.marketMax),
        avg: parseFloat(cached.marketAvg),
        salesPerWeek: parseFloat(cached.salesPerWeek),
        priceDiffPercent: parseFloat(cached.priceDiffPercent),
        verdict: cached.verdict,
      },
      topComps: typeof cached.topComps === 'string' ? JSON.parse(cached.topComps) : cached.topComps,
      yourPrice: parseFloat(cached.yourPrice),
    };
  }
}

module.exports = new PriceCheckService();
