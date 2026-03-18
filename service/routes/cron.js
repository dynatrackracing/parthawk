'use strict';

const { log } = require('../lib/logger');
const CronWorkRunner = require('../lib/CronWorkRunner');
const router = require('express-promise-router')();

const { isAdmin, authMiddleware } = require('../middleware/Middleware');

router.get('/', authMiddleware, isAdmin, async (req, res, next) => {
  log.info('Running cron route manually!');
  const cronRunner = new CronWorkRunner();
  try {
    cronRunner.work();
  } catch (err) {
    log.error({ err }, 'There was an error executing manual cron');
  }

});

module.exports = router;