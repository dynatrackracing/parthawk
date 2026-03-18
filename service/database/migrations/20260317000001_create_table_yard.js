'use strict';

exports.up = async function(knex) {
  // Yard profiles
  await knex.schema.createTable('yard', (table) => {
    table.uuid('id').primary();
    table.string('name', 255).notNullable();
    table.string('chain', 100);
    table.string('address', 500);
    table.decimal('lat', 10, 7);
    table.decimal('lng', 10, 7);
    table.decimal('distance_from_base', 8, 2);
    table.decimal('entry_fee', 8, 2).defaultTo(0);
    table.decimal('tax_rate', 5, 4).defaultTo(0);
    table.string('scrape_url', 1000);
    table.string('scrape_method', 50).defaultTo('none'); // none, automated, on_demand
    table.timestamp('last_scraped');
    table.timestamp('last_visited');
    table.decimal('avg_yield', 8, 2);
    table.decimal('avg_rating', 3, 2);
    table.boolean('flagged').defaultTo(false);
    table.text('flag_reason');
    table.boolean('enabled').defaultTo(true);
    table.string('visit_frequency', 50).defaultTo('local'); // local, day_trip, road_trip
    table.text('notes');
    table.timestamp('createdAt').notNullable().defaultTo(knex.fn.now());
    table.timestamp('updatedAt').notNullable().defaultTo(knex.fn.now());

    table.index('chain');
    table.index('enabled');
    table.index('flagged');
    table.index('visit_frequency');
  });

  // Yard vehicle inventory from scrapes
  await knex.schema.createTable('yard_vehicle', (table) => {
    table.uuid('id').primary();
    table.uuid('yard_id').references('id').inTable('yard').onDelete('CASCADE');
    table.string('year', 10);
    table.string('make', 100);
    table.string('model', 100);
    table.string('trim', 100);
    table.string('color', 100);
    table.string('row_number', 50);
    table.string('vin', 20);
    table.date('date_added');
    table.timestamp('scraped_at').notNullable().defaultTo(knex.fn.now());
    table.boolean('active').defaultTo(true);
    table.timestamp('createdAt').notNullable().defaultTo(knex.fn.now());
    table.timestamp('updatedAt').notNullable().defaultTo(knex.fn.now());

    table.index('yard_id');
    table.index(['year', 'make', 'model']);
    table.index('scraped_at');
    table.index('active');
    table.index('date_added');
  });

  // Yard visit feedback
  await knex.schema.createTable('yard_visit_feedback', (table) => {
    table.uuid('id').primary();
    table.uuid('yard_id').references('id').inTable('yard').onDelete('CASCADE');
    table.string('puller_name', 255);
    table.date('visit_date').notNullable();
    table.integer('rating');
    table.text('notes');
    table.timestamp('createdAt').notNullable().defaultTo(knex.fn.now());

    table.index('yard_id');
    table.index('visit_date');
  });

  // Seed the yards from the spec
  const { v4: uuidv4 } = require('uuid');
  
  await knex('yard').insert([
    // Local yards (within 60 miles) - automated daily scrape
    {
      id: uuidv4(),
      name: 'LKQ Raleigh',
      chain: 'LKQ',
      address: 'Raleigh, NC',
      distance_from_base: 18,
      entry_fee: 2.00,
      tax_rate: 0.0725,
      scrape_url: 'https://www.lkqpickyourpart.com/locations/LKQ-Pick-Your-Part-Raleigh--78/',
      scrape_method: 'automated',
      visit_frequency: 'local',
      enabled: true,
      notes: 'Core local yard. Daily 2am scrape.'
    },
    {
      id: uuidv4(),
      name: 'LKQ Durham',
      chain: 'LKQ',
      address: 'Durham, NC',
      distance_from_base: 12,
      entry_fee: 2.00,
      tax_rate: 0.0725,
      scrape_url: 'https://www.lkqpickyourpart.com/locations/LKQ-Pick-Your-Part-Durham--79/',
      scrape_method: 'automated',
      visit_frequency: 'local',
      enabled: true,
      notes: 'Core local yard. Daily 2am scrape.'
    },
    {
      id: uuidv4(),
      name: 'LKQ Greensboro',
      chain: 'LKQ',
      address: 'Greensboro, NC',
      distance_from_base: 55,
      entry_fee: 2.00,
      tax_rate: 0.0675,
      scrape_url: 'https://www.lkqpickyourpart.com/locations/LKQ-Pick-Your-Part-Greensboro--80/',
      scrape_method: 'automated',
      visit_frequency: 'local',
      enabled: true,
      notes: 'Core local yard. Daily 2am scrape.'
    },
    {
      id: uuidv4(),
      name: 'LKQ East NC',
      chain: 'LKQ',
      address: 'East NC',
      distance_from_base: 45,
      entry_fee: 2.00,
      tax_rate: 0.0700,
      scrape_url: 'https://www.lkqpickyourpart.com/locations/LKQ-Pick-Your-Part-East-NC--81/',
      scrape_method: 'automated',
      visit_frequency: 'local',
      enabled: true,
      notes: 'Core local yard. Daily 2am scrape.'
    },
    // On-demand yards
    {
      id: uuidv4(),
      name: 'Foss U-Pull-It La Grange',
      chain: 'Foss',
      address: 'La Grange, NC',
      distance_from_base: 55,
      entry_fee: 0,
      tax_rate: 0.0700,
      scrape_url: 'https://www.fossupullit.com/inventory',
      scrape_method: 'on_demand',
      visit_frequency: 'local',
      enabled: true,
      notes: 'Dynamic JS site - Puppeteer required. On-demand scrape only.'
    },
    {
      id: uuidv4(),
      name: 'Foss U-Pull-It Jacksonville',
      chain: 'Foss',
      address: 'Jacksonville, NC',
      distance_from_base: 75,
      entry_fee: 0,
      tax_rate: 0.0700,
      scrape_url: 'https://www.fossupullit.com/inventory',
      scrape_method: 'on_demand',
      visit_frequency: 'local',
      enabled: true,
      notes: 'Dynamic JS site - Puppeteer required. On-demand scrape only.'
    },
    {
      id: uuidv4(),
      name: "Young's U-Pull-It Goldsboro",
      chain: 'Youngs',
      address: 'Goldsboro, NC',
      distance_from_base: 50,
      entry_fee: 0,
      tax_rate: 0.0700,
      scrape_url: 'https://www.youngsautocenter.com/latest-arrivals',
      scrape_method: 'on_demand',
      visit_frequency: 'local',
      enabled: true,
      notes: 'Has Latest Arrivals page. On-demand scrape.'
    },
    {
      id: uuidv4(),
      name: 'Pull-A-Part Charlotte',
      chain: 'Pull-A-Part',
      address: 'Charlotte, NC',
      distance_from_base: 165,
      entry_fee: 0,
      tax_rate: 0.0725,
      scrape_url: 'https://www.pullapart.com/locations/charlotte-nc/',
      scrape_method: 'on_demand',
      visit_frequency: 'day_trip',
      enabled: true,
      notes: 'Pull-A-Part owns U-Pull-&-Pay. Same scraper covers both brands.'
    },
    // Flagged yards - do not go
    {
      id: uuidv4(),
      name: "Baughman's U-Pull-It",
      chain: null,
      address: 'NC',
      distance_from_base: 0,
      entry_fee: 0,
      tax_rate: 0.0700,
      scrape_method: 'none',
      visit_frequency: 'local',
      enabled: false,
      flagged: true,
      flag_reason: 'Do not go.',
      notes: 'Flagged - do not visit.'
    },
    {
      id: uuidv4(),
      name: '1213 N Plymouth',
      chain: null,
      address: 'NC',
      distance_from_base: 0,
      entry_fee: 0,
      tax_rate: 0.0700,
      scrape_method: 'none',
      visit_frequency: 'local',
      enabled: false,
      flagged: true,
      flag_reason: 'Do not go.',
      notes: 'Flagged - do not visit.'
    },
    {
      id: uuidv4(),
      name: "Harry's We Buy It",
      chain: null,
      address: 'NC',
      distance_from_base: 142,
      entry_fee: 22.00,
      tax_rate: 0.0700,
      scrape_method: 'none',
      visit_frequency: 'day_trip',
      enabled: false,
      flagged: true,
      flag_reason: 'Very small - do not go.',
      notes: '$20 deposit + $2/hour entry fee. Watch the deposit - they charge per hour.'
    },
  ]);
};

exports.down = async function(knex) {
  await knex.schema.dropTableIfExists('yard_visit_feedback');
  await knex.schema.dropTableIfExists('yard_vehicle');
  await knex.schema.dropTableIfExists('yard');
};
