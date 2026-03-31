'use strict';

exports.up = async (knex) => {
  // Table 1: ebay_message_templates
  if (!await knex.schema.hasTable('ebay_message_templates')) {
    await knex.schema.createTable('ebay_message_templates', (t) => {
      t.increments('id').primary();
      t.string('template_key', 32).unique().notNullable();
      t.text('subject');
      t.text('body').notNullable();
      t.boolean('is_active').defaultTo(true);
      t.string('api_target', 32).notNullable().defaultTo('trading');
      t.timestamp('created_at').defaultTo(knex.fn.now());
      t.timestamp('updated_at').defaultTo(knex.fn.now());
    });
  }

  // Table 2: ebay_messages (sent message log)
  if (!await knex.schema.hasTable('ebay_messages')) {
    await knex.schema.createTable('ebay_messages', (t) => {
      t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      t.string('order_id', 64).notNullable();
      t.string('item_id', 64).notNullable();
      t.string('buyer_user_id', 128).notNullable();
      t.string('template_key', 32).notNullable();
      t.text('subject');
      t.text('body').notNullable();
      t.text('rendered_body');
      t.timestamp('sent_at');
      t.string('status', 16).notNullable().defaultTo('pending');
      t.string('error_code', 32);
      t.text('error_detail');
      t.text('api_response');
      t.integer('retry_count').defaultTo(0);
      t.string('ebay_store', 64);
      t.string('trigger_source', 32);
      t.timestamp('created_at').defaultTo(knex.fn.now());
      t.timestamp('updated_at').defaultTo(knex.fn.now());
    });

    await knex.schema.raw(`
      CREATE UNIQUE INDEX idx_ebay_messages_idempotent ON ebay_messages(order_id, template_key);
      CREATE INDEX idx_ebay_messages_order ON ebay_messages(order_id);
      CREATE INDEX idx_ebay_messages_buyer ON ebay_messages(buyer_user_id);
      CREATE INDEX idx_ebay_messages_status ON ebay_messages(status);
      CREATE INDEX idx_ebay_messages_template ON ebay_messages(template_key, sent_at);
    `);
  }

  // Table 3: ebay_message_queue
  if (!await knex.schema.hasTable('ebay_message_queue')) {
    await knex.schema.createTable('ebay_message_queue', (t) => {
      t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      t.string('order_id', 64).notNullable();
      t.string('item_id', 64).notNullable();
      t.string('buyer_user_id', 128).notNullable();
      t.string('template_key', 32).notNullable();
      t.timestamp('scheduled_at').notNullable();
      t.string('status', 16).notNullable().defaultTo('pending');
      t.string('claimed_by', 64);
      t.timestamp('claimed_at');
      t.string('return_id', 64);
      t.string('ebay_store', 64);
      t.timestamp('created_at').defaultTo(knex.fn.now());
    });

    await knex.schema.raw(`
      CREATE UNIQUE INDEX idx_message_queue_idempotent ON ebay_message_queue(order_id, template_key);
      CREATE INDEX idx_message_queue_pending ON ebay_message_queue(scheduled_at) WHERE status = 'pending';
    `);
  }

  // Seed templates
  const existing = await knex('ebay_message_templates').count('* as count').first();
  if (parseInt(existing.count) === 0) {
    await knex('ebay_message_templates').insert([
      {
        template_key: 'post_purchase',
        subject: 'Your DynaTrack Order — What to Know Before It Arrives',
        body: `Thank you for your order from DynaTrack.

Before shipment, each item goes through our quality-control process to verify part identification, condition, and listing accuracy. This helps ensure accuracy and faster resolution if an issue ever comes up.

Please confirm the part number and application match your vehicle before installation. Compatibility charts are helpful, but they should not be the sole basis for purchase.

If anything appears incorrect when your order arrives, contact us through eBay before installing, modifying, or disassembling the part. We respond quickly and can usually resolve issues much more efficiently when we hear from you first.`,
        is_active: true,
        api_target: 'trading',
      },
      {
        template_key: 'post_delivery',
        subject: 'Your DynaTrack Order Has Been Delivered',
        body: `Your DynaTrack order for {ITEM_TITLE} shows as delivered.

Please inspect the part and confirm it matches your application before installation. If anything seems off, message us through eBay right away so we can help.

If the part needs to be returned, the core unit must come back complete and unaltered — all original internal components intact, with no parts removed, swapped, or substituted. Normal installation and removal is expected, but items returned with missing or substituted components will not qualify for a full refund.`,
        is_active: true,
        api_target: 'trading',
      },
      {
        template_key: 'return_opened',
        subject: null,
        body: `We received your return request for {ITEM_TITLE}.

Our pre-shipment process allows us to verify the exact unit sent in each order. Returns are confirmed against the original shipped unit.

To qualify for refund, the returned item must be the same unit originally shipped — complete, with all internal components intact. Items with parts removed, swapped, or substituted, or units that do not match the original shipment, will not qualify for full refund consideration.

Questions about the return process can be directed to us here.`,
        is_active: true,
        api_target: 'post_order',
      },
    ]);
  }
};

exports.down = async (knex) => {
  await knex.schema.dropTableIfExists('ebay_message_queue');
  await knex.schema.dropTableIfExists('ebay_messages');
  await knex.schema.dropTableIfExists('ebay_message_templates');
};
