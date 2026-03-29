'use strict';

const router = require('express-promise-router')();
const { log } = require('../lib/logger');
const ReturnIntelligenceService = require('../services/ReturnIntelligenceService');

router.get('/summary', async (req, res) => {
  try {
    const service = new ReturnIntelligenceService();
    const data = await service.getSummary();
    res.json({ success: true, ...data });
  } catch (err) {
    log.error({ err }, 'Error getting return summary');
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/by-part-type', async (req, res) => {
  try {
    const months = parseInt(req.query.months || '36');
    const service = new ReturnIntelligenceService();
    const data = await service.getReturnRateByPartType({ months });
    res.json({ success: true, data });
  } catch (err) {
    log.error({ err }, 'Error getting return rates by part type');
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/problem-parts', async (req, res) => {
  try {
    const months = parseInt(req.query.months || '36');
    const minReturns = parseInt(req.query.minReturns || '3');
    const service = new ReturnIntelligenceService();
    const data = await service.getProblemParts({ minReturns, months });
    res.json({ success: true, data });
  } catch (err) {
    log.error({ err }, 'Error getting problem parts');
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/repeat-returners', async (req, res) => {
  try {
    const months = parseInt(req.query.months || '36');
    const minReturns = parseInt(req.query.minReturns || '3');
    const service = new ReturnIntelligenceService();
    const data = await service.getRepeatReturners({ minReturns, months });
    res.json({ success: true, data });
  } catch (err) {
    log.error({ err }, 'Error getting repeat returners');
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/by-make', async (req, res) => {
  try {
    const months = parseInt(req.query.months || '36');
    const service = new ReturnIntelligenceService();
    const data = await service.getReturnsByMake({ months });
    res.json({ success: true, data });
  } catch (err) {
    log.error({ err }, 'Error getting returns by make');
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/monthly-trend', async (req, res) => {
  try {
    const months = parseInt(req.query.months || '36');
    const service = new ReturnIntelligenceService();
    const data = await service.getMonthlyTrend({ months });
    res.json({ success: true, ...data });
  } catch (err) {
    log.error({ err }, 'Error getting monthly trend');
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/inad', async (req, res) => {
  try {
    const months = parseInt(req.query.months || '36');
    const service = new ReturnIntelligenceService();
    const data = await service.getINADStats({ months });
    res.json({ success: true, ...data });
  } catch (err) {
    log.error({ err }, 'Error getting INAD stats');
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/high-value-alerts', async (req, res) => {
  try {
    const months = parseInt(req.query.months || '36');
    const service = new ReturnIntelligenceService();
    const data = await service.getHighValueHighFrequency({ months });
    res.json({ success: true, data });
  } catch (err) {
    log.error({ err }, 'Error getting high value alerts');
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
