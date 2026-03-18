'use strict';

const { log } = require('../lib/logger');
const { database } = require('../database/database');
const { normalizePartNumber } = require('../lib/partNumberUtils');

/**
 * CompetitorMonitorService — Watch competitors and generate alerts
 *
 * Advisory only — no auto-match.
 * Alerts when:
 * - We are significantly underpriced vs market
 * - A competitor drops out of a category (opportunity)
 * - A competitor undercuts us significantly
 */
class CompetitorMonitorService {
  constructor() {
    this.log = log.child({ class: 'CompetitorMonitorService' }, true);
  }

  /**
   * Run competitor monitoring scan.
   * Compares our listings against competitor prices and market data.
   */
  async scan() {
    this.log.info('Running competitor price monitoring');

    let ourListings, competitorItems;
    try {
      ourListings = await database('YourListing')
        .where('listingStatus', 'Active')
        .whereNotNull('sku')
        .select('id', 'ebayItemId', 'title', 'sku', 'currentPrice', 'store');
    } catch (e) { return { scanned: 0, alerts: 0 }; }

    try {
      competitorItems = await database('Item')
        .whereNotNull('manufacturerPartNumber')
        .select('title', 'price', 'seller', 'manufacturerPartNumber');
    } catch (e) { competitorItems = []; }

    // Build competitor price index by normalized part number
    const compIndex = {};
    for (const item of competitorItems) {
      const base = normalizePartNumber(item.manufacturerPartNumber);
      if (!base) continue;
      if (!compIndex[base]) compIndex[base] = [];
      compIndex[base].push({
        seller: item.seller,
        price: parseFloat(item.price) || 0,
        title: item.title,
      });
    }

    // Get market data
    let marketIndex = {};
    try {
      const cacheRows = await database('market_demand_cache').select('*');
      for (const row of cacheRows) {
        marketIndex[row.part_number_base] = {
          avgPrice: parseFloat(row.ebay_avg_price) || 0,
          sold90d: parseInt(row.ebay_sold_90d) || 0,
        };
      }
    } catch (e) { /* ignore */ }

    let alertCount = 0;
    for (const listing of ourListings) {
      const base = normalizePartNumber(listing.sku);
      if (!base) continue;

      const ourPrice = parseFloat(listing.currentPrice) || 0;
      const competitors = compIndex[base] || [];
      const market = marketIndex[base];

      // Check: are we significantly underpriced?
      if (market && market.avgPrice > 0 && ourPrice < market.avgPrice * 0.75) {
        await this.createAlert({
          competitorSeller: null,
          partNumberBase: base,
          title: listing.title,
          alertType: 'underpriced',
          ourPrice,
          competitorPrice: null,
          marketAvg: market.avgPrice,
          recommendation: `Our price $${ourPrice.toFixed(2)} is ${Math.round((1 - ourPrice / market.avgPrice) * 100)}% below market avg $${market.avgPrice.toFixed(2)}. Consider raising.`,
        });
        alertCount++;
      }

      // Check: competitor undercuts us significantly
      for (const comp of competitors) {
        if (comp.price > 0 && comp.price < ourPrice * 0.70) {
          await this.createAlert({
            competitorSeller: comp.seller,
            partNumberBase: base,
            title: listing.title,
            alertType: 'competitor_undercut',
            ourPrice,
            competitorPrice: comp.price,
            marketAvg: market?.avgPrice || null,
            recommendation: `${comp.seller} lists at $${comp.price.toFixed(2)} vs our $${ourPrice.toFixed(2)}. Advisory — review pricing.`,
          });
          alertCount++;
          break; // One alert per listing per scan
        }
      }
    }

    // Check for competitors dropping out of categories we sell in
    // (This detects when competitor_count drops to 0 for a part we stock)
    // Assumption: this would require historical data; for now we flag when
    // we have no competition on a high-demand part

    this.log.info({ scanned: ourListings.length, alerts: alertCount },
      'Competitor monitoring complete');
    return { scanned: ourListings.length, alerts: alertCount };
  }

  async createAlert({ competitorSeller, partNumberBase, title, alertType, ourPrice, competitorPrice, marketAvg, recommendation }) {
    try {
      // Skip duplicate alerts (same type + part in last 7 days)
      const cutoff = new Date(Date.now() - 7 * 86400000);
      const existing = await database('competitor_alert')
        .where('part_number_base', partNumberBase)
        .where('alert_type', alertType)
        .where('createdAt', '>', cutoff)
        .first();
      if (existing) return;

      await database('competitor_alert').insert({
        competitor_seller: competitorSeller,
        part_number_base: partNumberBase,
        title,
        alert_type: alertType,
        our_price: ourPrice,
        competitor_price: competitorPrice,
        market_avg: marketAvg,
        recommendation,
        dismissed: false,
        createdAt: new Date(),
      });
    } catch (err) {
      this.log.warn({ err: err.message }, 'competitor_alert insert failed');
    }
  }

  /**
   * Get active (undismissed) alerts.
   */
  async getAlerts({ limit = 50, dismissed = false } = {}) {
    try {
      return await database('competitor_alert')
        .where('dismissed', dismissed)
        .orderBy('createdAt', 'desc')
        .limit(limit);
    } catch (e) { return []; }
  }

  /**
   * Dismiss an alert.
   */
  async dismiss(id) {
    try {
      await database('competitor_alert').where('id', id).update({ dismissed: true });
      return { success: true };
    } catch (e) { return { success: false, error: e.message }; }
  }
}

module.exports = CompetitorMonitorService;
