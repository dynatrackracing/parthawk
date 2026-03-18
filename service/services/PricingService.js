'use strict';

const { log } = require('../lib/logger');
const SoldItem = require('../models/SoldItem');
const YourSale = require('../models/YourSale');
const YourListing = require('../models/YourListing');
const Item = require('../models/Item');
const { raw } = require('objection');

/**
 * PricingService - Suggests optimal prices for your inventory
 * Based on market prices, competitor prices, and your historical data
 */
class PricingService {
  constructor() {
    this.log = log.child({ class: 'PricingService' }, true);
  }

  /**
   * Get pricing recommendations
   * @param {Object} options
   * @param {string} options.ebayItemId - Specific listing to price
   * @param {boolean} options.all - Get recommendations for all listings
   * @param {number} options.daysBack - Days to look back for market data (default: 30)
   */
  async getRecommendations({ ebayItemId, all = false, daysBack = 30 } = {}) {
    this.log.info({ ebayItemId, all, daysBack }, 'Getting pricing recommendations');

    // Get your listings to price
    let listings;
    if (ebayItemId) {
      listings = await YourListing.query().where('ebayItemId', ebayItemId);
    } else if (all) {
      listings = await YourListing.query().where('listingStatus', 'Active');
    } else {
      listings = [];
    }

    if (listings.length === 0) {
      return { pricingRecommendations: [] };
    }

    const cutoffDate = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000);

    // Get market data and competitor data
    const marketData = await this.getMarketPriceData({ cutoffDate });
    const competitorData = await this.getCompetitorPrices();
    const yourHistoricalData = await this.getYourHistoricalPrices({ cutoffDate });

    // Generate recommendations for each listing
    const recommendations = [];
    for (const listing of listings) {
      const recommendation = this.generatePricingRecommendation({
        listing,
        marketData,
        competitorData,
        yourHistoricalData,
      });
      recommendations.push(recommendation);
    }

    this.log.info({ recommendationCount: recommendations.length }, 'Generated pricing recommendations');
    return { pricingRecommendations: recommendations };
  }

  /**
   * Get market price data from sold items
   */
  async getMarketPriceData({ cutoffDate }) {
    const results = await SoldItem.query()
      .select(
        'title',
        raw('COUNT(*) as "soldCount"'),
        raw('MIN("soldPrice") as "minPrice"'),
        raw('MAX("soldPrice") as "maxPrice"'),
        raw('AVG("soldPrice") as "avgPrice"'),
        raw('PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY "soldPrice") as "medianPrice"')
      )
      .where('soldDate', '>=', cutoffDate)
      .groupBy('title');

    // Create map by normalized title
    const priceMap = {};
    for (const row of results) {
      const key = this.normalizeTitle(row.title);
      priceMap[key] = {
        soldCount: parseInt(row.soldCount, 10),
        min: parseFloat(row.minPrice),
        max: parseFloat(row.maxPrice),
        avg: parseFloat(row.avgPrice),
        median: parseFloat(row.medianPrice),
      };
    }
    return priceMap;
  }

  /**
   * Get competitor prices from Item table
   */
  async getCompetitorPrices() {
    const results = await Item.query()
      .select('title', 'price', 'seller');

    // Group by normalized title
    const priceMap = {};
    for (const row of results) {
      const key = this.normalizeTitle(row.title);
      if (!priceMap[key]) {
        priceMap[key] = [];
      }
      priceMap[key].push(parseFloat(row.price));
    }
    return priceMap;
  }

  /**
   * Get your historical prices
   */
  async getYourHistoricalPrices({ cutoffDate }) {
    const results = await YourSale.query()
      .select(
        'title',
        raw('AVG("salePrice") as "avgPrice"'),
        raw('COUNT(*) as "soldCount"')
      )
      .where('soldDate', '>=', cutoffDate)
      .groupBy('title');

    const priceMap = {};
    for (const row of results) {
      const key = this.normalizeTitle(row.title);
      priceMap[key] = {
        avgPrice: parseFloat(row.avgPrice),
        soldCount: parseInt(row.soldCount, 10),
      };
    }
    return priceMap;
  }

  /**
   * Normalize title for matching
   */
  normalizeTitle(title) {
    if (!title) return '';
    return title
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Find best matching key in a map
   */
  findBestMatch(title, map) {
    const normalizedTitle = this.normalizeTitle(title);
    const words = normalizedTitle.split(' ').filter(w => w.length > 2);

    let bestMatch = null;
    let bestScore = 0;

    for (const key of Object.keys(map)) {
      const keyWords = key.split(' ').filter(w => w.length > 2);
      let matchCount = 0;
      for (const word of words) {
        if (keyWords.includes(word)) {
          matchCount++;
        }
      }
      const score = matchCount / Math.max(words.length, keyWords.length);
      if (score > bestScore && score > 0.3) { // At least 30% match
        bestScore = score;
        bestMatch = key;
      }
    }

    return bestMatch;
  }

  /**
   * Generate pricing recommendation for a single listing
   */
  generatePricingRecommendation({ listing, marketData, competitorData, yourHistoricalData }) {
    const title = listing.title;
    const currentPrice = parseFloat(listing.currentPrice);

    // Find market data
    const marketKey = this.findBestMatch(title, marketData);
    const market = marketKey ? marketData[marketKey] : null;

    // Find competitor prices
    const competitorKey = this.findBestMatch(title, competitorData);
    const competitorPrices = competitorKey ? competitorData[competitorKey] : [];

    // Find your historical data
    const historyKey = this.findBestMatch(title, yourHistoricalData);
    const yourHistory = historyKey ? yourHistoricalData[historyKey] : null;

    // Calculate market price range
    const marketPriceRange = market ? {
      min: market.min?.toFixed(2),
      max: market.max?.toFixed(2),
      avg: market.avg?.toFixed(2),
      median: market.median?.toFixed(2),
      soldCount: market.soldCount,
    } : null;

    // Calculate suggested price
    let suggestedPrice = currentPrice;
    let reasoning = '';

    if (market) {
      // Use median as base suggested price
      suggestedPrice = market.median;

      // Adjust based on competition
      if (competitorPrices.length > 0) {
        const avgCompetitorPrice = competitorPrices.reduce((a, b) => a + b, 0) / competitorPrices.length;
        // If competitors are lower, consider matching
        if (avgCompetitorPrice < suggestedPrice) {
          suggestedPrice = Math.max(avgCompetitorPrice, market.min);
        }
      }

      // Generate reasoning
      if (currentPrice < market.min) {
        reasoning = 'Priced significantly below market minimum. Consider increasing price.';
      } else if (currentPrice < market.median * 0.9) {
        reasoning = 'Priced below market median. Room to increase price.';
      } else if (currentPrice > market.max) {
        reasoning = 'Priced above market maximum. Consider reducing to improve sell-through.';
      } else if (currentPrice > market.median * 1.1) {
        reasoning = 'Priced above market median. May take longer to sell.';
      } else {
        reasoning = 'Price is within market range.';
      }
    } else {
      reasoning = 'No market data available. Using current price.';
    }

    // Round to .99 pricing
    suggestedPrice = Math.floor(suggestedPrice) + 0.99;
    if (suggestedPrice < 1) suggestedPrice = currentPrice;

    return {
      ebayItemId: listing.ebayItemId,
      title: listing.title,
      sku: listing.sku,
      yourCurrentPrice: currentPrice?.toFixed(2),
      marketPriceRange,
      competitorPrices: competitorPrices.slice(0, 10).map(p => p?.toFixed(2)),
      yourHistoricalAvg: yourHistory?.avgPrice?.toFixed(2),
      yourHistoricalSales: yourHistory?.soldCount,
      suggestedPrice: suggestedPrice?.toFixed(2),
      priceDifference: (suggestedPrice - currentPrice)?.toFixed(2),
      reasoning,
      daysListed: listing.daysListed,
      viewItemUrl: listing.viewItemUrl,
    };
  }
}

module.exports = PricingService;
