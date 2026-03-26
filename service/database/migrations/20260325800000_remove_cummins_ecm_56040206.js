'use strict';

/**
 * Remove 5.9L Cummins diesel ECM part number 56040206 and all suffix variants
 * (56040206AA, AB, AC, AD, etc.) from all tables. These create false matches
 * against gas Ram 1500s and other vehicles.
 */
module.exports = {
  async up(knex) {
    const results = {};

    // 1. Find Item IDs referencing this part number (for cascade cleanup)
    const items = await knex('Item')
      .where('title', 'ilike', '%56040206%')
      .orWhere('sku', 'ilike', '%56040206%')
      .select('id', 'title', 'sku');
    results.itemsFound = items.length;

    if (items.length > 0) {
      const itemIds = items.map(i => i.id);

      // 2. Remove AutoItemCompatibility references
      try {
        const aicDeleted = await knex('AutoItemCompatibility')
          .whereIn('itemId', itemIds)
          .del();
        results.autoItemCompatibilityDeleted = aicDeleted;
      } catch (e) { results.autoItemCompatibilityError = e.message; }

      // 3. Remove the Items themselves
      const itemsDeleted = await knex('Item')
        .whereIn('id', itemIds)
        .del();
      results.itemsDeleted = itemsDeleted;
    }

    // 4. Remove from scout_alerts
    try {
      const alertsDeleted = await knex('scout_alerts')
        .where('source_title', 'ilike', '%56040206%')
        .del();
      results.scoutAlertsDeleted = alertsDeleted;
    } catch (e) { results.scoutAlertsError = e.message; }

    // 5. Remove from YourListing if present
    try {
      const listingsDeleted = await knex('YourListing')
        .where('title', 'ilike', '%56040206%')
        .del();
      results.yourListingsDeleted = listingsDeleted;
    } catch (e) { /* YourListing may not have this */ }

    // 6. Remove from YourSale if present
    try {
      const salesDeleted = await knex('YourSale')
        .where('title', 'ilike', '%56040206%')
        .del();
      results.yourSalesDeleted = salesDeleted;
    } catch (e) { /* may not have this */ }

    // 7. Remove from restock_want_list if present
    try {
      const wantDeleted = await knex('restock_want_list')
        .where('title', 'ilike', '%56040206%')
        .del();
      results.wantListDeleted = wantDeleted;
    } catch (e) { /* may not have this */ }

    // 8. Verify
    const remaining = await knex('Item')
      .where('title', 'ilike', '%56040206%')
      .orWhere('sku', 'ilike', '%56040206%')
      .count('* as count')
      .first();
    results.remainingItems = parseInt(remaining?.count || 0);

    console.log('[MIGRATION] Removed 5.9L Cummins ECM 56040206 variants:', JSON.stringify(results));
  },

  async down(knex) {
    // Cannot restore deleted records
    console.log('[MIGRATION] Cannot undo 56040206 deletion — records are gone');
  }
};
