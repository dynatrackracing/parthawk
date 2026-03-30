'use strict';

exports.up = async function(knex) {
  await knex.schema.createTable('programming_reference', (table) => {
    table.increments('id').primary();
    table.text('brand_group').notNullable();
    table.text('module_type').notNullable();
    table.integer('year').notNullable();
    table.varchar('required', 10).notNullable();
    table.text('notes');
    table.timestamp('created_at').defaultTo(knex.fn.now());
  });
  await knex.raw('CREATE UNIQUE INDEX idx_prog_ref_lookup ON programming_reference(brand_group, module_type, year)');
  await knex.raw('CREATE INDEX idx_prog_ref_group_module ON programming_reference(brand_group, module_type)');

  // Seed from programming_db.json
  const path = require('path');
  const fs = require('fs');
  const jsonPath = path.resolve(__dirname, '..', '..', 'public', 'programming_db.json');
  if (!fs.existsSync(jsonPath)) {
    console.log('programming_db.json not found, skipping seed');
    return;
  }
  const data = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
  const rules = data.rules || {};
  const rows = [];
  for (const [key, val] of Object.entries(rules)) {
    const parts = key.split('|');
    if (parts.length !== 3) continue;
    const [brandGroup, moduleType, yearStr] = parts;
    const year = parseInt(yearStr);
    if (!year || !brandGroup || !moduleType) continue;
    rows.push({
      brand_group: brandGroup,
      module_type: moduleType,
      year,
      required: val.r || 'VERIFY',
      notes: val.n || null,
    });
  }
  // Insert in batches of 200
  for (let i = 0; i < rows.length; i += 200) {
    await knex('programming_reference').insert(rows.slice(i, i + 200));
  }
  console.log(`Seeded ${rows.length} programming_reference rows`);
};

exports.down = async function(knex) {
  await knex.schema.dropTableIfExists('programming_reference');
};
