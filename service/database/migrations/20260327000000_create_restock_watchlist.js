exports.up = async function(knex) {
  const exists = await knex.schema.hasTable('restock_watchlist');
  if (exists) return;
  return knex.schema.createTable('restock_watchlist', (table) => {
    table.increments('id').primary();
    table.string('part_number_base', 50).notNullable().unique();
    table.text('part_description');
    table.integer('target_stock').defaultTo(1);
    table.string('priority', 20).defaultTo('normal');
    table.text('notes');
    table.timestamp('added_at').defaultTo(knex.fn.now());
    table.boolean('active').defaultTo(true);
  });
};

exports.down = function(knex) {
  return knex.schema.dropTableIfExists('restock_watchlist');
};
