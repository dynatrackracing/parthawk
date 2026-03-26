'use strict';

const router = require('express-promise-router')();
const { lookupFitment, generatePartNumberWarning } = require('../services/FitmentIntelligenceService');
const { extractPartNumbers } = require('../utils/partIntelligence');

// CORS for listing tool at listcleaner.dynatrackracingnc.workers.dev
router.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

/**
 * GET /api/fitment/lookup
 * Returns fitment intelligence for a part.
 *
 * Query params:
 *   partType (optional) — ECM, BCM, ABS, etc.
 *   make (optional) — Ford, Toyota, etc.
 *   model (optional) — F150, Camry, etc.
 *   year (optional) — 2014
 *   partNumber (optional) — OEM part number, used to auto-detect part type and generate PN warning
 */
router.get('/lookup', async (req, res) => {
  try {
    let { partType, make, model, year, partNumber } = req.query;

    // If partNumber provided, try to detect partType from our sales data
    if (partNumber && !partType) {
      const { database } = require('../database/database');
      try {
        const sale = await database('YourSale')
          .where('title', 'ilike', `%${partNumber}%`)
          .first('title');
        if (sale) {
          const t = (sale.title || '').toUpperCase();
          if (t.includes('ECM') || t.includes('ECU') || t.includes('PCM')) partType = 'ECM';
          else if (t.includes('BCM')) partType = 'BCM';
          else if (t.includes('TCM') || t.includes('TCU')) partType = 'TCM';
          else if (t.includes('ABS')) partType = 'ABS';
          else if (t.includes('TIPM') || t.includes('FUSE') || t.includes('IPDM')) partType = 'TIPM';
          else if (t.includes('AMPLIFIER') || t.includes('AMP')) partType = 'AMP';
          else if (t.includes('CLUSTER') || t.includes('SPEEDOMETER')) partType = 'CLUSTER';
          else if (t.includes('RADIO') || t.includes('STEREO')) partType = 'RADIO';

          // Also try to extract make/model if not provided
          if (!make) {
            const MAKES = { 'ford': 'Ford', 'toyota': 'Toyota', 'honda': 'Honda', 'dodge': 'Dodge',
              'jeep': 'Jeep', 'chrysler': 'Chrysler', 'ram': 'Ram', 'chevrolet': 'Chevrolet',
              'nissan': 'Nissan', 'bmw': 'BMW', 'mazda': 'Mazda', 'lexus': 'Lexus', 'acura': 'Acura',
              'hyundai': 'Hyundai', 'kia': 'Kia', 'subaru': 'Subaru', 'volkswagen': 'Volkswagen',
              'infiniti': 'Infiniti', 'cadillac': 'Cadillac', 'buick': 'Buick', 'lincoln': 'Lincoln',
              'volvo': 'Volvo', 'mercedes': 'Mercedes-Benz' };
            const tLower = sale.title.toLowerCase();
            for (const [alias, canonical] of Object.entries(MAKES)) {
              if (tLower.includes(alias)) { make = canonical; break; }
            }
          }

          // Extract year if not provided
          if (!year) {
            const ym = sale.title.match(/\b((?:19|20)\d{2})\b/);
            if (ym) year = ym[1];
          }
        }
      } catch (e) { /* DB query failed — proceed without enrichment */ }
    }

    const result = await lookupFitment({ partType, make, model, year, partNumber });
    res.json(result);
  } catch (err) {
    console.error('Fitment lookup error:', err);
    res.status(500).json({ error: err.message, confidence: 'none' });
  }
});

/**
 * GET /api/fitment/stats
 * Returns summary of fitment intelligence data.
 */
router.get('/stats', async (req, res) => {
  try {
    const { database } = require('../database/database');
    const stats = await database.raw(`
      SELECT
        COUNT(*) as total,
        COUNT(CASE WHEN confidence = 'high' THEN 1 END) as high_confidence,
        COUNT(CASE WHEN confidence = 'medium' THEN 1 END) as medium_confidence,
        COUNT(CASE WHEN negation_text IS NOT NULL THEN 1 END) as with_negations,
        COUNT(DISTINCT make) as makes,
        COUNT(DISTINCT model) as models,
        COUNT(DISTINCT part_type) as part_types
      FROM fitment_intelligence
    `);
    res.json({ success: true, stats: stats.rows[0] });
  } catch (err) {
    res.json({ success: true, stats: { total: 0, high_confidence: 0, medium_confidence: 0, with_negations: 0 } });
  }
});

module.exports = router;
