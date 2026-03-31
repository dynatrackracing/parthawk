'use strict';

exports.up = async function(knex) {
  // Create table
  await knex.schema.createTable('trim_value_validation', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.string('make', 100).notNullable();
    t.string('part_type', 100).notNullable();
    t.string('premium_keyword', 200).notNullable();
    t.decimal('premium_avg_price', 10, 2);
    t.decimal('base_avg_price', 10, 2);
    t.decimal('delta', 10, 2).notNullable();
    t.integer('n_premium').defaultTo(0);
    t.integer('n_base').defaultTo(0);
    t.string('verdict', 20).notNullable();
    t.string('source', 20).notNullable().defaultTo('YOUR_DATA');
    t.timestamp('validated_at').notNullable().defaultTo(knex.fn.now());
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
    t.unique(['make', 'part_type', 'premium_keyword']);
    t.index(['make', 'verdict']);
    t.index(['verdict']);
  });

  // Seed validated data from Step 2 analysis
  const rows = [
    // ── CONFIRMED (delta > $75) ──
    { make: 'Mercedes', part_type: 'amp', premium_keyword: 'Harman Kardon', premium_avg_price: 503, base_avg_price: 170, delta: 334, n_premium: 3, n_base: 46, verdict: 'CONFIRMED' },
    { make: 'BMW', part_type: 'amp', premium_keyword: 'Harman Kardon', premium_avg_price: 429, base_avg_price: 171, delta: 258, n_premium: 3, n_base: 67, verdict: 'CONFIRMED' },
    { make: 'Nissan', part_type: 'amp', premium_keyword: 'Bose', premium_avg_price: 285, base_avg_price: 130, delta: 155, n_premium: 3, n_base: 5, verdict: 'CONFIRMED' },
    { make: 'Lexus', part_type: 'nav_radio', premium_keyword: 'navigation', premium_avg_price: 474, base_avg_price: 175, delta: 299, n_premium: 11, n_base: 88, verdict: 'CONFIRMED' },
    { make: 'Hyundai', part_type: 'nav_radio', premium_keyword: 'navigation', premium_avg_price: 284, base_avg_price: 106, delta: 179, n_premium: 5, n_base: 30, verdict: 'CONFIRMED' },
    { make: 'Mercedes', part_type: 'nav_radio', premium_keyword: 'navigation', premium_avg_price: 282, base_avg_price: 189, delta: 92, n_premium: 9, n_base: 33, verdict: 'CONFIRMED' },

    // ── WORTH_IT (delta $30-$75) ──
    { make: 'Mini', part_type: 'amp', premium_keyword: 'Harman Kardon', premium_avg_price: 164, base_avg_price: 125, delta: 39, n_premium: 5, n_base: 14, verdict: 'WORTH_IT' },
    { make: 'Toyota', part_type: 'nav_radio', premium_keyword: 'navigation', premium_avg_price: 200, base_avg_price: 163, delta: 37, n_premium: 3, n_base: 61, verdict: 'WORTH_IT' },

    // ── MARGINAL (delta < $30) ──
    { make: 'Audi', part_type: 'amp', premium_keyword: 'B&O', premium_avg_price: 187, base_avg_price: 159, delta: 28, n_premium: 8, n_base: 10, verdict: 'MARGINAL' },
    { make: 'Chevrolet', part_type: 'amp', premium_keyword: 'Bose', premium_avg_price: 115, base_avg_price: 112, delta: 3, n_premium: 6, n_base: 3, verdict: 'MARGINAL' },
    { make: 'Kia', part_type: 'amp', premium_keyword: 'JBL', premium_avg_price: 127, base_avg_price: 104, delta: 23, n_premium: 15, n_base: 19, verdict: 'MARGINAL' },
    { make: 'Toyota', part_type: 'amp', premium_keyword: 'JBL', premium_avg_price: 151, base_avg_price: 132, delta: 19, n_premium: 17, n_base: 90, verdict: 'MARGINAL' },
    { make: 'Mitsubishi', part_type: 'amp', premium_keyword: 'Rockford Fosgate', premium_avg_price: 163, base_avg_price: 135, delta: 28, n_premium: 7, n_base: 20, verdict: 'MARGINAL' },
    { make: 'Audi', part_type: 'nav_radio', premium_keyword: 'navigation', premium_avg_price: 145, base_avg_price: 133, delta: 12, n_premium: 5, n_base: 25, verdict: 'MARGINAL' },
    { make: 'Ford', part_type: 'nav_radio', premium_keyword: 'navigation', premium_avg_price: 202, base_avg_price: 192, delta: 10, n_premium: 6, n_base: 153, verdict: 'MARGINAL' },

    // ── NO_PREMIUM (negative delta — warnings) ──
    { make: 'Audi', part_type: 'amp', premium_keyword: 'Bose', premium_avg_price: 116, base_avg_price: 159, delta: -43, n_premium: 13, n_base: 10, verdict: 'NO_PREMIUM' },
    { make: 'Buick', part_type: 'amp', premium_keyword: 'Bose', premium_avg_price: 114, base_avg_price: 146, delta: -32, n_premium: 5, n_base: 8, verdict: 'NO_PREMIUM' },
    { make: 'Ford', part_type: 'amp', premium_keyword: 'Sony', premium_avg_price: 85, base_avg_price: 229, delta: -144, n_premium: 3, n_base: 15, verdict: 'NO_PREMIUM' },
    { make: 'Hyundai', part_type: 'amp', premium_keyword: 'JBL', premium_avg_price: 56, base_avg_price: 115, delta: -59, n_premium: 4, n_base: 26, verdict: 'NO_PREMIUM' },
    { make: 'Infiniti', part_type: 'amp', premium_keyword: 'Bose', premium_avg_price: 76, base_avg_price: 131, delta: -55, n_premium: 3, n_base: 9, verdict: 'NO_PREMIUM' },
    { make: 'Lexus', part_type: 'amp', premium_keyword: 'Mark Levinson', premium_avg_price: 137, base_avg_price: 156, delta: -19, n_premium: 29, n_base: 58, verdict: 'NO_PREMIUM' },
    { make: 'Mitsubishi', part_type: 'amp', premium_keyword: 'Infinity', premium_avg_price: 124, base_avg_price: 135, delta: -10, n_premium: 19, n_base: 20, verdict: 'NO_PREMIUM' },
    { make: 'Subaru', part_type: 'amp', premium_keyword: 'Harman Kardon', premium_avg_price: 126, base_avg_price: 151, delta: -26, n_premium: 12, n_base: 19, verdict: 'NO_PREMIUM' },
    { make: 'Chrysler', part_type: 'nav_radio', premium_keyword: 'navigation', premium_avg_price: 141, base_avg_price: 142, delta: -1, n_premium: 6, n_base: 11, verdict: 'NO_PREMIUM' },
    { make: 'Dodge', part_type: 'nav_radio', premium_keyword: 'navigation', premium_avg_price: 127, base_avg_price: 147, delta: -20, n_premium: 12, n_base: 16, verdict: 'NO_PREMIUM' },
    { make: 'Genesis', part_type: 'nav_radio', premium_keyword: 'navigation', premium_avg_price: 213, base_avg_price: 372, delta: -159, n_premium: 12, n_base: 5, verdict: 'NO_PREMIUM' },
    { make: 'Jeep', part_type: 'nav_radio', premium_keyword: 'navigation', premium_avg_price: 139, base_avg_price: 286, delta: -147, n_premium: 3, n_base: 8, verdict: 'NO_PREMIUM' },
    { make: 'Mazda', part_type: 'nav_radio', premium_keyword: 'navigation', premium_avg_price: 115, base_avg_price: 163, delta: -48, n_premium: 6, n_base: 101, verdict: 'NO_PREMIUM' },
    { make: 'Volkswagen', part_type: 'nav_radio', premium_keyword: 'navigation', premium_avg_price: 180, base_avg_price: 192, delta: -12, n_premium: 3, n_base: 54, verdict: 'NO_PREMIUM' },
  ];

  for (const row of rows) {
    await knex('trim_value_validation').insert({
      ...row,
      source: 'YOUR_DATA',
    });
  }
};

exports.down = async function(knex) {
  await knex.schema.dropTableIfExists('trim_value_validation');
};
