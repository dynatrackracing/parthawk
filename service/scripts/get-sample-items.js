'use strict';
require('dotenv').config();

const { Model } = require('objection');
const { database } = require('../database/database');
Model.knex(database);

const YourSale = require('../models/YourSale');

async function getSample() {
  // Get a diverse sample of recent sales with different price ranges
  const sales = await YourSale.query()
    .select('ebayItemId', 'title', 'salePrice')
    .whereNotNull('title')
    .where('salePrice', '>', 50)
    .orderByRaw('RANDOM()')
    .limit(15);

  console.log('Sample items for analysis:\n');
  sales.forEach((s, i) => {
    const shortTitle = s.title.substring(0, 70);
    console.log((i+1) + '. $' + s.salePrice + ' - ' + shortTitle + '...');
  });

  console.log('\n// For script:');
  console.log('const TEST_ITEMS = [');
  sales.forEach(s => {
    const escaped = s.title.replace(/'/g, "\\'");
    console.log("  { itemId: '" + s.ebayItemId + "', price: " + s.salePrice + ", title: '" + escaped + "' },");
  });
  console.log('];');

  process.exit(0);
}

getSample().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
