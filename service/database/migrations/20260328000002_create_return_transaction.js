'use strict';

exports.up = async (knex) => {
  await knex.schema.createTable('return_transaction', (t) => {
    t.increments('id').primary();
    t.date('transaction_date').notNullable().index();
    t.string('order_number', 80);
    t.string('legacy_order_id', 80);
    t.string('buyer_username', 80).index();
    t.string('buyer_name', 120);
    t.string('ship_city', 80);
    t.string('ship_state', 80).index();
    t.string('ship_zip', 30);
    t.string('ship_country', 30);
    t.decimal('net_amount', 10, 2);
    t.decimal('gross_amount', 10, 2);
    t.string('ebay_item_id', 80);
    t.string('transaction_id', 80);
    t.string('item_title', 300);
    t.string('custom_label', 80).index();
    t.decimal('item_subtotal', 10, 2);
    t.decimal('shipping_handling', 10, 2);
    t.decimal('fvf_fixed', 10, 2);
    t.decimal('fvf_variable', 10, 2);
    t.decimal('regulatory_fee', 10, 2);
    t.decimal('inad_fee', 10, 2);
    t.decimal('international_fee', 10, 2);
    t.string('reference_id', 80);
    t.string('payout_id', 80);
    t.string('part_type', 40).index();
    t.string('make', 30).index();
    t.boolean('is_formal_return').defaultTo(false);
    t.boolean('has_inad_fee').defaultTo(false);
    t.decimal('abs_gross', 10, 2);
    t.timestamps(true, true);
  });

  await knex.schema.raw(`
    CREATE INDEX idx_return_tx_part_type_date ON return_transaction (part_type, transaction_date);
    CREATE INDEX idx_return_tx_make_date ON return_transaction (make, transaction_date);
    CREATE INDEX idx_return_tx_buyer_gross ON return_transaction (buyer_username, abs_gross);
  `);
};

exports.down = async (knex) => {
  await knex.schema.dropTableIfExists('return_transaction');
};
