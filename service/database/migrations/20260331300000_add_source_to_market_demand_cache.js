exports.up = async function(knex) {
  const hasSource = await knex.schema.hasColumn('market_demand_cache', 'source');
  if (!hasSource) {
    await knex.schema.alterTable('market_demand_cache', (table) => {
      table.varchar('source', 32);
    });
  }
  const hasMedian = await knex.schema.hasColumn('market_demand_cache', 'ebay_median_price');
  if (!hasMedian) {
    await knex.schema.alterTable('market_demand_cache', (table) => {
      table.decimal('ebay_median_price', 10, 2);
    });
  }
};
exports.down = async function(knex) {
  await knex.schema.alterTable('market_demand_cache', (table) => {
    table.dropColumn('source');
    table.dropColumn('ebay_median_price');
  });
};
