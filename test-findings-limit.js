const axios = require('axios');
require('dotenv').config();

const appName = process.env.FINDINGS_APP_NAME || process.env.TRADING_API_APP_NAME;
console.log('Using app name:', appName ? appName.substring(0, 10) + '...' : 'NOT SET');

async function testLimit() {
  try {
    const response = await axios({
      method: 'POST',
      url: 'https://svcs.ebay.com/services/search/FindingService/v1',
      headers: {
        'X-EBAY-SOA-SERVICE-NAME': 'FindingService',
        'X-EBAY-SOA-SERVICE-VERSION': '1.12.0',
        'X-EBAY-SOA-SECURITY-APPNAME': appName,
        'X-EBAY-SOA-GLOBAL-ID': 'EBAY-US',
        'X-EBAY-SOA-OPERATION-NAME': 'findCompletedItems',
        'X-EBAY-SOA-REQUEST-DATA-FORMAT': 'XML',
        'X-EBAY-SOA-RESPONSE-DATA-FORMAT': 'XML',
        'Content-Type': 'text/xml',
      },
      data: '<?xml version="1.0" encoding="utf-8"?><findCompletedItemsRequest xmlns="http://www.ebay.com/marketplace/search/v1/services"><itemFilter><n>Seller</n><value>importapart</value></itemFilter><itemFilter><n>SoldItemsOnly</n><value>true</value></itemFilter><paginationInput><entriesPerPage>1</entriesPerPage><pageNumber>1</pageNumber></paginationInput></findCompletedItemsRequest>',
    });

    if (response.data.includes('exceeded')) {
      console.log('STATUS: RATE LIMITED - limit exceeded');
      console.log('Resets at midnight Pacific time');
    } else if (response.data.includes('Success')) {
      console.log('STATUS: WORKING - API is available');
      var match = response.data.match(/totalEntries>(\d+)</);
      if (match) console.log('Total entries available:', match[1]);
    } else {
      console.log('STATUS: UNKNOWN');
    }
    console.log('\nRaw response snippet:', response.data.substring(0, 500));
  } catch (err) {
    console.log('STATUS: ERROR -', err.message);
    if (err.response) console.log('Response:', err.response.data.substring(0, 500));
  }
}

testLimit();
