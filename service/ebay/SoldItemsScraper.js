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
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
];

/**
 * SoldItemsScraper - Scrapes eBay's sold items pages for market intelligence
 * Uses playwright-extra with stealth plugin to avoid bot detection
 */
class SoldItemsScraper {
  constructor() {
    this.log = log.child({ class: 'SoldItemsScraper' }, true);
    this.browser = null;
  }

  /**
   * Get a random user agent
   */
  getRandomUserAgent() {
    return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
  }

  /**
   * Random delay between requests (2-4 seconds)
   */
  async randomDelay() {
    const delay = 2000 + Math.random() * 2000;
    await new Promise(resolve => setTimeout(resolve, delay));
  }

  /**
   * Initialize the browser with stealth mode
   */
  async initBrowser() {
    if (!this.browser) {
      this.log.info('Launching stealth browser');
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
    return this.browser;
  }

  /**
   * Close the browser
   */
  async closeBrowser() {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
  }

  /**
   * Build the eBay sold items search URL
   * @param {Object} options
   * @param {string} options.seller - Seller username (optional)
   * @param {string} options.keywords - Search keywords (optional)
   * @param {string} options.categoryId - Category ID (default: 35596 for ECU)
   * @param {number} options.pageNumber - Page number (default: 1)
   */
  buildSearchUrl({ seller, keywords, categoryId = '0', pageNumber = 1 }) {
    const baseUrl = 'https://www.ebay.com/sch/i.html';
    const params = new URLSearchParams();

    // Add seller filter if specified
    if (seller) {
      params.set('_ssn', seller);
    }

    // Add keywords if specified
    if (keywords) {
      params.set('_nkw', keywords);
    }

    params.set('LH_Sold', '1'); // Sold items only
    params.set('LH_Complete', '1'); // Completed listings
    params.set('_sop', '13'); // Sort by end date: recent first

    // Only add category if it's a real category (not '0' or empty)
    if (categoryId && categoryId !== '0') {
      params.set('_sacat', categoryId);
    }

    params.set('_pgn', pageNumber.toString());
    params.set('_ipg', '60'); // Items per page

    return `${baseUrl}?${params.toString()}`;
  }

  /**
   * Scrape sold items by keyword search
   * Useful for finding competitors and market data for specific parts
   * @param {Object} options
   * @param {string} options.keywords - Search keywords
   * @param {string} options.categoryId - Category ID (default: 35596)
   * @param {number} options.maxPages - Maximum pages to scrape (default: 5)
   */
  async scrapeSoldItemsByKeywords({ keywords, categoryId = '35596', maxPages = 5 }) {
    this.log.info({ keywords, categoryId, maxPages }, 'Scraping sold items by keywords');

    const allItems = [];
    let pageNumber = 1;
    let hasMorePages = true;

    try {
      await this.initBrowser();
      const context = await this.browser.newContext({
        userAgent: this.getRandomUserAgent(),
        viewport: { width: 1920, height: 1080 },
        locale: 'en-US',
        timezoneId: 'America/New_York',
      });

      const page = await context.newPage();

      await page.setExtraHTTPHeaders({
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
      });

      while (hasMorePages && pageNumber <= maxPages) {
        const url = this.buildSearchUrl({ keywords, categoryId, pageNumber });
        this.log.info({ url, pageNumber }, 'Scraping keyword search page');

        try {
          await page.goto(url, { waitUntil: 'load', timeout: 60000 });
          await page.waitForTimeout(5000);

          // Scroll to trigger lazy loading
          await page.evaluate(() => window.scrollTo(0, 500));
          await page.waitForTimeout(1000);
          await page.evaluate(() => window.scrollTo(0, 1000));
          await page.waitForTimeout(2000);

          try {
            await page.waitForSelector('ul.srp-results, .srp-river-results, li.s-item, li.s-card', { timeout: 15000 });
          } catch (e) {
            this.log.warn({ pageNumber }, 'Results not found');
          }

          // Extract items
          const items = await this.extractItemsFromPage(page, null);
          this.log.info({ pageNumber, itemCount: items.length }, 'Extracted items from keyword search');

          if (items.length === 0) {
            hasMorePages = false;
          } else {
            allItems.push(...items);
            pageNumber++;

            if (hasMorePages && pageNumber <= maxPages) {
              await this.randomDelay();
            }
          }
        } catch (pageError) {
          this.log.error({ err: pageError, pageNumber }, 'Error scraping keyword page');
          pageNumber++;
          await this.randomDelay();
        }
      }

      await context.close();
    } catch (err) {
      this.log.error({ err }, 'Error in keyword scraping process');
      throw err;
    }

    this.log.info({ keywords, totalItems: allItems.length }, 'Completed scraping by keywords');
    return allItems;
  }

  /**
   * Scrape sold items for a seller (all pages)
   * Note: Seller-only searches may not return results in eBay's new layout.
   * Consider using scrapeSoldItemsByKeywords for better results.
   * @param {Object} options
   * @param {string} options.seller - Seller username
   * @param {string} options.keywords - Search keywords (recommended for better results)
   * @param {string} options.categoryId - Category ID (default: 35596)
   * @param {number} options.maxPages - Maximum pages to scrape (default: 10)
   */
  async scrapeSoldItems({ seller, keywords, categoryId = '35596', maxPages = 10 }) {
    this.log.info({ seller, keywords, categoryId, maxPages }, 'Starting to scrape sold items with stealth browser');

    // Warn if no keywords provided - eBay's new layout may not show results
    if (!keywords) {
      this.log.warn({ seller }, 'No keywords provided - eBay may not return results for seller-only searches')
    }

    const allItems = [];
    let pageNumber = 1;
    let hasMorePages = true;

    try {
      await this.initBrowser();
      const context = await this.browser.newContext({
        userAgent: this.getRandomUserAgent(),
        viewport: { width: 1920, height: 1080 },
        locale: 'en-US',
        timezoneId: 'America/New_York',
      });

      const page = await context.newPage();

      // Add some human-like behavior
      await page.setExtraHTTPHeaders({
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
      });

      while (hasMorePages && pageNumber <= maxPages) {
        const url = this.buildSearchUrl({ seller, keywords, categoryId, pageNumber });
        this.log.info({ url, pageNumber }, 'Scraping page');

        try {
          // Navigate with extended timeout, wait for full load
          await page.goto(url, { waitUntil: 'load', timeout: 60000 });

          // Wait for JavaScript to render content
          await page.waitForTimeout(5000);

          // Check if we hit bot detection
          const pageContent = await page.content();
          if (pageContent.includes('Checking your browser') || pageContent.includes('Please verify')) {
            this.log.warn({ pageNumber }, 'Bot detection triggered, waiting and retrying...');
            await page.waitForTimeout(5000);
            await page.reload({ waitUntil: 'load' });
            await page.waitForTimeout(5000);
          }

          // Scroll to trigger lazy loading
          await page.evaluate(() => window.scrollTo(0, 500));
          await page.waitForTimeout(1000);
          await page.evaluate(() => window.scrollTo(0, 1000));
          await page.waitForTimeout(2000);

          // Wait for results container — try both layouts
          try {
            await page.waitForSelector('ul.srp-results, .srp-river-results, li.s-item, li.s-card', { timeout: 15000 });
          } catch (e) {
            this.log.warn({ pageNumber }, 'Results selector not found, page may be empty or blocked');
            // Log what we actually got for debugging
            const bodyText = await page.evaluate(() => document.body?.innerText?.substring(0, 500) || '');
            this.log.warn({ pageNumber, bodySnippet: bodyText }, 'Page body preview');
          }

          // Detect which layout eBay served
          const layoutInfo = await page.evaluate(() => {
            const sCardCount = document.querySelectorAll('li.s-card').length;
            const sItemCount = document.querySelectorAll('li.s-item').length;
            const totalLi = document.querySelectorAll('ul.srp-results > li').length;
            return { sCardCount, sItemCount, totalLi };
          });
          this.log.info({ pageNumber, ...layoutInfo }, 'eBay layout detected');

          // Extract items from page
          const items = await this.extractItemsFromPage(page, seller);
          this.log.info({ pageNumber, itemCount: items.length }, 'Extracted items from page');

          if (items.length === 0) {
            hasMorePages = false;
          } else {
            allItems.push(...items);
            pageNumber++;

            // Random delay between pages
            if (hasMorePages && pageNumber <= maxPages) {
              await this.randomDelay();
            }
          }
        } catch (pageError) {
          this.log.error({ err: pageError, pageNumber }, 'Error scraping page');
          // Continue to next page on error
          pageNumber++;
          await this.randomDelay();
        }
      }

      await context.close();
    } catch (err) {
      this.log.error({ err }, 'Error in scraping process');
      throw err;
    }

    this.log.info({ seller, totalItems: allItems.length }, 'Completed scraping sold items');
    return allItems;
  }

  /**
   * Extract sold items from a page
   * Handles BOTH eBay layouts: new .s-card__* (2024+) and old .s-item__* (legacy)
   * eBay serves both layouts depending on the page/region/A-B test.
   * @param {Page} page - Playwright page object
   * @param {string} seller - Seller username for reference
   */
  async extractItemsFromPage(page, seller) {
    return await page.evaluate((sellerName) => {
      const items = [];

      // eBay uses ul.srp-results > li for both layouts
      const listings = document.querySelectorAll('ul.srp-results > li');

      listings.forEach((listing) => {
        try {
          // Find the link to get item ID — generic selector works for both layouts
          const linkEl = listing.querySelector('a.s-card__link') ||
                         listing.querySelector('a.s-item__link') ||
                         listing.querySelector('a.su-link') ||
                         listing.querySelector('a[href*="/itm/"]');
          if (!linkEl) return;

          const href = linkEl.getAttribute('href') || '';
          const itemIdMatch = href.match(/\/itm\/(\d+)/);
          const ebayItemId = itemIdMatch ? itemIdMatch[1] : null;

          // Skip promotional items and items without valid ID
          if (!ebayItemId || ebayItemId === '123456') return;

          // Title — new layout first, then old layout fallback
          const titleEl = listing.querySelector('.s-card__title span') ||
                          listing.querySelector('.s-card__title') ||
                          listing.querySelector('.s-item__title') ||
                          listing.querySelector('.su-card-container__header') ||
                          listing.querySelector('a[href*="/itm/"]');
          let title = titleEl?.textContent?.trim() || '';
          title = title.replace(/Opens in a new window or tab$/i, '').trim();
          title = title.replace(/^New Listing\s*/i, '').trim();

          // Price — new layout first, then old layout fallback
          const priceEl = listing.querySelector('.s-card__price') ||
                          listing.querySelector('.s-item__price') ||
                          listing.querySelector('[class*="price"]');
          let priceText = priceEl?.textContent?.trim() || '';
          if (priceText.includes(' to ')) {
            priceText = priceText.split(' to ')[0];
          }
          const soldPrice = parseFloat(priceText.replace(/[^0-9.]/g, '')) || 0;

          if (soldPrice === 0) return;

          // Condition/subtitle — new layout first, then old layout fallback
          const conditionEl = listing.querySelector('.s-card__subtitle span') ||
                             listing.querySelector('.s-card__subtitle') ||
                             listing.querySelector('.s-item__subtitle') ||
                             listing.querySelector('.SECONDARY_INFO');
          const condition = conditionEl?.textContent?.trim() || '';

          // Image — check data-src first (lazy loading), then src
          const imgEl = listing.querySelector('img.s-card__image') ||
                        listing.querySelector('.s-item__image-img') ||
                        listing.querySelector('.s-card__media-wrapper img') ||
                        listing.querySelector('img');
          const pictureUrl = imgEl?.getAttribute('data-src') || imgEl?.getAttribute('src') || '';

          // Sold date — try multiple patterns eBay uses across layouts
          let soldDate = null;
          const listingText = listing.textContent || '';
          // Pattern 1: "Sold Mar 15, 2026" or "Sold Mar 15 2026"
          // Pattern 2: "Sold 15 Mar 2026" (international format)
          // Pattern 3: "Sold 03/15/2026" or "Sold 3/15/2026"
          const datePatterns = [
            /Sold\s+([A-Za-z]{3,9}\s+\d{1,2},?\s+\d{4})/,
            /Sold\s+(\d{1,2}\s+[A-Za-z]{3,9},?\s+\d{4})/,
            /Sold\s+(\d{1,2}\/\d{1,2}\/\d{4})/,
          ];
          for (const pat of datePatterns) {
            const m = listingText.match(pat);
            if (m) {
              const parsed = new Date(m[1]);
              if (!isNaN(parsed.getTime())) { soldDate = parsed.toISOString(); break; }
            }
          }
          // Fallback: check for date-like elements (eBay sometimes puts date in a span)
          if (!soldDate) {
            const dateEl = listing.querySelector('.s-card__endedDate') ||
                           listing.querySelector('.s-item__endedDate') ||
                           listing.querySelector('[class*="endedDate"]') ||
                           listing.querySelector('[class*="sold-date"]');
            if (dateEl) {
              const parsed = new Date(dateEl.textContent.replace(/^Sold\s*/i, '').trim());
              if (!isNaN(parsed.getTime())) soldDate = parsed.toISOString();
            }
          }

          // Seller info — extract from listing if scraping keyword search (no seller filter)
          let itemSeller = sellerName;
          if (!itemSeller) {
            const sellerEl = listing.querySelector('.s-card__seller-info') ||
                            listing.querySelector('.s-item__seller-info-text') ||
                            listing.querySelector('[class*="seller"]');
            if (sellerEl) {
              const sellerText = sellerEl.textContent?.trim() || '';
              const sellerMatch = sellerText.match(/(?:from\s+|by\s+)?(\S+)/i);
              if (sellerMatch) itemSeller = sellerMatch[1];
            }
          }

          items.push({
            ebayItemId,
            title,
            soldPrice,
            soldDate,
            condition,
            pictureUrl,
            seller: itemSeller,
          });
        } catch (err) {
          console.error('Error parsing listing:', err);
        }
      });

      return items;
    }, seller);
  }

  /**
   * Parse items from HTML string (for testing with fixtures)
   * @param {string} html - HTML string
   */
  parseItemsFromHtml(html) {
    // This is a simplified version for testing
    // In production, we use Playwright's evaluate
    const items = [];
    const itemRegex = /\/itm\/(\d+)/g;
    let match;
    while ((match = itemRegex.exec(html)) !== null) {
      items.push({ ebayItemId: match[1] });
    }
    return items;
  }

  /**
   * Scrape sold items from multiple sellers
   * @param {Array<string>} sellers - Array of seller usernames
   * @param {Object} options
   * @param {string} options.categoryId - Category ID
   * @param {number} options.maxPagesPerSeller - Max pages per seller
   */
  async scrapeMultipleSellers(sellers, { categoryId = '35596', maxPagesPerSeller = 5 } = {}) {
    const allItems = [];

    try {
      await this.initBrowser();

      for (const seller of sellers) {
        try {
          const items = await this.scrapeSoldItems({
            seller,
            categoryId,
            maxPages: maxPagesPerSeller,
          });
          allItems.push(...items);

          // Delay between sellers
          await this.randomDelay();
        } catch (err) {
          this.log.error({ err, seller }, 'Error scraping seller, continuing to next');
        }
      }
    } finally {
      await this.closeBrowser();
    }

    return allItems;
  }
}

module.exports = SoldItemsScraper;
