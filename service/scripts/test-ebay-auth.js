'use strict';
require('dotenv').config();

const SellerAPI = require('../ebay/SellerAPI');

async function testAuth() {
  const api = new SellerAPI();
  
  console.log('Testing eBay Trading API connection...');
  console.log('Token (first 50 chars):', process.env.TRADING_API_TOKEN?.substring(0, 50));
  
  const result = await api.healthCheck();
  console.log('\nHealth check result:', result);
  
  if (result.success) {
    console.log('\n✅ Connected! Seller ID:', result.sellerId);
  } else {
    console.log('\n❌ Connection failed:', result.error);
  }
}

testAuth().catch(console.error);
