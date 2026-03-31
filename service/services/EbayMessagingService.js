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

    // 2. Build template variables from order data
    const variables = await this._buildTemplateVariables(entry);

    // 3. Render the template
    const renderedBody = this._renderTemplate(template.body, variables);
    const renderedSubject = template.subject ? this._renderTemplate(template.subject, variables) : null;

    // 4. Send via appropriate API
    let result;
    if (template.api_target === 'post_order' && entry.return_id) {
      // Phase 3 — Post-Order API for return messages (NOT IMPLEMENTED YET)
      this.log.info({ returnId: entry.return_id }, 'Post-Order API not yet implemented, skipping');
      await this._markQueueStatus(entry.id, 'failed');
      await this._logMessage(entry, renderedSubject, renderedBody, 'skipped', null, 'NOT_IMPLEMENTED', 'Post-Order API phase 3');
      return;
    }

    // Trading API: AddMemberMessageAAQToPartner
    result = await this.sellerApi.sendMessageToPartner({
      itemId: entry.item_id,
      buyerUserId: entry.buyer_user_id,
      subject: renderedSubject || 'Message from DynaTrack',
      body: renderedBody,
    });

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
          trigger_source: 'poll',
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
