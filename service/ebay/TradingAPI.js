'use strict';
const { log } = require('../lib/logger');
const { v4: uuidv4 } = require('uuid');
const axios = require('axios').default;
const xml2js = require('xml2js');


class TradingAPI {
  constructor() {
    this.log = log.child({ class: 'TradingAPI' }, true);
    this.url = 'https://api.ebay.com/ws/api.dll';
    this.isProd = process.env.NODE_ENV === 'production';
  }


  createHeaders() {
    const headers = {
      'X-EBAY-API-COMPATIBILITY-LEVEL': '837',
      'X-EBAY-API-DEV-NAME': process.env.TRADING_API_DEV_NAME,
      'X-EBAY-API-APP-NAME': process.env.TRADING_API_APP_NAME,
      'X-EBAY-API-CERT-NAME': process.env.TRADING_API_CERT_NAME,
      'X-EBAY-API-SITEID': '0',
      'X-EBAY-API-CALL-NAME': 'GetItem',
      'Content-Type': 'text/xml',
      'User-Agent': 'eBaySDK/2.2.0 Python/3.8.8 Darwin/20.4.0',
      'X-EBAY-SDK-REQUEST-ID': uuidv4(),
    };

    return headers;
  }

  async makeRequest({ ebayItemId, options }) {
    let response;
    let headers = this.createHeaders();
    try {
      response = await axios({
        method: 'POST',
        url: this.url,
        headers,
        timeout: 15000,
        data: `<?xml version=\'1.0\' encoding=\'utf-8\'?><GetItemRequest xmlns="urn:ebay:apis:eBLBaseComponents"><RequesterCredentials><eBayAuthToken>${process.env.TRADING_API_TOKEN}</eBayAuthToken></RequesterCredentials><IncludeItemCompatibilityList>${options.includeItemCompatibility || 'true'}</IncludeItemCompatibilityList><IncludeItemSpecifics>${options.includeItemSpecifics || 'true'}</IncludeItemSpecifics><ItemID>${ebayItemId}</ItemID></GetItemRequest>`
      });
    } catch (err) {
      this.log.error({ err, ebayItemId }, 'Issue getting specifics for the item');
      return null;
    }

    let parsed = await xml2js.parseStringPromise(response.data);
    return parsed;
  }
}

module.exports = TradingAPI;