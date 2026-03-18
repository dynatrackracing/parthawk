'use strict';
require('dotenv').config();

const { Model } = require('objection');
const { database } = require('../database/database');
Model.knex(database);

const YourDataManager = require('../managers/YourDataManager');

async function importData() {
  const manager = new YourDataManager();
  
  console.log('=== Importing Your eBay Data ===\n');
  
  // Import sales from last 90 days
  console.log('1. Importing sales (last 90 days)...');
  const salesResult = await manager.syncOrders({ daysBack: 90 });
  console.log(`   Synced: ${salesResult.synced} sales, Errors: ${salesResult.errors}\n`);
  
  // Import active listings
  console.log('2. Importing active listings...');
  const listingsResult = await manager.syncListings();
  console.log(`   Synced: ${listingsResult.synced} listings, Errors: ${listingsResult.errors}\n`);
  
  // Show stats
  const stats = await manager.getStats();
  console.log('=== Import Complete ===');
  console.log(`Total Sales: ${stats.totalSales}`);
  console.log(`Total Listings: ${stats.totalListings}`);
  console.log(`Sales (last 30 days): ${stats.salesLast30Days}`);
}

importData()
  .then(() => {
    console.log('\nDone!');
    process.exit(0);
  })
  .catch(err => {
    console.error('Error:', err);
    process.exit(1);
  });
