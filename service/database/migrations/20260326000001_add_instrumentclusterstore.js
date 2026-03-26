'use strict';

exports.up = async function(knex) {
  // Add competitor seller
  const exists = await knex('SoldItemSeller').where('name', 'instrumentclusterstore').first();
  if (!exists) {
    await knex('SoldItemSeller').insert({
      name: 'instrumentclusterstore',
      enabled: true,
      itemsScraped: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  }
};

exports.down = async function(knex) {
  await knex('SoldItemSeller').where('name', 'instrumentclusterstore').del();
};
