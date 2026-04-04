'use strict';

const { log } = require('../lib/logger');
const SellerAPI = require('../ebay/SellerAPI');
const YourSale = require('../models/YourSale');
const YourListing = require('../models/YourListing');
const Promise = require('bluebird');
const { extractStructuredFields } = require('../utils/partIntelligence');

/**
 * YourDataManager - Syncs YOUR eBay seller data (orders and listings) to database
 */
class YourDataManager {
  constructor() {
    this.log = log.child({ class: 'YourDataManager' }, true);
    this.sellerAPI = new SellerAPI();
  }

  /**
   * Sync all your data (orders and listings)
   */
  async syncAll({ daysBack = 365 } = {}) {
    this.log.info({ daysBack }, 'Starting full sync of your eBay data');

    const results = {
      orders: { synced: 0, errors: 0 },
      listings: { synced: 0, errors: 0 },
    };

    try {
      const orderResults = await this.syncOrders({ daysBack });
      results.orders = orderResults;
    } catch (err) {
      this.log.error({ err }, 'Error syncing orders');
      results.orders.errors = 1;
    }

    try {
      const listingResults = await this.syncListings();
      results.listings = listingResults;
    } catch (err) {
      this.log.error({ err }, 'Error syncing listings');
      results.listings.errors = 1;
    }

    // Overstock watch check — runs after every listing sync
    try {
      const OverstockCheckService = require('../services/OverstockCheckService');
      const overstockService = new OverstockCheckService();
      const result = await overstockService.checkAll();
      if (result.triggered > 0) {
        this.log.info({ result }, 'Overstock alerts triggered');
      } else {
        this.log.debug({ result }, 'Overstock watch check complete');
      }
    } catch (err) {
      this.log.error({ err }, 'Overstock watch check failed (non-fatal)');
    }

    // Auto-resolve cache entries against newly synced listings
    try {
      const CacheService = require('../services/CacheService');
      const cacheService = new CacheService();
      const cacheResult = await cacheService.resolveFromListings();
      this.log.info({ cacheResult }, 'Cache auto-resolution complete after YourData sync');
    } catch (err) {
      this.log.warn({ err: err.message }, 'Cache auto-resolution failed (non-fatal)');
    }

    this.log.info({ results }, 'Completed full sync of your eBay data');
    return results;
  }

  /**
   * Sync your orders/sales from eBay
   * @param {Object} options
   * @param {number} options.daysBack - Number of days back to fetch (default: 365)
   */
  async syncOrders({ daysBack = 365 } = {}) {
    this.log.info({ daysBack }, 'Syncing orders from eBay');

    let synced = 0;
    let errors = 0;

    try {
      const orders = await this.sellerAPI.getOrders({ daysBack });
      this.log.info({ orderCount: orders.length }, 'Fetched orders from eBay');

      // Flatten orders into individual line items (each item sold is a YourSale record)
      await Promise.mapSeries(orders, async (order) => {
        await Promise.mapSeries(order.lineItems, async (lineItem) => {
          try {
            const toInsert = {
              ebayOrderId: `${order.orderId}-${lineItem.itemId}`, // Unique per line item
              ebayItemId: lineItem.itemId,
              title: lineItem.title,
              sku: lineItem.sku,
              quantity: lineItem.quantity,
              salePrice: lineItem.price,
              soldDate: order.createdTime ? new Date(order.createdTime) : null,
              buyerUsername: order.buyerUsername,
              shippedDate: order.shippedTime ? new Date(order.shippedTime) : null,
              store: 'dynatrack',
            };

            // Clean Pipe: extract structured fields from title
            const extracted = extractStructuredFields(toInsert.title);
            toInsert.partNumberBase = extracted.partNumberBase || null;
            toInsert.partType = extracted.partType || 'OTHER';
            toInsert.extractedMake = extracted.extractedMake || null;
            toInsert.extractedModel = extracted.extractedModel || null;

            // Upsert on conflict (order ID + item ID)
            // id omitted from insert so DB generates it via gen_random_uuid(),
            // and .merge() won't touch id on conflict — preserving FK references
            await YourSale.query()
              .insert(toInsert)
              .onConflict('ebayOrderId')
              .merge();

            synced++;
          } catch (err) {
            this.log.error({ err, orderId: order.orderId, itemId: lineItem.itemId }, 'Error inserting sale');
            errors++;
          }
        });
      });

      this.log.info({ synced, errors }, 'Completed syncing orders');
    } catch (err) {
      this.log.error({ err }, 'Error fetching orders from eBay');
      throw err;
    }

    return { synced, errors };
  }

  /**
   * Sync your active listings from eBay
   */
  async syncListings() {
    this.log.info('Syncing active listings from eBay');

    let synced = 0;
    let errors = 0;

    try {
      const listings = await this.sellerAPI.getActiveListings();
      this.log.info({ listingCount: listings.length }, 'Fetched listings from eBay');

      await Promise.mapSeries(listings, async (listing) => {
        try {
          const toInsert = {
            ebayItemId: listing.itemId,
            title: listing.title,
            sku: listing.sku,
            quantityAvailable: listing.quantityAvailable,
            currentPrice: listing.currentPrice,
            listingStatus: (parseInt(listing.quantityAvailable) || 0) <= 0 ? 'Ended' : (listing.listingStatus || 'Active'),
            startTime: listing.startTime ? new Date(listing.startTime) : null,
            viewItemUrl: listing.viewItemUrl,
            store: 'dynatrack',
            syncedAt: new Date(),
          };

          // Clean Pipe: extract structured fields from title
          const extracted = extractStructuredFields(toInsert.title);
          toInsert.partNumberBase = extracted.partNumberBase || null;
          toInsert.partType = extracted.partType || 'OTHER';
          toInsert.extractedMake = extracted.extractedMake || null;
          toInsert.extractedModel = extracted.extractedModel || null;

          // Upsert on conflict (item ID)
          // id omitted from insert so DB generates it via gen_random_uuid(),
          // and .merge() won't touch id on conflict — preserving FK references from PriceCheck
          await YourListing.query()
            .insert(toInsert)
            .onConflict('ebayItemId')
            .merge();

          synced++;
        } catch (err) {
          this.log.error({ err, itemId: listing.itemId }, 'Error inserting listing');
          errors++;
        }
      });

      // Mark listings not in this sync as Ended (they're no longer active on eBay)
      const syncedIds = listings.map(l => l.itemId).filter(Boolean);
      let deactivated = 0;
      if (syncedIds.length > 0) {
        try {
          const { database } = require('../database/database');
          const now = new Date();
          const result = await database('YourListing')
            .where('listingStatus', 'Active')
            .where('store', 'dynatrack') // CRITICAL: only deactivate dynatrack listings
            .where('syncedAt', '<', new Date(now.getTime() - 60000)) // not synced in last minute
            .whereNotIn('ebayItemId', syncedIds)
            .update({ listingStatus: 'Ended', updatedAt: now });
          deactivated = result;
          if (deactivated > 0) {
            this.log.info({ deactivated }, 'Marked stale listings as Ended');
          }
        } catch (err) {
          this.log.warn({ err: err.message }, 'Failed to deactivate stale listings (non-fatal)');
        }
      }

      this.log.info({ synced, errors, deactivated }, 'Completed syncing listings');
    } catch (err) {
      this.log.error({ err }, 'Error fetching listings from eBay');
      throw err;
    }

    return { synced, errors };
  }

  /**
   * Get sync statistics
   */
  async getStats() {
    const [salesCount, listingsCount, recentSales] = await Promise.all([
      YourSale.query().count('* as count').first(),
      YourListing.query().count('* as count').first(),
      YourSale.query()
        .where('soldDate', '>=', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000))
        .count('* as count')
        .first(),
    ]);

    return {
      totalSales: parseInt(salesCount.count, 10),
      totalListings: parseInt(listingsCount.count, 10),
      salesLast30Days: parseInt(recentSales.count, 10),
    };
  }
}

module.exports = YourDataManager;
