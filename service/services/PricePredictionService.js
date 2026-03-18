'use strict';

const { log } = require('../lib/logger');
const SoldItem = require('../models/SoldItem');
const CompetitorListing = require('../models/CompetitorListing');
const YourSale = require('../models/YourSale');
const YourListing = require('../models/YourListing');

/**
 * PricePredictionService - ML-based pricing recommendations
 *
 * Uses multiple data sources to predict optimal pricing:
 * 1. Your historical sales - what prices worked for you
 * 2. Competitor listings - current market prices
 * 3. Market sold items - what buyers actually pay
 *
 * Algorithms:
 * - Weighted average based on data freshness and relevance
 * - Price velocity analysis (how fast items sell at different prices)
 * - Competitive positioning analysis
 */
class PricePredictionService {
  constructor() {
    this.log = log.child({ class: 'PricePredictionService' }, true);
  }

  /**
   * Calculate optimal price for a listing based on ML analysis
   * @param {string} listingId - Your listing ID
   * @returns {Object} Price recommendation with confidence score
   */
  async predictOptimalPrice(listingId) {
    this.log.info({ listingId }, 'Calculating optimal price');

    const listing = await YourListing.query().findById(listingId);
    if (!listing) {
      throw new Error('Listing not found');
    }

    // Extract keywords for matching
    const keywords = this.extractKeywords(listing.title);

    // Get all relevant data
    const [yourSales, competitorListings, marketSoldItems] = await Promise.all([
      this.getYourHistoricalSales(keywords),
      this.getCompetitorPrices(listingId, keywords),
      this.getMarketSoldPrices(keywords),
    ]);

    // Calculate weighted price recommendations
    const analysis = this.analyzeAllData({
      yourSales,
      competitorListings,
      marketSoldItems,
      currentPrice: parseFloat(listing.currentPrice),
    });

    return {
      listingId,
      currentPrice: parseFloat(listing.currentPrice),
      ...analysis,
    };
  }

  /**
   * Extract meaningful keywords from title for matching
   */
  extractKeywords(title) {
    if (!title) return '';

    // Remove common words and keep important terms
    const stopWords = ['for', 'the', 'and', 'or', 'a', 'an', 'in', 'on', 'at', 'to', 'new', 'used', 'oem', 'genuine'];
    const words = title.toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(word => word.length > 2 && !stopWords.includes(word));

    return words.slice(0, 6).join(' ');
  }

  /**
   * Get your historical sales for similar items
   */
  async getYourHistoricalSales(keywords) {
    if (!keywords) return [];

    const keywordList = keywords.split(' ');
    let query = YourSale.query();

    // Match any keyword in title
    keywordList.forEach((keyword, index) => {
      if (index === 0) {
        query = query.where('title', 'ilike', `%${keyword}%`);
      } else {
        query = query.orWhere('title', 'ilike', `%${keyword}%`);
      }
    });

    const sales = await query
      .orderBy('soldDate', 'desc')
      .limit(50);

    return sales;
  }

  /**
   * Get competitor prices for similar items
   */
  async getCompetitorPrices(listingId, keywords) {
    // First try to get linked competitors
    let competitors = await CompetitorListing.query()
      .where('yourListingId', listingId)
      .orderBy('scrapedAt', 'desc')
      .limit(50);

    // If no linked competitors, search by keywords
    if (competitors.length === 0 && keywords) {
      const keywordList = keywords.split(' ');
      let query = CompetitorListing.query();

      keywordList.forEach((keyword, index) => {
        if (index === 0) {
          query = query.where('title', 'ilike', `%${keyword}%`);
        } else {
          query = query.orWhere('title', 'ilike', `%${keyword}%`);
        }
      });

      competitors = await query
        .orderBy('scrapedAt', 'desc')
        .limit(50);
    }

    return competitors;
  }

  /**
   * Get market sold prices for similar items
   */
  async getMarketSoldPrices(keywords) {
    if (!keywords) return [];

    const keywordList = keywords.split(' ');
    let query = SoldItem.query();

    keywordList.forEach((keyword, index) => {
      if (index === 0) {
        query = query.where('title', 'ilike', `%${keyword}%`);
      } else {
        query = query.orWhere('title', 'ilike', `%${keyword}%`);
      }
    });

    // Get recent sold items (last 90 days)
    const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
    const soldItems = await query
      .where('soldDate', '>=', ninetyDaysAgo)
      .orderBy('soldDate', 'desc')
      .limit(100);

    return soldItems;
  }

  /**
   * Analyze all data sources and produce price recommendation
   */
  analyzeAllData({ yourSales, competitorListings, marketSoldItems, currentPrice }) {
    const analysis = {
      dataQuality: 'low',
      confidence: 0,
      suggestedPrice: null,
      priceRange: { min: null, max: null },
      recommendation: null,
      insights: [],
    };

    // Calculate statistics for each data source
    const yourSalesStats = this.calculateStats(yourSales.map(s => parseFloat(s.salePrice)));
    const competitorStats = this.calculateStats(competitorListings.map(c => parseFloat(c.currentPrice)));
    const marketSoldStats = this.calculateStats(marketSoldItems.map(s => parseFloat(s.soldPrice)));

    // Determine data quality
    const totalDataPoints = yourSales.length + competitorListings.length + marketSoldItems.length;
    if (totalDataPoints >= 20) {
      analysis.dataQuality = 'high';
      analysis.confidence = Math.min(0.95, 0.5 + (totalDataPoints / 100));
    } else if (totalDataPoints >= 10) {
      analysis.dataQuality = 'medium';
      analysis.confidence = Math.min(0.75, 0.3 + (totalDataPoints / 50));
    } else if (totalDataPoints >= 3) {
      analysis.dataQuality = 'low';
      analysis.confidence = Math.min(0.5, 0.1 + (totalDataPoints / 30));
    } else {
      analysis.dataQuality = 'insufficient';
      analysis.confidence = 0;
      analysis.recommendation = 'INSUFFICIENT_DATA';
      analysis.insights.push('Not enough market data to make a confident recommendation');
      return analysis;
    }

    // Weight the different data sources
    // Market sold items are most valuable (actual sales)
    // Your sales are valuable (your specific experience)
    // Competitor listings are least valuable (they may be overpriced)
    const weights = {
      marketSold: 0.5,  // Actual market prices
      yourSales: 0.35,  // Your successful sales
      competitor: 0.15, // Current competitor prices
    };

    let weightedPrice = 0;
    let totalWeight = 0;

    if (marketSoldStats.count > 0) {
      weightedPrice += marketSoldStats.median * weights.marketSold;
      totalWeight += weights.marketSold;
      analysis.insights.push(
        `Market sold avg: $${marketSoldStats.avg.toFixed(2)} (${marketSoldStats.count} sales)`
      );
    }

    if (yourSalesStats.count > 0) {
      weightedPrice += yourSalesStats.median * weights.yourSales;
      totalWeight += weights.yourSales;
      analysis.insights.push(
        `Your avg sale price: $${yourSalesStats.avg.toFixed(2)} (${yourSalesStats.count} sales)`
      );
    }

    if (competitorStats.count > 0) {
      weightedPrice += competitorStats.median * weights.competitor;
      totalWeight += weights.competitor;
      analysis.insights.push(
        `Competitor avg: $${competitorStats.avg.toFixed(2)} (${competitorStats.count} listings)`
      );
    }

    // Normalize weighted price
    if (totalWeight > 0) {
      analysis.suggestedPrice = weightedPrice / totalWeight;
    }

    // Calculate price range
    const allPrices = [
      ...yourSales.map(s => parseFloat(s.salePrice)),
      ...competitorListings.map(c => parseFloat(c.currentPrice)),
      ...marketSoldItems.map(s => parseFloat(s.soldPrice)),
    ].filter(p => p > 0);

    if (allPrices.length > 0) {
      allPrices.sort((a, b) => a - b);
      const q25Index = Math.floor(allPrices.length * 0.25);
      const q75Index = Math.floor(allPrices.length * 0.75);
      analysis.priceRange = {
        min: allPrices[q25Index],
        max: allPrices[q75Index],
      };
    }

    // Generate recommendation
    if (analysis.suggestedPrice) {
      const priceDiff = currentPrice - analysis.suggestedPrice;
      const priceDiffPercent = (priceDiff / analysis.suggestedPrice) * 100;

      if (priceDiffPercent > 15) {
        analysis.recommendation = 'REDUCE_PRICE';
        analysis.insights.push(
          `Your price is ${priceDiffPercent.toFixed(1)}% above market. Consider reducing.`
        );
      } else if (priceDiffPercent < -15) {
        analysis.recommendation = 'RAISE_PRICE';
        analysis.insights.push(
          `Your price is ${Math.abs(priceDiffPercent).toFixed(1)}% below market. You could increase.`
        );
      } else {
        analysis.recommendation = 'PRICE_OK';
        analysis.insights.push(
          `Your price is within market range (${priceDiffPercent > 0 ? '+' : ''}${priceDiffPercent.toFixed(1)}%)`
        );
      }
    }

    // Round suggested price
    if (analysis.suggestedPrice) {
      analysis.suggestedPrice = Math.round(analysis.suggestedPrice * 100) / 100;
    }

    return analysis;
  }

  /**
   * Calculate statistics for a set of prices
   */
  calculateStats(prices) {
    const validPrices = prices.filter(p => p > 0);

    if (validPrices.length === 0) {
      return { count: 0, avg: 0, min: 0, max: 0, median: 0 };
    }

    validPrices.sort((a, b) => a - b);

    const sum = validPrices.reduce((acc, p) => acc + p, 0);
    const avg = sum / validPrices.length;
    const median = validPrices.length % 2 === 0
      ? (validPrices[validPrices.length / 2 - 1] + validPrices[validPrices.length / 2]) / 2
      : validPrices[Math.floor(validPrices.length / 2)];

    return {
      count: validPrices.length,
      avg,
      min: validPrices[0],
      max: validPrices[validPrices.length - 1],
      median,
    };
  }

  /**
   * Analyze price velocity - how fast items sell at different price points
   * This helps determine if a lower price significantly increases sales speed
   */
  async analyzePriceVelocity(keywords) {
    if (!keywords) return null;

    const keywordList = keywords.split(' ');
    let query = SoldItem.query();

    keywordList.forEach((keyword, index) => {
      if (index === 0) {
        query = query.where('title', 'ilike', `%${keyword}%`);
      } else {
        query = query.orWhere('title', 'ilike', `%${keyword}%`);
      }
    });

    const soldItems = await query
      .orderBy('soldDate', 'desc')
      .limit(200);

    if (soldItems.length < 10) {
      return null;
    }

    // Group by price buckets
    const prices = soldItems.map(s => parseFloat(s.soldPrice)).filter(p => p > 0);
    prices.sort((a, b) => a - b);

    const min = prices[0];
    const max = prices[prices.length - 1];
    const range = max - min;
    const bucketSize = range / 5; // 5 price buckets

    const buckets = {};
    for (let i = 0; i < 5; i++) {
      const bucketMin = min + (i * bucketSize);
      const bucketMax = min + ((i + 1) * bucketSize);
      const bucketItems = soldItems.filter(s => {
        const price = parseFloat(s.soldPrice);
        return price >= bucketMin && price < bucketMax;
      });

      buckets[`$${bucketMin.toFixed(0)}-$${bucketMax.toFixed(0)}`] = {
        count: bucketItems.length,
        avgPrice: bucketItems.length > 0
          ? bucketItems.reduce((acc, s) => acc + parseFloat(s.soldPrice), 0) / bucketItems.length
          : 0,
      };
    }

    return {
      totalSales: soldItems.length,
      priceRange: { min, max },
      buckets,
    };
  }

  /**
   * Get batch price predictions for all your listings
   */
  async batchPredictPrices(limit = 100) {
    const listings = await YourListing.query()
      .where('listingStatus', 'Active')
      .orderBy('createdAt', 'desc')
      .limit(limit);

    const predictions = [];

    for (const listing of listings) {
      try {
        const prediction = await this.predictOptimalPrice(listing.id);
        predictions.push(prediction);
      } catch (err) {
        this.log.warn({ err, listingId: listing.id }, 'Failed to predict price for listing');
        predictions.push({
          listingId: listing.id,
          currentPrice: parseFloat(listing.currentPrice),
          error: err.message,
        });
      }
    }

    return predictions;
  }

  /**
   * Find underpriced items in your inventory
   */
  async findUnderpricedItems(limit = 20) {
    const predictions = await this.batchPredictPrices(limit * 2);

    const underpriced = predictions
      .filter(p => p.recommendation === 'RAISE_PRICE' && p.suggestedPrice)
      .map(p => ({
        ...p,
        potentialGain: p.suggestedPrice - p.currentPrice,
        potentialGainPercent: ((p.suggestedPrice - p.currentPrice) / p.currentPrice) * 100,
      }))
      .sort((a, b) => b.potentialGain - a.potentialGain)
      .slice(0, limit);

    return underpriced;
  }

  /**
   * Find overpriced items that may not sell
   */
  async findOverpricedItems(limit = 20) {
    const predictions = await this.batchPredictPrices(limit * 2);

    const overpriced = predictions
      .filter(p => p.recommendation === 'REDUCE_PRICE' && p.suggestedPrice)
      .map(p => ({
        ...p,
        overpricedBy: p.currentPrice - p.suggestedPrice,
        overpricedPercent: ((p.currentPrice - p.suggestedPrice) / p.suggestedPrice) * 100,
      }))
      .sort((a, b) => b.overpricedPercent - a.overpricedPercent)
      .slice(0, limit);

    return overpriced;
  }
}

module.exports = PricePredictionService;
