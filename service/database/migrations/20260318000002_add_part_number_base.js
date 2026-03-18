'use strict';

const { normalizePartNumber } = require('../../lib/partNumberUtils');

module.exports = {
  async up(knex) {
    // Add partNumberBase column to Item table
    const hasCol = await knex.schema.hasColumn('Item', 'partNumberBase');
    if (!hasCol) {
      await knex.schema.alterTable('Item', (table) => {
        table.text('partNumberBase');
      });
      await knex.schema.alterTable('Item', (table) => {
        table.index('partNumberBase', 'idx_item_part_number_base');
      });
    }

    // Backfill existing records with normalized part numbers
    const items = await knex('Item')
      .whereNotNull('manufacturerPartNumber')
      .select('id', 'manufacturerPartNumber');

    for (const item of items) {
      const base = normalizePartNumber(item.manufacturerPartNumber);
      if (base && base !== item.manufacturerPartNumber) {
        await knex('Item')
          .where('id', item.id)
          .update({ partNumberBase: base });
      } else {
        await knex('Item')
          .where('id', item.id)
          .update({ partNumberBase: item.manufacturerPartNumber });
      }
    }
  },

  async down(knex) {
    const hasCol = await knex.schema.hasColumn('Item', 'partNumberBase');
    if (hasCol) {
      await knex.schema.alterTable('Item', (table) => {
        table.dropColumn('partNumberBase');
      });
    }
  }
};
