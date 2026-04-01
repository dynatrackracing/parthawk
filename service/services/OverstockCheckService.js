'use strict';

const log = require('pino')({ name: 'OverstockCheckService' });
const { database } = require('../database/database');

class OverstockCheckService {
  async checkAll() {
    const watching = await database('overstock_watch').where('status', 'watching');
    let triggered = 0;

    for (const row of watching) {
      const listing = await database('YourListing')
        .where('ebayItemId', row.ebay_item_id)
        .first();

      let liveQty;
      if (!listing || (listing.listingStatus && /ended|inactive/i.test(listing.listingStatus))) {
        liveQty = 0;
      } else {
        liveQty = (listing.quantityAvailable != null) ? parseInt(listing.quantityAvailable) || 1 : 1;
      }

      await database('overstock_watch')
        .where('id', row.id)
        .update({ current_quantity: liveQty, updated_at: new Date() });

      if (liveQty <= row.restock_target) {
        await database('overstock_watch')
          .where('id', row.id)
          .update({ status: 'triggered', triggered_at: new Date(), updated_at: new Date() });

        // Check for existing unclaimed OVERSTOCK alert for this item
        const existing = await database('scout_alerts')
          .where('source', 'OVERSTOCK')
          .where('source_title', row.title)
          .where('claimed', false)
          .first();

        if (!existing) {
          const partValue = listing ? (parseFloat(listing.currentPrice) || null) : null;
          await database('scout_alerts').insert({
            source: 'OVERSTOCK',
            source_title: row.title,
            part_value: partValue,
            yard_name: null,
            vehicle_year: null,
            vehicle_make: null,
            vehicle_model: null,
            claimed: false,
          });
        }

        log.info('Overstock alert triggered: %s — qty %d hit target %d', row.title, liveQty, row.restock_target);
        triggered++;
      }
    }

    return { checked: watching.length, triggered };
  }
}

module.exports = OverstockCheckService;
