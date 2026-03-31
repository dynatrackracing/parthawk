'use strict';

exports.up = async function(knex) {
  const hasType = await knex.schema.hasColumn('SoldItemSeller', 'type');
  if (!hasType) {
    await knex.schema.alterTable('SoldItemSeller', (table) => {
      table.text('type').notNullable().defaultTo('competitor');
    });
    await knex.raw('CREATE INDEX idx_sold_item_seller_type ON "SoldItemSeller"(type)');
  }

  // Upsert prorebuild as rebuild type
  await knex('SoldItemSeller')
    .insert({ name: 'prorebuild', enabled: true, type: 'rebuild' })
    .onConflict('name')
    .merge({ type: 'rebuild' });
};

exports.down = async function(knex) {
  const hasType = await knex.schema.hasColumn('SoldItemSeller', 'type');
  if (hasType) {
    await knex.schema.alterTable('SoldItemSeller', (table) => {
      table.dropColumn('type');
    });
  }
};
