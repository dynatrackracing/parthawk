#!/usr/bin/env node
'use strict';

require('dotenv').config();
const axios = require('axios');
const xml2js = require('xml2js');

// Find app name from env
const appName = process.env.FINDINGS_APP_NAME || process.env.EBAY_APP_ID || process.env.EBAY_CLIENT_ID || process.env.TRADING_API_APP_NAME;

console.log('=== eBay ENV VARS ===');
console.log('FINDINGS_APP_NAME:', process.env.FINDINGS_APP_NAME || 'NOT SET');
console.log('EBAY_APP_ID:', process.env.EBAY_APP_ID || 'NOT SET');
console.log('EBAY_CLIENT_ID:', process.env.EBAY_CLIENT_ID || 'NOT SET');
console.log('TRADING_API_APP_NAME:', process.env.TRADING_API_APP_NAME ? 'SET (' + process.env.TRADING_API_APP_NAME.substring(0, 20) + '...)' : 'NOT SET');
console.log('TRADING_API_DEV_NAME:', process.env.TRADING_API_DEV_NAME ? 'SET' : 'NOT SET');
console.log('TRADING_API_TOKEN:', process.env.TRADING_API_TOKEN ? 'SET (' + process.env.TRADING_API_TOKEN.length + ' chars)' : 'NOT SET');
console.log('Using app name:', appName ? appName.substring(0, 25) + '...' : 'NONE');
console.log();

if (!appName) {
  console.error('ERROR: No eBay app name found in env. Set FINDINGS_APP_NAME or TRADING_API_APP_NAME.');
  process.exit(1);
}

const url = 'https://svcs.ebay.com/services/search/FindingService/v1';

const headers = {
  'X-EBAY-SOA-SERVICE-NAME': 'FindingService',
  'X-EBAY-SOA-SERVICE-VERSION': '1.12.0',
  'X-EBAY-SOA-SECURITY-APPNAME': appName,
  'X-EBAY-SOA-GLOBAL-ID': 'EBAY-US',
  'X-EBAY-SOA-OPERATION-NAME': 'findCompletedItems',
  'X-EBAY-SOA-REQUEST-DATA-FORMAT': 'XML',
  'X-EBAY-SOA-RESPONSE-DATA-FORMAT': 'XML',
  'Content-Type': 'text/xml',
};

const body = `<?xml version="1.0" encoding="utf-8"?>
<findCompletedItemsRequest xmlns="http://www.ebay.com/marketplace/search/v1/services">
  <itemFilter><name>Seller</name><value>importapart</value></itemFilter>
  <itemFilter><name>SoldItemsOnly</name><value>true</value></itemFilter>
  <paginationInput><entriesPerPage>10</entriesPerPage><pageNumber>1</pageNumber></paginationInput>
  <sortOrder>EndTimeSoonest</sortOrder>
</findCompletedItemsRequest>`;

async function run() {
  console.log('=== CALLING FINDING API ===');
  console.log('URL:', url);
  console.log('Seller: importapart');
  console.log('Filter: SoldItemsOnly=true\n');

  try {
    const res = await axios.post(url, body, { headers, timeout: 15000 });
    console.log('HTTP Status:', res.status);
    console.log('Response length:', res.data.length, 'chars\n');

    const parsed = await xml2js.parseStringPromise(res.data);
    const resp = parsed.findCompletedItemsResponse;

    const ack = resp.ack?.[0];
    console.log('API Ack:', ack);

    if (ack === 'Failure') {
      const err = resp.errorMessage?.[0]?.error?.[0];
      console.log('Error:', err?.message?.[0] || JSON.stringify(err));
      return;
    }

    const totalEntries = resp.paginationOutput?.[0]?.totalEntries?.[0];
    const totalPages = resp.paginationOutput?.[0]?.totalPages?.[0];
    console.log('Total entries:', totalEntries);
    console.log('Total pages:', totalPages);

    const items = resp.searchResult?.[0]?.item || [];
    console.log('Items on this page:', items.length);
    console.log('\n=== FIRST 5 ITEMS ===');

    for (let i = 0; i < Math.min(5, items.length); i++) {
      const item = items[i];
      const title = item.title?.[0] || '?';
      const price = item.sellingStatus?.[0]?.currentPrice?.[0]?._ || item.sellingStatus?.[0]?.currentPrice?.[0] || '?';
      const endTime = item.listingInfo?.[0]?.endTime?.[0] || '?';
      const itemId = item.itemId?.[0] || '?';
      const category = item.primaryCategory?.[0]?.categoryName?.[0] || '?';

      console.log(`\n${i + 1}. ${title.substring(0, 75)}`);
      console.log(`   Price: $${price} | Ended: ${endTime} | ID: ${itemId}`);
      console.log(`   Category: ${category}`);
    }

  } catch (err) {
    console.error('REQUEST FAILED');
    console.error('Status:', err.response?.status);
    console.error('Data:', err.response?.data?.substring?.(0, 500) || err.message);
  }
}

run();
