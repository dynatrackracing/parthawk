'use strict';

exports.up = async function(knex) {
  const hasCol = await knex.schema.hasColumn('the_cache', 'item_id');
  if (!hasCol) {
    await knex.schema.alterTable('the_cache', (table) => {
      table.integer('item_id').nullable();
      table.index('item_id', 'idx_cache_item_id');
    });
  }
};

exports.down = async function(knex) {
  const hasCol = await knex.schema.hasColumn('the_cache', 'item_id');
  if (hasCol) {
    await knex.schema.alterTable('the_cache', (table) => {
      table.dropIndex('item_id', 'idx_cache_item_id');
      table.dropColumn('item_id');
    });
  }
};
