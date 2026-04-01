'use strict';

const log = require('pino')({ name: 'OverstockCheckService' });
const { database } = require('../database/database');

class OverstockCheckService {
  async checkAll() {
    const groups = await database('overstock_group')
      .where('status', 'watching');

    let triggered = 0;

    for (const group of groups) {
      const items = await database('overstock_group_item')
        .where('group_id', group.id);

      let currentStock = 0;

      if (group.group_type === 'single') {
        // Single high-qty listing: check quantity on the one item
        const item = items[0];
        if (item) {
          const listing = await database('YourListing')
            .where('ebayItemId', item.ebay_item_id)
            .first();

          if (!listing || (listing.listingStatus && /ended|inactive/i.test(listing.listingStatus))) {
            currentStock = 0;
            await database('overstock_group_item').where('id', item.id).update({ is_active: false });
          } else {
            currentStock = parseInt(listing.quantityAvailable) || 1;
            await database('overstock_group_item').where('id', item.id).update({
              is_active: true,
              current_price: parseFloat(listing.currentPrice) || null,
            });
          }
        }
      } else {
        // Multi-listing group: count how many items are still active
        for (const item of items) {
          const listing = await database('YourListing')
            .where('ebayItemId', item.ebay_item_id)
            .first();

          if (!listing || (listing.listingStatus && /ended|inactive/i.test(listing.listingStatus))) {
            await database('overstock_group_item').where('id', item.id).update({ is_active: false });
          } else {
            currentStock++;
            await database('overstock_group_item').where('id', item.id).update({
              is_active: true,
              current_price: parseFloat(listing.currentPrice) || null,
            });
          }
        }
      }

      await database('overstock_group')
        .where('id', group.id)
        .update({ current_stock: currentStock, updated_at: new Date() });

      if (currentStock <= group.restock_target) {
        await database('overstock_group')
          .where('id', group.id)
          .update({ status: 'triggered', triggered_at: new Date(), updated_at: new Date() });

        // Check for existing unclaimed alert
        const existing = await database('scout_alerts')
          .where('source', 'OVERSTOCK')
          .where('source_title', group.name)
          .where('claimed', false)
          .first();

        if (!existing) {
          // Compute avg price of active items
          const activeItems = await database('overstock_group_item')
            .where('group_id', group.id)
            .where('is_active', true);
          let avgPrice = null;
          if (activeItems.length > 0) {
            const prices = activeItems.map(i => parseFloat(i.current_price)).filter(p => p > 0);
            if (prices.length > 0) avgPrice = Math.round(prices.reduce((a, b) => a + b, 0) / prices.length);
          }

          await database('scout_alerts').insert({
            source: 'OVERSTOCK',
            source_title: group.name,
            part_value: avgPrice,
            yard_name: null,
            vehicle_year: null,
            vehicle_make: null,
            vehicle_model: null,
            claimed: false,
          });
        }

        log.info('Overstock alert triggered: %s — stock %d hit target %d', group.name, currentStock, group.restock_target);
        triggered++;
      }
    }

    return { checked: groups.length, triggered };
  }
}

module.exports = OverstockCheckService;
