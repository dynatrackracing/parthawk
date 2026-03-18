'use strict';

const yards = [
  { name: 'LKQ Raleigh', chain: 'LKQ', address: 'Raleigh, NC', distance_from_base: 18.0, entry_fee: 2.00, tax_rate: 0.0725, scrape_url: 'https://www.lkqpickyourpart.com/locations/LKQ-Pick-Your-Part-Raleigh--183/', scrape_method: 'automated', visit_frequency: 'local', flagged: false, enabled: true, notes: 'Core local yard. Daily 2am scrape.' },
  { name: 'LKQ Durham', chain: 'LKQ', address: 'Durham, NC', distance_from_base: 12.0, entry_fee: 2.00, tax_rate: 0.0725, scrape_url: 'https://www.lkqpickyourpart.com/locations/LKQ-Pick-Your-Part-Durham--184/', scrape_method: 'automated', visit_frequency: 'local', flagged: false, enabled: true, notes: 'Core local yard. Daily 2am scrape.' },
  { name: 'LKQ Greensboro', chain: 'LKQ', address: 'Greensboro, NC', distance_from_base: 52.0, entry_fee: 2.00, tax_rate: 0.0675, scrape_url: 'https://www.lkqpickyourpart.com/locations/LKQ-Pick-Your-Part-Greensboro--185/', scrape_method: 'automated', visit_frequency: 'local', flagged: false, enabled: true, notes: 'Core local yard. Daily 2am scrape.' },
  { name: 'LKQ East NC', chain: 'LKQ', address: 'East NC', distance_from_base: 55.0, entry_fee: 2.00, tax_rate: 0.0700, scrape_url: 'https://www.lkqpickyourpart.com/locations/', scrape_method: 'automated', visit_frequency: 'local', flagged: false, enabled: true, notes: 'Core local yard. Daily 2am scrape.' },
  { name: 'Foss U-Pull-It La Grange', chain: 'Foss', address: 'La Grange, NC', distance_from_base: 58.0, entry_fee: 0, tax_rate: 0.0700, scrape_url: 'https://www.fossupullit.com/vehicle-inventory', scrape_method: 'on_demand', visit_frequency: 'local', flagged: false, enabled: true, notes: 'Dynamic JS site - Puppeteer required. On-demand scrape only.' },
  { name: 'Foss U-Pull-It Jacksonville', chain: 'Foss', address: 'Jacksonville, NC', distance_from_base: 58.0, entry_fee: 0, tax_rate: 0.0700, scrape_url: 'https://www.fossupullit.com/vehicle-inventory', scrape_method: 'on_demand', visit_frequency: 'local', flagged: false, enabled: true, notes: 'Dynamic JS site - Puppeteer required. On-demand scrape only.' },
  { name: "Young's U-Pull-It Goldsboro", chain: 'Youngs', address: 'Goldsboro, NC', distance_from_base: 45.0, entry_fee: 0, tax_rate: 0.0700, scrape_url: 'https://www.youngsautocenter.com/latest-arrivals', scrape_method: 'on_demand', visit_frequency: 'local', flagged: false, enabled: true, notes: 'Has Latest Arrivals page. On-demand scrape.' },
  { name: 'LKQ Charlotte', chain: 'LKQ', address: 'Charlotte, NC', distance_from_base: 145.0, entry_fee: 2.00, tax_rate: 0.0725, scrape_url: 'https://www.lkqpickyourpart.com/locations/', scrape_method: 'on_demand', visit_frequency: 'day_trip', flagged: false, enabled: true, notes: 'Day trip LKQ location.' },
  { name: 'Foss U-Pull-It Wilson', chain: 'Foss', address: 'Wilson, NC', distance_from_base: 65.0, entry_fee: 0, tax_rate: 0.0700, scrape_url: 'https://www.fossupullit.com/vehicle-inventory', scrape_method: 'on_demand', visit_frequency: 'day_trip', flagged: false, enabled: true, notes: 'On-demand scrape only.' },
  { name: 'Foss U-Pull-It Winston-Salem', chain: 'Foss', address: 'Winston-Salem, NC', distance_from_base: 95.0, entry_fee: 0, tax_rate: 0.0700, scrape_url: 'https://www.fossupullit.com/vehicle-inventory', scrape_method: 'on_demand', visit_frequency: 'day_trip', flagged: false, enabled: true, notes: 'On-demand scrape only.' },
  { name: 'Pull-A-Part Charlotte', chain: 'Pull-A-Part', address: 'Charlotte, NC', distance_from_base: 145.0, entry_fee: 0, tax_rate: 0.0725, scrape_url: 'https://www.pullapart.com/locations/charlotte-nc/', scrape_method: 'on_demand', visit_frequency: 'day_trip', flagged: false, enabled: true, notes: 'Pull-A-Part owns U-Pull-&-Pay. Same scraper covers both brands.' },
  { name: "Baughman's U-Pull-It", chain: null, address: 'NC', distance_from_base: 0, entry_fee: 0, tax_rate: 0.0700, scrape_method: 'none', visit_frequency: 'local', flagged: true, flag_reason: 'Do not go.', enabled: false, notes: 'Flagged - do not visit.' },
  { name: '1213 N Plymouth', chain: null, address: 'NC', distance_from_base: 0, entry_fee: 0, tax_rate: 0.0700, scrape_method: 'none', visit_frequency: 'local', flagged: true, flag_reason: 'Do not go.', enabled: false, notes: 'Flagged - do not visit.' },
  { name: "Harry's We Buy It", chain: null, address: 'NC', distance_from_base: 142.0, entry_fee: 22.00, tax_rate: 0.0700, scrape_method: 'none', visit_frequency: 'day_trip', flagged: true, flag_reason: 'Very small - do not go.', enabled: false, notes: '$20 deposit + $2/hour entry fee.' },
];

module.exports = {
  async up(knex) {
    const { v4: uuidv4 } = require('uuid');
    for (const yard of yards) {
      const exists = await knex('yard').where('name', yard.name).first();
      if (!exists) {
        await knex('yard').insert({
          id: uuidv4(),
          ...yard,
          createdAt: knex.fn.now(),
          updatedAt: knex.fn.now(),
        });
      }
    }
  },
  async down(knex) {
    await knex('yard').whereIn('name', yards.map(y => y.name)).delete();
  }
};
