/**
 * DEBUG - See what GetItem actually returns for your listings
 * Shows raw response structure to understand where fitment data lives
 * 
 * Usage:
 *   cd C:\Users\atenr\Downloads\parthawk-complete\parthawk-deploy
 *   set DATABASE_URL=postgresql://postgres:jOWykUhLuUbWSVASAAZZHqsDVfyqaFTN@switchyard.proxy.rlwy.net:12023/railway
 *   node debug-getitem-response.js
 */

'use strict';
require('dotenv').config();

const axios = require('axios');
const xml2js = require('xml2js');
const { v4: uuidv4 } = require('uuid');

const knex = require('knex')({
  client: 'pg',
  connection: process.env.DATABASE_URL,
  searchPath: ['public'],
});

function createHeaders(callName = 'GetItem') {
  return {
    'X-EBAY-API-COMPATIBILITY-LEVEL': '837',
    'X-EBAY-API-DEV-NAME': process.env.TRADING_API_DEV_NAME,
    'X-EBAY-API-APP-NAME': process.env.TRADING_API_APP_NAME,
    'X-EBAY-API-CERT-NAME': process.env.TRADING_API_CERT_NAME,
    'X-EBAY-API-SITEID': '0',
    'X-EBAY-API-CALL-NAME': callName,
    'X-EBAY-API-IAF-TOKEN': process.env.TRADING_API_TOKEN,
    'Content-Type': 'text/xml',
    'X-EBAY-SDK-REQUEST-ID': uuidv4(),
  };
}

async function run() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('  DEBUG: GetItem Raw Response Analysis');
  console.log('  Auth method: OAuth via X-EBAY-API-IAF-TOKEN header');
  console.log('═══════════════════════════════════════════════════════════\n');

  if (!process.env.TRADING_API_TOKEN) {
    console.error('TRADING_API_TOKEN not set');
    await knex.destroy();
    return;
  }

  // Get 3 active listings
  const listings = await knex('YourListing')
    .select('ebayItemId', 'title')
    .where('listingStatus', 'Active')
    .whereNotNull('ebayItemId')
    .limit(3);

  console.log(`Testing ${listings.length} listings:\n`);

  for (const listing of listings) {
    console.log('━'.repeat(70));
    console.log(`eBay ID: ${listing.ebayItemId}`);
    console.log(`Title:   ${listing.title}`);
    console.log('');

    // Call GetItem with ALL detail - token sent via X-EBAY-API-IAF-TOKEN header
    const xml = `<?xml version="1.0" encoding="utf-8"?>
<GetItemRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  <IncludeItemCompatibilityList>true</IncludeItemCompatibilityList>
  <IncludeItemSpecifics>true</IncludeItemSpecifics>
  <DetailLevel>ReturnAll</DetailLevel>
  <ItemID>${listing.ebayItemId}</ItemID>
</GetItemRequest>`;

    try {
      const response = await axios({
        method: 'POST',
        url: 'https://api.ebay.com/ws/api.dll',
        headers: createHeaders(),
        timeout: 15000,
        data: xml,
      });

      const parsed = await xml2js.parseStringPromise(response.data);
      const item = parsed?.GetItemResponse?.Item?.[0];

      if (!item) {
        console.log('  ⚠️ No Item in response');
        console.log('  Response keys:', Object.keys(parsed?.GetItemResponse || {}));
        // Check for errors
        const errors = parsed?.GetItemResponse?.Errors;
        if (errors) {
          console.log('  Errors:', JSON.stringify(errors, null, 2));
        }
        continue;
      }

      // Show what's available
      console.log('  Item keys:', Object.keys(item).join(', '));
      console.log('');

      // Check ItemCompatibilityList
      const compatList = item?.ItemCompatibilityList?.[0];
      if (compatList) {
        const compats = compatList?.Compatibility || [];
        console.log(`  ItemCompatibilityList: ${compats.length} entries`);
        // Show first 3
        compats.slice(0, 3).forEach((c, i) => {
          const nvList = c?.NameValueList || [];
          const pairs = nvList.map(nv => `${nv.Name?.[0]}=${nv.Value?.[0]}`).join(', ');
          console.log(`    [${i}] ${pairs}`);
        });
        if (compats.length > 3) console.log(`    ... and ${compats.length - 3} more`);
      } else {
        console.log('  ItemCompatibilityList: ❌ NOT PRESENT');
      }
      console.log('');

      // Check ItemSpecifics
      const specifics = item?.ItemSpecifics?.[0]?.NameValueList || [];
      if (specifics.length > 0) {
        console.log(`  ItemSpecifics: ${specifics.length} fields`);
        specifics.forEach(nv => {
          const name = nv.Name?.[0];
          const value = nv.Value?.[0];
          console.log(`    ${name}: ${value}`);
        });
      } else {
        console.log('  ItemSpecifics: ❌ NOT PRESENT');
      }
      console.log('');

      // Check Category
      const catId = item?.PrimaryCategory?.[0]?.CategoryID?.[0];
      const catName = item?.PrimaryCategory?.[0]?.CategoryName?.[0];
      console.log(`  Category: ${catId} - ${catName}`);

      // Check if listing has any compatibility-related fields
      const condId = item?.ConditionID?.[0];
      const condName = item?.ConditionDisplayName?.[0];
      console.log(`  Condition: ${condId} - ${condName}`);
      
      // SKU
      const sku = item?.SKU?.[0];
      console.log(`  SKU: ${sku || '(none)'}`);

    } catch (err) {
      console.log(`  ❌ API Error: ${err.message}`);
      if (err.response) {
        console.log(`  Status: ${err.response.status}`);
        console.log(`  Data: ${err.response.data?.substring?.(0, 500)}`);
      }
    }

    console.log('');
    await new Promise(r => setTimeout(r, 600));
  }

  console.log('═══════════════════════════════════════════════════════════');
  await knex.destroy();
}

run().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
