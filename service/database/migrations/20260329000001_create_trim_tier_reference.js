'use strict';

const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse/sync');

exports.up = async function(knex) {
  const exists = await knex.schema.hasTable('trim_tier_reference');
  if (exists) return;

  await knex.schema.createTable('trim_tier_reference', (table) => {
    table.increments('id').primary();
    table.text('make').notNullable();
    table.text('model').notNullable();
    table.integer('gen_start').notNullable();
    table.integer('gen_end').notNullable();
    table.text('trim').notNullable();
    table.integer('tier').notNullable();
    table.text('tier_name');
    table.text('top_engine');
    table.text('audio_brand');
    table.text('expected_parts');
    table.text('notes');
    table.boolean('cult').defaultTo(false);
  });

  await knex.raw('CREATE INDEX idx_ttr_make_model ON trim_tier_reference (LOWER(make), LOWER(model))');
  await knex.raw('CREATE INDEX idx_ttr_years ON trim_tier_reference (gen_start, gen_end)');

  // Seed from CSV
  try {
    const csvPath = path.resolve(__dirname, '../../data/darkhawk_trim_tier_reference.csv');
    const raw = fs.readFileSync(csvPath, 'utf-8');
    const records = parse(raw, { columns: true, skip_empty_lines: true, bom: true });

    const batch = records.map(r => ({
      make: r.make || '',
      model: r.model || '',
      gen_start: parseInt(r.gen_start) || 0,
      gen_end: parseInt(r.gen_end) || 0,
      trim: r.trim || '',
      tier: parseInt(r.tier) || 1,
      tier_name: r.tier_name || null,
      top_engine: r.top_engine || null,
      audio_brand: r.audio_brand || null,
      expected_parts: r.expected_parts || null,
      notes: r.notes || null,
      cult: r.cult === 'CULT',
    }));

    // Insert in chunks of 100
    for (let i = 0; i < batch.length; i += 100) {
      await knex('trim_tier_reference').insert(batch.slice(i, i + 100));
    }
    console.log(`[MIGRATION] Seeded trim_tier_reference with ${batch.length} entries`);
  } catch (e) {
    console.log(`[MIGRATION] CSV seed failed: ${e.message} — table created but empty`);
  }
};

exports.down = async function(knex) {
  await knex.schema.dropTableIfExists('trim_tier_reference');
};
