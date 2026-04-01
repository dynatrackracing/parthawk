'use strict';

exports.up = async function(knex) {
  await knex.schema.alterTable('YourListing', function(table) {
    table.string('store', 50).defaultTo('dynatrack').index();
  });
  await knex.schema.alterTable('YourSale', function(table) {
    table.string('store', 50).defaultTo('dynatrack').index();
  });
  await knex.raw("UPDATE \"YourListing\" SET store = 'dynatrack' WHERE store IS NULL");
  await knex.raw("UPDATE \"YourSale\" SET store = 'dynatrack' WHERE store IS NULL");
};

exports.down = async function(knex) {
  await knex.schema.alterTable('YourListing', function(table) { table.dropColumn('store'); });
  await knex.schema.alterTable('YourSale', function(table) { table.dropColumn('store'); });
};
