'use strict';

const { log } = require('../lib/logger');
const SoldItem = require('../models/SoldItem');
const CompetitorListing = require('../models/CompetitorListing');
const YourSale = require('../models/YourSale');
const YourListing = require('../models/YourListing');

/**
 * DemandAnalysisService - Advanced market demand and inventory analytics
 *
 * Features:
 * 1. Sales velocity tracking (how fast items sell at different prices)
 * 2. Demand forecasting based on historical patterns
 * 3. Stale inventory detection
 * 4. Category-level market insights
 * 5. Seller performance comparison
 */
class DemandAnalysisService {
  constructor() {
    this.log = log.child({ class: 'DemandAnalysisService' }, true);
  }

  /**
   * Calculate sell-through rate for your inventory
   * Higher rate = items selling faster
   */
  async calculateSellThroughRate(daysBack = 30) {
    const startDate = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000);

    const [soldCount, avgListingCount] = await Promise.all([
      YourSale.query()
        .where('soldDate', '>=', startDate)
        .count('* as count')
        .first(),
      YourListing.query()
        .where('listingStatus', 'Active')
        .count('* as count')
        .first(),
    ]);

    const sold = parseInt(soldCount?.count || 0, 10);
    const active = parseInt(avgListingCount?.count || 0, 10);

    if (active === 0) return { sellThroughRate: 0, details: 'No active listings' };

    const sellThroughRate = (sold / (sold + active)) * 100;

    return {
      sellThroughRate: Math.round(sellThroughRate * 100) / 100,
      soldItems: sold,
      activeListings: active,
      daysAnalyzed: daysBack,
      insight: this.getSellThroughInsight(sellThroughRate),
    };
  }

  getSellThroughInsight(rate) {
    if (rate >= 50) return 'Excellent sell-through. Your inventory is moving fast!';
    if (rate >= 30) return 'Good sell-through rate. Healthy inventory turnover.';
    if (rate >= 15) return 'Average sell-through. Consider price optimization.';
    if (rate >= 5) return 'Low sell-through. Review pricing and listing quality.';
    return 'Very low sell-through. Major pricing or demand issues.';
  }

  /**
   * Find stale inventory that hasn't sold in a long time
   */
  async findStaleInventory(daysThreshold = 60, limit = 50) {
    const thresholdDate = new Date(Date.now() - daysThreshold * 24 * 60 * 60 * 1000);

    const staleListings = await YourListing.query()
      .where('listingStatus', 'Active')
      .where('startTime', '<=', thresholdDate)
      .orderBy('startTime', 'asc')
      .limit(limit);

    return staleListings.map(listing => ({
      id: listing.id,
      title: listing.title,
      currentPrice: parseFloat(listing.currentPrice),
      daysListed: Math.floor((Date.now() - new Date(listing.startTime).getTime()) / (24 * 60 * 60 * 1000)),
      startTime: listing.startTime,
      recommendation: 'Consider price reduction or relisting',
    }));
  }

  /**
   * Analyze demand by tracking sales velocity over time
   * Returns daily/weekly sales patterns
   */
  async analyzeSalesVelocity(daysBack = 90) {
    const startDate = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000);

    const yourSales = await YourSale.query()
      .where('soldDate', '>=', startDate)
      .select(
        YourSale.raw("DATE_TRUNC('week', \"soldDate\") as week"),
        YourSale.raw('COUNT(*) as sales_count'),
        YourSale.raw('SUM("salePrice") as total_revenue'),
        YourSale.raw('AVG("salePrice") as avg_price')
      )
      .groupByRaw("DATE_TRUNC('week', \"soldDate\")")
      .orderBy('week', 'asc');

    const totalCount = yourSales.reduce((s, r) => s + parseInt(r.sales_count, 10), 0);
    const totalRevenue = yourSales.reduce((s, r) => s + parseFloat(r.total_revenue || 0), 0);

    return {
      yourVelocity: yourSales.map(row => ({
        week: row.week,
        salesCount: parseInt(row.sales_count, 10),
        totalRevenue: parseFloat(row.total_revenue || 0),
        avgPrice: parseFloat(row.avg_price || 0),
      })),
      totals: {
        count: totalCount,
        revenue: totalRevenue,
        avgPrice: totalCount > 0 ? totalRevenue / totalCount : 0,
      },
      daysAnalyzed: daysBack,
    };
  }

  /**
   * Get top performing products (best sellers)
   */
  async getTopPerformers(limit = 20, daysBack = 90) {
    const startDate = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000);
    const sales = await YourSale.query()
      .where('soldDate', '>=', startDate)
      .select(
        'title',
        YourSale.raw('COUNT(*) as sales_count'),
        YourSale.raw('SUM("salePrice") as total_revenue'),
        YourSale.raw('AVG("salePrice") as avg_price')
      )
      .groupBy('title')
      .orderByRaw('COUNT(*) DESC')
      .limit(limit);

    return sales.map(row => ({
      title: row.title,
      salesCount: parseInt(row.sales_count, 10),
      totalRevenue: parseFloat(row.total_revenue || 0),
      avgPrice: parseFloat(row.avg_price || 0),
    }));
  }

  /**
   * Analyze competition level for a keyword/category
   */
  async analyzeCompetition(keywords) {
    if (!keywords) return null;

    const keywordList = keywords.split(' ').filter(k => k.length > 2);
    if (keywordList.length === 0) return null;

    // Build query for competitors
    let competitorQuery = CompetitorListing.query();
    keywordList.forEach((keyword, index) => {
      if (index === 0) {
        competitorQuery = competitorQuery.where('title', 'ilike', `%${keyword}%`);
      } else {
        competitorQuery = competitorQuery.orWhere('title', 'ilike', `%${keyword}%`);
      }
    });

    // Build query for sold items
    let soldQuery = SoldItem.query();
    keywordList.forEach((keyword, index) => {
      if (index === 0) {
        soldQuery = soldQuery.where('title', 'ilike', `%${keyword}%`);
      } else {
        soldQuery = soldQuery.orWhere('title', 'ilike', `%${keyword}%`);
      }
    });

    const [competitors, soldItems] = await Promise.all([
      competitorQuery.select(
        CompetitorListing.raw('COUNT(*) as count'),
        CompetitorListing.raw('COUNT(DISTINCT seller) as unique_sellers'),
        CompetitorListing.raw('AVG("currentPrice") as avg_price'),
        CompetitorListing.raw('MIN("currentPrice") as min_price'),
        CompetitorListing.raw('MAX("currentPrice") as max_price')
      ).first(),
      soldQuery.select(
        SoldItem.raw('COUNT(*) as count'),
        SoldItem.raw('AVG("soldPrice") as avg_price'),
        SoldItem.raw('MIN("soldPrice") as min_price'),
        SoldItem.raw('MAX("soldPrice") as max_price')
      ).first(),
    ]);

    const competitorCount = parseInt(competitors?.count || 0, 10);
    const soldCount = parseInt(soldItems?.count || 0, 10);
    const uniqueSellers = parseInt(competitors?.unique_sellers || 0, 10);

    // Calculate competition score (lower is better for entry)
    let competitionLevel = 'low';
    let competitionScore = 0;

    if (competitorCount > 50 || uniqueSellers > 20) {
      competitionLevel = 'high';
      competitionScore = 80 + Math.min(20, competitorCount / 10);
    } else if (competitorCount > 20 || uniqueSellers > 10) {
      competitionLevel = 'medium';
      competitionScore = 40 + Math.min(40, competitorCount / 2);
    } else {
      competitionLevel = 'low';
      competitionScore = Math.min(40, competitorCount * 2);
    }

    // Calculate demand score
    let demandLevel = 'low';
    let demandScore = 0;

    if (soldCount > 50) {
      demandLevel = 'high';
      demandScore = 80 + Math.min(20, soldCount / 10);
    } else if (soldCount > 20) {
      demandLevel = 'medium';
      demandScore = 40 + Math.min(40, soldCount);
    } else {
      demandLevel = 'low';
      demandScore = Math.min(40, soldCount * 2);
    }

    // Calculate opportunity score (high demand + low competition = good opportunity)
    const opportunityScore = Math.max(0, demandScore - (competitionScore * 0.5));

    return {
      keywords,
      competition: {
        listingCount: competitorCount,
        uniqueSellers,
        avgPrice: parseFloat(competitors?.avg_price || 0),
        priceRange: {
          min: parseFloat(competitors?.min_price || 0),
          max: parseFloat(competitors?.max_price || 0),
        },
        level: competitionLevel,
        score: Math.round(competitionScore),
      },
      demand: {
        soldCount,
        avgSoldPrice: parseFloat(soldItems?.avg_price || 0),
        priceRange: {
          min: parseFloat(soldItems?.min_price || 0),
          max: parseFloat(soldItems?.max_price || 0),
        },
        level: demandLevel,
        score: Math.round(demandScore),
      },
      opportunity: {
        score: Math.round(opportunityScore),
        recommendation: this.getOpportunityRecommendation(opportunityScore, demandLevel, competitionLevel),
      },
    };
  }

  getOpportunityRecommendation(score, demandLevel, competitionLevel) {
    if (score >= 60 && demandLevel === 'high' && competitionLevel === 'low') {
      return 'Excellent opportunity! High demand with low competition.';
    }
    if (score >= 40) {
      return 'Good opportunity. Consider entering this market.';
    }
    if (demandLevel === 'low') {
      return 'Low demand market. Consider other categories.';
    }
    if (competitionLevel === 'high') {
      return 'High competition. Need competitive pricing to succeed.';
    }
    return 'Moderate opportunity. Proceed with caution.';
  }

  /**
   * Get comprehensive market health dashboard data
   */
  async getMarketHealthDashboard() {
    const [sellThrough, staleItems, topPerformers, velocityData] = await Promise.all([
      this.calculateSellThroughRate(30),
      this.findStaleInventory(60, 10),
      this.getTopPerformers(10),
      this.analyzeSalesVelocity(60),
    ]);

    // Calculate overall health score
    let healthScore = 50; // Base score

    // Sell-through rate impact
    healthScore += Math.min(25, sellThrough.sellThroughRate / 2);

    // Stale inventory penalty
    healthScore -= Math.min(15, staleItems.length);

    // Recent velocity trend
    if (velocityData.yourVelocity.length >= 2) {
      const recent = velocityData.yourVelocity.slice(-2);
      if (recent.length === 2 && recent[1].salesCount > recent[0].salesCount) {
        healthScore += 10; // Improving trend
      } else if (recent.length === 2 && recent[1].salesCount < recent[0].salesCount * 0.7) {
        healthScore -= 10; // Declining trend
      }
    }

    healthScore = Math.max(0, Math.min(100, Math.round(healthScore)));

    return {
      healthScore,
      healthRating: this.getHealthRating(healthScore),
      sellThrough,
      staleInventoryCount: staleItems.length,
      staleInventorySample: staleItems.slice(0, 5),
      topPerformers: topPerformers.slice(0, 5),
      velocityTrend: {
        weeks: velocityData.yourVelocity.length,
        recentWeekSales: velocityData.yourVelocity.slice(-1)[0]?.salesCount || 0,
        avgWeeklySales: velocityData.yourVelocity.length > 0
          ? Math.round(velocityData.yourVelocity.reduce((acc, w) => acc + w.salesCount, 0) / velocityData.yourVelocity.length)
          : 0,
      },
    };
  }

  getHealthRating(score) {
    if (score >= 80) return { label: 'Excellent', color: 'green' };
    if (score >= 60) return { label: 'Good', color: 'blue' };
    if (score >= 40) return { label: 'Fair', color: 'yellow' };
    if (score >= 20) return { label: 'Poor', color: 'orange' };
    return { label: 'Critical', color: 'red' };
  }
}

module.exports = DemandAnalysisService;
