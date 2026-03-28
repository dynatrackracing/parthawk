'use strict';
const { log } = require('../lib/logger');
const { v4: uuidv4 } = require('uuid');
const axios = require('axios').default;
const xml2js = require('xml2js');

class TradingAPI {
  constructor() {
    this.log = log.child({ class: 'TradingAPI' }, true);
    this.url = 'https://api.ebay.com/ws/api.dll';
  }

  getAuthToken() {
    const token = process.env.TRADING_API_TOKEN;
    if (!token) throw new Error('TRADING_API_TOKEN not configured');
    return token;
  }

  createHeaders(callName = 'GetItem') {
    return {
      'X-EBAY-API-COMPATIBILITY-LEVEL': '1225',
      'X-EBAY-API-DEV-NAME': process.env.TRADING_API_DEV_NAME,
      'X-EBAY-API-APP-NAME': process.env.TRADING_API_APP_NAME,
      'X-EBAY-API-CERT-NAME': process.env.TRADING_API_CERT_NAME,
      'X-EBAY-API-SITEID': '0',
      'X-EBAY-API-CALL-NAME': callName,
      'X-EBAY-API-IAF-TOKEN': this.getAuthToken(),
      'Content-Type': 'text/xml',
    };
  }

  /**
   * GetItem — fetch item details with compatibility and specifics.
   * Backwards-compatible with existing callers.
   */
  async makeRequest({ ebayItemId, options = {} }) {
    try {
      const response = await axios({
        method: 'POST',
        url: this.url,
        headers: this.createHeaders('GetItem'),
        timeout: 15000,
        data: `<?xml version='1.0' encoding='utf-8'?><GetItemRequest xmlns="urn:ebay:apis:eBLBaseComponents"><IncludeItemCompatibilityList>${options.includeItemCompatibility || 'true'}</IncludeItemCompatibilityList><IncludeItemSpecifics>${options.includeItemSpecifics || 'true'}</IncludeItemSpecifics><ItemID>${ebayItemId}</ItemID></GetItemRequest>`,
      });
      return await xml2js.parseStringPromise(response.data);
    } catch (err) {
      this.log.error({ err, ebayItemId }, 'GetItem failed');
      return null;
    }
  }

  /**
   * ReviseItem — change listing price.
   */
  async reviseItem({ ebayItemId, startPrice }) {
    const xml = `<?xml version='1.0' encoding='utf-8'?>
<ReviseItemRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  <Item>
    <ItemID>${ebayItemId}</ItemID>
    <StartPrice>${parseFloat(startPrice).toFixed(2)}</StartPrice>
  </Item>
</ReviseItemRequest>`;

    const response = await axios({
      method: 'POST', url: this.url,
      headers: this.createHeaders('ReviseItem'),
      data: xml, timeout: 15000,
    });

    const parsed = await xml2js.parseStringPromise(response.data);
    const ack = parsed?.ReviseItemResponse?.Ack?.[0];
    if (ack !== 'Success' && ack !== 'Warning') {
      const errorMsg = parsed?.ReviseItemResponse?.Errors?.[0]?.LongMessage?.[0] || 'Unknown error';
      throw new Error(`ReviseItem failed: ${errorMsg}`);
    }
    return { success: true, ack, newPrice: startPrice };
  }

  /**
   * EndItem — end a listing.
   */
  async endItem({ ebayItemId, endingReason = 'NotAvailable' }) {
    const xml = `<?xml version='1.0' encoding='utf-8'?>
<EndItemRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  <ItemID>${ebayItemId}</ItemID>
  <EndingReason>${endingReason}</EndingReason>
</EndItemRequest>`;

    const response = await axios({
      method: 'POST', url: this.url,
      headers: this.createHeaders('EndItem'),
      data: xml, timeout: 15000,
    });

    const parsed = await xml2js.parseStringPromise(response.data);
    const ack = parsed?.EndItemResponse?.Ack?.[0];
    if (ack !== 'Success' && ack !== 'Warning') {
      const errorMsg = parsed?.EndItemResponse?.Errors?.[0]?.LongMessage?.[0] || 'Unknown error';
      throw new Error(`EndItem failed: ${errorMsg}`);
    }
    const endTime = parsed?.EndItemResponse?.EndTime?.[0] || null;
    return { success: true, ack, endTime };
  }

  /**
   * RelistItem — relist an ended item (creates new listing).
   */
  async relistItem({ ebayItemId, startPrice }) {
    let itemXml = `<ItemID>${ebayItemId}</ItemID>`;
    if (startPrice) itemXml += `<StartPrice>${parseFloat(startPrice).toFixed(2)}</StartPrice>`;

    const xml = `<?xml version='1.0' encoding='utf-8'?>
<RelistItemRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  <Item>${itemXml}</Item>
</RelistItemRequest>`;

    const response = await axios({
      method: 'POST', url: this.url,
      headers: this.createHeaders('RelistItem'),
      data: xml, timeout: 15000,
    });

    const parsed = await xml2js.parseStringPromise(response.data);
    const ack = parsed?.RelistItemResponse?.Ack?.[0];
    if (ack !== 'Success' && ack !== 'Warning') {
      const errorMsg = parsed?.RelistItemResponse?.Errors?.[0]?.LongMessage?.[0] || 'Unknown error';
      throw new Error(`RelistItem failed: ${errorMsg}`);
    }
    const newItemId = parsed?.RelistItemResponse?.ItemID?.[0] || null;
    const fees = parsed?.RelistItemResponse?.Fees?.[0]?.Fee || [];
    return { success: true, ack, newItemId, fees: fees.length };
  }
}

module.exports = TradingAPI;
