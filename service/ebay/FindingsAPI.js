'use strict';
const { log } = require('../lib/logger');
const { v4: uuidv4 } = require('uuid');
const axios = require('axios').default;
const xml2js = require('xml2js');

class FindingsAPI {
  constructor() {
    this.log = log.child({ class: 'FindingsAPI' }, true);
    this.url = 'https://svcs.ebay.com/services/search/FindingService/v1';
    this.isProd = process.env.NODE_ENV === 'production';
  }

  createHeaders(operationName = 'findItemsAdvanced') {
    const headers = {
      'X-EBAY-SOA-SERVICE-NAME': 'FindingService',
      'X-EBAY-SOA-SERVICE-VERSION': '1.12.0',
      'X-EBAY-SOA-SECURITY-APPNAME': process.env.FINDINGS_APP_NAME,
      'X-EBAY-SOA-GLOBAL-ID': 'EBAY-US',
      'X-EBAY-SOA-OPERATION-NAME': operationName,
      'X-EBAY-SOA-REQUEST-DATA-FORMAT': 'XML',
      'X-EBAY-SOA-RESPONSE-DATA-FORMAT': 'XML',
      'Content-Type': 'text/xml',
      'User-Agent': 'eBaySDK/2.2.0 Python/3.8.8 Darwin/20.4.0',
      'X-EBAY-SDK-REQUEST-ID': uuidv4(),
    };
    return headers;
  }

  async makeRequest({ sellerName, paginationOptions }) {
    let response;
    try {
      response = await axios({
        method: 'POST',
        url: this.url,
        headers: this.createHeaders('findItemsAdvanced'),
        data: `<?xml version=\'1.0\' encoding=\'utf-8\'?><findItemsAdvancedRequest xmlns="http://www.ebay.com/marketplace/search/v1/services"><itemFilter><name>Seller</name><value>${sellerName}</value></itemFilter><paginationInput><entriesPerPage>${paginationOptions.entriesPerPage}</entriesPerPage><pageNumber>${paginationOptions.pageNumber}</pageNumber></paginationInput></findItemsAdvancedRequest>`
      });

      if (response.status !== 200) {
        this.log.error({ response }, 'Unknown error code');
        throw new Error(response.config);
      }
    } catch (err) {
      this.log.error({ err }, 'There was an error with accessing the Findings API');
    }

    let parsed = await xml2js.parseStringPromise(response.data);

    return parsed;
  }

  /**
   * Find completed/sold items for a seller
   * @param {Object} options
   * @param {string} options.sellerName - eBay seller username
   * @param {string} options.categoryId - Category ID (optional)
   * @param {number} options.entriesPerPage - Items per page (default: 100)
   * @param {number} options.pageNumber - Page number (default: 1)
   */
  async findCompletedItems({ sellerName, categoryId, entriesPerPage = 100, pageNumber = 1 }) {
    this.log.info({ sellerName, categoryId, pageNumber }, 'Finding completed items');

    // Build item filters
    let filters = `
      <itemFilter>
        <name>Seller</name>
        <value>${sellerName}</value>
      </itemFilter>
      <itemFilter>
        <name>SoldItemsOnly</name>
        <value>true</value>
      </itemFilter>`;

    // Add category filter if provided
    let categoryFilter = '';
    if (categoryId) {
      categoryFilter = `<categoryId>${categoryId}</categoryId>`;
    }

    const requestXml = `<?xml version="1.0" encoding="utf-8"?>
      <findCompletedItemsRequest xmlns="http://www.ebay.com/marketplace/search/v1/services">
        ${categoryFilter}
        ${filters}
        <paginationInput>
          <entriesPerPage>${entriesPerPage}</entriesPerPage>
          <pageNumber>${pageNumber}</pageNumber>
        </paginationInput>
        <sortOrder>EndTimeSoonest</sortOrder>
      </findCompletedItemsRequest>`;

    try {
      const response = await axios({
        method: 'POST',
        url: this.url,
        headers: this.createHeaders('findCompletedItems'),
        data: requestXml,
      });

      if (response.status !== 200) {
        this.log.error({ status: response.status }, 'Error response from Finding API');
        throw new Error(`Finding API returned status ${response.status}`);
      }

      const parsed = await xml2js.parseStringPromise(response.data);
      return this.parseCompletedItemsResponse(parsed);
    } catch (err) {
      this.log.error({ err }, 'Error finding completed items');
      throw err;
    }
  }

  /**
   * Parse the findCompletedItems response into a usable format
   */
  parseCompletedItemsResponse(parsed) {
    const response = parsed.findCompletedItemsResponse;
    if (!response) {
      return { items: [], totalPages: 0, totalEntries: 0 };
    }

    const ack = response.ack?.[0];
    if (ack !== 'Success' && ack !== 'Warning') {
      const error = response.errorMessage?.[0]?.error?.[0]?.message?.[0] || 'Unknown error';
      throw new Error(`Finding API error: ${error}`);
    }

    const searchResult = response.searchResult?.[0];
    const paginationOutput = response.paginationOutput?.[0];

    const totalPages = parseInt(paginationOutput?.totalPages?.[0] || '0', 10);
    const totalEntries = parseInt(paginationOutput?.totalEntries?.[0] || '0', 10);

    const rawItems = searchResult?.item || [];
    const items = rawItems.map((item) => ({
      ebayItemId: item.itemId?.[0] || '',
      title: item.title?.[0] || '',
      categoryId: item.primaryCategory?.[0]?.categoryId?.[0] || '',
      categoryName: item.primaryCategory?.[0]?.categoryName?.[0] || '',
      soldPrice: parseFloat(item.sellingStatus?.[0]?.currentPrice?.[0]?._ || item.sellingStatus?.[0]?.currentPrice?.[0] || '0'),
      soldDate: item.listingInfo?.[0]?.endTime?.[0] || null,
      condition: item.condition?.[0]?.conditionDisplayName?.[0] || '',
      pictureUrl: item.galleryURL?.[0] || '',
      viewItemUrl: item.viewItemURL?.[0] || '',
      seller: item.sellerInfo?.[0]?.sellerUserName?.[0] || '',
    }));

    return { items, totalPages, totalEntries };
  }

  /**
   * Fetch all completed items for a seller (handles pagination)
   * @param {Object} options
   * @param {string} options.sellerName - eBay seller username
   * @param {string} options.categoryId - Category ID (optional)
   * @param {number} options.maxPages - Maximum pages to fetch (default: 10)
   */
  async fetchAllCompletedItems({ sellerName, categoryId, maxPages = 10 }) {
    this.log.info({ sellerName, categoryId, maxPages }, 'Fetching all completed items');

    const allItems = [];
    let pageNumber = 1;
    let hasMorePages = true;

    while (hasMorePages && pageNumber <= maxPages) {
      const result = await this.findCompletedItems({
        sellerName,
        categoryId,
        pageNumber,
      });

      allItems.push(...result.items);
      this.log.info({ pageNumber, itemsOnPage: result.items.length, totalEntries: result.totalEntries }, 'Fetched completed items page');

      if (pageNumber >= result.totalPages || result.items.length === 0) {
        hasMorePages = false;
      } else {
        pageNumber++;
      }
    }

    this.log.info({ sellerName, totalItems: allItems.length }, 'Completed fetching all completed items');
    return allItems;
  }
}

module.exports = FindingsAPI;