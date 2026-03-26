'use strict';

const { log } = require('../lib/logger');
const router = require('express-promise-router')();
const AttackListService = require('../services/AttackListService');
const DeadInventoryService = require('../services/DeadInventoryService');
const { database } = require('../database/database');
const { v4: uuidv4 } = require('uuid');

/**
 * GET /attack-list
 * Get attack list across all yards — sorted by opportunity.
 * By default returns SLIM vehicles (no parts/rebuild_parts) to keep payload under 200KB.
 * Parts are loaded on-demand via GET /attack-list/vehicle/:id/parts.
 * Pass ?full=true to get the old behavior (large payload with all parts).
 */
router.get('/', async (req, res) => {
  try {
    const { days = 90, activeOnly, full } = req.query;
    const service = new AttackListService();
    const results = await service.getAllYardsAttackList({
      daysBack: parseInt(days),
      activeOnly: activeOnly === 'true',
    });

    // Strip parts arrays for slim mode (default) — huge memory savings on mobile
    if (full !== 'true') {
      for (const yard of results) {
        for (const vehicle of (yard.vehicles || [])) {
          // Keep only chip-display data: part type + price for each part
          vehicle.part_chips = (vehicle.parts || []).slice(0, 4).map(p => ({
            partType: p.partType, price: p.price, verdict: p.verdict,
          }));
          delete vehicle.parts;
          delete vehicle.rebuild_parts;
          delete vehicle.platform_siblings;
        }
      }
    } else {
      // Full mode: enrich with dead inventory warnings
      const deadService = new DeadInventoryService();
      for (const yard of results) {
        for (const vehicle of (yard.vehicles || [])) {
          for (const part of (vehicle.parts || [])) {
            if (part.partNumber) {
              try {
                const warning = await deadService.getWarning(part.partNumber);
                if (warning) part.deadWarning = warning;
              } catch (e) { /* ignore */ }
            }
          }
        }
      }
    }

    res.json({
      success: true,
      generated_at: new Date().toISOString(),
      yards: results,
    });
  } catch (err) {
    log.error({ err }, 'Error generating attack list');
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /attack-list/vehicle/:id/parts
 * Load parts for a single vehicle on-demand (when user taps to expand).
 */
router.get('/vehicle/:id/parts', async (req, res) => {
  try {
    const { id } = req.params;
    const service = new AttackListService();

    // Find the vehicle in the DB
    const vehicle = await database('yard_vehicle').where('id', id).first();
    if (!vehicle) return res.status(404).json({ success: false, error: 'Vehicle not found' });

    // Build indexes and score just this one vehicle
    const inventoryIndex = await service.buildInventoryIndex();
    const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
    const salesIndex = await service.buildSalesIndex(cutoff);
    const { byMakeModel: stockIndex, byPartNumber: stockPartNumbers } = await service.buildStockIndex();
    const platformIndex = await service.buildPlatformIndex();

    const scored = service.scoreVehicle(vehicle, inventoryIndex, salesIndex, stockIndex, platformIndex, stockPartNumbers);

    // Enrich with dead inventory warnings
    const deadService = new DeadInventoryService();
    for (const part of (scored.parts || [])) {
      if (part.partNumber) {
        try {
          const warning = await deadService.getWarning(part.partNumber);
          if (warning) part.deadWarning = warning;
        } catch (e) { /* ignore */ }
      }
    }

    // Enrich with cached market data
    let marketHits = 0, marketMisses = 0;
    try {
      const { getCachedPrice, buildSearchQuery: buildMktQuery } = require('../services/MarketPricingService');
      const vYear = parseInt(vehicle.year) || 0;
      for (const p of (scored.parts || [])) {
        const sq = buildMktQuery({
          title: p.title || '',
          make: scored.make || vehicle.make,
          model: scored.model || vehicle.model,
          year: vYear,
          partType: p.partType,
        });
        const cached = await getCachedPrice(sq.cacheKey);
        if (cached) {
          p.marketMedian = cached.median;
          p.marketCount = cached.count;
          p.marketVelocity = cached.velocity;
          marketHits++;
        } else {
          marketMisses++;
        }
      }
      log.info({ vehicleId: id, parts: (scored.parts || []).length, marketHits, marketMisses }, 'Market enrichment for vehicle parts');
    } catch (e) {
      log.warn({ err: e.message }, 'Market enrichment failed');
    }

    res.json({
      success: true,
      id,
      parts: scored.parts || [],
      rebuild_parts: scored.rebuild_parts || null,
      platform_siblings: scored.platform_siblings || null,
    });
  } catch (err) {
    log.error({ err }, 'Error loading vehicle parts');
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /attack-list/yard/:yardId
 * Get full attack list for a specific yard
 */
router.get('/yard/:yardId', async (req, res) => {
  try {
    const { yardId } = req.params;
    const { days = 90, limit = 100 } = req.query;

    const yard = await database('yard').where('id', yardId).first();
    if (!yard) return res.status(404).json({ error: 'Yard not found' });

    const service = new AttackListService();
    const list = await service.getAttackList(yardId, { 
      daysBack: parseInt(days),
      limit: parseInt(limit),
    });

    res.json({
      success: true,
      yard: {
        id: yard.id,
        name: yard.name,
        chain: yard.chain,
        distance_from_base: yard.distance_from_base,
        last_scraped: yard.last_scraped,
      },
      ...list,
    });
  } catch (err) {
    log.error({ err }, 'Error generating yard attack list');
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /attack-list/summary
 * Quick summary — which yards have the most opportunity today
 */
router.get('/summary', async (req, res) => {
  try {
    const service = new AttackListService();
    const results = await service.getAllYardsAttackList({ daysBack: 90 });

    const summary = results.map(r => ({
      yard: r.yard.name,
      distance: r.yard.distance_from_base,
      vehicles_on_lot: r.total_vehicles,
      hot_vehicles: r.hot_vehicles,
      top_score: r.top_score,
      est_value: r.est_total_value,
      last_scraped: r.yard.last_scraped,
      visit_priority: r.top_score >= 80 ? '🟢 GO TODAY' : r.top_score >= 60 ? '🟡 CONSIDER' : '⬜ SKIP',
    }));

    res.json({ success: true, summary, generated_at: new Date().toISOString() });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /attack-list/log-pull
 * Log a part as pulled. Auto-creates pull_session if needed.
 * Body: { vehicleId, itemId, yardId? }
 */
router.post('/log-pull', async (req, res) => {
  try {
    const { vehicleId, itemId } = req.body;

    // Find the yard for this vehicle
    let yardId = req.body.yardId;
    if (!yardId && vehicleId) {
      try {
        const vehicle = await database('yard_vehicle').where('id', vehicleId).first();
        if (vehicle) yardId = vehicle.yard_id;
      } catch (e) { /* ignore */ }
    }

    // Auto-create or find today's pull session for this yard
    let sessionId = null;
    if (yardId) {
      try {
        const today = new Date().toISOString().slice(0, 10);
        let session = await database('pull_session')
          .where('yard_id', yardId)
          .where('date', today)
          .first();

        if (!session) {
          const { v4: uuidv4 } = require('uuid');
          const inserted = await database('pull_session').insert({
            id: uuidv4(),
            yard_id: yardId,
            date: today,
            createdAt: new Date(),
            updatedAt: new Date(),
          }).returning('id');
          sessionId = inserted[0]?.id || inserted[0];
        } else {
          sessionId = session.id;
        }
      } catch (e) {
        log.warn({ err: e.message }, 'pull_session create failed');
      }
    }

    res.json({ success: true, sessionId });
  } catch (err) {
    log.error({ err }, 'Error logging pull');
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /attack-list/visit-feedback
 * Log yard visit feedback after a session.
 * Body: { yardId, rating (1-5), notes?, pullerName? }
 */
router.post('/visit-feedback', async (req, res) => {
  try {
    const { yardId, rating, notes, pullerName } = req.body;
    if (!yardId || !rating) return res.status(400).json({ error: 'yardId and rating required' });

    const { v4: uuidv4 } = require('uuid');
    await database('yard_visit_feedback').insert({
      id: uuidv4(),
      yard_id: yardId,
      puller_name: pullerName || null,
      visit_date: new Date().toISOString().slice(0, 10),
      rating: parseInt(rating),
      notes: notes || null,
      createdAt: new Date(),
    });

    res.json({ success: true });
  } catch (err) {
    log.error({ err }, 'Error saving visit feedback');
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /attack-list/last-visit/:yardId
 * Get most recent visit feedback for a yard.
 */
router.get('/last-visit/:yardId', async (req, res) => {
  try {
    const { yardId } = req.params;
    const visit = await database('yard_visit_feedback')
      .where('yard_id', yardId)
      .orderBy('visit_date', 'desc')
      .first();

    if (!visit) return res.json({ success: true, found: false });

    const daysAgo = Math.floor((Date.now() - new Date(visit.visit_date).getTime()) / 86400000);
    res.json({
      success: true,
      found: true,
      visit: {
        daysAgo,
        rating: visit.rating,
        notes: visit.notes,
        pullerName: visit.puller_name,
        date: visit.visit_date,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /attack-list/manual
 * Parse raw text into vehicles, score them through the same engine.
 * Body: { text: "2009 Dodge Ram 1500 Silver\n09 RAM 1500\n..." }
 */
router.post('/manual', async (req, res) => {
  try {
    const { text } = req.body;
    if (!text || typeof text !== 'string') {
      return res.status(400).json({ success: false, error: 'text is required' });
    }

    const lines = text.split(/\n/).map(l => l.trim());
    if (lines.filter(l => l).length === 0) {
      return res.status(400).json({ success: false, error: 'No vehicles found in input' });
    }

    // Multi-line parsing: group metadata lines with their vehicle header
    const metaRe = /^(color|vin|section|stock|available|row|space|mileage|odometer|engine|trim|drive|trans|status|date|location|notes?)\s*[:#]/i;
    const vehicles_raw = [];
    let currentBlock = [];

    for (const line of lines) {
      if (!line) {
        // Blank line — flush current block
        if (currentBlock.length > 0) { vehicles_raw.push(currentBlock); currentBlock = []; }
        continue;
      }
      if (metaRe.test(line) && currentBlock.length > 0) {
        // Metadata line — append to current block
        currentBlock.push(line);
      } else if (/\b(?:19|20)\d{2}\b/.test(line) || /^\d{2}\s+[A-Za-z]/.test(line)) {
        // Looks like a new vehicle (has a year) — flush and start new
        if (currentBlock.length > 0) vehicles_raw.push(currentBlock);
        currentBlock = [line];
      } else if (currentBlock.length > 0) {
        // Unknown line — could be continuation, append
        currentBlock.push(line);
      } else {
        // Standalone line — try as single vehicle
        currentBlock = [line];
      }
    }
    if (currentBlock.length > 0) vehicles_raw.push(currentBlock);

    if (vehicles_raw.length > 200) {
      return res.status(400).json({ success: false, error: 'Max 200 vehicles per manual list' });
    }

    // Parse each block: first line is the vehicle, rest is metadata
    const parsed = vehicles_raw.map((block, idx) => {
      const v = parseVehicleLine(block[0], idx);
      // Merge metadata from continuation lines
      for (let i = 1; i < block.length; i++) {
        const meta = block[i];
        const vinM = meta.match(/^vin\s*:\s*([A-HJ-NPR-Z0-9]{17})/i);
        if (vinM && !v.vin) v.vin = vinM[1].toUpperCase();
        const colorM = meta.match(/^color\s*:\s*(.+)/i);
        if (colorM && !v.color) v.color = colorM[1].trim();
        const rowM = meta.match(/row\s*:\s*([A-Za-z0-9]+)/i);
        if (rowM && !v.row) v.row = rowM[1].trim();
        const stockM = meta.match(/^stock\s*[#:]?\s*:?\s*(.+)/i);
        if (stockM) v.stockNumber = stockM[1].trim();
        const engM = meta.match(/^engine\s*:\s*(.+)/i);
        if (engM && !v.engine) v.engine = engM[1].trim();
      }
      return v;
    });
    const valid = parsed.filter(v => v.year && v.make && v.model);

    if (valid.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Could not parse any vehicles. Use format: "2009 Dodge Ram 1500"',
        parsed: parsed.slice(0, 5),
      });
    }

    // Build fake yard_vehicle objects for the scoring engine
    const vehicles = valid.map(v => ({
      id: 'manual-' + uuidv4().slice(0, 8),
      year: v.year,
      make: v.make,
      model: v.model,
      trim: v.trim || null,
      color: v.color || null,
      row_number: v.row || null,
      vin: v.vin || null,
      engine: v.engine || null,
      engine_type: null,
      drivetrain: v.drivetrain || null,
      trim_level: null,
      body_style: null,
      stock_number: null,
      date_added: new Date().toISOString(),
      last_seen: new Date().toISOString(),
      active: true,
      _raw_line: v.raw,
    }));

    // VIN decode any that have VINs (batch via NHTSA)
    const withVins = vehicles.filter(v => v.vin && v.vin.length >= 11);
    if (withVins.length > 0) {
      try {
        for (const v of withVins) {
          try {
            const nhtsa = await fetch(`https://vpic.nhtsa.dot.gov/api/vehicles/decodevin/${v.vin}?format=json`);
            const data = await nhtsa.json();
            const results = data.Results || [];
            const get = (id) => {
              const r = results.find(r => r.VariableId === id);
              return r && r.Value && r.Value !== 'Not Applicable' ? r.Value : null;
            };
            if (!v.year && get(29)) v.year = parseInt(get(29));
            if (get(26)) v.make = get(26);
            if (get(28)) v.model = get(28);
            if (get(13)) v.trim = get(13);
            const disp = get(13) || get(71);
            if (disp) v.engine = disp;
          } catch (e) { /* skip individual VIN errors */ }
        }
      } catch (e) {
        log.warn({ err: e.message }, 'Manual list VIN decode failed');
      }
    }

    const service = new AttackListService();
    const scored = await service.scoreManualVehicles(vehicles);

    // Enrich with dead inventory warnings
    const deadService = new DeadInventoryService();
    for (const vehicle of scored) {
      for (const part of (vehicle.parts || [])) {
        if (part.partNumber) {
          try {
            const warning = await deadService.getWarning(part.partNumber);
            if (warning) part.deadWarning = warning;
          } catch (e) { /* ignore */ }
        }
      }
    }

    res.json({
      success: true,
      generated_at: new Date().toISOString(),
      total_lines: lines.length,
      parsed_count: valid.length,
      skipped_count: lines.length - valid.length,
      vehicles: scored,
    });
  } catch (err) {
    log.error({ err }, 'Error scoring manual set list');
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── Vehicle line parser ──────────────────────────────────
const MAKE_MAP = {
  'chevy': 'Chevrolet', 'chevrolet': 'Chevrolet', 'chev': 'Chevrolet',
  'dodge': 'Dodge', 'ram': 'Ram',
  'chrysler': 'Chrysler', 'jeep': 'Jeep',
  'ford': 'Ford', 'gmc': 'GMC', 'gm': 'GMC',
  'toyota': 'Toyota', 'honda': 'Honda', 'nissan': 'Nissan',
  'bmw': 'BMW', 'mercedes': 'Mercedes-Benz', 'mercedes-benz': 'Mercedes-Benz', 'merc': 'Mercedes-Benz',
  'mazda': 'Mazda', 'kia': 'Kia', 'hyundai': 'Hyundai',
  'subaru': 'Subaru', 'mitsubishi': 'Mitsubishi',
  'infiniti': 'Infiniti', 'lexus': 'Lexus', 'acura': 'Acura',
  'cadillac': 'Cadillac', 'caddy': 'Cadillac',
  'buick': 'Buick', 'lincoln': 'Lincoln',
  'volvo': 'Volvo', 'audi': 'Audi',
  'volkswagen': 'Volkswagen', 'vw': 'Volkswagen',
  'mini': 'Mini', 'pontiac': 'Pontiac', 'saturn': 'Saturn',
  'mercury': 'Mercury', 'scion': 'Scion',
  'land rover': 'Land Rover', 'landrover': 'Land Rover',
  'porsche': 'Porsche', 'jaguar': 'Jaguar',
  'saab': 'Saab', 'fiat': 'Fiat', 'alfa': 'Alfa Romeo',
  'alfa romeo': 'Alfa Romeo', 'tesla': 'Tesla',
};

const COLOR_WORDS = new Set([
  'black', 'white', 'silver', 'gray', 'grey', 'red', 'blue', 'green',
  'gold', 'tan', 'beige', 'brown', 'orange', 'yellow', 'purple', 'maroon',
  'burgundy', 'champagne', 'bronze', 'charcoal', 'cream', 'ivory',
]);

function parseVehicleLine(line, idx) {
  const raw = line;
  // Clean up: remove leading bullets, numbers, dashes, tabs
  let cleaned = line.replace(/^[\s\-•*#\d.)\]]+/, '').trim();
  if (!cleaned) return { raw, error: 'empty' };

  // Extract VIN if present (17-char alphanumeric, no I/O/Q)
  let vin = null;
  const vinMatch = cleaned.match(/\b([A-HJ-NPR-Z0-9]{17})\b/i);
  if (vinMatch) {
    vin = vinMatch[1].toUpperCase();
    cleaned = cleaned.replace(vinMatch[0], ' ').trim();
  }

  // Extract row/space if present (e.g., "Row C3", "Space 12", "R-C3", "Spot 4A")
  let row = null;
  const rowMatch = cleaned.match(/\b(?:row|space|spot|r-?)\s*([A-Z]?\d+[A-Z]?(?:\s*[-/]\s*[A-Z]?\d+[A-Z]?)?)\b/i);
  if (rowMatch) {
    row = rowMatch[1].toUpperCase();
    cleaned = cleaned.replace(rowMatch[0], ' ').trim();
  }

  // Extract engine displacement (e.g., "3.5L", "5.7", "EcoBoost", "Hemi")
  let engine = null;
  const engMatch = cleaned.match(/\b(\d+\.\d+)\s*[lL]?\b/);
  if (engMatch) {
    engine = engMatch[1] + 'L';
    cleaned = cleaned.replace(engMatch[0], ' ').trim();
  }
  // Named engines
  const namedEng = cleaned.match(/\b(ecoboost|hemi|coyote|vortec|duramax|cummins|powerstroke|ecotec|pentastar)\b/i);
  if (namedEng) {
    engine = (engine ? engine + ' ' : '') + namedEng[1];
    cleaned = cleaned.replace(namedEng[0], ' ').trim();
  }

  // Extract drivetrain
  let drivetrain = null;
  const dtMatch = cleaned.match(/\b(4wd|4x4|awd|2wd|fwd|rwd)\b/i);
  if (dtMatch) {
    drivetrain = dtMatch[1].toUpperCase();
    cleaned = cleaned.replace(dtMatch[0], ' ').trim();
  }

  // Extract color
  let color = null;
  const words = cleaned.toLowerCase().split(/\s+/);
  for (const w of words) {
    if (COLOR_WORDS.has(w)) {
      color = w.charAt(0).toUpperCase() + w.slice(1);
      cleaned = cleaned.replace(new RegExp('\\b' + w + '\\b', 'i'), ' ').trim();
      break;
    }
  }

  // Extract year — full (2009) or short (09)
  let year = null;
  const fullYearMatch = cleaned.match(/\b((?:19|20)\d{2})\b/);
  if (fullYearMatch) {
    year = parseInt(fullYearMatch[1]);
    cleaned = cleaned.replace(fullYearMatch[0], ' ').trim();
  } else {
    const shortYearMatch = cleaned.match(/\b(\d{2})\b/);
    if (shortYearMatch) {
      let y = parseInt(shortYearMatch[1]);
      year = y >= 70 ? 1900 + y : 2000 + y;
      cleaned = cleaned.replace(shortYearMatch[0], ' ').trim();
    }
  }

  // Normalize remaining tokens
  const tokens = cleaned.split(/[\s,/]+/).filter(t => t.length > 0);

  // Find make
  let make = null;
  let makeIdx = -1;
  for (let i = 0; i < tokens.length; i++) {
    const lower = tokens[i].toLowerCase();
    // Check two-word makes first
    if (i + 1 < tokens.length) {
      const twoWord = lower + ' ' + tokens[i + 1].toLowerCase();
      if (MAKE_MAP[twoWord]) {
        make = MAKE_MAP[twoWord];
        makeIdx = i;
        tokens.splice(i, 2);
        break;
      }
    }
    if (MAKE_MAP[lower]) {
      make = MAKE_MAP[lower];
      makeIdx = i;
      tokens.splice(i, 1);
      break;
    }
  }

  // Remaining tokens = model (take up to 3 words, stop at noise)
  const modelTokens = [];
  for (const t of tokens) {
    if (/^(ecm|bcm|abs|tipm|radio|module|oem|used|new|reman|part|engine|control)$/i.test(t)) break;
    if (/^\d+\.\d+$/.test(t)) break;
    modelTokens.push(t);
    if (modelTokens.length >= 3) break;
  }
  const model = modelTokens.join(' ') || null;

  return { raw, year, make, model, color, row, vin, engine, drivetrain, trim: null };
}

module.exports = router;
