'use strict';

const { log } = require('../lib/logger');
const { chromium } = require('playwright-extra');
const stealth = require('puppeteer-extra-plugin-stealth');

// Apply stealth plugin to avoid bot detection
chromium.use(stealth());

// User agents for rotation
const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:123.0) Gecko/20100101 Firefox/123.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.3 Safari/605.1.15',
];

/**
 * MarketResearchScraper - Comprehensive eBay market research
 *
 * Scrapes both active listings (competitors) and sold items for market intelligence.
 * Does NOT use any eBay API tokens - purely browser-based to avoid attribution.
 *
 * Flow:
 * 1. Search by keywords → get active listings (competitor prices)
 * 2. Apply "Sold Items" filter → get actual sale prices and dates
 */
class MarketResearchScraper {
  constructor() {
    this.log = log.child({ class: 'MarketResearchScraper' }, true);
    this.browser = null;
    this.context = null;
  }

  getRandomUserAgent() {
    return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
  }

  async randomDelay(min = 2000, max = 4000) {
    const delay = min + Math.random() * (max - min);
    await new Promise(resolve => setTimeout(resolve, delay));
  }

  async initBrowser() {
    if (!this.browser) {
      this.log.info('Launching stealth browser for market research');
      this.browser = await chromium.launch({
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas',
          '--disable-gpu',
          '--window-size=1920,1080',
        ],
      });
    }

    if (!this.context) {
      this.context = await this.browser.newContext({
        userAgent: this.getRandomUserAgent(),
        viewport: { width: 1920, height: 1080 },
        locale: 'en-US',
        timezoneId: 'America/New_York',
      });
    }

    return this.browser;
  }

  async closeBrowser() {
    if (this.context) {
      await this.context.close();
      this.context = null;
    }
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
  }

  /**
   * Extract search keywords from a listing title
   * Cleans up the title to create effective search terms
   */
  extractKeywords(title) {
    if (!title) return '';

    // Remove common noise words and special characters
    const noiseWords = [
      'oem', 'genuine', 'new', 'used', 'pre-owned', 'tested', 'working',
      'fits', 'for', 'the', 'and', 'with', 'free', 'shipping', 'fast',
      'warranty', 'day', 'return', 'returns', 'see', 'description',
    ];

    let keywords = title
      .toLowerCase()
      // Keep alphanumeric, spaces, and hyphens
      .replace(/[^a-z0-9\s-]/g, ' ')
      // Normalize spaces
      .replace(/\s+/g, ' ')
      .trim()
      .split(' ')
      // Remove noise words
      .filter(word => word.length > 1 && !noiseWords.includes(word))
      // Take first 8 meaningful words
      .slice(0, 8)
      .join(' ');

    return keywords;
  }

  /**
   * Build search URL for active listings
   */
  buildActiveListingsUrl({ keywords, categoryId = '35596', pageNumber = 1 }) {
    const params = new URLSearchParams({
      _nkw: keywords,
      _sacat: categoryId,
      _sop: '12', // Sort by: Best Match
      _ipg: '60', // Items per page
      _pgn: pageNumber.toString(),
    });
    return `https://www.ebay.com/sch/i.html?${params.toString()}`;
  }

  /**
   * Build search URL for sold items (add LH_Sold and LH_Complete filters)
   */
  buildSoldItemsUrl({ keywords, categoryId = '35596', pageNumber = 1 }) {
    const params = new URLSearchParams({
      _nkw: keywords,
      _sacat: categoryId,
      LH_Sold: '1',
      LH_Complete: '1',
      _sop: '13', // Sort by: End Date (recent first)
      _ipg: '60',
      _pgn: pageNumber.toString(),
    });
    return `https://www.ebay.com/sch/i.html?${params.toString()}`;
  }

  /**
   * Scrape active listings (competitors) for given keywords
   */
  async scrapeActiveListings({ keywords, categoryId = '35596', maxPages = 2 }) {
    this.log.info({ keywords, categoryId, maxPages }, 'Scraping active competitor listings');

    const allItems = [];
    let pageNumber = 1;

    try {
      await this.initBrowser();
      const page = await this.context.newPage();

      await page.setExtraHTTPHeaders({
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      });

      while (pageNumber <= maxPages) {
        const url = this.buildActiveListingsUrl({ keywords, categoryId, pageNumber });
        this.log.info({ url, pageNumber }, 'Scraping active listings page');

        try {
          await page.goto(url, { waitUntil: 'load', timeout: 60000 });
          await page.waitForTimeout(5000);

          // Scroll for lazy loading
          await page.evaluate(() => window.scrollTo(0, 500));
          await page.waitForTimeout(1000);
          await page.evaluate(() => window.scrollTo(0, 1000));
          await page.waitForTimeout(2000);

          const items = await this.extractActiveListings(page, keywords);
          this.log.info({ pageNumber, itemCount: items.length }, 'Extracted active listings');

          if (items.length === 0) break;

          allItems.push(...items);
          pageNumber++;

          if (pageNumber <= maxPages) {
            await this.randomDelay();
          }
        } catch (err) {
          this.log.error({ err, pageNumber }, 'Error scraping active listings page');
          break;
        }
      }

      await page.close();
    } catch (err) {
      this.log.error({ err }, 'Error in active listings scraping');
      throw err;
    }

    return allItems;
  }

  /**
   * Extract active listing data from page
   */
  async extractActiveListings(page, keywords) {
    return await page.evaluate((searchKeywords) => {
      const items = [];
      const listings = document.querySelectorAll('ul.srp-results > li');

      listings.forEach((listing) => {
        try {
          const linkEl = listing.querySelector('a[href*="/itm/"]');
          if (!linkEl) return;

          const href = linkEl.getAttribute('href') || '';
          const itemIdMatch = href.match(/\/itm\/(\d+)/);
          const ebayItemId = itemIdMatch ? itemIdMatch[1] : null;

          if (!ebayItemId || ebayItemId === '123456') return;

          // Title — dual layout: new .s-card, old .s-item
          const titleEl = listing.querySelector('.s-card__title span') ||
                          listing.querySelector('.s-card__title') ||
                          listing.querySelector('.s-item__title') ||
                          listing.querySelector('a[href*="/itm/"]');
          let title = titleEl?.textContent?.trim() || '';
          title = title.replace(/Opens in a new window or tab$/i, '').trim();
          title = title.replace(/^New Listing\s*/i, '').trim();

          // Price — dual layout
          const priceEl = listing.querySelector('.s-card__price') ||
                          listing.querySelector('.s-item__price') ||
                          listing.querySelector('[class*="price"]');
          let priceText = priceEl?.textContent?.trim() || '';
          const currentPrice = parseFloat(priceText.replace(/[^0-9.]/g, '')) || 0;

          // Original price (strikethrough)
          const origPriceEl = listing.querySelector('.s-card__price--original, .s-item__price--original, [class*="STRIKETHROUGH"]');
          let originalPrice = null;
          if (origPriceEl) {
            const origText = origPriceEl.textContent?.trim() || '';
            originalPrice = parseFloat(origText.replace(/[^0-9.]/g, '')) || null;
          }

          if (currentPrice === 0) return;

          // Seller info — dual layout
          const sellerEl = listing.querySelector('.s-card__seller-info') ||
                           listing.querySelector('.s-item__seller-info-text') ||
                           listing.querySelector('[class*="seller"]');
          let seller = null;
          let sellerFeedbackScore = null;
          let sellerFeedbackPercent = null;

          if (sellerEl) {
            const sellerText = sellerEl.textContent?.trim() || '';
            const sellerMatch = sellerText.match(/([a-z0-9_-]+)\s+([\d.]+)%[^(]*\(([\d.]+K?)\)/i);
            if (sellerMatch) {
              seller = sellerMatch[1];
              sellerFeedbackPercent = parseFloat(sellerMatch[2]);
              let scoreStr = sellerMatch[3].replace('K', '000');
              sellerFeedbackScore = parseInt(scoreStr, 10);
            } else {
              const nameMatch = sellerText.match(/^([a-z0-9_-]+)/i);
              if (nameMatch) seller = nameMatch[1];
            }
          }

          // Condition — dual layout
          const conditionEl = listing.querySelector('.s-card__subtitle span') ||
                             listing.querySelector('.s-card__subtitle') ||
                             listing.querySelector('.s-item__subtitle') ||
                             listing.querySelector('.SECONDARY_INFO');
          const condition = conditionEl?.textContent?.trim() || '';

          // Shipping — dual layout
          const shippingEl = listing.querySelector('.s-item__logisticsCost') ||
                             listing.querySelector('.s-item__shipping') ||
                             listing.querySelector('[class*="shipping"]') ||
                             listing.querySelector('[class*="delivery"]');
          const shippingText = shippingEl?.textContent?.toLowerCase() || '';
          const freeShipping = shippingText.includes('free');
          let shippingCost = null;
          if (!freeShipping) {
            const shipMatch = shippingText.match(/\$?([\d.]+)\s*(?:shipping|delivery)/);
            if (shipMatch) shippingCost = parseFloat(shipMatch[1]);
          }

          // Free returns
          const returnsText = listing.textContent?.toLowerCase() || '';
          const freeReturns = returnsText.includes('free returns');

          // Sponsored
          const isSponsored = listing.textContent?.toLowerCase().includes('sponsored') || false;

          // Location
          const locationEl = listing.querySelector('[class*="location"]');
          const location = locationEl?.textContent?.replace('Located in', '').trim() || null;

          // Image — dual layout, prefer data-src for lazy loading
          const imgEl = listing.querySelector('img.s-card__image') ||
                        listing.querySelector('.s-item__image-img') ||
                        listing.querySelector('img');
          const pictureUrl = imgEl?.getAttribute('data-src') || imgEl?.getAttribute('src') || '';

          items.push({
            ebayItemId,
            title,
            currentPrice,
            originalPrice,
            seller,
            sellerFeedbackScore,
            sellerFeedbackPercent,
            condition,
            shippingCost,
            freeShipping,
            freeReturns,
            location,
            isSponsored,
            pictureUrl,
            viewItemUrl: href,
            keywords: searchKeywords,
          });
        } catch (err) {
          console.error('Error parsing active listing:', err);
        }
      });

      return items;
    }, keywords);
  }

  /**
   * Scrape sold items for given keywords
   */
  async scrapeSoldItems({ keywords, categoryId = '35596', maxPages = 3 }) {
    this.log.info({ keywords, categoryId, maxPages }, 'Scraping sold items');

    const allItems = [];
    let pageNumber = 1;

    try {
      await this.initBrowser();
      const page = await this.context.newPage();

      await page.setExtraHTTPHeaders({
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      });

      while (pageNumber <= maxPages) {
        const url = this.buildSoldItemsUrl({ keywords, categoryId, pageNumber });
        this.log.info({ url, pageNumber }, 'Scraping sold items page');

        try {
          await page.goto(url, { waitUntil: 'load', timeout: 60000 });
          await page.waitForTimeout(5000);

          // Scroll for lazy loading
          await page.evaluate(() => window.scrollTo(0, 500));
          await page.waitForTimeout(1000);
          await page.evaluate(() => window.scrollTo(0, 1000));
          await page.waitForTimeout(2000);

          const items = await this.extractSoldItems(page, keywords);
          this.log.info({ pageNumber, itemCount: items.length }, 'Extracted sold items');

          if (items.length === 0) break;

          allItems.push(...items);
          pageNumber++;

          if (pageNumber <= maxPages) {
            await this.randomDelay();
          }
        } catch (err) {
          this.log.error({ err, pageNumber }, 'Error scraping sold items page');
          break;
        }
      }

      await page.close();
    } catch (err) {
      this.log.error({ err }, 'Error in sold items scraping');
      throw err;
    }

    return allItems;
  }

  /**
   * Extract sold item data from page
   */
  async extractSoldItems(page, keywords) {
    return await page.evaluate((searchKeywords) => {
      const items = [];
      const listings = document.querySelectorAll('ul.srp-results > li');

      listings.forEach((listing) => {
        try {
          const linkEl = listing.querySelector('a[href*="/itm/"]');
          if (!linkEl) return;

          const href = linkEl.getAttribute('href') || '';
          const itemIdMatch = href.match(/\/itm\/(\d+)/);
          const ebayItemId = itemIdMatch ? itemIdMatch[1] : null;

          if (!ebayItemId || ebayItemId === '123456') return;

          // Title — dual layout
          const titleEl = listing.querySelector('.s-card__title span') ||
                          listing.querySelector('.s-card__title') ||
                          listing.querySelector('.s-item__title') ||
                          listing.querySelector('a[href*="/itm/"]');
          let title = titleEl?.textContent?.trim() || '';
          title = title.replace(/Opens in a new window or tab$/i, '').trim();
          title = title.replace(/^New Listing\s*/i, '').trim();

          // Sold price — dual layout
          const priceEl = listing.querySelector('.s-card__price') ||
                          listing.querySelector('.s-item__price') ||
                          listing.querySelector('[class*="price"]');
          let priceText = priceEl?.textContent?.trim() || '';
          const soldPrice = parseFloat(priceText.replace(/[^0-9.]/g, '')) || 0;

          // Original price
          const origPriceEl = listing.querySelector('.s-card__price--original, .s-item__price--original, [class*="STRIKETHROUGH"]');
          let originalPrice = null;
          if (origPriceEl) {
            const origText = origPriceEl.textContent?.trim() || '';
            originalPrice = parseFloat(origText.replace(/[^0-9.]/g, '')) || null;
          }

          if (soldPrice === 0) return;

          // Sold date - look for "Sold Jan 16, 2026" pattern
          let soldDate = null;
          const listingText = listing.textContent || '';
          const soldDateMatch = listingText.match(/Sold\s+([A-Za-z]{3}\s+\d{1,2},?\s+\d{4})/);
          if (soldDateMatch) {
            const dateStr = soldDateMatch[1];
            const parsed = new Date(dateStr);
            if (!isNaN(parsed.getTime())) {
              soldDate = parsed.toISOString();
            }
          }

          // Seller info — dual layout
          const sellerEl = listing.querySelector('.s-card__seller-info') ||
                           listing.querySelector('.s-item__seller-info-text') ||
                           listing.querySelector('[class*="seller"]');
          let seller = null;
          let sellerFeedbackScore = null;
          let sellerFeedbackPercent = null;

          if (sellerEl) {
            const sellerText = sellerEl.textContent?.trim() || '';
            const sellerMatch = sellerText.match(/([a-z0-9_-]+)\s+([\d.]+)%[^(]*\(([\d.]+K?)\)/i);
            if (sellerMatch) {
              seller = sellerMatch[1];
              sellerFeedbackPercent = parseFloat(sellerMatch[2]);
              let scoreStr = sellerMatch[3].replace('K', '000');
              sellerFeedbackScore = parseInt(scoreStr, 10);
            } else {
              const nameMatch = sellerText.match(/^([a-z0-9_-]+)/i);
              if (nameMatch) seller = nameMatch[1];
            }
          }

          // Condition — dual layout
          const conditionEl = listing.querySelector('.s-card__subtitle span') ||
                             listing.querySelector('.s-card__subtitle') ||
                             listing.querySelector('.s-item__subtitle') ||
                             listing.querySelector('.SECONDARY_INFO');
          const condition = conditionEl?.textContent?.trim() || '';

          // Shipping
          const shippingText = listing.textContent?.toLowerCase() || '';
          const freeShipping = shippingText.includes('free delivery') || shippingText.includes('free shipping');
          let shippingCost = null;
          const shipMatch = shippingText.match(/\+\s*\$?([\d.]+)\s*(?:shipping|delivery)/);
          if (shipMatch) shippingCost = parseFloat(shipMatch[1]);

          // Location
          const locationMatch = listingText.match(/Located in\s+([^·\n]+)/i);
          const location = locationMatch ? locationMatch[1].trim() : null;

          // Image — dual layout, prefer data-src
          const imgEl = listing.querySelector('img.s-card__image') ||
                        listing.querySelector('.s-item__image-img') ||
                        listing.querySelector('img');
          const pictureUrl = imgEl?.getAttribute('data-src') || imgEl?.getAttribute('src') || '';

          items.push({
            ebayItemId,
            title,
            soldPrice,
            originalPrice,
            soldDate,
            seller,
            sellerFeedbackScore,
            sellerFeedbackPercent,
            condition,
            shippingCost,
            freeShipping,
            location,
            pictureUrl,
            viewItemUrl: href,
            keywords: searchKeywords,
          });
        } catch (err) {
          console.error('Error parsing sold item:', err);
        }
      });

      return items;
    }, keywords);
  }

  /**
   * Full market research for a set of keywords
   * Returns both active listings and sold items
   */
  async fullMarketResearch({ keywords, categoryId = '35596', maxActivePages = 2, maxSoldPages = 3 }) {
    this.log.info({ keywords, categoryId }, 'Starting full market research');

    try {
      await this.initBrowser();

      // Scrape active listings
      const activeListings = await this.scrapeActiveListings({
        keywords,
        categoryId,
        maxPages: maxActivePages,
      });

      await this.randomDelay(3000, 5000);

      // Scrape sold items
      const soldItems = await this.scrapeSoldItems({
        keywords,
        categoryId,
        maxPages: maxSoldPages,
      });

      this.log.info({
        keywords,
        activeListings: activeListings.length,
        soldItems: soldItems.length,
      }, 'Completed full market research');

      return {
        activeListings,
        soldItems,
      };
    } catch (err) {
      this.log.error({ err, keywords }, 'Error in full market research');
      throw err;
    }
  }
}

module.exports = MarketResearchScraper;
