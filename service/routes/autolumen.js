'use strict';

const router = require('express-promise-router')();
const multer = require('multer');
const { log } = require('../lib/logger');
const AutolumenImportService = require('../services/AutolumenImportService');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

router.post('/import/listings', upload.single('csv'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'CSV file required' });
    const service = new AutolumenImportService();
    const result = await service.importActiveListings(req.file.buffer.toString('utf-8'));
    res.json(result);
  } catch (err) {
    log.error({ err }, 'Autolumen listing import failed');
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/import/sales', upload.single('csv'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'CSV file required' });
    const service = new AutolumenImportService();
    const result = await service.importSalesHistory(req.file.buffer.toString('utf-8'));
    res.json(result);
  } catch (err) {
    log.error({ err }, 'Autolumen sales import failed');
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/import/transactions', upload.single('csv'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'CSV file required' });
    const service = new AutolumenImportService();
    const result = await service.importTransactions(req.file.buffer.toString('utf-8'));
    res.json(result);
  } catch (err) {
    log.error({ err }, 'Autolumen transaction import failed');
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/stats', async (req, res) => {
  try {
    const service = new AutolumenImportService();
    const stats = await service.getStats();
    res.json({ success: true, stats });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
