'use strict';
require('dotenv').config();

const axios = require('axios').default;
const xml2js = require('xml2js');

async function checkItem(itemId) {
  const url = 'https://api.ebay.com/ws/api.dll';

  const headers = {
    'X-EBAY-API-COMPATIBILITY-LEVEL': '1225',
    'X-EBAY-API-DEV-NAME': process.env.TRADING_API_DEV_NAME,
    'X-EBAY-API-APP-NAME': process.env.TRADING_API_APP_NAME,
    'X-EBAY-API-CERT-NAME': process.env.TRADING_API_CERT_NAME,
    'X-EBAY-API-SITEID': '0',
    'X-EBAY-API-CALL-NAME': 'GetItem',
    'Content-Type': 'text/xml',
  };

  const xml = `<?xml version="1.0" encoding="utf-8"?>
    <GetItemRequest xmlns="urn:ebay:apis:eBLBaseComponents">
      <RequesterCredentials>
        <eBayAuthToken>${process.env.TRADING_API_TOKEN}</eBayAuthToken>
      </RequesterCredentials>
      <ItemID>${itemId}</ItemID>
      <DetailLevel>ReturnAll</DetailLevel>
    </GetItemRequest>`;

  console.log('Checking item via Trading API:', itemId);

  try {
    const response = await axios.post(url, xml, { headers });
    const parsed = await xml2js.parseStringPromise(response.data, { explicitArray: false });

    const item = parsed.GetItemResponse?.Item;
    if (!item) {
      console.log('No item data returned');
      console.log('Response:', JSON.stringify(parsed, null, 2).substring(0, 500));
      return;
    }

    console.log('\n=== Item Details from API ===');
    console.log('ItemID:', item.ItemID);
    console.log('Title:', item.Title?.substring(0, 60));
    console.log('StartTime:', item.ListingDetails?.StartTime);
    console.log('EndTime:', item.ListingDetails?.EndTime);
    console.log('ListingStatus:', item.SellingStatus?.ListingStatus);
    console.log('CurrentPrice:', item.SellingStatus?.CurrentPrice?._);

  } catch (error) {
    console.error('Error:', error.response?.data || error.message);
  }
}

// Check a completed listing
checkItem('236552475815');
