'use strict';

const { log } = require('../lib/logger');
const { v4: uuidv4 } = require('uuid');
const axios = require('axios').default;
const xml2js = require('xml2js');

/**
 * SellerAPI - Fetches YOUR eBay seller data (orders and listings)
 * Uses eBay Trading API (GetOrders, GetMyeBaySelling)
 */
class SellerAPI {
  constructor() {
    this.log = log.child({ class: 'SellerAPI' }, true);
    this.url = 'https://api.ebay.com/ws/api.dll';
  }

  createHeaders(callName) {
    return {
      'X-EBAY-API-COMPATIBILITY-LEVEL': '1225',
      'X-EBAY-API-DEV-NAME': process.env.TRADING_API_DEV_NAME,
      'X-EBAY-API-APP-NAME': process.env.TRADING_API_APP_NAME,
      'X-EBAY-API-CERT-NAME': process.env.TRADING_API_CERT_NAME,
      'X-EBAY-API-SITEID': '0',
      'X-EBAY-API-CALL-NAME': callName,
      'Content-Type': 'text/xml',
      'User-Agent': 'eBaySDK/2.2.0 Node.js',
      'X-EBAY-SDK-REQUEST-ID': uuidv4(),
    };
  }

  getAuthToken() {
    if (!process.env.TRADING_API_TOKEN) {
      throw new Error('eBay auth token (TRADING_API_TOKEN) is not configured');
    }
    return process.env.TRADING_API_TOKEN;
  }

  /**
   * Test API connectivity by making a simple GetUser call
   */
  async healthCheck() {
    try {
      const xml = `<?xml version="1.0" encoding="utf-8"?>
        <GetUserRequest xmlns="urn:ebay:apis:eBLBaseComponents">
          <RequesterCredentials>
            <eBayAuthToken>${this.getAuthToken()}</eBayAuthToken>
          </RequesterCredentials>
        </GetUserRequest>`;

      const response = await axios.post(this.url, xml, {
        headers: this.createHeaders('GetUser'),
      });

      const parsed = await xml2js.parseStringPromise(response.data, { explicitArray: false });
      const ack = parsed.GetUserResponse?.Ack;

      if (ack === 'Success' || ack === 'Warning') {
        return {
          success: true,
          sellerId: parsed.GetUserResponse?.User?.UserID,
        };
      }

      return {
        success: false,
        error: parsed.GetUserResponse?.Errors?.ShortMessage || 'Unknown error',
      };
    } catch (error) {
      this.log.error({ err: error }, 'Health check failed');
      return {
        success: false,
        error: error.message || 'Unknown error',
      };
    }
  }

  /**
   * Fetch orders from eBay Trading API (paginates through all results)
   * @param {Object} options
   * @param {number} options.daysBack - Number of days back to fetch (default: 30)
   * @returns {Promise<Array>} Array of order objects
   */
  async getOrders({ daysBack = 30 } = {}) {
    // eBay Trading API rejects CreateTimeFrom older than ~90 days
    const MAX_DAYS = 90;
    const effectiveDaysBack = Math.min(daysBack, MAX_DAYS);

    if (daysBack > MAX_DAYS) {
      this.log.warn({ requested: daysBack, capped: effectiveDaysBack }, 'daysBack exceeds eBay 90-day limit, capping');
    }

    const now = new Date();
    const createTimeFrom = new Date(now);
    createTimeFrom.setDate(createTimeFrom.getDate() - effectiveDaysBack);

    this.log.info({ daysBack: effectiveDaysBack }, 'Fetching orders from eBay');

    const allOrders = await this._fetchOrdersForRange(createTimeFrom, now);

    this.log.info({ totalOrders: allOrders.length }, 'Completed fetching orders');
    return allOrders;
  }

  async _fetchOrdersForRange(createTimeFrom, createTimeTo) {
    const orders = [];
    let pageNumber = 1;
    let hasMorePages = true;

    while (hasMorePages) {
      const xml = `<?xml version="1.0" encoding="utf-8"?>
        <GetOrdersRequest xmlns="urn:ebay:apis:eBLBaseComponents">
          <RequesterCredentials>
            <eBayAuthToken>${this.getAuthToken()}</eBayAuthToken>
          </RequesterCredentials>
          <CreateTimeFrom>${createTimeFrom.toISOString()}</CreateTimeFrom>
          <CreateTimeTo>${createTimeTo.toISOString()}</CreateTimeTo>
          <OrderRole>Seller</OrderRole>
          <OrderStatus>All</OrderStatus>
          <Pagination>
            <EntriesPerPage>100</EntriesPerPage>
            <PageNumber>${pageNumber}</PageNumber>
          </Pagination>
        </GetOrdersRequest>`;

      try {
        const response = await axios.post(this.url, xml, {
          headers: this.createHeaders('GetOrders'),
        });

        const parsed = await xml2js.parseStringPromise(response.data, { explicitArray: false });
        const pageOrders = this.parseOrders(parsed);
        orders.push(...pageOrders);

        this.log.info({ pageNumber, ordersOnPage: pageOrders.length }, 'Fetched orders page');

        const paginationResult = parsed.GetOrdersResponse?.PaginationResult;
        const totalPages = parseInt(paginationResult?.TotalNumberOfPages || '1', 10);

        if (pageNumber >= totalPages) {
          hasMorePages = false;
        } else {
          pageNumber++;
        }
      } catch (error) {
        this.log.error({ err: error, pageNumber }, 'Error fetching orders page');
        throw error;
      }
    }

    return orders;
  }

  /**
   * Fetch active listings from eBay Trading API (paginates through all results)
   * @returns {Promise<Array>} Array of listing objects
   */
  async getActiveListings() {
    const allListings = [];
    let pageNumber = 1;
    let hasMorePages = true;

    this.log.info('Fetching active listings from eBay');

    while (hasMorePages) {
      const xml = `<?xml version="1.0" encoding="utf-8"?>
        <GetMyeBaySellingRequest xmlns="urn:ebay:apis:eBLBaseComponents">
          <RequesterCredentials>
            <eBayAuthToken>${this.getAuthToken()}</eBayAuthToken>
          </RequesterCredentials>
          <ActiveList>
            <Include>true</Include>
            <Pagination>
              <EntriesPerPage>200</EntriesPerPage>
              <PageNumber>${pageNumber}</PageNumber>
            </Pagination>
          </ActiveList>
        </GetMyeBaySellingRequest>`;

      try {
        const response = await axios.post(this.url, xml, {
          headers: this.createHeaders('GetMyeBaySelling'),
        });

        const parsed = await xml2js.parseStringPromise(response.data, { explicitArray: false });
        const listings = this.parseListings(parsed);
        allListings.push(...listings);

        this.log.info({ pageNumber, listingsOnPage: listings.length }, 'Fetched listings page');

        // Check pagination info
        const paginationResult = parsed.GetMyeBaySellingResponse?.ActiveList?.PaginationResult;
        const totalPages = parseInt(paginationResult?.TotalNumberOfPages || '1', 10);

        if (pageNumber >= totalPages) {
          hasMorePages = false;
        } else {
          pageNumber++;
        }
      } catch (error) {
        this.log.error({ err: error, pageNumber }, 'Error fetching listings page');
        throw error;
      }
    }

    this.log.info({ totalListings: allListings.length }, 'Completed fetching listings');
    return allListings;
  }

  /**
   * Parse GetOrders response into structured array
   */
  parseOrders(parsed) {
    const response = parsed.GetOrdersResponse;
    if (!response || response.Ack === 'Failure') {
      const error = response?.Errors?.ShortMessage || 'Failed to get orders';
      throw new Error(error);
    }

    const orderArray = response.OrderArray?.Order;
    if (!orderArray) {
      return [];
    }

    // Ensure we have an array
    const orders = Array.isArray(orderArray) ? orderArray : [orderArray];

    return orders.map((order) => {
      // Parse line items (transactions)
      const transactionArray = order.TransactionArray?.Transaction;
      const transactions = transactionArray
        ? Array.isArray(transactionArray)
          ? transactionArray
          : [transactionArray]
        : [];

      const lineItems = transactions.map((tx) => ({
        itemId: tx.Item?.ItemID || '',
        title: tx.Item?.Title || '',
        sku: tx.Item?.SKU || tx.Variation?.SKU || null,
        quantity: parseInt(tx.QuantityPurchased || '1', 10),
        price: parseFloat(tx.TransactionPrice?._ || tx.TransactionPrice || '0'),
      }));

      return {
        orderId: order.OrderID || '',
        buyerUsername: order.BuyerUserID || '',
        orderStatus: order.OrderStatus || '',
        total: parseFloat(order.Total?._ || order.Total || '0'),
        createdTime: order.CreatedTime || '',
        shippedTime: order.ShippedTime || undefined,
        lineItems,
      };
    });
  }

  /**
   * Parse GetMyeBaySelling response into structured array
   */
  parseListings(parsed) {
    const response = parsed.GetMyeBaySellingResponse;
    if (!response || response.Ack === 'Failure') {
      const error = response?.Errors?.ShortMessage || 'Failed to get listings';
      throw new Error(error);
    }

    const itemArray = response.ActiveList?.ItemArray?.Item;
    if (!itemArray) {
      return [];
    }

    // Ensure we have an array
    const items = Array.isArray(itemArray) ? itemArray : [itemArray];

    return items.map((item) => ({
      itemId: item.ItemID || '',
      title: item.Title || '',
      sku: item.SKU || null,
      quantityAvailable: parseInt(item.QuantityAvailable || '0', 10),
      currentPrice: parseFloat(
        item.SellingStatus?.CurrentPrice?._ ||
          item.SellingStatus?.CurrentPrice ||
          item.BuyItNowPrice?._ ||
          item.BuyItNowPrice ||
          '0'
      ),
      listingStatus: item.SellingStatus?.ListingStatus || 'Active',
      startTime: item.ListingDetails?.StartTime || '',
      viewItemUrl: item.ListingDetails?.ViewItemURL || '',
    }));
  }

  /**
   * Send a message to a buyer via eBay's AddMemberMessageAAQToPartner
   * Message appears in buyer's My eBay Messages inbox.
   *
   * @param {Object} params
   * @param {string} params.itemId - eBay Item ID from the order
   * @param {string} params.buyerUserId - Buyer's eBay username
   * @param {string} params.subject - Message subject line
   * @param {string} params.body - Message body text
   * @returns {Object} { success, ack, errorCode, errorMessage, rawResponse }
   */
  async sendMessageToPartner({ itemId, buyerUserId, subject, body }) {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
      <AddMemberMessageAAQToPartnerRequest xmlns="urn:ebay:apis:eBLBaseComponents">
        <RequesterCredentials>
          <eBayAuthToken>${this.getAuthToken()}</eBayAuthToken>
        </RequesterCredentials>
        <ItemID>${itemId}</ItemID>
        <MemberMessage>
          <Subject>${this._escapeXml(subject)}</Subject>
          <Body>${this._escapeXml(body)}</Body>
          <QuestionType>CustomizedSubject</QuestionType>
          <RecipientID>${this._escapeXml(buyerUserId)}</RecipientID>
        </MemberMessage>
      </AddMemberMessageAAQToPartnerRequest>`;

    try {
      const response = await axios.post(this.url, xml, {
        headers: this.createHeaders('AddMemberMessageAAQToPartner'),
        timeout: 15000,
      });

      const parsed = await xml2js.parseStringPromise(response.data, { explicitArray: false });
      const ack = parsed.AddMemberMessageAAQToPartnerResponse?.Ack;
      const errors = parsed.AddMemberMessageAAQToPartnerResponse?.Errors;

      if (ack === 'Success' || ack === 'Warning') {
        this.log.info({ itemId, buyerUserId }, 'Message sent to buyer');
        return { success: true, ack, rawResponse: response.data };
      }

      const errorCode = errors?.ErrorCode || 'UNKNOWN';
      const errorMessage = errors?.ShortMessage || errors?.LongMessage || 'Unknown error';
      this.log.warn({ itemId, buyerUserId, errorCode, errorMessage }, 'Message send failed');
      return { success: false, ack, errorCode, errorMessage, rawResponse: response.data };

    } catch (err) {
      this.log.error({ err, itemId, buyerUserId }, 'Message send request failed');
      return { success: false, errorCode: 'REQUEST_FAILED', errorMessage: err.message };
    }
  }

  /**
   * XML-escape a string to prevent injection in SOAP requests
   */
  _escapeXml(str) {
    if (!str) return '';
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }
}

module.exports = SellerAPI;
