'use strict';

const { log } = require('../lib/logger');
const { v4: uuidv4 } = require('uuid');
const Promise = require('bluebird');
const MarketResearchScraper = require('../ebay/MarketResearchScraper');
const MarketResearchRun = require('../models/MarketResearchRun');
const CompetitorListing = require('../models/CompetitorListing');
const SoldItem = require('../models/SoldItem');
const YourListing = require('../models/YourListing');
const PriceSnapshot = require('../models/PriceSnapshot');

/**
 * MarketResearchManager - Orchestrates market research for inventory items
 *
 * Flow:
 * 1. Get inventory items from your_listing
 * 2. Extract keywords from each listing title
 * 3. Search eBay for active listings (competitors) and sold items
 * 4. Store all data linked to the original inventory item
 * 5. Calculate price statistics for ML training
 */
class MarketResearchManager {
  constructor() {
    this.log = log.child({ class: 'MarketResearchManager' }, true);
    this.scraper = new MarketResearchScraper();
  }

  /**
   * Run market research for all inventory items
   * @param {Object} options
   * @param {number} options.limit - Max items to process (default: 100)
   * @param {number} options.maxActivePages - Max pages of active listings per item
   * @param {number} options.maxSoldPages - Max pages of sold items per item
   * @param {string} options.categoryId - eBay category ID
   */
  async researchAllInventory({ limit = 100, maxActivePages = 2, maxSoldPages = 3, categoryId = '35596' } = {}) {
    this.log.info({ limit, maxActivePages, maxSoldPages, categoryId }, 'Starting market research for inventory');

    // Get inventory items that haven't been researched recently
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const listings = await YourListing.query()
      .whereNotExists(
        MarketResearchRun.query()
          .whereColumn('MarketResearchRun.yourListingId', 'YourListing.id')
          .where('MarketResearchRun.createdAt', '>', oneDayAgo)
      )
      .limit(limit)
      .orderBy('createdAt', 'desc');

    this.log.info({ listingCount: listings.length }, 'Found inventory items to research');

    if (listings.length === 0) {
      return { processed: 0, activeListings: 0, soldItems: 0, errors: 0 };
    }

    const results = {
      processed: 0,
      activeListings: 0,
      soldItems: 0,
      errors: 0,
    };

    try {
      for (const listing of listings) {
        try {
          const research = await this.researchSingleItem({
            listing,
            maxActivePages,
            maxSoldPages,
            categoryId,
          });

          results.processed++;
          results.activeListings += research.activeListings;
          results.soldItems += research.soldItems;

          // Delay between items to avoid detection
          await this.scraper.randomDelay(5000, 8000);
        } catch (err) {
          this.log.error({ err, listingId: listing.id }, 'Error researching item');
          results.errors++;
        }
      }
    } finally {
      await this.scraper.closeBrowser();
    }

    this.log.info({ results }, 'Completed market research for inventory');
    return results;
  }

  /**
   * Research a single inventory item
   */
  async researchSingleItem({ listing, maxActivePages = 2, maxSoldPages = 3, categoryId = '35596' }) {
    const keywords = this.scraper.extractKeywords(listing.title);

    if (!keywords || keywords.length < 5) {
      this.log.warn({ listingId: listing.id, title: listing.title }, 'Could not extract meaningful keywords');
      return { activeListings: 0, soldItems: 0 };
    }

    this.log.info({ listingId: listing.id, keywords }, 'Researching inventory item');

    // Create research run record
    const run = await MarketResearchRun.query().insert({
      id: uuidv4(),
      yourListingId: listing.id,
      keywords,
      status: 'running',
      startedAt: new Date(),
    });

    try {
      // Run full market research
      const research = await this.scraper.fullMarketResearch({
        keywords,
        categoryId,
        maxActivePages,
        maxSoldPages,
      });

      // Store active listings
      const activeCount = await this.storeActiveListings({
        listings: research.activeListings,
        runId: run.id,
        yourListingId: listing.id,
      });

      // Store sold items
      const soldCount = await this.storeSoldItems({
        items: research.soldItems,
        runId: run.id,
        yourListingId: listing.id,
      });

      // Update run status
      await MarketResearchRun.query()
        .findById(run.id)
        .patch({
          status: 'completed',
          completedAt: new Date(),
          activeListingsFound: activeCount,
          soldItemsFound: soldCount,
        });

      this.log.info({
        listingId: listing.id,
        keywords,
        activeCount,
        soldCount,
      }, 'Completed research for inventory item');

      return { activeListings: activeCount, soldItems: soldCount };
    } catch (err) {
      await MarketResearchRun.query()
        .findById(run.id)
        .patch({
          status: 'failed',
          completedAt: new Date(),
          errorMessage: err.message,
        });
      throw err;
    }
  }

  /**
   * Store active competitor listings
   */
  async storeActiveListings({ listings, runId, yourListingId }) {
    let stored = 0;

    await Promise.mapSeries(listings, async (item) => {
      try {
        await CompetitorListing.query()
          .insert({
            id: uuidv4(),
            researchRunId: runId,
            yourListingId: yourListingId,
            ebayItemId: item.ebayItemId,
            title: item.title,
            currentPrice: item.currentPrice,
            originalPrice: item.originalPrice,
            seller: item.seller,
            sellerFeedbackScore: item.sellerFeedbackScore,
            sellerFeedbackPercent: item.sellerFeedbackPercent,
            condition: item.condition,
            shippingCost: item.shippingCost,
            freeShipping: item.freeShipping,
            freeReturns: item.freeReturns,
            location: item.location,
            isSponsored: item.isSponsored,
            pictureUrl: item.pictureUrl,
            viewItemUrl: item.viewItemUrl,
            keywords: item.keywords,
            scrapedAt: new Date(),
          })
          .onConflict('ebayItemId')
          .merge();
        stored++;
      } catch (err) {
        this.log.warn({ err, ebayItemId: item.ebayItemId }, 'Error storing competitor listing');
      }
    });

    return stored;
  }

  /**
   * Store sold items
   */
  async storeSoldItems({ items, runId, yourListingId }) {
    let stored = 0;

    await Promise.mapSeries(items, async (item) => {
      try {
        await SoldItem.query()
          .insert({
            id: uuidv4(),
            researchRunId: runId,
            yourListingId: yourListingId,
            ebayItemId: item.ebayItemId,
            title: item.title,
            soldPrice: item.soldPrice,
            originalPrice: item.originalPrice,
            soldDate: item.soldDate ? new Date(item.soldDate) : new Date(),
            seller: item.seller,
            sellerFeedbackScore: item.sellerFeedbackScore,
            sellerFeedbackPercent: item.sellerFeedbackPercent,
            condition: item.condition,
            shippingCost: item.shippingCost,
            freeShipping: item.freeShipping,
            location: item.location,
            pictureUrl: item.pictureUrl,
            keywords: item.keywords,
            scrapedAt: new Date(),
          })
          .onConflict('ebayItemId')
          .merge();
        stored++;
      } catch (err) {
        this.log.warn({ err, ebayItemId: item.ebayItemId }, 'Error storing sold item');
      }
    });

    return stored;
  }

  /**
   * Research by custom keywords (not tied to inventory)
   */
  async researchByKeywords({ keywords, categoryId = '35596', maxActivePages = 2, maxSoldPages = 3 }) {
    this.log.info({ keywords, categoryId }, 'Running market research by keywords');

    // Create research run record (no yourListingId)
    const run = await MarketResearchRun.query().insert({
      id: uuidv4(),
      yourListingId: null,
      keywords,
      status: 'running',
      startedAt: new Date(),
    });

    try {
      const research = await this.scraper.fullMarketResearch({
        keywords,
        categoryId,
        maxActivePages,
        maxSoldPages,
      });

      const activeCount = await this.storeActiveListings({
        listings: research.activeListings,
        runId: run.id,
        yourListingId: null,
      });

      const soldCount = await this.storeSoldItems({
        items: research.soldItems,
        runId: run.id,
        yourListingId: null,
      });

      await MarketResearchRun.query()
        .findById(run.id)
        .patch({
          status: 'completed',
          completedAt: new Date(),
          activeListingsFound: activeCount,
          soldItemsFound: soldCount,
        });

      return {
        runId: run.id,
        keywords,
        activeListings: activeCount,
        soldItems: soldCount,
      };
    } catch (err) {
      await MarketResearchRun.query()
        .findById(run.id)
        .patch({
          status: 'failed',
          completedAt: new Date(),
          errorMessage: err.message,
        });
      throw err;
    } finally {
      await this.scraper.closeBrowser();
    }
  }

  /**
   * Calculate price statistics and create snapshot for ML training
   */
  async calculatePriceSnapshot({ keywords, categoryId = '35596', periodDays = 30 }) {
    const periodStart = new Date(Date.now() - periodDays * 24 * 60 * 60 * 1000);
    const periodEnd = new Date();

    // Get sold items stats
    const soldStats = await SoldItem.query()
      .where('keywords', 'like', `%${keywords}%`)
      .where('soldDate', '>=', periodStart)
      .select(
        SoldItem.raw('COUNT(*) as count'),
        SoldItem.raw('MIN("soldPrice") as min_price'),
        SoldItem.raw('MAX("soldPrice") as max_price'),
        SoldItem.raw('AVG("soldPrice") as avg_price'),
        SoldItem.raw('PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY "soldPrice") as median_price')
      )
      .first();

    // Get active listings stats
    const activeStats = await CompetitorListing.query()
      .where('keywords', 'like', `%${keywords}%`)
      .where('scrapedAt', '>=', periodStart)
      .select(
        CompetitorListing.raw('COUNT(*) as count'),
        CompetitorListing.raw('MIN("currentPrice") as min_price'),
        CompetitorListing.raw('MAX("currentPrice") as max_price'),
        CompetitorListing.raw('AVG("currentPrice") as avg_price'),
        CompetitorListing.raw('PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY "currentPrice") as median_price')
      )
      .first();

    const snapshot = await PriceSnapshot.query().insert({
      id: uuidv4(),
      keywords,
      categoryId,
      soldCount: parseInt(soldStats?.count || 0, 10),
      soldPriceMin: soldStats?.min_price,
      soldPriceMax: soldStats?.max_price,
      soldPriceAvg: soldStats?.avg_price,
      soldPriceMedian: soldStats?.median_price,
      activeCount: parseInt(activeStats?.count || 0, 10),
      activePriceMin: activeStats?.min_price,
      activePriceMax: activeStats?.max_price,
      activePriceAvg: activeStats?.avg_price,
      activePriceMedian: activeStats?.median_price,
      periodStart,
      periodEnd,
    });

    return snapshot;
  }

  /**
   * Get market research statistics
   */
  async getStats() {
    const [runStats, competitorStats, soldStats] = await Promise.all([
      MarketResearchRun.query()
        .select(
          MarketResearchRun.raw('COUNT(*) as total_runs'),
          MarketResearchRun.raw("COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed_runs"),
          MarketResearchRun.raw("COUNT(CASE WHEN status = 'failed' THEN 1 END) as failed_runs")
        )
        .first(),
      CompetitorListing.query()
        .select(
          CompetitorListing.raw('COUNT(*) as total'),
          CompetitorListing.raw('COUNT(DISTINCT seller) as unique_sellers'),
          CompetitorListing.raw('AVG("currentPrice") as avg_price')
        )
        .first(),
      SoldItem.query()
        .select(
          SoldItem.raw('COUNT(*) as total'),
          SoldItem.raw('COUNT(DISTINCT seller) as unique_sellers'),
          SoldItem.raw('AVG("soldPrice") as avg_price')
        )
        .first(),
    ]);

    return {
      researchRuns: {
        total: parseInt(runStats?.total_runs || 0, 10),
        completed: parseInt(runStats?.completed_runs || 0, 10),
        failed: parseInt(runStats?.failed_runs || 0, 10),
      },
      competitorListings: {
        total: parseInt(competitorStats?.total || 0, 10),
        uniqueSellers: parseInt(competitorStats?.unique_sellers || 0, 10),
        avgPrice: parseFloat(competitorStats?.avg_price || 0),
      },
      soldItems: {
        total: parseInt(soldStats?.total || 0, 10),
        uniqueSellers: parseInt(soldStats?.unique_sellers || 0, 10),
        avgPrice: parseFloat(soldStats?.avg_price || 0),
      },
    };
  }
}

module.exports = MarketResearchManager;
