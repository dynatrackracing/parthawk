'use strict';

const { log } = require('../lib/logger');
const SoldItemsScraper = require('../ebay/SoldItemsScraper');
const TradingAPI = require('../ebay/TradingAPI');
const SoldItemSeller = require('../models/SoldItemSeller');
const SoldItem = require('../models/SoldItem');
const Promise = require('bluebird');
const { v4: uuidv4 } = require('uuid');

// All categories for competitor intel (not just ECU)
const DEFAULT_CATEGORY_ID = '0';

/**
 * SoldItemsManager - Fetches sold items via Playwright scraping and stores them.
 * FindingsAPI removed (decommissioned Feb 2025). Pure scraper now.
 */
class SoldItemsManager {
  constructor() {
    this.log = log.child({ class: 'SoldItemsManager' }, true);
    this.scraper = new SoldItemsScraper();
    this.tradingAPI = new TradingAPI();
  }

  /**
   * Scrape sold items from all enabled competitors
   * @param {Object} options
   * @param {string} options.categoryId - Category ID (default: 35596)
   * @param {number} options.maxPagesPerSeller - Max pages per seller (default: 5)
   * @param {boolean} options.enrichCompatibility - Whether to fetch compatibility data (default: false, slow)
   */
  async scrapeAllCompetitors({ categoryId = DEFAULT_CATEGORY_ID, maxPagesPerSeller = 5, enrichCompatibility = false } = {}) {
    this.log.info({ categoryId, maxPagesPerSeller, enrichCompatibility }, 'Starting to scrape all competitors');

    // Get enabled sellers from SoldItemSeller table
    const sellers = await SoldItemSeller.query().where('enabled', true);
    this.log.info({ sellerCount: sellers.length }, 'Found enabled sellers');

    if (sellers.length === 0) {
      this.log.warn('No enabled sellers found for sold items scraping');
      return { scraped: 0, stored: 0, errors: 0 };
    }

    const results = {
      scraped: 0,
      stored: 0,
      errors: 0,
      byCompetitor: {},
    };

    try {
      // Scrape each seller
      for (const seller of sellers) {
        try {
          this.log.info({ seller: seller.name }, 'Scraping seller sold items');

          const sellerResult = await this.scrapeCompetitor({
            seller: seller.name,
            categoryId,
            maxPages: maxPagesPerSeller,
            enrichCompatibility,
          });

          results.byCompetitor[seller.name] = sellerResult;
          results.scraped += sellerResult.scraped;
          results.stored += sellerResult.stored;
          results.errors += sellerResult.errors;

          // Update seller stats
          await SoldItemSeller.query()
            .findById(seller.name)
            .patch({
              itemsScraped: seller.itemsScraped + sellerResult.stored,
              lastScrapedAt: new Date(),
            });
        } catch (err) {
          this.log.error({ err, seller: seller.name }, 'Error scraping seller');
          results.byCompetitor[seller.name] = { scraped: 0, stored: 0, errors: 1 };
          results.errors++;
        }
      }
    } finally {
      // Browser cleanup only needed if scraper was used
      try { await this.scraper.closeBrowser(); } catch (e) {}
    }

    this.log.info({ results }, 'Completed scraping all competitors');
    return results;
  }

  /**
   * Scrape sold items from a single seller via Playwright
   * @param {Object} options
   * @param {string} options.seller - Seller username
   * @param {string} options.categoryId - Category ID (default: 0 = all)
   * @param {number} options.maxPages - Max pages to fetch
   * @param {boolean} options.enrichCompatibility - Whether to fetch compatibility data
   */
  async scrapeCompetitor({ seller, categoryId = DEFAULT_CATEGORY_ID, maxPages = 5, enrichCompatibility = false }) {
    this.log.info({ seller, categoryId, maxPages }, 'Scraping seller sold items via Playwright');

    let scraped = 0;
    let stored = 0;
    let errors = 0;

    try {
      let items = [];

      try {
        items = await this.scraper.scrapeSoldItems({
          seller,
          categoryId,
          maxPages,
        });
        this.log.info({ seller, itemCount: items.length }, 'Scraped sold items via Playwright');
        this.log.info({ seller, itemCount: items.length, firstThree: items.slice(0,3).map(i => ({ id: i.ebayItemId, price: i.soldPrice, title: (i.title||'').substring(0,50) })) }, 'DEBUG: raw scraper output');
      } catch (scrapeErr) {
        this.log.error({ err: scrapeErr, seller }, 'Playwright scrape failed');
        items = [];
      }

      scraped = items.length;
      this.log.info({ seller, itemCount: items.length }, 'Fetched sold items from seller');

      // Store items in database, stop early if we hit items we already have
      let consecutiveDupes = 0;
      await Promise.mapSeries(items, async (item) => {
        try {
          if (consecutiveDupes >= 10) return;

          // Skip items without valid ebayItemId
          if (!item.ebayItemId) {
            this.log.warn({ item }, 'Skipping item without ebayItemId');
            errors++;
            return;
          }

          // Price floor: skip items under $100
          const price = parseFloat(item.soldPrice) || 0;
          if (price < 100) {
            return;
          }

          const now = new Date();
          const toInsert = {
            id: uuidv4(),
            ebayItemId: item.ebayItemId,
            title: item.title,
            soldPrice: item.soldPrice,
            // Only use real soldDate from scraper — don't fake it with today's date.
            // If null, use scrapedAt so NOT NULL constraint is satisfied, but scrapedAt
            // matching soldDate signals "estimated" to downstream consumers.
            soldDate: item.soldDate ? new Date(item.soldDate) : now,
            categoryId: categoryId,
            categoryTitle: null,
            seller: item.seller || seller,
            condition: item.condition,
            pictureUrl: item.pictureUrl,
            compatibility: null,
            manufacturerPartNumber: null,
            interchangeNumbers: null,
            scrapedAt: now,
          };

          // Enrich with compatibility data if enabled (slow - makes API call per item)
          if (enrichCompatibility) {
            try {
              const enriched = await this.enrichWithCompatibility(item.ebayItemId);
              if (enriched) {
                toInsert.compatibility = enriched.compatibility;
                toInsert.manufacturerPartNumber = enriched.manufacturerPartNumber;
                toInsert.interchangeNumbers = enriched.interchangeNumbers;
              }
            } catch (enrichErr) {
              this.log.warn({ err: enrichErr, ebayItemId: item.ebayItemId }, 'Error enriching item');
            }
          }

          // Check if we already have this item - track consecutive dupes
          const existing = await SoldItem.query().where('ebayItemId', item.ebayItemId).first();
          if (existing) {
            consecutiveDupes++;
            return;
          }
          consecutiveDupes = 0;

          // Upsert on conflict
          await SoldItem.query()
            .insert(toInsert)
            .onConflict('ebayItemId')
            .merge();

          stored++;
        } catch (itemErr) {
          this.log.error({ err: itemErr, ebayItemId: item.ebayItemId }, 'Error storing item');
          errors++;
        }
      });

      this.log.info({ seller, consecutiveDupes, scraped, stored }, 'Scrape complete, dupes detected');

    } catch (err) {
      this.log.error({ err, seller }, 'Error scraping competitor');
      errors++;
    }

    this.log.info({ seller, scraped, stored, errors }, 'Completed scraping competitor');
    return { scraped, stored, errors };
  }

  /**
   * Enrich an item with compatibility data from eBay Trading API
   * @param {string} ebayItemId - eBay item ID
   */
  async enrichWithCompatibility(ebayItemId) {
    try {
      const response = await this.tradingAPI.makeRequest({
        ebayItemId,
        options: {
          includeItemCompatibility: 'true',
          includeItemSpecifics: 'true',
        },
      });

      const itemResponse = response?.GetItemResponse;
      if (!itemResponse || itemResponse.Ack?.[0] !== 'Success') {
        return null;
      }

      const item = itemResponse.Item?.[0];
      if (!item) return null;

      // Extract manufacturer part number
      let manufacturerPartNumber = null;
      let interchangeNumbers = [];

      const specifics = item.ItemSpecifics?.[0]?.NameValueList || [];
      for (const spec of specifics) {
        const name = spec.Name?.[0];
        const value = spec.Value?.[0];
        if (name === 'Manufacturer Part Number') {
          manufacturerPartNumber = value;
        } else if (name === 'Interchange Part Number') {
          interchangeNumbers.push(value);
        }
      }

      // Extract compatibility
      let compatibility = [];
      const compatList = item.ItemCompatibilityList?.[0]?.Compatibility || [];
      for (const compat of compatList) {
        const compatObj = {};
        const nameValues = compat.NameValueList || [];
        for (const nv of nameValues) {
          const name = nv.Name?.[0]?.toLowerCase();
          const value = nv.Value?.[0];
          if (name && value) {
            compatObj[name] = value;
          }
        }
        if (Object.keys(compatObj).length > 0) {
          compatibility.push(compatObj);
        }
      }

      return {
        compatibility: compatibility.length > 0 ? compatibility : null,
        manufacturerPartNumber,
        interchangeNumbers: interchangeNumbers.length > 0 ? interchangeNumbers : null,
      };
    } catch (err) {
      this.log.warn({ err, ebayItemId }, 'Error fetching compatibility data');
      return null;
    }
  }

  /**
   * Scrape sold items by keywords (market research)
   * Finds what's selling across all sellers for given search terms
   * @param {Object} options
   * @param {string} options.keywords - Search keywords
   * @param {string} options.categoryId - Category ID (default: 35596)
   * @param {number} options.maxPages - Max pages to scrape (default: 5)
   */
  async scrapeByKeywords({ keywords, categoryId = DEFAULT_CATEGORY_ID, maxPages = 5 }) {
    this.log.info({ keywords, categoryId, maxPages }, 'Scraping market sold items by keywords');

    let scraped = 0;
    let stored = 0;
    let errors = 0;

    try {
      const items = await this.scraper.scrapeSoldItemsByKeywords({
        keywords,
        categoryId,
        maxPages,
      });

      scraped = items.length;
      this.log.info({ keywords, itemCount: items.length }, 'Fetched sold items by keywords');

      // Store items in database
      await Promise.mapSeries(items, async (item) => {
        try {
          if (!item.ebayItemId) {
            this.log.warn({ item }, 'Skipping item without ebayItemId');
            errors++;
            return;
          }

          // Price floor: skip items under $100
          const price = parseFloat(item.soldPrice) || 0;
          if (price < 100) {
            return;
          }

          const now = new Date();
          const toInsert = {
            id: uuidv4(),
            ebayItemId: item.ebayItemId,
            title: item.title,
            soldPrice: item.soldPrice,
            soldDate: item.soldDate ? new Date(item.soldDate) : now,
            categoryId: categoryId,
            categoryTitle: null,
            seller: item.seller,
            condition: item.condition,
            pictureUrl: item.pictureUrl,
            compatibility: null,
            manufacturerPartNumber: null,
            interchangeNumbers: null,
            scrapedAt: now,
          };

          await SoldItem.query()
            .insert(toInsert)
            .onConflict('ebayItemId')
            .merge();

          stored++;
        } catch (itemErr) {
          this.log.error({ err: itemErr, ebayItemId: item.ebayItemId }, 'Error storing item');
          errors++;
        }
      });
    } catch (err) {
      this.log.error({ err, keywords }, 'Error scraping by keywords');
      errors++;
    } finally {
      await this.scraper.closeBrowser();
    }

    this.log.info({ keywords, scraped, stored, errors }, 'Completed keyword scraping');
    return { scraped, stored, errors };
  }

  /**
   * Get sold items statistics
   */
  async getStats() {
    const [totalCount, recentCount, topSellers] = await Promise.all([
      SoldItem.query().count('* as count').first(),
      SoldItem.query()
        .where('soldDate', '>=', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000))
        .count('* as count')
        .first(),
      SoldItem.query()
        .select('seller')
        .count('* as count')
        .groupBy('seller')
        .orderBy('count', 'desc')
        .limit(10),
    ]);

    return {
      totalSoldItems: parseInt(totalCount.count, 10),
      soldItemsLast30Days: parseInt(recentCount.count, 10),
      topSellers,
    };
  }
}

module.exports = SoldItemsManager;
