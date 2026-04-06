'use strict';

const { log } = require('../lib/logger');
const { database } = require('../database/database');
const SellerAPI = require('../ebay/SellerAPI');

class EbayMessagingService {
  constructor() {
    this.log = log.child({ class: 'EbayMessagingService' }, true);
    this.sellerApi = new SellerAPI();
    this.workerId = `msg-worker-${process.pid}-${Date.now()}`;
  }

  // --- QUEUE MANAGEMENT ---

  /**
   * Queue a post_purchase message for a new paid order.
   * Uses ON CONFLICT DO NOTHING for idempotency.
   */
  async queuePostPurchase(order, ebayStore = 'dynatrack') {
    const primaryItem = order.lineItems?.[0];
    if (!primaryItem?.itemId) {
      this.log.warn({ orderId: order.orderId }, 'Order has no line items, skipping');
      return null;
    }

    const scheduledAt = new Date(Date.now() + 15 * 60 * 1000); // 15 min delay

    try {
      const result = await database('ebay_message_queue')
        .insert({
          id: database.raw('gen_random_uuid()'),
          order_id: order.orderId,
          item_id: primaryItem.itemId,
          buyer_user_id: order.buyerUsername,
          template_key: 'post_purchase',
          scheduled_at: scheduledAt,
          status: 'pending',
          ebay_store: ebayStore,
          created_at: new Date(),
        })
        .onConflict(['order_id', 'template_key'])
        .ignore()
        .returning('id');

      if (result?.length > 0) {
        this.log.info({ orderId: order.orderId, scheduledAt }, 'Queued post_purchase message');
        return result[0].id;
      }
      return null;
    } catch (err) {
      this.log.error({ err, orderId: order.orderId }, 'Failed to queue post_purchase message');
      return null;
    }
  }

  // --- QUEUE PROCESSOR ---

  /**
   * Process pending messages in the queue.
   * Claim -> render -> send -> log. Called by cron every 2 minutes.
   */
  async processQueue() {
    const startTime = Date.now();
    let processed = 0;
    let sent = 0;
    let failed = 0;

    try {
      // Step 1: Claim pending rows
      const claimed = await database('ebay_message_queue')
        .where('status', 'pending')
        .where('scheduled_at', '<=', new Date())
        .orderBy('scheduled_at', 'asc')
        .limit(20)
        .update({
          status: 'claimed',
          claimed_by: this.workerId,
          claimed_at: new Date(),
        })
        .returning('*');

      if (!claimed?.length) {
        return { processed: 0, sent: 0, failed: 0, elapsed: Date.now() - startTime };
      }

      this.log.info({ count: claimed.length }, 'Claimed message queue entries');

      // Step 2: Process each claimed message
      for (const queueEntry of claimed) {
        processed++;
        try {
          await this._processQueueEntry(queueEntry);
          sent++;
        } catch (err) {
          failed++;
          this.log.error({ err, queueId: queueEntry.id }, 'Failed to process queue entry');
        }
      }

      // Step 3: Release stale claims (safety net for crashed workers)
      const staleThreshold = new Date(Date.now() - 10 * 60 * 1000);
      await database('ebay_message_queue')
        .where('status', 'claimed')
        .where('claimed_at', '<', staleThreshold)
        .update({
          status: 'pending',
          claimed_by: null,
          claimed_at: null,
        });

    } catch (err) {
      this.log.error({ err }, 'Queue processor error');
    }

    const elapsed = Date.now() - startTime;
    this.log.info({ processed, sent, failed, elapsed }, 'Queue processing complete');
    return { processed, sent, failed, elapsed };
  }

  /**
   * Process a single queue entry: render template, send via API, log result.
   */
  async _processQueueEntry(entry) {
    // 1. Fetch the active template
    const template = await database('ebay_message_templates')
      .where('template_key', entry.template_key)
      .where('is_active', true)
      .first();

    if (!template) {
      this.log.warn({ templateKey: entry.template_key }, 'Template not found or inactive');
      await this._markQueueFailed(entry.id, 'TEMPLATE_NOT_FOUND', 'Template inactive or missing');
      return;
    }

    // Set trigger_source for logging (delivery detection method tracked in poll logs)
    if (!entry.trigger_source) {
      entry.trigger_source = entry.template_key === 'post_delivery' ? 'delivery_poll'
        : entry.template_key === 'return_opened' ? 'return_poll' : 'poll';
    }

    // 2. Build template variables from order data
    const variables = await this._buildTemplateVariables(entry);

    // 3. Render the template
    const renderedBody = this._renderTemplate(template.body, variables);
    const renderedSubject = template.subject ? this._renderTemplate(template.subject, variables) : null;

    // 4. Send via appropriate API
    let result;
    if (template.api_target === 'post_order' && entry.return_id) {
      // Post-Order API: send message into return thread
      result = await this._sendPostOrderMessage(entry.return_id, renderedBody);
    } else {
      // Trading API: AddMemberMessageAAQToPartner
      result = await this.sellerApi.sendMessageToPartner({
        itemId: entry.item_id,
        buyerUserId: entry.buyer_user_id,
        subject: renderedSubject || 'Message from DynaTrack',
        body: renderedBody,
      });
    }

    // 5. Log the result
    if (result.success) {
      await this._markQueueStatus(entry.id, 'sent');
      await this._logMessage(entry, renderedSubject, renderedBody, 'sent', result.rawResponse);
    } else {
      // Handle auth token expired — reset to pending for retry
      if (result.errorCode === '932') {
        this.log.warn('Auth token expired, resetting queue entry to pending');
        await this._markQueuePending(entry.id);
        return;
      }

      // Check retry count
      const retryCount = await this._getRetryCount(entry.order_id, entry.template_key);
      if (retryCount >= 3) {
        await this._markQueueStatus(entry.id, 'failed');
        await this._logMessage(entry, renderedSubject, renderedBody, 'failed', result.rawResponse, result.errorCode, result.errorMessage);
      } else {
        await this._markQueuePending(entry.id);
        await this._logMessage(entry, renderedSubject, renderedBody, 'failed', result.rawResponse, result.errorCode, result.errorMessage);
      }
    }
  }

  // --- TEMPLATE RENDERING ---

  _renderTemplate(templateText, variables) {
    let rendered = templateText;
    for (const [key, value] of Object.entries(variables)) {
      rendered = rendered.replace(new RegExp(`\\{${key}\\}`, 'g'), value || '');
    }
    return rendered;
  }

  async _buildTemplateVariables(entry) {
    let itemTitle = '';
    try {
      const sale = await database('YourSale')
        .where('ebayItemId', entry.item_id)
        .orWhere('ebayOrderId', entry.order_id)
        .first();
      if (sale) {
        itemTitle = sale.title || '';
      } else {
        const listing = await database('YourListing')
          .where('ebayItemId', entry.item_id)
          .first();
        if (listing) {
          itemTitle = listing.title || '';
        }
      }
    } catch (err) {
      this.log.warn({ err, itemId: entry.item_id }, 'Could not fetch item title for template');
    }

    return {
      ITEM_TITLE: itemTitle,
      ITEM_ID: entry.item_id,
      ORDER_ID: entry.order_id,
      BUYER_USER_ID: entry.buyer_user_id,
    };
  }

  // --- QUEUE STATUS HELPERS ---

  async _markQueueStatus(queueId, status) {
    await database('ebay_message_queue')
      .where('id', queueId)
      .update({ status });
  }

  async _markQueueFailed(queueId, errorCode, errorDetail) {
    await database('ebay_message_queue')
      .where('id', queueId)
      .update({ status: 'failed' });
  }

  async _markQueuePending(queueId) {
    await database('ebay_message_queue')
      .where('id', queueId)
      .update({ status: 'pending', claimed_by: null, claimed_at: null });
  }

  async _getRetryCount(orderId, templateKey) {
    const msg = await database('ebay_messages')
      .where('order_id', orderId)
      .where('template_key', templateKey)
      .first();
    return msg?.retry_count || 0;
  }

  async _logMessage(entry, subject, renderedBody, status, rawResponse, errorCode, errorDetail) {
    try {
      const existing = await database('ebay_messages')
        .where('order_id', entry.order_id)
        .where('template_key', entry.template_key)
        .first();

      const retryCount = (existing?.retry_count || 0) + (status === 'failed' ? 1 : 0);

      await database('ebay_messages')
        .insert({
          id: database.raw('gen_random_uuid()'),
          order_id: entry.order_id,
          item_id: entry.item_id,
          buyer_user_id: entry.buyer_user_id,
          template_key: entry.template_key,
          subject: subject,
          body: renderedBody,
          rendered_body: renderedBody,
          sent_at: status === 'sent' ? new Date() : null,
          status,
          error_code: errorCode || null,
          error_detail: errorDetail || null,
          api_response: rawResponse || null,
          retry_count: retryCount,
          ebay_store: entry.ebay_store,
          trigger_source: entry.trigger_source || 'poll',
          created_at: new Date(),
          updated_at: new Date(),
        })
        .onConflict(['order_id', 'template_key'])
        .merge({
          status,
          sent_at: status === 'sent' ? new Date() : null,
          error_code: errorCode || null,
          error_detail: errorDetail || null,
          api_response: rawResponse || null,
          retry_count: retryCount,
          rendered_body: renderedBody,
          updated_at: new Date(),
        });
    } catch (err) {
      this.log.error({ err, orderId: entry.order_id }, 'Failed to log message');
    }
  }

  // --- PHASE 2: POST-DELIVERY QUEUE ---

  /**
   * Queue a post_delivery message for a delivered order.
   * 4-hour delay so buyer has time to open the package.
   */
  async queuePostDelivery(order, ebayStore = 'dynatrack') {
    const primaryItem = order.lineItems?.[0];
    if (!primaryItem?.itemId) return null;

    const scheduledAt = new Date(Date.now() + 4 * 60 * 60 * 1000); // 4 hour delay

    try {
      const result = await database('ebay_message_queue')
        .insert({
          id: database.raw('gen_random_uuid()'),
          order_id: order.orderId,
          item_id: primaryItem.itemId,
          buyer_user_id: order.buyerUsername,
          template_key: 'post_delivery',
          scheduled_at: scheduledAt,
          status: 'pending',
          ebay_store: ebayStore,
          created_at: new Date(),
        })
        .onConflict(['order_id', 'template_key'])
        .ignore()
        .returning('id');

      if (result?.length > 0) {
        this.log.info({ orderId: order.orderId, scheduledAt }, 'Queued post_delivery message');
        return result[0].id;
      }
      return null;
    } catch (err) {
      this.log.error({ err, orderId: order.orderId }, 'Failed to queue post_delivery');
      return null;
    }
  }

  /**
   * Poll for delivered orders and queue post_delivery messages.
   * Primary: eBay Fulfillment API (explicit delivery status via OAuth).
   * Fallback: GetOrders Completed status + 2-day shipping margin (Trading API).
   * Called by cron every 30 minutes.
   */
  async pollDeliveryStatus() {
    const startTime = Date.now();
    let checked = 0, queued = 0;
    let method = 'none';

    try {
      // Get orders that had post_purchase sent but no post_delivery yet
      const sentPurchases = await database('ebay_messages')
        .where('template_key', 'post_purchase')
        .where('status', 'sent')
        .whereNotNull('order_id')
        .select('order_id', 'item_id', 'buyer_user_id', 'ebay_store');

      if (sentPurchases.length === 0) {
        this.log.info('No orders pending delivery check');
        return { checked: 0, queued: 0, method: 'none', elapsed: Date.now() - startTime };
      }

      // Filter out orders that already have post_delivery queued/sent
      const alreadyDelivered = await database('ebay_message_queue')
        .where('template_key', 'post_delivery')
        .whereIn('order_id', sentPurchases.map(o => o.order_id))
        .select('order_id');
      const alreadySent = await database('ebay_messages')
        .where('template_key', 'post_delivery')
        .whereIn('order_id', sentPurchases.map(o => o.order_id))
        .select('order_id');

      const doneSet = new Set([
        ...alreadyDelivered.map(r => r.order_id),
        ...alreadySent.map(r => r.order_id),
      ]);

      const toCheck = sentPurchases.filter(o => !doneSet.has(o.order_id));
      this.log.info({ total: sentPurchases.length, alreadyDone: doneSet.size, toCheck: toCheck.length }, 'Delivery status check');

      if (toCheck.length === 0) {
        return { checked: 0, queued: 0, method: 'none', elapsed: Date.now() - startTime };
      }

      // Fulfillment API requires a valid OAuth 2.0 Bearer token.
      // EBAY_OAUTH_TOKEN is currently expired, so skip straight to GetOrders fallback.
      // When a fresh OAuth token is available, re-enable by setting EBAY_FULFILLMENT_TOKEN.
      const oauthToken = process.env.EBAY_FULFILLMENT_TOKEN;
      const useFulfillmentApi = !!oauthToken;

      if (useFulfillmentApi) {
        method = 'fulfillment_api';
        this.log.info({ count: toCheck.length }, 'Checking delivery via Fulfillment API');
        const axios = require('axios');

        for (const pending of toCheck) {
          checked++;
          try {
            const resp = await axios.get(
              `https://api.ebay.com/sell/fulfillment/v1/order/${pending.order_id}/shipping_fulfillment`,
              {
                headers: {
                  'Authorization': `Bearer ${oauthToken}`,
                  'Content-Type': 'application/json',
                },
                timeout: 10000,
              }
            );

            // Check fulfillments for explicit DELIVERED status
            const fulfillments = resp.data?.fulfillments || [];
            let isDelivered = false;
            for (const f of fulfillments) {
              // eBay Fulfillment API: shipmentTrackingNumber, shippingCarrierCode
              // deliveredDate field or shipmentStatus === 'DELIVERED'
              if (f.shipmentStatus === 'DELIVERED' || f.deliveredDate) {
                isDelivered = true;
                break;
              }
              // Also check tracking events if available
              const events = f.trackingEvents || f.shipmentTracking?.events || [];
              if (events.some(e => /delivered/i.test(e.status || e.eventDescription || ''))) {
                isDelivered = true;
                break;
              }
            }

            if (isDelivered) {
              const queueResult = await this.queuePostDelivery({
                orderId: pending.order_id,
                buyerUsername: pending.buyer_user_id,
                lineItems: [{ itemId: pending.item_id }],
                _triggerSource: 'fulfillment_api',
              }, pending.ebay_store || 'dynatrack');
              if (queueResult) queued++;
            }
          } catch (apiErr) {
            if (apiErr.response?.status === 401) {
              this.log.warn('Fulfillment API OAuth expired — falling back to GetOrders for remaining');
              method = 'fallback_after_401';
              break; // Fall through to fallback below
            }
            // 404 = no fulfillments yet (not shipped), skip silently
            if (apiErr.response?.status !== 404) {
              this.log.warn({ err: apiErr.message, orderId: pending.order_id }, 'Fulfillment API check failed');
            }
          }
        }
      }

      // Fallback: GetOrders Completed status + 2-day shipping margin
      // Runs if OAuth unavailable, or if OAuth expired mid-run
      if (!useFulfillmentApi || method === 'fallback_after_401') {
        if (!useFulfillmentApi) method = 'fallback';
        this.log.info({ count: toCheck.length, reason: useFulfillmentApi ? 'oauth_expired' : 'no_oauth' }, 'Checking delivery via GetOrders fallback');

        const orders = await this.sellerApi.getOrders({ daysBack: 14 });
        const orderMap = new Map();
        for (const o of orders) {
          if (o.orderId) orderMap.set(o.orderId, o);
        }

        for (const pending of toCheck) {
          // Skip orders already queued by Fulfillment API pass above
          const alreadyQueued = await database('ebay_message_queue')
            .where('order_id', pending.order_id)
            .where('template_key', 'post_delivery')
            .first();
          if (alreadyQueued) continue;

          checked++;
          const order = orderMap.get(pending.order_id);
          if (!order) continue;

          // eBay sets orderStatus to 'Completed' after delivery confirmation
          if (order.orderStatus === 'Completed' && order.shippedTime) {
            const shippedAt = new Date(order.shippedTime);
            const daysSinceShipped = (Date.now() - shippedAt.getTime()) / 86400000;
            if (daysSinceShipped < 2) continue;

            const queueResult = await this.queuePostDelivery({
              orderId: pending.order_id,
              buyerUsername: pending.buyer_user_id,
              lineItems: [{ itemId: pending.item_id }],
              _triggerSource: 'fallback',
            }, pending.ebay_store || 'dynatrack');
            if (queueResult) queued++;
          }
        }
      }
    } catch (err) {
      this.log.error({ err }, 'Delivery status polling failed');
    }

    const elapsed = Date.now() - startTime;
    this.log.info({ checked, queued, method, elapsed }, 'Delivery polling complete');
    return { checked, queued, method, elapsed };
  }

  // --- PHASE 3: RETURN OPENED QUEUE ---

  /**
   * Queue a return_opened message for a new return request.
   * 5-minute delay, stores return_id for Post-Order API routing.
   */
  async queueReturnOpened({ orderId, itemId, buyerUsername, returnId, ebayStore = 'dynatrack' }) {
    const scheduledAt = new Date(Date.now() + 5 * 60 * 1000); // 5 min delay

    try {
      const result = await database('ebay_message_queue')
        .insert({
          id: database.raw('gen_random_uuid()'),
          order_id: orderId,
          item_id: itemId,
          buyer_user_id: buyerUsername,
          template_key: 'return_opened',
          scheduled_at: scheduledAt,
          status: 'pending',
          return_id: returnId,
          ebay_store: ebayStore,
          created_at: new Date(),
        })
        .onConflict(['order_id', 'template_key'])
        .ignore()
        .returning('id');

      if (result?.length > 0) {
        this.log.info({ orderId, returnId, scheduledAt }, 'Queued return_opened message');
        return result[0].id;
      }
      return null;
    } catch (err) {
      this.log.error({ err, orderId, returnId }, 'Failed to queue return_opened');
      return null;
    }
  }

  /**
   * Poll eBay Post-Order API for new returns and queue return_opened messages.
   * Requires EBAY_OAUTH_TOKEN env var. Called by cron every 15 minutes.
   */
  async pollReturns() {
    // Post-Order API requires TOKEN scheme (not Bearer OAuth).
    // TRADING_API_TOKEN is the active eBay User Auth Token.
    const oauthToken = process.env.TRADING_API_TOKEN;
    if (!oauthToken) {
      this.log.debug('TRADING_API_TOKEN not set — return polling disabled');
      return { checked: 0, queued: 0, skipped: true };
    }

    const startTime = Date.now();
    let checked = 0, queued = 0;

    try {
      const axios = require('axios');
      // Search for returns created in the last 24 hours
      const fromDate = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const toDate = new Date().toISOString();

      const response = await axios.get('https://api.ebay.com/post-order/v2/return/search', {
        params: {
          creation_date_range_from: fromDate,
          creation_date_range_to: toDate,
          limit: 50,
          offset: 0,
        },
        headers: {
          'Authorization': `TOKEN ${oauthToken}`,
          'Content-Type': 'application/json',
          'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US',
        },
        timeout: 15000,
      });

      const returns = response.data?.members || response.data?.returns || [];
      this.log.info({ returnCount: returns.length }, 'Polled returns');

      for (const ret of returns) {
        checked++;
        const returnId = ret.returnId || ret.id;
        const orderId = ret.orderId;
        if (!returnId || !orderId) continue;

        // Check if already queued/sent
        const exists = await database('ebay_message_queue')
          .where('order_id', orderId)
          .where('template_key', 'return_opened')
          .first();
        if (exists) continue;

        const existsMsg = await database('ebay_messages')
          .where('order_id', orderId)
          .where('template_key', 'return_opened')
          .first();
        if (existsMsg) continue;

        const result = await this.queueReturnOpened({
          orderId,
          itemId: ret.itemId || ret.lineItems?.[0]?.itemId || null,
          buyerUsername: ret.buyerLoginName || ret.buyer?.username || null,
          returnId: String(returnId),
          ebayStore: 'dynatrack',
        });
        if (result) queued++;
      }
    } catch (err) {
      if (err.response?.status === 401) {
        this.log.warn('TRADING_API_TOKEN rejected (401) — return polling skipped');
      } else {
        this.log.error({ err: err.message }, 'Return polling failed');
      }
    }

    const elapsed = Date.now() - startTime;
    this.log.info({ checked, queued, elapsed }, 'Return polling complete');
    return { checked, queued, elapsed };
  }

  /**
   * Send a message into an eBay return thread via Post-Order API.
   * Requires EBAY_OAUTH_TOKEN.
   */
  async _sendPostOrderMessage(returnId, messageBody) {
    // Post-Order API requires TOKEN scheme with TRADING_API_TOKEN
    const oauthToken = process.env.TRADING_API_TOKEN;
    if (!oauthToken) {
      return { success: false, errorCode: 'NO_TOKEN', errorMessage: 'TRADING_API_TOKEN not configured' };
    }

    try {
      const axios = require('axios');
      await axios.post(
        `https://api.ebay.com/post-order/v2/return/${returnId}/send_message`,
        { message: { content: messageBody } },
        {
          headers: {
            'Authorization': `TOKEN ${oauthToken}`,
            'Content-Type': 'application/json',
            'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US',
          },
          timeout: 15000,
        }
      );
      return { success: true };
    } catch (err) {
      return {
        success: false,
        errorCode: String(err.response?.status || 'UNKNOWN'),
        errorMessage: err.response?.data?.message || err.message,
        rawResponse: JSON.stringify(err.response?.data || {}).substring(0, 500),
      };
    }
  }

  // --- ORDER POLLING ---

  /**
   * Poll eBay for recent orders and queue post_purchase messages for new ones.
   * Called by cron every 15 minutes.
   */
  async pollNewOrders() {
    const startTime = Date.now();
    let queued = 0;

    try {
      const orders = await this.sellerApi.getOrders({ daysBack: 2 });

      this.log.info({ orderCount: orders.length }, 'Polled orders for messaging');

      for (const order of orders) {
        if (!order.orderId || !order.buyerUsername) continue;

        const result = await this.queuePostPurchase(order);
        if (result) queued++;
      }

    } catch (err) {
      this.log.error({ err }, 'Order polling failed');
    }

    const elapsed = Date.now() - startTime;
    this.log.info({ queued, elapsed }, 'Order polling complete');
    return { queued, elapsed };
  }

  // --- STATUS & HISTORY ---

  async getMessageHistory({ orderId, limit = 50, offset = 0 }) {
    let query = database('ebay_messages').orderBy('created_at', 'desc');
    if (orderId) query = query.where('order_id', orderId);
    return query.limit(limit).offset(offset);
  }

  async getQueueStatus() {
    const pending = await database('ebay_message_queue')
      .where('status', 'pending')
      .count('* as count')
      .first();
    const claimed = await database('ebay_message_queue')
      .where('status', 'claimed')
      .count('* as count')
      .first();
    const sent = await database('ebay_messages')
      .where('status', 'sent')
      .count('* as count')
      .first();
    const failed = await database('ebay_messages')
      .where('status', 'failed')
      .count('* as count')
      .first();
    const recent = await database('ebay_messages')
      .where('status', 'sent')
      .orderBy('sent_at', 'desc')
      .limit(5);

    return {
      queue: {
        pending: parseInt(pending?.count || 0),
        claimed: parseInt(claimed?.count || 0),
      },
      messages: {
        sent: parseInt(sent?.count || 0),
        failed: parseInt(failed?.count || 0),
      },
      recentSent: recent,
    };
  }

  async getTemplates() {
    return database('ebay_message_templates').orderBy('template_key');
  }
}

module.exports = EbayMessagingService;
