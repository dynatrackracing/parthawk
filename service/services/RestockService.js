'use strict';

const { log } = require('../lib/logger');
const { database } = require('../database/database');
const { normalizePartNumber } = require('../lib/partNumberUtils');

/**
 * RestockService — Identifies parts that need restocking
 *
 * Rule: sold >= 2x active stock in 90 days = restock flag.
 * Checks both stores. Recent 30 days weighted heavier.
 * Days-to-sell as tiebreaker.
 */
class RestockService {
  constructor() {
    this.log = log.child({ class: 'RestockService' }, true);
  }

  /**
   * Scan and flag parts that need restocking.
   */
  async scanAndFlag() {
    this.log.info('Running restock scan');

    const cutoff90 = new Date(Date.now() - 90 * 86400000);
    const cutoff30 = new Date(Date.now() - 30 * 86400000);

    // Get sold items grouped by SKU/part number (last 90 days)
    let sales90, sales30;
    try {
      sales90 = await database('YourSale')
        .where('soldDate', '>=', cutoff90)
        .whereNotNull('sku')
        .where('sku', '!=', '')
        .select('sku', 'title', 'salePrice', 'soldDate', 'store');
    } catch (e) {
      this.log.warn({ err: e.message }, 'Could not query YourSale');
      return { scanned: 0, flagged: 0 };
    }

    // Group by normalized part number
    const salesByPart = {};
    for (const sale of sales90) {
      const base = normalizePartNumber(sale.sku);
      if (!base) continue;

      if (!salesByPart[base]) {
        salesByPart[base] = { title: sale.title, sold90: 0, sold30: 0, totalRevenue: 0, dates: [], stores: new Set() };
      }
      salesByPart[base].sold90++;
      salesByPart[base].totalRevenue += parseFloat(sale.salePrice) || 0;
      salesByPart[base].dates.push(new Date(sale.soldDate));
      salesByPart[base].stores.add(sale.store || 'dynatrack');

      if (new Date(sale.soldDate) >= cutoff30) {
        salesByPart[base].sold30++;
      }
    }

    // Get active stock counts
    let activeStock = {};
    try {
      const listings = await database('YourListing')
        .where('listingStatus', 'Active')
        .whereNotNull('sku')
        .select('sku', 'quantityAvailable', 'store');

      for (const listing of listings) {
        const base = normalizePartNumber(listing.sku);
        if (!base) continue;
        activeStock[base] = (activeStock[base] || 0) + (parseInt(listing.quantityAvailable) || 1);
      }
    } catch (e) {
      this.log.warn({ err: e.message }, 'Could not query YourListing for stock');
    }

    // Flag parts where sold >= 2x active stock
    let flagged = 0;
    for (const [base, data] of Object.entries(salesByPart)) {
      const stock = activeStock[base] || 0;

      // sold >= 2x active stock in 90 days = restock flag
      if (data.sold90 < 2 * Math.max(stock, 1)) continue;

      // Calculate avg days to sell (if we have date data)
      const avgDaysToSell = data.dates.length > 1
        ? Math.round((data.dates[data.dates.length - 1] - data.dates[0]) / data.dates.length / 86400000)
        : null;

      const avgPrice = data.sold90 > 0 ? Math.round(data.totalRevenue / data.sold90 * 100) / 100 : 0;

      // Restock score: weight recent 30d sales heavier
      // Score = (sold30 * 2 + sold90) * avgPrice / max(stock, 1)
      const restockScore = Math.round(((data.sold30 * 2 + data.sold90) * avgPrice / Math.max(stock, 1)) * 100) / 100;

      // Upsert restock flag
      try {
        const existing = await database('restock_flag')
          .where('part_number_base', base)
          .first();

        const record = {
          part_number_base: base,
          title: data.title,
          sold_90d: data.sold90,
          sold_30d: data.sold30,
          active_stock: stock,
          avg_sold_price: avgPrice,
          avg_days_to_sell: avgDaysToSell,
          restock_score: restockScore,
          store: data.stores.size > 1 ? 'all' : [...data.stores][0] || 'dynatrack',
          last_checked: new Date(),
        };

        if (existing) {
          await database('restock_flag').where('id', existing.id).update(record);
        } else {
          record.createdAt = new Date();
          await database('restock_flag').insert(record);
        }
        flagged++;
      } catch (err) {
        this.log.warn({ err: err.message, base }, 'restock_flag upsert failed');
      }
    }

    this.log.info({ scanned: Object.keys(salesByPart).length, flagged }, 'Restock scan complete');
    return { scanned: Object.keys(salesByPart).length, flagged };
  }

  /**
   * Get all active restock flags, sorted by score.
   */
  async getFlags({ acknowledged = false, limit = 50 } = {}) {
    try {
      let query = database('restock_flag');
      if (!acknowledged) query = query.where('acknowledged', false);
      return await query.orderBy('restock_score', 'desc').limit(limit);
    } catch (e) { return []; }
  }

  /**
   * Acknowledge a restock flag (puller saw it).
   */
  async acknowledge(id) {
    try {
      await database('restock_flag').where('id', id).update({ acknowledged: true });
      return { success: true };
    } catch (e) { return { success: false, error: e.message }; }
  }
}

module.exports = RestockService;
