'use strict';

exports.up = async function(knex) {
  await knex.schema.alterTable('scout_alerts', (table) => {
    table.boolean('claimed').defaultTo(false);
    table.text('claimed_by');
    table.timestamp('claimed_at');
  });
  // Add pulled_from to want list so we can show "Pulled from LKQ Durham"
  const has = await knex.schema.hasColumn('restock_want_list', 'pulled_from');
  if (!has) {
    await knex.schema.alterTable('restock_want_list', (table) => {
      table.text('pulled_from');
    });
  }
};

exports.down = async function(knex) {
  await knex.schema.alterTable('scout_alerts', (table) => {
    table.dropColumn('claimed');
    table.dropColumn('claimed_by');
    table.dropColumn('claimed_at');
  });
  try { await knex.schema.alterTable('restock_want_list', t => { t.dropColumn('pulled_from'); }); } catch(e) {}
};
