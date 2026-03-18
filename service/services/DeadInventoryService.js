'use strict';

const { log } = require('../lib/logger');
const SoldItem = require('../models/SoldItem');
const YourSale = require('../models/YourSale');
const YourListing = require('../models/YourListing');
const Item = require('../models/Item');
const { raw } = require('objection');

/**
 * DeadInventoryService - Identifies stale listings that need action
 * Based on days listed, market demand, and competition
 */
class DeadInventoryService {
  constructor() {
    this.log = log.child({ class: 'DeadInventoryService' }, true);
  }

  /**
   * Get dead inventory listings
   * @param {Object} options
   * @param {number} options.daysThreshold - Days threshold for "dead" (default: 90)
   * @param {boolean} options.includeMarketData - Include market demand data
   * @param {number} options.limit - Number of results per page (default: 50)
   * @param {number} options.page - Page number (default: 1)
   */
  async getDeadInventory({ daysThreshold = 90, includeMarketData = true, limit = 50, page = 1 } = {}) {
    this.log.info({ daysThreshold, includeMarketData, limit, page }, 'Getting dead inventory');

    const now = new Date();
    const cutoffDate = new Date(now - daysThreshold * 24 * 60 * 60 * 1000);

    // Filter by date in SQL for performance - get count and paginated results
    const [countResult, listings] = await Promise.all([
      YourListing.query()
        .where('listingStatus', 'Active')
        .where('startTime', '<', cutoffDate)
        .count('* as total')
        .first(),
      YourListing.query()
        .where('listingStatus', 'Active')
        .where('startTime', '<', cutoffDate)
        .orderBy('startTime', 'asc')
        .limit(limit)
        .offset((page - 1) * limit),
    ]);

    const total = parseInt(countResult?.total || 0);
    const totalPages = Math.ceil(total / limit);

    if (listings.length === 0) {
      return { deadInventory: [], total: 0, totalPages: 1 };
    }

    // Build simple recommendations based on days listed (skip expensive market data matching for speed)
    const deadInventory = listings.map(listing => {
      const startDate = new Date(listing.startTime);
      const daysListed = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
      const currentPrice = parseFloat(listing.currentPrice);

      // Simple recommendation based on age
      let recommendation, suggestedAction, reasoning;
      if (daysListed >= 180) {
        recommendation = 'DEEP DISCOUNT';
        suggestedAction = `Reduce to $${Math.max(10, currentPrice * 0.5).toFixed(2)} or relist`;
        reasoning = 'Listed over 6 months - aggressive action needed';
      } else if (daysListed >= 120) {
        recommendation = 'RELIST';
        suggestedAction = 'End and relist to refresh search ranking';
        reasoning = 'Listing is stale - relisting may improve visibility';
      } else if (daysListed >= 90) {
        recommendation = 'REDUCE PRICE';
        suggestedAction = `Consider reducing by 10-15%`;
        reasoning = 'Listed over 90 days - price reduction may help';
      } else {
        recommendation = 'HOLD';
        suggestedAction = 'Monitor for another 30 days';
        reasoning = 'Not yet stale enough for action';
      }

      return {
        id: listing.id,
        ebayItemId: listing.ebayItemId,
        title: listing.title,
        sku: listing.sku,
        daysListed,
        currentPrice: currentPrice?.toFixed(2),
        recommendation,
        suggestedAction,
        reasoning,
        viewItemUrl: listing.viewItemUrl,
        // These would require expensive matching - skip for now
        marketSalesLast90Days: null,
        marketAvgPrice: null,
        competitorCount: null,
      };
    });

    // Sort by days listed (oldest first) since we can't do severity sorting without market data
    deadInventory.sort((a, b) => b.daysListed - a.daysListed);

    this.log.info({ deadInventoryCount: total, page, totalPages }, 'Found dead inventory');
    return {
      deadInventory,
      total,
      totalPages,
    };
  }

  /**
   * Get market demand data from sold items (last 90 days)
   */
  async getMarketDemandData() {
    const cutoffDate = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);

    const results = await SoldItem.query()
      .select(
        'title',
        raw('COUNT(*) as "soldCount"'),
        raw('AVG("soldPrice") as "avgPrice"')
      )
      .where('soldDate', '>=', cutoffDate)
      .groupBy('title');

    const demandMap = {};
    for (const row of results) {
      const key = this.normalizeTitle(row.title);
      demandMap[key] = {
        soldCount: parseInt(row.soldCount, 10),
        avgPrice: parseFloat(row.avgPrice),
      };
    }
    return demandMap;
  }

  /**
   * Get competitor data from Item table
   */
  async getCompetitorData() {
    const results = await Item.query()
      .select(
        'title',
        raw('COUNT(DISTINCT seller) as "competitorCount"'),
        raw('MIN(price) as "minPrice"'),
        raw('AVG(price) as "avgPrice"')
      )
      .groupBy('title');

    const competitorMap = {};
    for (const row of results) {
      const key = this.normalizeTitle(row.title);
      competitorMap[key] = {
        competitorCount: parseInt(row.competitorCount, 10),
        minPrice: parseFloat(row.minPrice),
        avgPrice: parseFloat(row.avgPrice),
      };
    }
    return competitorMap;
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
      if (score > bestScore && score > 0.3) {
        bestScore = score;
        bestMatch = key;
      }
    }

    return bestMatch;
  }

  /**
   * Analyze a dead listing
   */
  analyzeDeadListing({ listing, marketData, competitorData, now }) {
    const startDate = new Date(listing.startTime);
    const daysListed = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
    const currentPrice = parseFloat(listing.currentPrice);

    // Find market data
    const marketKey = this.findBestMatch(listing.title, marketData);
    const market = marketKey ? marketData[marketKey] : null;

    // Find competitor data
    const competitorKey = this.findBestMatch(listing.title, competitorData);
    const competitor = competitorKey ? competitorData[competitorKey] : null;

    // Calculate market sales in last 90 days
    const marketSalesLast90Days = market?.soldCount || 0;
    const marketAvgPrice = market?.avgPrice;

    // Get competitor count
    const competitorCount = competitor?.competitorCount || 0;
    const competitorMinPrice = competitor?.minPrice;
    const competitorAvgPrice = competitor?.avgPrice;

    // Determine recommendation and action
    let recommendation;
    let suggestedAction;
    let reasoning;

    if (marketSalesLast90Days === 0) {
      // No market demand at all
      recommendation = 'SCRAP';
      suggestedAction = 'Consider scrapping or donating';
      reasoning = 'No market sales in 90 days - extremely low demand';
    } else if (marketSalesLast90Days < 3) {
      // Very low demand
      if (daysListed > 180) {
        recommendation = 'SCRAP';
        suggestedAction = 'Scrap or deep discount to $' + Math.max(10, currentPrice * 0.3).toFixed(2);
        reasoning = 'Very low demand and listed over 180 days';
      } else {
        recommendation = 'DEEP DISCOUNT';
        suggestedAction = 'Reduce to $' + Math.max(10, currentPrice * 0.5).toFixed(2);
        reasoning = 'Low market demand - aggressive pricing needed';
      }
    } else if (currentPrice > (marketAvgPrice || 0) * 1.3) {
      // Overpriced
      const suggestedPrice = marketAvgPrice ? Math.floor(marketAvgPrice * 0.95) + 0.99 : currentPrice * 0.8;
      recommendation = 'REDUCE PRICE';
      suggestedAction = 'Reduce to $' + suggestedPrice.toFixed(2);
      reasoning = 'Priced significantly above market average';
    } else if (competitorMinPrice && currentPrice > competitorMinPrice * 1.2) {
      // Undercut by competitors
      const suggestedPrice = Math.floor(competitorMinPrice * 1.05) + 0.99;
      recommendation = 'REDUCE PRICE';
      suggestedAction = 'Match or beat competitor at $' + suggestedPrice.toFixed(2);
      reasoning = 'Competitors are pricing lower';
    } else if (daysListed > 180) {
      // Listed too long, some demand exists
      recommendation = 'RELIST';
      suggestedAction = 'End and relist to refresh search ranking';
      reasoning = 'Listing is stale - relisting may improve visibility';
    } else {
      // Some hope - moderate action
      recommendation = 'HOLD';
      suggestedAction = 'Monitor for another 30 days';
      reasoning = 'Market demand exists - price may be ok';
    }

    return {
      ebayItemId: listing.ebayItemId,
      title: listing.title,
      sku: listing.sku,
      daysListed,
      currentPrice: currentPrice?.toFixed(2),
      marketSalesLast90Days,
      marketAvgPrice: marketAvgPrice?.toFixed(2),
      competitorCount,
      competitorMinPrice: competitorMinPrice?.toFixed(2),
      competitorAvgPrice: competitorAvgPrice?.toFixed(2),
      recommendation,
      suggestedAction,
      reasoning,
      viewItemUrl: listing.viewItemUrl,
    };
  }
}

module.exports = DeadInventoryService;
