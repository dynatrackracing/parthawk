'use strict';

const { log } = require('../lib/logger');
const SoldItem = require('../models/SoldItem');
const YourSale = require('../models/YourSale');
const Item = require('../models/Item');
const { raw } = require('objection');

/**
 * WhatToPullService - Recommends which parts to pull from junkyards
 * Based on market demand, your historical success, and competition level
 */
class WhatToPullService {
  constructor() {
    this.log = log.child({ class: 'WhatToPullService' }, true);
  }

  /**
   * Get recommendations for parts to pull
   * @param {Object} options
   * @param {string} options.make - Filter by vehicle make
   * @param {string} options.model - Filter by vehicle model
   * @param {number} options.year - Filter by vehicle year
   * @param {string} options.categoryId - Filter by category
   * @param {number} options.limit - Number of results (default: 50)
   * @param {number} options.daysBack - Days to look back for market data (default: 30)
   */
  async getRecommendations({
    make,
    model,
    year,
    categoryId,
    limit = 50,
    daysBack = 30,
  } = {}) {
    this.log.info({ make, model, year, categoryId, limit, daysBack }, 'Getting what-to-pull recommendations');

    const cutoffDate = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000);

    // Get market demand from sold items
    const marketDemand = await this.getMarketDemand({ make, model, year, categoryId, cutoffDate });

    // Get your historical sales
    const yourHistory = await this.getYourSalesHistory({ cutoffDate });

    // Get competition data
    const competition = await this.getCompetitionData({ make, model, year, categoryId });

    // Combine and score
    const recommendations = this.combineAndScore({
      marketDemand,
      yourHistory,
      competition,
      limit,
    });

    this.log.info({ recommendationCount: recommendations.length }, 'Generated recommendations');
    return recommendations;
  }

  /**
   * Get market demand from sold items
   */
  async getMarketDemand({ make, model, year, categoryId, cutoffDate }) {
    let query = SoldItem.query()
      .select(
        'categoryId',
        'categoryTitle',
        raw('COUNT(*) as "soldCount"'),
        raw('AVG("soldPrice") as "avgSoldPrice"'),
        raw('MIN("soldPrice") as "minSoldPrice"'),
        raw('MAX("soldPrice") as "maxSoldPrice"')
      )
      .where('soldDate', '>=', cutoffDate)
      .groupBy('categoryId', 'categoryTitle');

    if (categoryId) {
      query = query.where('categoryId', categoryId);
    }

    // Filter by compatibility if make/model/year provided
    if (make || model || year) {
      query = query.whereRaw(`
        EXISTS (
          SELECT 1 FROM jsonb_array_elements(compatibility) as c
          WHERE (${make ? `c->>'make' ILIKE ?` : 'TRUE'})
            AND (${model ? `c->>'model' ILIKE ?` : 'TRUE'})
            AND (${year ? `(c->>'year')::int = ?` : 'TRUE'})
        )
      `, [
        ...(make ? [`%${make}%`] : []),
        ...(model ? [`%${model}%`] : []),
        ...(year ? [year] : []),
      ]);
    }

    const results = await query;
    return results;
  }

  /**
   * Get your sales history
   */
  async getYourSalesHistory({ cutoffDate }) {
    const results = await YourSale.query()
      .select(
        'title',
        raw('COUNT(*) as "yourSoldCount"'),
        raw('AVG("salePrice") as "yourAvgPrice"')
      )
      .where('soldDate', '>=', cutoffDate)
      .groupBy('title');

    // Create a map for easy lookup
    const historyMap = {};
    for (const row of results) {
      historyMap[row.title?.toLowerCase()] = {
        yourSoldCount: parseInt(row.yourSoldCount, 10),
        yourAvgPrice: parseFloat(row.yourAvgPrice),
      };
    }
    return historyMap;
  }

  /**
   * Get competition data
   */
  async getCompetitionData({ make, model, year, categoryId }) {
    let query = Item.query()
      .select(
        'categoryId',
        'categoryTitle',
        raw('COUNT(DISTINCT seller) as "competitorCount"'),
        raw('COUNT(*) as "listingCount"'),
        raw('AVG(price) as "avgCompetitorPrice"')
      )
      .groupBy('categoryId', 'categoryTitle');

    if (categoryId) {
      query = query.where('categoryId', categoryId);
    }

    const results = await query;

    // Create a map by categoryId
    const competitionMap = {};
    for (const row of results) {
      competitionMap[row.categoryId] = {
        competitorCount: parseInt(row.competitorCount, 10),
        listingCount: parseInt(row.listingCount, 10),
        avgCompetitorPrice: parseFloat(row.avgCompetitorPrice),
      };
    }
    return competitionMap;
  }

  /**
   * Combine data sources and calculate scores
   */
  combineAndScore({ marketDemand, yourHistory, competition, limit }) {
    const recommendations = [];

    for (const demand of marketDemand) {
      const categoryId = demand.categoryId;
      const comp = competition[categoryId] || { competitorCount: 0, listingCount: 0, avgCompetitorPrice: 0 };

      // Calculate component scores (0-100)
      const demandScore = Math.min(100, (parseInt(demand.soldCount, 10) / 10) * 100); // 10+ sales = 100
      const priceScore = Math.min(100, (parseFloat(demand.avgSoldPrice) / 500) * 100); // $500+ = 100
      const competitionScore = Math.max(0, 100 - (comp.competitorCount * 10)); // Fewer competitors = higher score

      // Find if you've sold this before (approximate match by category title)
      let yourHistoryScore = 0;
      const categoryTitleLower = demand.categoryTitle?.toLowerCase() || '';
      for (const [title, history] of Object.entries(yourHistory)) {
        if (categoryTitleLower.includes(title) || title.includes(categoryTitleLower)) {
          yourHistoryScore = Math.min(100, history.yourSoldCount * 20); // 5+ sales = 100
          break;
        }
      }

      // Calculate composite score (weighted average)
      const weights = {
        demand: 0.35,
        price: 0.25,
        competition: 0.20,
        yourHistory: 0.20,
      };

      const score = Math.round(
        demandScore * weights.demand +
        priceScore * weights.price +
        competitionScore * weights.competition +
        yourHistoryScore * weights.yourHistory
      );

      // Determine recommendation level
      let recommendation;
      if (score >= 80) {
        recommendation = 'HIGH PRIORITY';
      } else if (score >= 60) {
        recommendation = 'RECOMMENDED';
      } else if (score >= 40) {
        recommendation = 'CONSIDER';
      } else {
        recommendation = 'LOW PRIORITY';
      }

      recommendations.push({
        partCategory: demand.categoryTitle || demand.categoryId,
        categoryId: demand.categoryId,
        marketDemand: parseInt(demand.soldCount, 10),
        avgSoldPrice: parseFloat(demand.avgSoldPrice)?.toFixed(2),
        minSoldPrice: parseFloat(demand.minSoldPrice)?.toFixed(2),
        maxSoldPrice: parseFloat(demand.maxSoldPrice)?.toFixed(2),
        competitorCount: comp.competitorCount,
        competitorListings: comp.listingCount,
        avgCompetitorPrice: comp.avgCompetitorPrice?.toFixed(2),
        yourHistoricalSales: yourHistoryScore > 0 ? Math.round(yourHistoryScore / 20) : 0,
        score,
        recommendation,
        breakdown: {
          demandScore: Math.round(demandScore),
          priceScore: Math.round(priceScore),
          competitionScore: Math.round(competitionScore),
          yourHistoryScore: Math.round(yourHistoryScore),
        },
      });
    }

    // Sort by score descending and limit
    recommendations.sort((a, b) => b.score - a.score);
    return recommendations.slice(0, limit);
  }
}

module.exports = WhatToPullService;
