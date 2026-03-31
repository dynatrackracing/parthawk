'use strict';

const router = require('express-promise-router')();
const Notifications = require('../ebay/Notifications');
const CacheManager = require('../middleware/CacheManager');
const EbayQueryCacheManager = require('../middleware/EbayQueryCacheManager');
const { isAdmin, authMiddleware } = require('../middleware/Middleware');

router.get('/ebay-challenger-api', async (req, res, next) => {
  const notifications = new Notifications();

  const { challenge_code } = req.query;

  const challengeResponse = notifications.createChallengeResponse({ challenge_code });

  res.status(200).send({ challengeResponse });
});

router.post('/ebay-challenger-api', async (req, res, next) => {
  const notifications = new Notifications();

  const response = notifications.processMessage({body: req.body});

  res.status(200).send(response);
});

router.get('/cache/flush', authMiddleware, isAdmin, async (req, res, next) => {
  console.log('!FLUSHING CACHE!')
  const cacheManager = new CacheManager();
  cacheManager.flush();
  res.json({ success: true, message: 'Cache flushed' });
});

router.get('/cache/stats', authMiddleware, isAdmin, async (req, res, next) => {
  const cache = new CacheManager();
  const ebayCache = new EbayQueryCacheManager();

  const cacheState = cache.stats();
  const ebayCacheState = ebayCache.stats();

  res.status(200).send({ cacheState, ebayCacheState });
});

module.exports = router;