'use strict';

const { log } = require('../lib/logger');
const router = require('express-promise-router')();
const EbayMessagingService = require('../services/EbayMessagingService');

const service = new EbayMessagingService();

/**
 * GET /ebay-messaging/status
 * Queue and message stats
 */
router.get('/status', async (req, res) => {
  try {
    const status = await service.getQueueStatus();
    res.json({ success: true, ...status });
  } catch (err) {
    log.error({ err }, 'Error getting messaging status');
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /ebay-messaging/history
 * Message send history. Query: ?orderId=&limit=50&offset=0
 */
router.get('/history', async (req, res) => {
  try {
    const { orderId, limit = 50, offset = 0 } = req.query;
    const messages = await service.getMessageHistory({
      orderId,
      limit: parseInt(limit),
      offset: parseInt(offset),
    });
    res.json({ success: true, messages });
  } catch (err) {
    log.error({ err }, 'Error getting message history');
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /ebay-messaging/templates
 * Current message templates
 */
router.get('/templates', async (req, res) => {
  try {
    const templates = await service.getTemplates();
    res.json({ success: true, templates });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /ebay-messaging/poll
 * Manually trigger order polling (normally runs on cron)
 */
router.post('/poll', async (req, res) => {
  try {
    const result = await service.pollNewOrders();
    res.json({ success: true, ...result });
  } catch (err) {
    log.error({ err }, 'Error polling orders');
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /ebay-messaging/process
 * Manually trigger queue processing (normally runs on cron)
 */
router.post('/process', async (req, res) => {
  try {
    const result = await service.processQueue();
    res.json({ success: true, ...result });
  } catch (err) {
    log.error({ err }, 'Error processing queue');
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /ebay-messaging/test-send
 * Send a test message to verify API connectivity.
 * Body: { itemId, buyerUserId, subject, body }
 * WARNING: This actually sends a real eBay message.
 */
router.post('/test-send', async (req, res) => {
  const { itemId, buyerUserId, subject, body } = req.body;
  if (!itemId || !buyerUserId || !subject || !body) {
    return res.status(400).json({ success: false, error: 'itemId, buyerUserId, subject, body required' });
  }

  try {
    const SellerAPI = require('../ebay/SellerAPI');
    const api = new SellerAPI();
    const result = await api.sendMessageToPartner({ itemId, buyerUserId, subject, body });
    res.json({ success: result.success, ...result });
  } catch (err) {
    log.error({ err }, 'Test send failed');
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /ebay-messaging/health/oauth
 * Check OAuth token manager status. Attempts a refresh if needed.
 */
router.get('/health/oauth', async (req, res) => {
  try {
    const oauthManager = require('../ebay/EbayOAuthManager');
    const status = oauthManager.getStatus();

    // If configured, try a health check (will refresh if expired)
    if (status.configured) {
      const check = await oauthManager.healthCheck();
      return res.json({
        success: check.success,
        configured: true,
        hasToken: !!check.expiresIn,
        expiresIn: check.expiresIn ? `${Math.round(check.expiresIn / 60)} minutes` : null,
        expiresAt: check.expiresAt || null,
        error: check.error || null,
        fallback: 'TRADING_API_TOKEN is ' + (process.env.TRADING_API_TOKEN ? 'available' : 'NOT SET'),
      });
    }

    // Not configured — report what's missing
    res.json({
      success: false,
      configured: false,
      error: 'OAuth not configured — using TRADING_API_TOKEN fallback',
      missing: [
        !process.env.EBAY_CLIENT_ID && 'EBAY_CLIENT_ID',
        !process.env.EBAY_CLIENT_SECRET && 'EBAY_CLIENT_SECRET',
        !process.env.EBAY_REFRESH_TOKEN && 'EBAY_REFRESH_TOKEN',
      ].filter(Boolean),
      fallback: 'TRADING_API_TOKEN is ' + (process.env.TRADING_API_TOKEN ? 'available' : 'NOT SET'),
    });
  } catch (err) {
    log.error({ err }, 'OAuth health check failed');
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
