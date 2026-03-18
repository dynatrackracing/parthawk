'use strict';

const { log } = require('../lib/logger');
const SoldItem = require('../models/SoldItem');
const YourSale = require('../models/YourSale');
const YourListing = require('../models/YourListing');
const Item = require('../models/Item');
const { raw } = require('objection');

/**
 * OpportunityService - Finds high-demand parts you're NOT stocking
 * Based on market demand, your inventory gaps, and competition
 */
class OpportunityService {
  constructor() {
    this.log = log.child({ class: 'OpportunityService' }, true);
  }

  /**
   * Get opportunity recommendations
   * @param {Object} options
   * @param {number} options.minDemand - Minimum market sales (default: 10)
   * @param {number} options.maxCompetition - Maximum competitors (default: 10)
   * @param {number} options.daysBack - Days to look back (default: 30)
   * @param {number} options.limit - Number of results (default: 50)
   */
  async getOpportunities({ minDemand = 10, maxCompetition = 10, daysBack = 30, limit = 50 } = {}) {
    this.log.info({ minDemand, maxCompetition, daysBack, limit }, 'Getting opportunity recommendations');

    const cutoffDate = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000);

    // Get market demand data
    const marketDemand = await this.getMarketDemand({ cutoffDate });

    // Get your current inventory
    const yourInventory = await this.getYourInventory();

    // Get your sales history
    const yourHistory = await this.getYourSalesHistory({ cutoffDate });

    // Get competition data
    const competition = await this.getCompetitionData();

    // Find opportunities (high demand items you don't have)
    const opportunities = this.findOpportunities({
      marketDemand,
      yourInventory,
      yourHistory,
      competition,
      minDemand,
      maxCompetition,
      limit,
    });

    this.log.info({ opportunityCount: opportunities.length }, 'Found opportunities');
    return { opportunities };
  }

  /**
   * Get market demand from sold items
   */
  async getMarketDemand({ cutoffDate }) {
    const results = await SoldItem.query()
      .select(
        'categoryId',
        'categoryTitle',
        'title',
        raw('COUNT(*) as "soldCount"'),
        raw('AVG("soldPrice") as "avgPrice"'),
        raw('array_agg(DISTINCT compatibility) as "compatibilities"')
      )
      .where('soldDate', '>=', cutoffDate)
      .groupBy('categoryId', 'categoryTitle', 'title')
      .orderBy('soldCount', 'desc');

    return results;
  }

  /**
   * Get your current inventory
   */
  async getYourInventory() {
    const results = await YourListing.query()
      .select('title', 'sku')
      .where('listingStatus', 'Active');

    const inventorySet = new Set();
    for (const item of results) {
      inventorySet.add(this.normalizeTitle(item.title));
      if (item.sku) {
        inventorySet.add(item.sku.toLowerCase());
      }
    }
    return inventorySet;
  }

  /**
   * Get your sales history
   */
  async getYourSalesHistory({ cutoffDate }) {
    const results = await YourSale.query()
      .select('title', 'sku')
      .where('soldDate', '>=', cutoffDate);

    const historySet = new Set();
    for (const item of results) {
      historySet.add(this.normalizeTitle(item.title));
      if (item.sku) {
        historySet.add(item.sku.toLowerCase());
      }
    }
    return historySet;
  }

  /**
   * Get competition data
   */
  async getCompetitionData() {
    const results = await Item.query()
      .select(
        'title',
        raw('COUNT(DISTINCT seller) as "competitorCount"'),
        raw('AVG(price) as "avgPrice"')
      )
      .groupBy('title');

    const competitorMap = {};
    for (const row of results) {
      const key = this.normalizeTitle(row.title);
      competitorMap[key] = {
        competitorCount: parseInt(row.competitorCount, 10),
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
   * Check if you have this item in stock
   */
  hasInStock(title, yourInventory) {
    const normalized = this.normalizeTitle(title);
    if (yourInventory.has(normalized)) return true;

    // Check for partial matches
    for (const inv of yourInventory) {
      const words = normalized.split(' ').filter(w => w.length > 3);
      let matches = 0;
      for (const word of words) {
        if (inv.includes(word)) matches++;
      }
      if (matches / words.length > 0.7) return true;
    }
    return false;
  }

  /**
   * Check if you've sold this before
   */
  hasSoldBefore(title, yourHistory) {
    const normalized = this.normalizeTitle(title);
    if (yourHistory.has(normalized)) return true;

    // Check for partial matches
    for (const hist of yourHistory) {
      const words = normalized.split(' ').filter(w => w.length > 3);
      let matches = 0;
      for (const word of words) {
        if (hist.includes(word)) matches++;
      }
      if (matches / words.length > 0.5) return true;
    }
    return false;
  }

  /**
   * Find best matching competition data
   */
  findCompetitionMatch(title, competition) {
    const normalized = this.normalizeTitle(title);
    const words = normalized.split(' ').filter(w => w.length > 3);

    let bestMatch = null;
    let bestScore = 0;

    for (const [key, data] of Object.entries(competition)) {
      const keyWords = key.split(' ').filter(w => w.length > 3);
      let matchCount = 0;
      for (const word of words) {
        if (keyWords.includes(word)) matchCount++;
      }
      const score = matchCount / Math.max(words.length, keyWords.length);
      if (score > bestScore && score > 0.3) {
        bestScore = score;
        bestMatch = data;
      }
    }

    return bestMatch;
  }

  /**
   * Extract compatibility info from array
   */
  extractCompatibility(compatibilities) {
    const result = [];
    if (!compatibilities) return result;

    for (const compat of compatibilities) {
      if (Array.isArray(compat)) {
        result.push(...compat);
      } else if (compat) {
        result.push(compat);
      }
    }

    // Deduplicate
    const seen = new Set();
    return result.filter(c => {
      const key = JSON.stringify(c);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).slice(0, 5); // Limit to 5 compatibility entries
  }

  /**
   * Find opportunities
   */
  findOpportunities({ marketDemand, yourInventory, yourHistory, competition, minDemand, maxCompetition, limit }) {
    const opportunities = [];

    for (const demand of marketDemand) {
      const soldCount = parseInt(demand.soldCount, 10);

      // Skip if below minimum demand
      if (soldCount < minDemand) continue;

      // Check if you have this in stock
      const youHaveInStock = this.hasInStock(demand.title, yourInventory);

      // Skip if you already have it
      if (youHaveInStock) continue;

      // Check if you've sold it before
      const youHaveSoldBefore = this.hasSoldBefore(demand.title, yourHistory);

      // Get competition data
      const comp = this.findCompetitionMatch(demand.title, competition);
      const competitorCount = comp?.competitorCount || 0;

      // Skip if too much competition
      if (competitorCount > maxCompetition) continue;

      // Calculate opportunity score
      const demandScore = Math.min(100, (soldCount / 20) * 100); // 20+ sales = 100
      const priceScore = Math.min(100, (parseFloat(demand.avgPrice) / 300) * 100); // $300+ = 100
      const competitionScore = Math.max(0, 100 - (competitorCount * 10));
      const historyBonus = youHaveSoldBefore ? 20 : 0;

      const opportunityScore = Math.round(
        demandScore * 0.35 +
        priceScore * 0.25 +
        competitionScore * 0.25 +
        historyBonus * 0.15
      );

      // Extract compatibility
      const compatibility = this.extractCompatibility(demand.compatibilities);

      // Generate recommendation
      let recommendation;
      if (opportunityScore >= 80 && youHaveSoldBefore) {
        recommendation = 'HIGH PRIORITY - You have sold this before and demand is strong';
      } else if (opportunityScore >= 70) {
        recommendation = 'Source this part - high demand, low competition';
      } else if (opportunityScore >= 50) {
        recommendation = 'Consider sourcing - moderate opportunity';
      } else {
        recommendation = 'Low priority opportunity';
      }

      opportunities.push({
        partCategory: demand.categoryTitle || demand.categoryId,
        title: demand.title,
        compatibility,
        marketSalesLast30Days: soldCount,
        avgSoldPrice: parseFloat(demand.avgPrice)?.toFixed(2),
        competitorCount,
        competitorAvgPrice: comp?.avgPrice?.toFixed(2),
        youHaveInStock,
        youHaveSoldBefore,
        opportunityScore,
        recommendation,
        breakdown: {
          demandScore: Math.round(demandScore),
          priceScore: Math.round(priceScore),
          competitionScore: Math.round(competitionScore),
          historyBonus,
        },
      });
    }

    // Sort by opportunity score
    opportunities.sort((a, b) => b.opportunityScore - a.opportunityScore);

    return opportunities.slice(0, limit);
  }
}

module.exports = OpportunityService;
