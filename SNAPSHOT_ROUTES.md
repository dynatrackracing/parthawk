# DARKHAWK ROUTES — 2026-04-01

## FILE: service/routes/attack-list.js
```javascript
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
    const { days = 90, activeOnly, full, since } = req.query;
    const service = new AttackListService();
    const results = await service.getAllYardsAttackList({
      daysBack: parseInt(days),
      activeOnly: activeOnly === 'true',
      lastSeenSince: since || null,
    });

    // Load active scout alerts and index by vehicle make+model+year+yard
    let alertsByVehicle = {};
    try {
      const alerts = await database('scout_alerts')
        .where(function() { this.where('claimed', false).orWhereNull('claimed'); })
        .select('id', 'source', 'source_title', 'part_value', 'confidence', 'yard_name',
                'vehicle_year', 'vehicle_make', 'vehicle_model');
      for (const a of alerts) {
        const key = [a.vehicle_year, (a.vehicle_make || '').toLowerCase(), (a.vehicle_model || '').toLowerCase(), (a.yard_name || '').toLowerCase()].join('|');
        if (!alertsByVehicle[key]) alertsByVehicle[key] = [];
        alertsByVehicle[key].push({
          id: a.id,
          source: a.source,
          title: a.source_title,
          value: a.part_value,
          confidence: a.confidence,
        });
      }
    } catch (e) { /* scout_alerts may not exist */ }

    // Attach alert badges to vehicles
    for (const yard of results) {
      for (const vehicle of (yard.vehicles || [])) {
        const key = [vehicle.year, (vehicle.make || '').toLowerCase(), (vehicle.model || '').toLowerCase(), (yard.yard_name || '').toLowerCase()].join('|');
        const va = alertsByVehicle[key];
        if (va && va.length > 0) {
          // Separate mark alerts (highest priority) from stream alerts
          vehicle.alertBadges = va.sort((a, b) => {
            if (a.source === 'PERCH' && b.source !== 'PERCH') return -1;
            if (a.source !== 'PERCH' && b.source === 'PERCH') return 1;
            return 0;
          });
        }
      }
    }

    // Strip parts arrays for slim mode (default) — huge memory savings on mobile
    if (full !== 'true') {
      for (const yard of results) {
        for (const vehicle of (yard.vehicles || [])) {
          // Keep only chip-display data: part type + price for each part
          vehicle.part_chips = (vehicle.parts || []).slice(0, 4).map(p => ({
            partType: p.partType, price: p.price, verdict: p.verdict, priceSource: p.priceSource,
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

    // Enrich with reference transmission if NHTSA didn't provide one
    if (!vehicle.decoded_transmission && vehicle.year && vehicle.make && vehicle.model) {
      try {
        const TrimTierService = require('../services/TrimTierService');
        const trimName = vehicle.decoded_trim || vehicle.trim_level || vehicle.trim || null;
        const engine = vehicle.decoded_engine || vehicle.engine || null;
        const refResult = await TrimTierService.lookup(
          parseInt(vehicle.year) || 0,
          vehicle.make, vehicle.model, trimName, engine,
          null, vehicle.decoded_drivetrain || vehicle.drivetrain || null
        );
        if (refResult && refResult.transmission) {
          vehicle.decoded_transmission = refResult.transmission;
        }
      } catch (e) { /* reference lookup optional */ }
    }

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
          p.marketCheckedAt = cached.checkedAt;
          marketHits++;
        } else {
          marketMisses++;
        }
      }
      log.info({ vehicleId: id, parts: (scored.parts || []).length, marketHits, marketMisses }, 'Market enrichment for vehicle parts');
    } catch (e) {
      log.warn({ err: e.message }, 'Market enrichment failed');
    }

    // Enrich expected_parts with validation verdicts
    const validations = await service.loadValidationCache();
    const validatedSuggestions = service.enrichSuggestions(
      vehicle.make, vehicle.expected_parts, vehicle.audio_brand, validations
    );

    res.json({
      success: true,
      id,
      parts: scored.parts || [],
      rebuild_parts: scored.rebuild_parts || null,
      platform_siblings: scored.platform_siblings || null,
      validated_suggestions: validatedSuggestions,
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
            if (get(28)) {
              // Use NHTSA model but strip trim suffixes to keep it clean
              const nhtsaModel = get(28);
              // Only override if parser didn't get a model, or NHTSA is more specific
              if (!v.model || v.model.toUpperCase() === nhtsaModel.split(' ')[0].toUpperCase()) {
                v.model = nhtsaModel.split(/\s+(LE|SE|XLE|SR5|LX|EX|SXT|RT|Limited|Sport|Base|Touring)\b/i)[0];
              }
            }
            if (get(38)) v.trim_level = get(38); // NHTSA var 38 = trim
            // Engine: displacement (var 13) + cylinders (var 71)
            const disp = get(13);
            const cyl = get(71);
            if (disp && !v.engine) {
              const d = parseFloat(disp);
              v.engine = (!isNaN(d) ? d.toFixed(1) : disp) + 'L' + (cyl ? ' ' + (parseInt(cyl) <= 4 ? '4-cyl' : parseInt(cyl) === 6 ? 'V6' : parseInt(cyl) === 8 ? 'V8' : cyl + '-cyl') : '');
            }
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
      total_lines: vehicles_raw.length,
      parsed_count: valid.length,
      skipped_count: vehicles_raw.length - valid.length,
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
  // Clean up: remove leading bullets, dashes, tabs — but NOT 4-digit years
  // Old regex had \d which stripped years like "2011"
  let cleaned = line.replace(/^[\s\-•*#)\]]+/, '').trim();
  // Strip leading list numbers like "1. " or "3) " but NOT years
  cleaned = cleaned.replace(/^\d{1,2}[.)]\s+/, '').trim();
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
```
---
## FILE: service/routes/competitors.js
```javascript
'use strict';

const router = require('express-promise-router')();
const { log } = require('../lib/logger');
const { database } = require('../database/database');
const CompetitorMonitorService = require('../services/CompetitorMonitorService');
const SoldItemsManager = require('../managers/SoldItemsManager');

/**
 * POST /competitors/scan
 * Run competitor price monitoring scan.
 */
router.post('/scan', async (req, res) => {
  try {
    const service = new CompetitorMonitorService();
    const result = await service.scan();
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /competitors/alerts
 * Get active competitor alerts.
 */
router.get('/alerts', async (req, res) => {
  try {
    const { dismissed, limit } = req.query;
    const service = new CompetitorMonitorService();
    const alerts = await service.getAlerts({
      dismissed: dismissed === 'true',
      limit: parseInt(limit) || 50,
    });
    res.json({ success: true, alerts });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /competitors/alerts/:id/dismiss
 * Dismiss a competitor alert.
 */
router.post('/alerts/:id/dismiss', async (req, res) => {
  try {
    const service = new CompetitorMonitorService();
    const result = await service.dismiss(req.params.id);
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /competitors/gap-intel
 * Gap intelligence: parts competitors sell that we have never sold or stocked.
 * Scored by competitor revenue volume and median price.
 * Query: days (default 90), limit (default 50)
 */
router.get('/gap-intel', async (req, res) => {
  const days = parseInt(req.query.days) || 90;
  const limit = parseInt(req.query.limit) || 50;
  const sellerFilter = req.query.seller || null;

  try {
    // Exclude rebuild sellers — their data is reference intel, not competitive
    const rebuildSellers = await database('SoldItemSeller').where('type', 'rebuild').select('name');
    const rebuildNames = rebuildSellers.map(s => s.name);

    // Get competitor sold items (capped at 5000, $100+ only)
    let competitorQuery = database('SoldItem')
      .where('soldDate', '>=', database.raw(`NOW() - INTERVAL '${days} days'`))
      .where('soldPrice', '>=', 100)
      .whereNot('seller', 'dynatrack')
      .whereNot('seller', 'dynatrackracing');

    if (rebuildNames.length > 0) {
      competitorQuery = competitorQuery.whereNotIn('seller', rebuildNames);
    }

    if (sellerFilter) {
      competitorQuery = competitorQuery.where('seller', sellerFilter);
    }

    const competitorItems = await competitorQuery
      .orderBy('soldDate', 'desc')
      .limit(5000)
      .select('title', 'soldPrice', 'soldDate', 'seller', 'ebayItemId');

    // Group competitor items by normalized title
    const compGroups = {};
    for (const item of competitorItems) {
      const key = normalizeTitle(item.title);
      if (!key || key.length < 10) continue;
      if (!compGroups[key]) {
        compGroups[key] = {
          title: item.title,
          sellers: new Set(),
          count: 0,
          totalRevenue: 0,
          prices: [],
          lastSold: null,
          ebayItemId: item.ebayItemId,
        };
      }
      const g = compGroups[key];
      g.sellers.add(item.seller);
      g.count++;
      g.totalRevenue += parseFloat(item.soldPrice) || 0;
      g.prices.push(parseFloat(item.soldPrice) || 0);
      if (!g.lastSold || new Date(item.soldDate) > new Date(g.lastSold)) g.lastSold = item.soldDate;
    }

    // Build match sets from our data (PNs + partType|make|model keys)
    const yourSales = await database('YourSale').select('title').limit(25000);
    const yourListings = await database('YourListing').where('listingStatus', 'Active').select('title').limit(10000);
    const yourItems = await database('Item').whereRaw("LOWER(seller) LIKE '%dynatrack%'").select('title').limit(5000);

    const allOurTitles = [
      ...yourSales.map(s => s.title),
      ...yourListings.map(l => l.title),
      ...yourItems.map(i => i.title),
    ].filter(Boolean);
    const { pnSet: yourPNs, keySet: yourKeys } = buildMatchSets(allOurTitles);

    let dismissedTitles = new Set();
    try {
      const dismissed = await database('dismissed_intel').select('normalizedTitle');
      dismissedTitles = new Set(dismissed.map(function(d) { return d.normalizedTitle; }));
    } catch (e) { /* table may not exist yet */ }

    // Exclude items already in the_mark (actively tracked)
    let markedTitles = new Set();
    try {
      const marks = await database('the_mark').where('active', true).select('normalizedTitle');
      markedTitles = new Set(marks.map(function(m) { return m.normalizedTitle; }));
    } catch (e) { /* table may not exist yet */ }

    // Check yard_vehicle for local matches (moved BEFORE gap loop)
    let yardMakes = new Set();
    try {
      const yardVehicles = await database('yard_vehicle').where('active', true).select('make').limit(5000);
      for (const v of yardVehicles) {
        if (v.make) yardMakes.add(v.make.toUpperCase());
      }
    } catch (e) { /* yard_vehicle may not have data */ }

    // Find gaps: competitor parts that we have never sold, listed, or stocked
    const gaps = [];
    for (const [key, group] of Object.entries(compGroups)) {
      if (weAlreadySellThis(group.title, yourPNs, yourKeys)) continue;
      if (dismissedTitles.has(key)) continue;
      if (markedTitles.has(key)) continue;

      // Calculate median price
      const sorted = group.prices.sort((a, b) => a - b);
      const median = sorted.length % 2 === 0
        ? (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
        : sorted[Math.floor(sorted.length / 2)];

      // Extract part number from title - common OEM patterns
      const partNumber = extractPartNumber(group.title);

      const sellerCount = group.sellers.size;
      const isConfluence = sellerCount >= 2;
      const volumeScore = Math.min(100, (group.count / 30) * 100);
      const priceScore = Math.min(100, (median / 500) * 100);
      const partNumberScore = partNumber ? 100 : 0;
      // Confluence reshapes the weights - multi-seller validation is the strongest signal
      let score;
      if (isConfluence) {
        const confluenceScore = Math.min(100, (sellerCount / 4) * 100); // 2=50, 3=75, 4+=100
        score = Math.round(confluenceScore * 0.30 + volumeScore * 0.25 + priceScore * 0.25 + partNumberScore * 0.20);
        // Confluence floor: never below 60 if 2+ sellers agree
        score = Math.max(60, score);
      } else {
        const sellerScore = Math.min(100, (sellerCount / 3) * 100);
        score = Math.round(volumeScore * 0.35 + priceScore * 0.30 + sellerScore * 0.15 + partNumberScore * 0.20);
      }

      gaps.push({
        title: group.title,
        normalizedTitle: key,
        sellers: Array.from(group.sellers),
        soldCount: group.count,
        totalRevenue: Math.round(group.totalRevenue),
        medianPrice: Math.round(median),
        avgPrice: Math.round(group.totalRevenue / group.count),
        minPrice: Math.round(Math.min(...group.prices)),
        maxPrice: Math.round(Math.max(...group.prices)),
        lastSold: group.lastSold,
        score,
        ebayItemId: group.ebayItemId,
        partNumber: partNumber,
        partType: extractPartType(group.title),
        confluence: isConfluence,
        sellerCount: sellerCount,
        yardMatch: titleMatchesYard(group.title, yardMakes),
      });
    }

    // Sort by score descending
    gaps.sort((a, b) => b.score - a.score);

    res.json({
      success: true,
      days,
      totalGaps: gaps.length,
      gaps: gaps.slice(0, limit),
    });
  } catch (err) {
    log.error({ err }, 'Gap intel error');
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /competitors/emerging
 * Detect NEW (first-ever appearance) and ACCELERATING parts from competitor data.
 * Query: days (default 90), limit (default 40)
 */
router.get('/emerging', async (req, res) => {
  const days = parseInt(req.query.days) || 90;
  const limit = parseInt(req.query.limit) || 40;
  const sellerFilter = req.query.seller || null;

  try {
    const now = new Date();
    const cutoff = new Date(now - days * 24 * 60 * 60 * 1000);
    const midpoint = new Date(now - (days / 2) * 24 * 60 * 60 * 1000);
    const recentWindow = new Date(now - 30 * 24 * 60 * 60 * 1000);

    // Exclude rebuild sellers — their data is reference intel, not competitive
    const rebuildSellers = await database('SoldItemSeller').where('type', 'rebuild').select('name');
    const rebuildNames = rebuildSellers.map(s => s.name);

    let emergingQuery = database('SoldItem')
      .where('soldDate', '>=', cutoff)
      .where('soldPrice', '>=', 100)
      .whereNot('seller', 'dynatrack')
      .whereNot('seller', 'dynatrackracing');

    if (rebuildNames.length > 0) {
      emergingQuery = emergingQuery.whereNotIn('seller', rebuildNames);
    }

    if (sellerFilter) {
      emergingQuery = emergingQuery.where('seller', sellerFilter);
    }

    const items = await emergingQuery
      .orderBy('soldDate', 'desc')
      .limit(5000)
      .select('title', 'soldPrice', 'soldDate', 'seller', 'ebayItemId');

    const groups = {};
    for (const item of items) {
      const key = normalizeTitle(item.title);
      if (!key || key.length < 10) continue;
      if (!groups[key]) {
        groups[key] = { title: item.title, sellers: new Set(), firstSeen: new Date(item.soldDate), recentCount: 0, olderCount: 0, totalCount: 0, prices: [], ebayItemId: item.ebayItemId };
      }
      const g = groups[key];
      g.sellers.add(item.seller);
      g.totalCount++;
      g.prices.push(parseFloat(item.soldPrice) || 0);
      const soldDate = new Date(item.soldDate);
      if (soldDate < g.firstSeen) g.firstSeen = soldDate;
      if (soldDate >= midpoint) { g.recentCount++; } else { g.olderCount++; }
    }

    const olderItems = await database('SoldItem').where('soldDate', '<', cutoff).select('title').limit(10000);
    const previouslySeenTitles = new Set(olderItems.map(function(i) { return normalizeTitle(i.title); }).filter(Boolean));

    // Build match sets from our data
    const yourSales = await database('YourSale').select('title').limit(25000);
    const yourListings = await database('YourListing').where('listingStatus', 'Active').select('title').limit(10000);
    const allOurTitles = [...yourSales.map(s => s.title), ...yourListings.map(l => l.title)].filter(Boolean);
    const { pnSet: yourPNs, keySet: yourKeys } = buildMatchSets(allOurTitles);

    let dismissedTitles = new Set();
    try {
      const dismissed = await database('dismissed_intel').select('normalizedTitle');
      dismissedTitles = new Set(dismissed.map(function(d) { return d.normalizedTitle; }));
    } catch (e) { /* table may not exist yet */ }

    const emerging = [];
    for (const [key, group] of Object.entries(groups)) {
      if (weAlreadySellThis(group.title, yourPNs, yourKeys)) continue;
      if (dismissedTitles.has(key)) continue;

      const sorted = group.prices.sort(function(a, b) { return a - b; });
      const median = sorted.length % 2 === 0 ? (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2 : sorted[Math.floor(sorted.length / 2)];
      const partNumber = extractPartNumber(group.title);

      let signal = null;
      let signalStrength = 0;

      if (group.firstSeen >= recentWindow && group.totalCount <= 5 && !previouslySeenTitles.has(key)) {
        signal = 'NEW';
        const rarityScore = Math.max(0, 100 - (group.totalCount - 1) * 20);
        const priceWeight = Math.min(100, (median / 400) * 100);
        const pnBonus = partNumber ? 20 : 0;
        signalStrength = Math.min(100, rarityScore * 0.45 + priceWeight * 0.35 + pnBonus);
      } else if (group.recentCount >= 4 && group.olderCount > 0 && group.recentCount >= group.olderCount * 3) {
        signal = 'ACCEL';
        const acceleration = group.recentCount / Math.max(1, group.olderCount);
        signalStrength = Math.min(100, (acceleration / 6) * 40 + (median / 400) * 30 + (group.recentCount / 20) * 20 + (partNumber ? 10 : 0));
      }

      if (!signal) continue;

      emerging.push({
        title: group.title, partNumber, partType: extractPartType(group.title), signal, signalStrength: Math.round(signalStrength),
        sellers: Array.from(group.sellers), totalCount: group.totalCount, recentCount: group.recentCount,
        olderCount: group.olderCount, medianPrice: Math.round(median),
        totalRevenue: Math.round(group.prices.reduce(function(a, b) { return a + b; }, 0)),
        firstSeen: group.firstSeen.toISOString(), ebayItemId: group.ebayItemId,
      });
    }

    emerging.sort(function(a, b) {
      if (a.signal === 'NEW' && b.signal !== 'NEW') return -1;
      if (b.signal === 'NEW' && a.signal !== 'NEW') return 1;
      return b.signalStrength - a.signalStrength;
    });

    res.json({ success: true, days, totalEmerging: emerging.length, newCount: emerging.filter(function(e) { return e.signal === 'NEW'; }).length, accelCount: emerging.filter(function(e) { return e.signal === 'ACCEL'; }).length, emerging: emerging.slice(0, limit) });
  } catch (err) {
    log.error({ err }, 'Emerging parts error');
    res.status(500).json({ success: false, error: err.message });
  }
});

// Helper: normalize a title for fuzzy matching
function normalizeTitle(title) {
  if (!title) return '';
  return title
    .toUpperCase()
    .replace(/[^A-Z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .substring(0, 65);
}

// Known automotive makes for title parsing
var KNOWN_MAKES_UPPER = ['FORD','CHEVROLET','CHEVY','DODGE','RAM','CHRYSLER','JEEP','TOYOTA','HONDA','NISSAN','HYUNDAI','KIA','SUBARU','MAZDA','MITSUBISHI','BMW','MERCEDES','AUDI','VOLKSWAGEN','VOLVO','MINI','PORSCHE','LEXUS','ACURA','INFINITI','GENESIS','CADILLAC','BUICK','GMC','LINCOLN','PONTIAC','SATURN','OLDSMOBILE','JAGUAR','LAND ROVER','FIAT','SCION','SUZUKI','SAAB'];

/**
 * Extract a structured key from a title: "PARTTYPE|MAKE|MODEL"
 * Used for two-tier gap-intel matching instead of fuzzy word overlap.
 */
function buildTitleKey(title) {
  if (!title) return null;
  var upper = title.toUpperCase();

  var partType = extractPartType(title) || null;
  if (!partType) return null;

  var make = null;
  for (var m of KNOWN_MAKES_UPPER) {
    if (upper.includes(m)) { make = m; break; }
  }
  if (!make) return null;

  // Extract model: first non-noise word(s) after make
  var makeIdx = upper.indexOf(make);
  var afterMake = upper.substring(makeIdx + make.length).trim();
  var modelWords = [];
  var stopWords = new Set(['OEM','GENUINE','PROGRAMMED','REBUILT','PLUG','PLAY','ASSEMBLY','MODULE','UNIT','REMAN','REMANUFACTURED','NEW','USED','TESTED','ENGINE','CONTROL','COMPUTER','ELECTRONIC','ANTI','LOCK','BRAKE','PUMP','FUSE','POWER','BOX','BODY','TRANSMISSION','ECU','ECM','PCM','BCM','TCM','ABS','TIPM','SRS','HVAC','INSTRUMENT','CLUSTER','SPEEDOMETER','RADIO','HEAD','STEREO','AMPLIFIER','THROTTLE','INTAKE','ALTERNATOR','STARTER','TURBO','CAMERA','SENSOR','WORKING','FAST','FREE','SHIPPING','SHIP']);
  for (var w of afterMake.replace(/[^A-Z0-9\s]/g, '').split(/\s+/)) {
    if (!w || w.length < 2) continue;
    if (/^\d{4}$/.test(w)) continue; // skip years
    if (stopWords.has(w)) continue;
    modelWords.push(w);
    if (modelWords.length >= 2) break;
  }
  var model = modelWords.join(' ') || null;
  if (!model) return null;

  return partType + '|' + make + '|' + model;
}

/**
 * Build PN and title-key sets from an array of title strings.
 * Returns { pnSet: Set<string>, keySet: Set<string> }
 */
function buildMatchSets(titles) {
  var pnSet = new Set();
  var keySet = new Set();
  for (var title of titles) {
    if (!title) continue;
    // Extract part number
    var pn = extractPartNumber(title);
    if (pn) {
      var pnBase = pn.replace(/[-\s]/g, '').replace(/[A-Z]{1,2}$/, '');
      if (pnBase.length >= 5) pnSet.add(pnBase);
      pnSet.add(pn.replace(/[-\s]/g, ''));
    }
    // Extract title key
    var key = buildTitleKey(title);
    if (key) keySet.add(key);
  }
  return { pnSet, keySet };
}

/**
 * Two-tier matching: do we already sell this part?
 * Tier 1: PN match (if extractable). Tier 2: strict partType|make|model key match.
 */
function weAlreadySellThis(competitorTitle, yourPNs, yourKeys) {
  // Tier 1: check by part number
  var pn = extractPartNumber(competitorTitle);
  if (pn) {
    var pnClean = pn.replace(/[-\s]/g, '');
    var pnBase = pnClean.replace(/[A-Z]{1,2}$/, '');
    if (yourPNs.has(pnClean) || (pnBase.length >= 5 && yourPNs.has(pnBase))) return true;
  }

  // Tier 2: strict partType|make|model key
  var key = buildTitleKey(competitorTitle);
  if (key && yourKeys.has(key)) return true;

  // No match — this is a gap
  return false;
}

// Extract OEM part number from title
// Matches patterns like: CT43-2C405-AB, 39132-26BL0, 8T0-035-223AN, 68059524AI, BBM466A20
function extractPartNumber(title) {
  if (!title) return null;

  // Common OEM part number patterns (alphanumeric with dashes/spaces, 6+ chars)
  const patterns = [
    /\b([A-Z]{1,4}\d{1,4}[-\s]?\d{2,5}[-\s]?[A-Z0-9]{1,5})\b/i,    // CT43-2C405-AB, 8T0 035 223AN
    /\b(\d{4,6}[-]?[A-Z0-9]{2,6}[-]?[A-Z0-9]{0,4})\b/i,             // 39132-26BL0, 68059524AI
    /\b([A-Z]{2,4}\d{3,6}[A-Z]?\d{0,2})\b/i,                         // BBM466A20, MR578042
    /\b(\d{2,3}[-]\d{4,5}[-]\d{3,5}[-]?[A-Z]{0,2})\b/,               // 84010-48180, 99211-F1000
  ];

  for (const pattern of patterns) {
    const match = title.match(pattern);
    if (match && match[1] && match[1].length >= 6) {
      // Filter out obvious non-part-numbers (years, mileage)
      const candidate = match[1].replace(/\s+/g, '-');
      if (/^(19|20)\d{2}$/.test(candidate)) continue; // skip years
      if (/^\d{1,3},?\d{3}$/.test(candidate)) continue; // skip mileage
      return candidate.toUpperCase();
    }
  }
  return null;
}

var PART_TYPES = [
  { keywords: ['ECU', 'ECM', 'PCM', 'ENGINE CONTROL', 'ENGINE COMPUTER'], type: 'ECM' },
  { keywords: ['BCM', 'BODY CONTROL'], type: 'BCM' },
  { keywords: ['TCM', 'TRANSMISSION CONTROL', 'TRANS CONTROL'], type: 'TCM' },
  { keywords: ['ABS', 'ANTI LOCK', 'ANTILOCK', 'BRAKE PUMP', 'BRAKE MODULE'], type: 'ABS' },
  { keywords: ['TIPM', 'TOTALLY INTEGRATED', 'POWER MODULE'], type: 'TIPM' },
  { keywords: ['FUSE BOX', 'FUSE RELAY', 'JUNCTION BOX', 'RELAY BOX'], type: 'FUSE BOX' },
  { keywords: ['AMPLIFIER', 'AMP ', 'AUDIO AMP', 'BOSE', 'BANG', 'HARMAN', 'JBL', 'ALPINE', 'INFINITY'], type: 'AMP' },
  { keywords: ['RADIO', 'STEREO', 'HEAD UNIT', 'INFOTAINMENT', 'NAVIGATION'], type: 'RADIO' },
  { keywords: ['CLUSTER', 'INSTRUMENT CLUSTER', 'SPEEDOMETER', 'GAUGE'], type: 'CLUSTER' },
  { keywords: ['THROTTLE BODY', 'THROTTLE ASSY'], type: 'THROTTLE' },
  { keywords: ['HVAC', 'CLIMATE CONTROL', 'A/C CONTROL', 'HEATER CONTROL'], type: 'HVAC' },
  { keywords: ['AIRBAG', 'AIR BAG', 'SRS', 'RESTRAINT'], type: 'AIRBAG' },
  { keywords: ['STEERING MODULE', 'STEERING CONTROL', 'EPS', 'POWER STEERING CONTROL'], type: 'STEERING' },
  { keywords: ['CAMERA', 'BACKUP CAM', 'REAR VIEW', 'SURROUND VIEW'], type: 'CAMERA' },
  { keywords: ['BLIND SPOT', 'LANE ASSIST', 'LANE DEPARTURE'], type: 'SENSOR' },
  { keywords: ['LIFTGATE', 'LIFT GATE', 'TAILGATE MODULE'], type: 'LIFTGATE' },
  { keywords: ['PARKING SENSOR', 'PARK ASSIST', 'PDC'], type: 'SENSOR' },
  { keywords: ['TRANSFER CASE MODULE', 'TRANSFER CASE CONTROL'], type: 'XFER' },
];

function extractPartType(title) {
  if (!title) return null;
  var upper = title.toUpperCase();
  for (var i = 0; i < PART_TYPES.length; i++) {
    for (var j = 0; j < PART_TYPES[i].keywords.length; j++) {
      if (upper.includes(PART_TYPES[i].keywords[j])) return PART_TYPES[i].type;
    }
  }
  return null;
}

/**
 * POST /competitors/cleanup
 * Purge sold data older than 90 days for all sellers EXCEPT importapart and pro-rebuild.
 * These two are permanent fixtures - their data is never purged.
 */
router.post('/cleanup', async (req, res) => {
  const protectedSellers = ['importapart', 'pro-rebuild'];
  const retentionDays = parseInt(req.query.days) || 90;

  try {
    const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);

    const result = await database('SoldItem')
      .where('soldDate', '<', cutoff)
      .whereNotIn('seller', protectedSellers)
      .del();

    res.json({
      success: true,
      purged: result,
      retentionDays,
      protectedSellers,
      cutoffDate: cutoff.toISOString(),
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /competitors/auto-scrape
 * Emergency override — scrapes ALL enabled sellers at once.
 * Prefer drip cron (CompetitorDripRunner, 4x daily) for normal operations.
 * Skips sellers scraped in the last 20 hours.
 */
router.post('/auto-scrape', async (req, res) => {
  log.warn('Manual auto-scrape triggered — prefer drip cron for rate limiting');
  try {
    const sellers = await database('SoldItemSeller').where('enabled', true);
    const results = [];
    const skipWindow = new Date(Date.now() - 20 * 60 * 60 * 1000);

    for (const seller of sellers) {
      if (seller.lastScrapedAt && new Date(seller.lastScrapedAt) > skipWindow) {
        results.push({ seller: seller.name, skipped: true, reason: 'scraped recently' });
        continue;
      }

      const manager = new SoldItemsManager();
      try {
        const result = await manager.scrapeCompetitor({
          seller: seller.name,
          categoryId: '6030',
          maxPages: 3,
        });

        await database('SoldItemSeller').where('name', seller.name).update({
          lastScrapedAt: new Date(),
          itemsScraped: (seller.itemsScraped || 0) + result.stored,
          updatedAt: new Date(),
        });

        results.push({ seller: seller.name, ...result });
      } catch (err) {
        log.error({ err: err.message, seller: seller.name }, 'Auto-scrape failed for seller');
        results.push({ seller: seller.name, error: err.message });
      } finally {
        try { await manager.scraper.closeBrowser(); } catch (e) {}
      }
    }

    res.json({ success: true, results });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/dismiss', async (req, res) => {
  const { title } = req.body;
  if (!title) return res.status(400).json({ success: false, error: 'title required' });
  try {
    const key = normalizeTitle(title);
    const exists = await database('dismissed_intel').where('normalizedTitle', key).first();
    if (!exists) {
      await database('dismissed_intel').insert({ normalizedTitle: key, originalTitle: title, dismissedAt: new Date() });
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/undismiss', async (req, res) => {
  const { title } = req.body;
  if (!title) return res.status(400).json({ success: false, error: 'title required' });
  try {
    const key = normalizeTitle(title);
    await database('dismissed_intel').where('normalizedTitle', key).del();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /competitors/mark
 * Add an item to The Mark (want list).
 * Body: { title, partNumber, partType, medianPrice, sourceSignal, sourceSellers, score }
 */
router.post('/mark', async (req, res) => {
  const { title, partNumber, partType, medianPrice, sourceSignal, sourceSellers, score } = req.body;
  if (!title) return res.status(400).json({ success: false, error: 'title required' });

  try {
    const key = normalizeTitle(title);
    const exists = await database('the_mark').where('normalizedTitle', key).first();
    if (exists) {
      // Reactivate if previously graduated
      if (!exists.active) {
        await database('the_mark').where('normalizedTitle', key).update({
          active: true,
          graduatedAt: null,
          graduatedReason: null,
          updatedAt: new Date(),
        });
      }
      return res.json({ success: true, exists: true, id: exists.id });
    }

    const inserted = await database('the_mark').insert({
      normalizedTitle: key,
      originalTitle: title,
      partNumber: partNumber || null,
      partType: partType || null,
      medianPrice: medianPrice || null,
      sourceSignal: sourceSignal || 'gap-intel',
      sourceSellers: sourceSellers || null,
      scoreAtMark: score || null,
      source: 'PERCH',
      active: true,
      markedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    }).returning('id');

    res.json({ success: true, id: inserted[0]?.id || inserted[0] });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /competitors/marks
 * Get all active marks. Query: all=true to include graduated.
 */
router.get('/marks', async (req, res) => {
  try {
    const showAll = req.query.all === 'true';
    let query = database('the_mark').orderBy('markedAt', 'desc');
    if (!showAll) {
      query = query.where('active', true);
    }
    const marks = await query.limit(200);

    // Check which marks have matching vehicles in yards right now
    let yardMakes = new Set();
    try {
      const yardVehicles = await database('yard_vehicle').select('make').limit(5000);
      for (const v of yardVehicles) {
        if (v.make) yardMakes.add(v.make.toUpperCase());
      }
    } catch (e) {}

    // Check which marks have been listed/sold (candidates for auto-graduation)
    const yourSales = await database('YourSale').select('title').limit(25000);
    const yourSoldTitles = new Set(yourSales.map(function(s) { return normalizeTitle(s.title); }).filter(Boolean));
    const yourListings = await database('YourListing').where('listingStatus', 'Active').select('title').limit(10000);
    const yourListingTitles = new Set(yourListings.map(function(l) { return normalizeTitle(l.title); }).filter(Boolean));

    const enriched = marks.map(function(m) {
      var yardMatch = titleMatchesYard(m.originalTitle, yardMakes);
      var inYourInventory = matchesAny(m.normalizedTitle, yourListingTitles);
      var youSoldIt = matchesAny(m.normalizedTitle, yourSoldTitles);

      return {
        ...m,
        yardMatch: yardMatch,
        inYourInventory: inYourInventory,
        youSoldIt: youSoldIt,
        status: !m.active ? 'graduated' : youSoldIt ? 'sold' : inYourInventory ? 'listed' : yardMatch ? 'in-yard' : 'hunting',
      };
    });

    res.json({ success: true, marks: enriched, total: enriched.length });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * DELETE /competitors/mark/:id
 * Remove an item from The Mark.
 */
router.delete('/mark/:id', async (req, res) => {
  try {
    await database('the_mark').where('id', req.params.id).del();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * PATCH /competitors/mark/:id
 * Update notes on a mark.
 */
router.patch('/mark/:id', async (req, res) => {
  try {
    const { notes } = req.body;
    await database('the_mark').where('id', req.params.id).update({ notes, updatedAt: new Date() });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /competitors/mark/graduate
 * Auto-graduate marks that you've now sold. Uses shared graduateMarks() function.
 */
router.post('/mark/graduate', async (req, res) => {
  try {
    const graduated = await graduateMarks();
    res.json({ success: true, graduated });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /competitors/mark/check-vehicle
 * Check if a make/model matches any active marks. Used by attack list.
 * Query: make, model, year (all optional)
 */
router.get('/mark/check-vehicle', async (req, res) => {
  const { make, model, year } = req.query;
  if (!make) return res.json({ success: true, matches: [] });

  try {
    const activeMarks = await database('the_mark').where('active', true);
    const makeUpper = make.toUpperCase();
    const modelUpper = model ? model.toUpperCase() : null;

    const matches = activeMarks.filter(function(m) {
      var title = m.originalTitle.toUpperCase();
      if (!title.includes(makeUpper)) return false;
      if (modelUpper && !title.includes(modelUpper)) return false;
      if (year && !title.includes(String(year))) return false;
      return true;
    }).map(function(m) {
      return {
        id: m.id,
        title: m.originalTitle,
        partType: m.partType,
        partNumber: m.partNumber,
        medianPrice: m.medianPrice,
        markedAt: m.markedAt,
      };
    });

    res.json({ success: true, matches });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /competitors/seed-defaults
 * Add default competitors if not already tracked.
 */
router.post('/seed-defaults', async (req, res) => {
  const defaults = ['importapart', 'pro-rebuild'];
  const added = [];
  for (const name of defaults) {
    try {
      const exists = await database('SoldItemSeller').where('name', name).first();
      if (!exists) {
        await database('SoldItemSeller').insert({
          name,
          enabled: true,
          itemsScraped: 0,
          createdAt: new Date(),
          updatedAt: new Date(),
        });
        added.push(name);
      }
    } catch (e) { /* ignore duplicate */ }
  }
  res.json({ success: true, added });
});

/**
 * DELETE /competitors/:sellerId
 * Remove a seller from tracking. Optionally delete their sold data.
 * Query: deleteData=true to also remove their SoldItem records
 */
router.delete('/:sellerId', async (req, res) => {
  const sellerName = req.params.sellerId.toLowerCase().trim();
  const deleteData = req.query.deleteData === 'true';

  try {
    // Remove from SoldItemSeller
    const deleted = await database('SoldItemSeller').where('name', sellerName).del();

    let itemsDeleted = 0;
    if (deleteData) {
      const result = await database('SoldItem').where('seller', sellerName).del();
      itemsDeleted = result;
    }

    res.json({
      success: true,
      seller: sellerName,
      removed: deleted > 0,
      itemsDeleted,
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /competitors/:sellerId/scrape
 * Trigger scrape for a specific competitor seller. Runs in background.
 */
router.post('/:sellerId/scrape', async (req, res) => {
  const sellerName = req.params.sellerId.toLowerCase().trim();
  const { pages = 3 } = req.query;

  // Auto-add seller to SoldItemSeller if not exists
  try {
    const exists = await database('SoldItemSeller').where('name', sellerName).first();
    if (!exists) {
      await database('SoldItemSeller').insert({ name: sellerName, enabled: true, itemsScraped: 0, createdAt: new Date(), updatedAt: new Date() });
    }
  } catch (e) { /* ignore duplicate */ }

  res.json({ started: true, seller: sellerName, maxPages: parseInt(pages) });

  // Run in background
  const manager = new SoldItemsManager();
  try {
    const result = await manager.scrapeCompetitor({
      seller: sellerName,
      categoryId: '6030',
      maxPages: parseInt(pages),
    });
    log.info({ seller: sellerName, result }, 'Manual competitor scrape complete');

    // Update seller stats (was missing — #7)
    try {
      await database('SoldItemSeller').where('name', sellerName).update({
        lastScrapedAt: new Date(),
        itemsScraped: database.raw('"itemsScraped" + ?', [result.stored]),
        updatedAt: new Date(),
      });
    } catch (e) { log.warn({ err: e.message, seller: sellerName }, 'Could not update seller stats'); }
  } catch (err) {
    log.error({ err: err.message, seller: sellerName }, 'Manual competitor scrape failed');
  } finally {
    try { await manager.scraper.closeBrowser(); } catch (e) {}
  }
});

/**
 * GET /competitors/:sellerId/best-sellers
 * Best sellers report from scraped sold items.
 */
router.get('/:sellerId/best-sellers', async (req, res) => {
  const sellerId = req.params.sellerId.toLowerCase().trim();
  const days = parseInt(req.query.days) || 90;

  try {
    // Get all sold items for this seller
    const items = await database('SoldItem')
      .where('seller', sellerId)
      .where('soldDate', '>=', database.raw(`NOW() - INTERVAL '${days} days'`))
      .orderBy('soldPrice', 'desc')
      .select('title', 'soldPrice', 'soldDate', 'ebayItemId', 'condition', 'manufacturerPartNumber');

    // Group by approximate title (first 40 chars) to find repeated sellers
    const groups = {};
    for (const item of items) {
      const key = normalizeTitle(item.title);
      if (!groups[key]) {
        groups[key] = { title: item.title, count: 0, totalRevenue: 0, prices: [], lastSold: null, pn: item.manufacturerPartNumber, ebayItemId: item.ebayItemId };
      }
      const g = groups[key];
      g.count++;
      g.totalRevenue += parseFloat(item.soldPrice) || 0;
      g.prices.push(parseFloat(item.soldPrice) || 0);
      if (!g.lastSold || new Date(item.soldDate) > new Date(g.lastSold)) g.lastSold = item.soldDate;
    }

    // Build sorted list by revenue
    const bestSellers = Object.values(groups)
      .map(g => ({
        title: g.title,
        partNumber: g.pn || null,
        soldCount: g.count,
        totalRevenue: Math.round(g.totalRevenue),
        avgPrice: Math.round(g.totalRevenue / g.count),
        minPrice: Math.round(Math.min(...g.prices)),
        maxPrice: Math.round(Math.max(...g.prices)),
        lastSold: g.lastSold,
        velocity: Math.round(g.count / (days / 7) * 10) / 10, // per week
        ebayItemId: g.ebayItemId || null,
      }))
      .sort((a, b) => b.totalRevenue - a.totalRevenue);

    res.json({
      success: true,
      seller: sellerId,
      days,
      totalSold: items.length,
      totalRevenue: Math.round(items.reduce((s, i) => s + (parseFloat(i.soldPrice) || 0), 0)),
      uniqueProducts: bestSellers.length,
      bestSellers: bestSellers.slice(0, 100),
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /competitors/sellers
 * List all tracked competitor sellers with stats.
 */
router.get('/sellers', async (req, res) => {
  try {
    const sellers = await database('SoldItemSeller').orderBy('name');

    // Single grouped query instead of N+1
    const counts = await database('SoldItem')
      .select('seller')
      .count('* as count')
      .groupBy('seller');
    const countMap = {};
    for (const c of counts) {
      countMap[c.seller] = parseInt(c.count || 0);
    }

    var withCounts = sellers.map(function(s) {
      var hoursAgo = s.lastScrapedAt ? Math.floor((Date.now() - new Date(s.lastScrapedAt).getTime()) / 3600000) : null;
      var scrapeAlert = null;
      if (s.enabled && (!s.lastScrapedAt || hoursAgo > 48)) {
        scrapeAlert = !s.lastScrapedAt ? 'Never scraped' : 'Last scrape ' + Math.floor(hoursAgo / 24) + 'd ago - may be failing';
      }
      return { ...s, soldItemCount: countMap[s.name] || 0, scrapeAlert: scrapeAlert };
    });

    var alerts = withCounts.filter(function(s) { return s.scrapeAlert; }).map(function(s) { return { seller: s.name, message: s.scrapeAlert }; });

    res.json({ success: true, sellers: withCounts, scrapeAlerts: alerts });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Check if a normalized title matches any title in a Set (word overlap >= 80%)
function matchesAny(normalizedTitle, titleSet) {
  if (!normalizedTitle || titleSet.size === 0) return false;
  const words = normalizedTitle.split(/\s+/).filter(w => w.length > 2);
  if (words.length === 0) return false;
  for (const candidate of titleSet) {
    const cWords = candidate.split(/\s+/).filter(w => w.length > 2);
    if (cWords.length === 0) continue;
    let matches = 0;
    for (const w of words) {
      if (cWords.includes(w)) matches++;
    }
    const overlap = matches / Math.max(words.length, 1);
    if (overlap >= 0.8) return true;
  }
  return false;
}

function titleMatchesYard(title, yardMakes) {
  if (!title || yardMakes.size === 0) return false;
  var upper = title.toUpperCase();
  for (var make of yardMakes) {
    if (make.length >= 3 && upper.includes(make)) return true;
  }
  return false;
}

// Weekly competitor scrape — Sunday 8pm UTC
// Rewired from dead FindingsAPI to SoldItemsScraper (Playwright) in Phase 2.5
// Also runs mark graduation after fresh data arrives
async function graduateMarks() {
  try {
    const activeMarks = await database('the_mark').where('active', true);
    const yListings = await database('YourListing').where('listingStatus', 'Active').select('title').limit(25000);
    const yListingTitles = new Set(yListings.map(function(l) { return normalizeTitle(l.title); }).filter(Boolean));

    let graduated = 0;
    for (const mark of activeMarks) {
      if (matchesAny(mark.normalizedTitle, yListingTitles)) {
        await database('the_mark').where('id', mark.id).update({
          active: false,
          graduatedAt: new Date(),
          graduatedReason: 'Listed - part sourced and in inventory',
          updatedAt: new Date(),
        });
        log.info({ mark: mark.originalTitle }, 'Auto-graduated mark - listed');
        graduated++;
      }
    }
    return graduated;
  } catch (gradErr) {
    log.error({ err: gradErr.message }, 'Auto-graduation check failed');
    return 0;
  }
}

// REMOVED: Sunday 8pm blast-all-sellers cron.
// Replaced by CompetitorDripRunner (4x daily, 1 seller per run, registered in index.js).
// graduateMarks() runs daily at midnight via index.js drip cron.

module.exports = router;
```
---
## FILE: service/routes/yards.js
```javascript
'use strict';

const { log } = require('../lib/logger');
const router = require('express-promise-router')();
const LKQScraper = require('../scrapers/LKQScraper');
const { database } = require('../database/database');
const { enrichYard } = require('../services/PostScrapeService');

// In-memory scrape status tracking
let scrapeStatus = { running: false, started_at: null, finished_at: null, error: null };

/**
 * Yard Routes
 * 
 * GET  /yards              - List all yards
 * GET  /yards/:id/vehicles - Get vehicles at a yard
 * POST /yards/scrape/lkq   - Trigger LKQ scrape for all NC locations (manual trigger)
 * POST /yards/scrape/:id   - Trigger scrape for a specific yard
 */

// Simple test endpoint
router.get('/ping', async (req, res) => {
  res.json({ ok: true, time: new Date().toISOString() });
});

// List all yards
router.get('/', async (req, res) => {
  try {
    const yards = await database('yard')
      .orderBy('flagged', 'asc')
      .orderBy('visit_frequency', 'asc')
      .orderBy('distance_from_base', 'asc');
    res.json(yards);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get vehicles at a specific yard
router.get('/:id/vehicles', async (req, res) => {
  const { id } = req.params;
  const { make, model, year, active = 'true' } = req.query;

  let query = database('yard_vehicle').where('yard_id', id);

  if (active === 'true') query = query.where('active', true);
  if (year) query = query.where('year', year);
  if (make) query = query.whereIlike('make', `%${make}%`);
  if (model) query = query.whereIlike('model', `%${model}%`);

  const vehicles = await query
    .orderBy('date_added', 'desc')
    .orderBy('make', 'asc')
    .orderBy('model', 'asc');

  res.json(vehicles);
});

// Trigger LKQ scrape for all NC locations
router.post('/scrape/lkq', async (req, res) => {
  if (scrapeStatus.running) {
    return res.json({ message: 'Scrape already in progress', already_running: true, started_at: scrapeStatus.started_at });
  }

  log.info('Manual LKQ scrape triggered');
  scrapeStatus = { running: true, started_at: new Date().toISOString(), finished_at: null, error: null };

  // Run async - don't wait for it to finish
  const scraper = new LKQScraper();
  scraper.scrapeAll()
    .then(() => {
      scrapeStatus.running = false;
      scrapeStatus.finished_at = new Date().toISOString();
    })
    .catch(err => {
      log.error({ err }, 'LKQ scrape failed');
      scrapeStatus.running = false;
      scrapeStatus.finished_at = new Date().toISOString();
      scrapeStatus.error = err.message;
    });

  res.json({
    message: 'LKQ scrape started for all 4 NC locations',
    locations: ['LKQ Raleigh', 'LKQ Durham', 'LKQ Greensboro', 'LKQ East NC']
  });
});

// Get current scrape status (for polling)
router.get('/scrape/status', async (req, res) => {
  res.json(scrapeStatus);
});

// Trigger scrape for a specific yard by ID
router.post('/scrape/:id', async (req, res) => {
  const { id } = req.params;
  
  const yard = await database('yard').where('id', id).first();
  if (!yard) {
    return res.status(404).json({ error: 'Yard not found' });
  }

  if (yard.scrape_method === 'none') {
    return res.status(400).json({ error: 'This yard does not support scraping' });
  }

  log.info({ yard: yard.name }, `Manual scrape triggered for ${yard.name}`);

  // Helper: run scraper then enrichment pipeline in background
  async function scrapeAndEnrich(scrapePromise) {
    try {
      await scrapePromise;
    } catch (err) {
      log.error({ err }, `Scrape failed for ${yard.name}`);
    }
    try {
      const enrichStats = await enrichYard(yard.id);
      log.info({ yard: yard.name, ...enrichStats }, `Post-scrape enrichment complete for ${yard.name}`);
    } catch (err) {
      log.error({ err: err.message }, `Post-scrape enrichment failed for ${yard.name}`);
    }
  }

  if (yard.chain === 'LKQ') {
    const scraper = new LKQScraper();
    const location = scraper.locations.find(l => l.name === yard.name);
    if (location) {
      scrapeAndEnrich(scraper.scrapeLocation(location));
    }
  } else if (yard.chain === 'Foss') {
    const FossScraper = require('../scrapers/FossScraper');
    const scraper = new FossScraper();
    const location = scraper.locations.find(l => l.name === yard.name);
    if (location) {
      scrapeAndEnrich(scraper.scrapeLocation(location));
    }
  } else if (yard.chain === 'Pull-A-Part') {
    const PullAPartScraper = require('../scrapers/PullAPartScraper');
    const scraper = new PullAPartScraper();
    scrapeAndEnrich(scraper.scrapeYard(yard));
  } else if (yard.chain === 'Carolina PNP') {
    const CarolinaPickNPullScraper = require('../scrapers/CarolinaPickNPullScraper');
    const scraper = new CarolinaPickNPullScraper();
    scrapeAndEnrich(scraper.scrapeYard(yard));
  } else if (yard.chain === 'upullandsave') {
    const UPullAndSaveScraper = require('../scrapers/UPullAndSaveScraper');
    const scraper = new UPullAndSaveScraper();
    scrapeAndEnrich(scraper.scrapeYard(yard));
  } else if (yard.chain === 'chesterfield') {
    const ChesterfieldScraper = require('../scrapers/ChesterfieldScraper');
    const scraper = new ChesterfieldScraper();
    scrapeAndEnrich(scraper.scrapeYard(yard));
  } else if (yard.chain === 'pickapartva') {
    const PickAPartVAScraper = require('../scrapers/PickAPartVAScraper');
    const scraper = new PickAPartVAScraper();
    scrapeAndEnrich(scraper.scrapeYard(yard));
  }

  res.json({ message: `Scrape + enrichment started for ${yard.name}` });
});

// Get scrape status / last scrape info for all yards
router.get('/status', async (req, res) => {
  try {
    const yards = await database('yard')
      .select('id', 'name', 'chain', 'scrape_method', 'last_scraped', 'visit_frequency', 'flagged', 'flag_reason')
      .orderBy('visit_frequency', 'asc')
      .orderBy('distance_from_base', 'asc');

    // Get vehicle counts per yard
    const counts = await database('yard_vehicle')
      .where('active', true)
      .groupBy('yard_id')
      .select('yard_id')
      .count('* as vehicle_count');

    const countMap = {};
    counts.forEach(c => { countMap[c.yard_id] = parseInt(c.vehicle_count); });

    const result = yards.map(y => ({
      ...y,
      vehicle_count: countMap[y.id] || 0,
    }));

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message, stack: err.stack });
  }
});

// Scrape health dashboard
router.get('/scrape-health', async (req, res) => {
  try {
    const yards = await database('yard')
      .where('enabled', true)
      .where(function() { this.where('flagged', false).orWhereNull('flagged'); })
      .select('id', 'name', 'chain', 'last_scraped')
      .orderBy('name');

    const yardIds = yards.map(y => y.id);

    // Vehicle stats per yard
    const stats = await database('yard_vehicle')
      .whereIn('yard_id', yardIds)
      .where('active', true)
      .groupBy('yard_id')
      .select('yard_id')
      .count('* as total_active')
      .max('date_added as newest_date_added')
      .max({ newest_created_at: 'createdAt' });

    const statsMap = {};
    stats.forEach(s => { statsMap[s.yard_id] = s; });

    // New vehicles per yard from last scrape (within 1hr window of last_scraped)
    const newCounts = await Promise.all(yards.map(async (y) => {
      if (!y.last_scraped) return { yard_id: y.id, new_vehicles_last_scrape: 0 };
      const window = new Date(new Date(y.last_scraped).getTime() - 60 * 60 * 1000);
      const count = await database('yard_vehicle')
        .where('yard_id', y.id)
        .where('createdAt', '>=', window)
        .where('createdAt', '<=', y.last_scraped)
        .count('* as cnt')
        .first();
      return { yard_id: y.id, new_vehicles_last_scrape: parseInt(count.cnt) || 0 };
    }));
    const newMap = {};
    newCounts.forEach(n => { newMap[n.yard_id] = n.new_vehicles_last_scrape; });

    // Recent scrape_log entries (last 5 per yard)
    let logMap = {};
    try {
      const logs = await database('scrape_log')
        .whereIn('yard_id', yardIds)
        .orderBy('scraped_at', 'desc')
        .limit(yardIds.length * 5);
      for (const l of logs) {
        if (!logMap[l.yard_id]) logMap[l.yard_id] = [];
        if (logMap[l.yard_id].length < 5) logMap[l.yard_id].push(l);
      }
    } catch (e) { /* scrape_log may not exist yet */ }

    const result = yards.map(y => {
      const s = statsMap[y.id] || {};
      const hoursSince = y.last_scraped
        ? Math.round((Date.now() - new Date(y.last_scraped).getTime()) / 3600000 * 10) / 10
        : null;

      let status = 'unknown';
      if (!y.last_scraped || hoursSince > 30) status = 'critical';
      else if (hoursSince > 18) status = 'stale';
      else if ((newMap[y.id] || 0) === 0) status = 'warning';
      else status = 'healthy';

      return {
        id: y.id,
        name: y.name,
        chain: y.chain,
        last_scraped: y.last_scraped,
        hours_since_scrape: hoursSince,
        new_vehicles_last_scrape: newMap[y.id] || 0,
        total_active: parseInt(s.total_active) || 0,
        newest_date_added: s.newest_date_added,
        newest_created_at: s.newest_created_at,
        status,
        recent_logs: logMap[y.id] || [],
      };
    });

    const summary = {
      total: result.length,
      healthy: result.filter(r => r.status === 'healthy').length,
      warning: result.filter(r => r.status === 'warning').length,
      stale: result.filter(r => r.status === 'stale').length,
      critical: result.filter(r => r.status === 'critical').length,
    };

    res.json({ success: true, summary, yards: result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Log a yard visit with feedback
router.post('/:id/feedback', async (req, res) => {
  const { id } = req.params;
  const { puller_name, rating, notes } = req.body;
  const { v4: uuidv4 } = require('uuid');

  const yard = await database('yard').where('id', id).first();
  if (!yard) return res.status(404).json({ error: 'Yard not found' });

  await database('yard_visit_feedback').insert({
    id: uuidv4(),
    yard_id: id,
    puller_name,
    visit_date: new Date().toISOString().split('T')[0],
    rating,
    notes,
    createdAt: new Date(),
  });

  // Update last_visited and avg_rating on yard
  const feedbacks = await database('yard_visit_feedback')
    .where('yard_id', id)
    .whereNotNull('rating');

  const avgRating = feedbacks.reduce((sum, f) => sum + f.rating, 0) / feedbacks.length;

  await database('yard')
    .where('id', id)
    .update({ 
      last_visited: new Date(), 
      avg_rating: avgRating.toFixed(2),
      updatedAt: new Date() 
    });

  res.json({ message: 'Feedback recorded', avg_rating: avgRating.toFixed(2) });
});

module.exports = router;
```
---
## FILE: service/routes/stale-inventory.js
```javascript
'use strict';

const router = require('express-promise-router')();
const { log } = require('../lib/logger');
const StaleInventoryService = require('../services/StaleInventoryService');
const ReturnIntakeService = require('../services/ReturnIntakeService');
const RestockService = require('../services/RestockService');

/**
 * POST /stale-inventory/run
 * Trigger stale inventory automation scan.
 * Applies scheduled price reductions via TradingAPI.
 */
router.post('/run', async (req, res) => {
  try {
    const service = new StaleInventoryService();
    // Run in background
    service.runAutomation().catch(err => {
      log.error({ err }, 'Stale inventory automation failed');
    });
    res.json({ success: true, message: 'Stale inventory automation started' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /stale-inventory/actions
 * Get history of stale inventory actions taken.
 */
router.get('/actions', async (req, res) => {
  try {
    const { database } = require('../database/database');
    const { limit = 50, page = 1, tier } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    let query = database('stale_inventory_action').orderBy('createdAt', 'desc');
    if (tier) query = query.where('tier', tier);

    const [actions, countResult] = await Promise.all([
      query.clone().limit(parseInt(limit)).offset(offset),
      query.clone().count('* as total').first(),
    ]);

    res.json({
      success: true,
      actions,
      total: parseInt(countResult?.total || 0),
      page: parseInt(page),
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// === Return Intake ===

/**
 * POST /stale-inventory/returns
 * Log a returned part and auto-queue relist.
 */
router.post('/returns', async (req, res) => {
  try {
    const service = new ReturnIntakeService();
    const result = await service.intakeReturn(req.body);
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /stale-inventory/returns/pending
 * Get all pending relists.
 */
router.get('/returns/pending', async (req, res) => {
  try {
    const service = new ReturnIntakeService();
    const returns = await service.getPendingRelists();
    res.json({ success: true, returns });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /stale-inventory/returns/:id/relisted
 * Mark a return as relisted.
 */
router.post('/returns/:id/relisted', async (req, res) => {
  try {
    const service = new ReturnIntakeService();
    const result = await service.markRelisted(req.params.id, req.body.newEbayItemId);
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /stale-inventory/returns/:id/scrapped
 * Mark a return as scrapped.
 */
router.post('/returns/:id/scrapped', async (req, res) => {
  try {
    const service = new ReturnIntakeService();
    const result = await service.markScrapped(req.params.id);
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// === Restock ===

/**
 * POST /stale-inventory/restock/scan
 * Run restock scan.
 */
router.post('/restock/scan', async (req, res) => {
  try {
    const service = new RestockService();
    const result = await service.scanAndFlag();
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /stale-inventory/restock/flags
 * Get restock flags.
 */
router.get('/restock/flags', async (req, res) => {
  try {
    const { acknowledged, limit } = req.query;
    const service = new RestockService();
    const flags = await service.getFlags({
      acknowledged: acknowledged === 'true',
      limit: parseInt(limit) || 50,
    });
    res.json({ success: true, flags });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /stale-inventory/restock/:id/acknowledge
 * Acknowledge a restock flag.
 */
router.post('/restock/:id/acknowledge', async (req, res) => {
  try {
    const service = new RestockService();
    const result = await service.acknowledge(req.params.id);
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// === Manual Inventory Controls (Phase 5) ===

const TradingAPI = require('../ebay/TradingAPI');
const { database } = require('../database/database');
const { v4: uuidv4 } = require('uuid');

/**
 * GET /stale-inventory/candidates
 * Listings needing action: aged out, reduced 2+ times, or overpriced verdict.
 */
router.get('/candidates', async (req, res) => {
  try {
    const listings = await database('YourListing')
      .where('listingStatus', 'Active')
      .where('quantityAvailable', '>', 0)
      .orderBy('startTime', 'asc')
      .limit(100)
      .select('id', 'ebayItemId', 'title', 'currentPrice', 'startTime', 'isProgrammed');

    const candidates = [];
    for (const l of listings) {
      const daysListed = l.startTime ? Math.floor((Date.now() - new Date(l.startTime).getTime()) / 86400000) : 0;
      if (daysListed < 60) continue;

      // Count prior reductions
      let reductionCount = 0;
      try {
        const actions = await database('stale_inventory_action')
          .where('ebay_item_id', l.ebayItemId)
          .where('action_type', 'REDUCE_PRICE')
          .count('* as c').first();
        reductionCount = parseInt(actions?.c || 0);
      } catch (e) {}

      let recommendation = 'hold';
      if (daysListed > 180 && reductionCount >= 2) recommendation = 'end';
      else if (daysListed > 120) recommendation = 'deep_discount';
      else if (daysListed > 90) recommendation = 'reduce';
      else recommendation = 'monitor';

      candidates.push({
        id: l.id,
        ebayItemId: l.ebayItemId,
        title: l.title,
        currentPrice: parseFloat(l.currentPrice),
        daysListed,
        reductionCount,
        isProgrammed: l.isProgrammed,
        recommendation,
      });
    }

    candidates.sort((a, b) => b.daysListed - a.daysListed);
    res.json({ success: true, candidates, total: candidates.length });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /stale-inventory/revise-price
 * Manually change a listing's price.
 */
router.post('/revise-price', async (req, res) => {
  const { ebayItemId, newPrice } = req.body;
  if (!ebayItemId || !newPrice) return res.status(400).json({ error: 'ebayItemId and newPrice required' });
  if (parseFloat(newPrice) <= 0) return res.status(400).json({ error: 'newPrice must be > 0' });

  try {
    // Get current price
    const listing = await database('YourListing').where('ebayItemId', ebayItemId).first();
    if (!listing) return res.status(404).json({ error: 'Listing not found' });
    if (listing.listingStatus !== 'Active') return res.status(400).json({ error: 'Listing is not active' });

    const oldPrice = parseFloat(listing.currentPrice);
    const api = new TradingAPI();
    await api.reviseItem({ ebayItemId, startPrice: parseFloat(newPrice) });

    // Update local record
    await database('YourListing').where('ebayItemId', ebayItemId).update({ currentPrice: parseFloat(newPrice), updatedAt: new Date() });

    // Log action
    await database('stale_inventory_action').insert({
      id: uuidv4(), ebay_item_id: ebayItemId, listing_id: listing.id, title: listing.title,
      action_type: 'manual_revise', old_price: oldPrice, new_price: parseFloat(newPrice),
      days_listed: listing.startTime ? Math.floor((Date.now() - new Date(listing.startTime).getTime()) / 86400000) : null,
      executed: true, executed_at: new Date(), createdAt: new Date(),
    });

    res.json({ success: true, oldPrice, newPrice: parseFloat(newPrice) });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /stale-inventory/end-item
 * End a listing on eBay.
 */
router.post('/end-item', async (req, res) => {
  const { ebayItemId, reason = 'NotAvailable' } = req.body;
  if (!ebayItemId) return res.status(400).json({ error: 'ebayItemId required' });

  try {
    const listing = await database('YourListing').where('ebayItemId', ebayItemId).first();
    if (!listing) return res.status(404).json({ error: 'Listing not found' });
    if (listing.listingStatus !== 'Active') return res.status(400).json({ error: 'Listing is not active' });

    const api = new TradingAPI();
    const result = await api.endItem({ ebayItemId, endingReason: reason });

    await database('YourListing').where('ebayItemId', ebayItemId).update({ listingStatus: 'Ended', updatedAt: new Date() });

    await database('stale_inventory_action').insert({
      id: uuidv4(), ebay_item_id: ebayItemId, listing_id: listing.id, title: listing.title,
      action_type: 'end', old_price: parseFloat(listing.currentPrice),
      days_listed: listing.startTime ? Math.floor((Date.now() - new Date(listing.startTime).getTime()) / 86400000) : null,
      executed: true, executed_at: new Date(), createdAt: new Date(),
    });

    res.json({ success: true, endTime: result.endTime });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /stale-inventory/relist-item
 * Relist an ended listing on eBay.
 */
router.post('/relist-item', async (req, res) => {
  const { ebayItemId, newPrice } = req.body;
  if (!ebayItemId) return res.status(400).json({ error: 'ebayItemId required' });

  try {
    const listing = await database('YourListing').where('ebayItemId', ebayItemId).first();
    if (!listing) return res.status(404).json({ error: 'Listing not found' });

    const api = new TradingAPI();
    const result = await api.relistItem({ ebayItemId, startPrice: newPrice ? parseFloat(newPrice) : null });

    await database('stale_inventory_action').insert({
      id: uuidv4(), ebay_item_id: ebayItemId, listing_id: listing.id, title: listing.title,
      action_type: 'relist', old_price: parseFloat(listing.currentPrice), new_price: newPrice ? parseFloat(newPrice) : parseFloat(listing.currentPrice),
      executed: true, executed_at: new Date(), createdAt: new Date(),
    });

    res.json({ success: true, newItemId: result.newItemId, fees: result.fees });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /stale-inventory/bulk-end
 * End multiple listings. Max 25 per call.
 */
router.post('/bulk-end', async (req, res) => {
  const { ebayItemIds, reason = 'NotAvailable' } = req.body;
  if (!ebayItemIds || !Array.isArray(ebayItemIds)) return res.status(400).json({ error: 'ebayItemIds array required' });
  if (ebayItemIds.length > 25) return res.status(400).json({ error: 'Max 25 items per bulk end' });

  const api = new TradingAPI();
  const results = [];

  for (const ebayItemId of ebayItemIds) {
    try {
      const listing = await database('YourListing').where('ebayItemId', ebayItemId).first();
      if (!listing || listing.listingStatus !== 'Active') {
        results.push({ ebayItemId, success: false, error: 'Not active' });
        continue;
      }

      await api.endItem({ ebayItemId, endingReason: reason });
      await database('YourListing').where('ebayItemId', ebayItemId).update({ listingStatus: 'Ended', updatedAt: new Date() });
      await database('stale_inventory_action').insert({
        id: uuidv4(), ebay_item_id: ebayItemId, listing_id: listing.id, title: listing.title,
        action_type: 'end', old_price: parseFloat(listing.currentPrice),
        executed: true, executed_at: new Date(), createdAt: new Date(),
      });
      results.push({ ebayItemId, success: true });
    } catch (err) {
      results.push({ ebayItemId, success: false, error: err.message });
    }
    // Rate limit: 1 second between calls
    await new Promise(r => setTimeout(r, 1000));
  }

  res.json({
    success: true,
    results,
    totalEnded: results.filter(r => r.success).length,
    totalFailed: results.filter(r => !r.success).length,
  });
});

module.exports = router;
```
---
## FILE: service/routes/scout-alerts.js
```javascript
'use strict';

const router = require('express-promise-router')();
const { database } = require('../database/database');
const { generateAlerts } = require('../services/ScoutAlertService');

// Hard age ceilings
const BONE_MAX_DAYS = 90;
const PERCH_MAX_DAYS = 60;

// Get alerts with yard + time filters
router.get('/list', async (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const perPage = 50;
  const yard = req.query.yard || 'all';
  const days = parseInt(req.query.days) || 0; // 0 = all (within hard ceilings)
  const hideClaimed = req.query.hideClaimed === '1';

  const knex = database;

  // Base query with hard age ceilings applied always
  let baseQuery = knex('scout_alerts').where(function() {
    this.where(function() {
      this.where('source', 'bone_pile')
        .andWhere('vehicle_set_date', '>=', knex.raw(`NOW() - INTERVAL '${BONE_MAX_DAYS} days'`));
    }).orWhere(function() {
      this.where('source', 'hunters_perch')
        .andWhere('vehicle_set_date', '>=', knex.raw(`NOW() - INTERVAL '${PERCH_MAX_DAYS} days'`));
    });
  });

  // Time filter (days pill)
  if (days > 0) {
    const effectiveBoneDays = Math.min(days, BONE_MAX_DAYS);
    const effectivePerchDays = Math.min(days, PERCH_MAX_DAYS);
    baseQuery = knex('scout_alerts').where(function() {
      this.where(function() {
        this.where('source', 'bone_pile')
          .andWhere('vehicle_set_date', '>=', knex.raw(`NOW() - INTERVAL '${effectiveBoneDays} days'`));
      }).orWhere(function() {
        this.where('source', 'hunters_perch')
          .andWhere('vehicle_set_date', '>=', knex.raw(`NOW() - INTERVAL '${effectivePerchDays} days'`));
      });
    });
  }

  // Also include alerts with NULL vehicle_set_date (can't filter what we can't date)
  // Actually, re-do: build the where as a function we can reuse
  function applyFilters(q) {
    q = q.where(function() {
      this.where(function() {
        this.where('source', 'bone_pile').andWhere(function() {
          this.where('vehicle_set_date', '>=', knex.raw(`NOW() - INTERVAL '${days > 0 ? Math.min(days, BONE_MAX_DAYS) : BONE_MAX_DAYS} days'`))
            .orWhereNull('vehicle_set_date');
        });
      }).orWhere(function() {
        this.where('source', 'hunters_perch').andWhere(function() {
          this.where('vehicle_set_date', '>=', knex.raw(`NOW() - INTERVAL '${days > 0 ? Math.min(days, PERCH_MAX_DAYS) : PERCH_MAX_DAYS} days'`))
            .orWhereNull('vehicle_set_date');
        });
      }).orWhere(function() {
        // PERCH (The Mark) alerts — no hard age ceiling, always show active marks
        this.where('source', 'PERCH');
      }).orWhere(function() {
        // OVERSTOCK alerts — always show, no date filtering
        this.where('source', 'OVERSTOCK');
      });
    });
    if (yard && yard !== 'all') {
      q = q.andWhere('yard_name', 'ilike', `%${yard}%`);
    }
    if (hideClaimed) {
      q = q.andWhere(function() { this.where('claimed', false).orWhereNull('claimed'); });
    }
    return q;
  }

  // Get paginated alerts
  let alertQuery = knex('scout_alerts');
  alertQuery = applyFilters(alertQuery);
  const alerts = await alertQuery
    .orderByRaw(`CASE WHEN claimed = true THEN 1 ELSE 0 END`)
    .orderByRaw(`
      CASE
        WHEN source = 'PERCH' AND confidence = 'high' THEN 0
        WHEN source = 'PERCH' AND confidence = 'medium' THEN 1
        WHEN source = 'bone_pile' AND confidence = 'high' THEN 2
        WHEN source = 'bone_pile' AND confidence = 'medium' THEN 3
        WHEN source = 'bone_pile' AND confidence = 'low' THEN 4
        WHEN source = 'hunters_perch' AND confidence = 'high' THEN 5
        WHEN source = 'hunters_perch' AND confidence = 'medium' THEN 6
        WHEN source = 'hunters_perch' AND confidence = 'low' THEN 7
        WHEN source = 'OVERSTOCK' THEN 1
        ELSE 8
      END
    `)
    .orderBy('part_value', 'desc')
    .offset((page - 1) * perPage)
    .limit(perPage);

  // Get total count with same filters
  let countQuery = knex('scout_alerts');
  countQuery = applyFilters(countQuery);
  const [{ count }] = await countQuery.count('* as count');
  const total = parseInt(count) || 0;

  // Get last generated timestamp
  const meta = await knex('scout_alerts_meta').where('key', 'last_generated').first();
  const lastGenerated = meta ? meta.value : null;

  // Group by yard
  const byYard = {};
  for (const a of alerts) {
    const y = a.yard_name || 'Unknown';
    if (!byYard[y]) byYard[y] = [];
    byYard[y].push(a);
  }

  // Yard counts with same filters
  let yardCountQuery = knex('scout_alerts');
  yardCountQuery = applyFilters(yardCountQuery);
  const yardCounts = await yardCountQuery
    .select('yard_name').count('* as count').groupBy('yard_name').orderBy('count', 'desc');

  // Source counts with same filters
  let srcQuery = knex('scout_alerts');
  srcQuery = applyFilters(srcQuery);
  const sourceCounts = await srcQuery.select('source').count('* as count').groupBy('source');
  const boneCount = parseInt((sourceCounts.find(s => s.source === 'bone_pile') || {}).count) || 0;
  const perchCount = parseInt((sourceCounts.find(s => s.source === 'hunters_perch') || {}).count) || 0;
  const markCount = parseInt((sourceCounts.find(s => s.source === 'PERCH') || {}).count) || 0;
  const overstockCount = parseInt((sourceCounts.find(s => s.source === 'OVERSTOCK') || {}).count) || 0;

  // Tag perch alerts with recent sales
  let justSoldCount = 0;
  try {
    const recentSales = await knex('YourSale')
      .where('soldDate', '>=', knex.raw("NOW() - INTERVAL '3 days'"))
      .whereNotNull('title').select('title', 'soldDate');
    const saleTitles = recentSales.map(s => ({ lower: (s.title || '').toLowerCase(), soldDate: s.soldDate }));
    for (const yardName in byYard) {
      for (const alert of byYard[yardName]) {
        if (alert.source !== 'hunters_perch') continue;
        const alertWords = (alert.source_title || '').toLowerCase()
          .replace(/\([^)]*\)/g, '').replace(/\b\d+\b/g, '').replace(/[^a-z\s]/g, ' ')
          .split(/\s+/).filter(w => w.length >= 3);
        for (const sale of saleTitles) {
          const matches = alertWords.filter(w => sale.lower.includes(w));
          if (matches.length >= 3) {
            const daysAgo = Math.floor((Date.now() - new Date(sale.soldDate).getTime()) / 86400000);
            alert.justSold = daysAgo <= 0 ? 'today' : daysAgo + 'd ago';
            justSoldCount++;
            break;
          }
        }
      }
    }
  } catch (e) { /* ignore */ }

  res.json({
    success: true,
    alerts: byYard,
    yardCounts: yardCounts.map(y => ({ yard: y.yard_name, count: parseInt(y.count) })),
    boneCount, perchCount, markCount, overstockCount, justSoldCount,
    total, page, totalPages: Math.ceil(total / perPage),
    lastGenerated
  });
});

// Claim / unclaim an alert (GOT ONE)
router.post('/claim', async (req, res) => {
  const { id, claimed } = req.body;
  if (!id) return res.status(400).json({ error: 'ID required' });

  const knex = database;
  const alert = await knex('scout_alerts').where({ id }).first();
  if (!alert) return res.status(404).json({ error: 'Alert not found' });

  // Update scout_alerts
  await knex('scout_alerts').where({ id }).update({
    claimed: !!claimed,
    claimed_by: claimed ? (alert.yard_name || 'unknown') : null,
    claimed_at: claimed ? new Date().toISOString() : null,
  });

  // If PERCH alert, sync with restock_want_list
  if (alert.source === 'hunters_perch') {
    // Find the matching want list item by title
    const wantItem = await knex('restock_want_list')
      .where({ active: true })
      .where('title', alert.source_title)
      .first();
    if (wantItem) {
      await knex('restock_want_list').where({ id: wantItem.id }).update({
        pulled: !!claimed,
        pulled_date: claimed ? new Date().toISOString() : null,
        pulled_from: claimed ? (alert.yard_name || null) : null,
      });
    }
  }

  res.json({ success: true });
});

// Manual refresh
router.post('/refresh', async (req, res) => {
  try {
    const result = await generateAlerts();
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
```
---
## FILE: service/routes/restock-want-list.js
```javascript
'use strict';

const router = require('express-promise-router')();
const { database } = require('../database/database');
const { matchPartToSales, matchPartToYardVehicles, parseTitle, loadModelsFromDB } = require('../utils/partMatcher');
const { extractPartNumbers, parseYearRange: piParseYearRange } = require('../utils/partIntelligence');

/**
 * Count stocked items for a HUNTERS PERCH entry.
 * TIER 1: Part number match (from architect's partNumberExtractor)
 * TIER 2: Year + Model + Part phrase (vehicle-specific)
 * TIER 3: Keyword fallback (flagged as unreliable)
 */
async function countStockedForEntry(knex, title) {
  // TIER 1: Part number match
  const partNumbers = extractPartNumbers(title);
  const realPNs = partNumbers.filter(pn => pn.normalized.length >= 6);

  if (realPNs.length > 0) {
    let q = knex('YourListing').where('listingStatus', 'Active');
    q = q.where(function() {
      for (const pn of realPNs) {
        this.orWhere('title', 'ilike', `%${pn.normalized}%`);
        if (pn.base !== pn.normalized) this.orWhere('title', 'ilike', `%${pn.base}%`);
        // Also match with original formatting (dashes etc)
        const rawUp = pn.raw.toUpperCase();
        if (rawUp !== pn.normalized) this.orWhere('title', 'ilike', `%${rawUp}%`);
      }
    });
    const listings = await q.select('title', knex.raw('COALESCE("quantityAvailable"::int, 1) as qty')).limit(20);
    const totalStock = listings.reduce((sum, l) => sum + (parseInt(l.qty) || 1), 0);
    return {
      stock: totalStock,
      listingCount: listings.length,
      matchedTitles: listings.map(l => l.title),
      method: 'PART_NUMBER',
      debug: `PN: ${realPNs[0].raw} (${listings.length} listing${listings.length !== 1 ? 's' : ''}, ${totalStock} in stock)`
    };
  }

  // TIER 2: Year + Model + Part phrase (vehicle-specific via Auto table)
  await loadModelsFromDB();
  const parsed = parseTitle(title);
  if (parsed && parsed.models.length > 0 && parsed.partPhrase) {
    let q = knex('YourListing').where('listingStatus', 'Active');
    q = q.where(function() {
      for (const model of parsed.models) this.orWhere('title', 'ilike', `%${model}%`);
    });
    q = q.andWhere('title', 'ilike', `%${parsed.partPhrase}%`);
    const allListings = await q.select('title', knex.raw('COALESCE("quantityAvailable"::int, 1) as qty')).limit(50);
    // Year filter
    const filtered = parsed.yearStart && parsed.yearEnd
      ? allListings.filter(l => {
          const ly = extractYearsFromListingTitle(l.title);
          if (!ly) return true;
          return ly.start <= parsed.yearEnd && ly.end >= parsed.yearStart;
        })
      : allListings;
    const totalStock = filtered.reduce((sum, l) => sum + (parseInt(l.qty) || 1), 0);
    const yearLabel = parsed.yearStart ? (parsed.yearStart === parsed.yearEnd ? String(parsed.yearStart) : parsed.yearStart + '-' + parsed.yearEnd) : null;
    const debug = [yearLabel, parsed.models.join('/'), '"' + parsed.partPhrase + '"'].filter(Boolean).join(' + ');
    return {
      stock: totalStock,
      listingCount: filtered.length,
      matchedTitles: filtered.slice(0, 10).map(l => l.title),
      method: 'VEHICLE_MATCH',
      debug: `${debug} (${filtered.length} listing${filtered.length !== 1 ? 's' : ''}, ${totalStock} in stock)`
    };
  }

  // TIER 3: Keyword fallback — flag as unreliable
  if (parsed && parsed.make && parsed.partPhrase) {
    let q = knex('YourListing').where('listingStatus', 'Active');
    q = q.andWhere('title', 'ilike', `%${parsed.make}%`);
    q = q.andWhere('title', 'ilike', `%${parsed.partPhrase}%`);
    const allListings = await q.select('title', knex.raw('COALESCE("quantityAvailable"::int, 1) as qty')).limit(50);
    const filtered = parsed.yearStart && parsed.yearEnd
      ? allListings.filter(l => {
          const ly = extractYearsFromListingTitle(l.title);
          if (!ly) return true;
          return ly.start <= parsed.yearEnd && ly.end >= parsed.yearStart;
        })
      : allListings;
    const totalStock = filtered.reduce((sum, l) => sum + (parseInt(l.qty) || 1), 0);
    return {
      stock: totalStock,
      listingCount: filtered.length,
      matchedTitles: filtered.slice(0, 10).map(l => l.title),
      method: 'KEYWORD',
      debug: `${parsed.make} + "${parsed.partPhrase}" (${filtered.length} listing${filtered.length !== 1 ? 's' : ''}, ${totalStock} in stock, keyword)`
    };
  }

  return { stock: 0, matchedTitles: [], method: 'NO_MATCH', debug: 'Could not extract part number or vehicle' };
}

function extractYearsFromListingTitle(title) {
  const range = title.match(/\b(19|20)(\d{2})\s*[-–]\s*(19|20)?(\d{2})\b/);
  if (range) {
    const start = parseInt(range[1] + range[2]);
    const end = range[3] ? parseInt(range[3] + range[4]) : parseInt(range[1] + range[4]);
    return { start, end };
  }
  const single = title.match(/\b((?:19|20)\d{2})\b/);
  if (single) { const y = parseInt(single[1]); return { start: y, end: y }; }
  return null;
}

// Diagnostic endpoint
router.get('/debug/:id', async (req, res) => {
  const item = await database('restock_want_list').where({ id: req.params.id }).first();
  if (!item) return res.status(404).json({ error: 'Not found' });

  const pns = extractPartNumbers(item.title);
  const listings = await countStockedForEntry(database, item.title);
  const sales = await matchPartToSales(item.title);
  const parsed = parseTitle(item.title);

  res.json({ wantTitle: item.title, extractedPNs: pns, parsed, listings, sales });
});

// Get active want list items with stock counts and sale data
// ?manual_only=true to exclude auto-generated entries
router.get('/items', async (req, res) => {
  await loadModelsFromDB();
  let q = database('restock_want_list').where({ active: true }).orderBy('created_at', 'asc');
  if (req.query.manual_only === 'true') {
    q = q.where(function() { this.where('auto_generated', false).orWhereNull('auto_generated'); });
  }
  const items = await q;

  const knex = database;
  const results = [];
  for (const item of items) {
    const listings = await countStockedForEntry(knex, item.title);
    const sales = await matchPartToSales(item.title);

    results.push({
      id: item.id,
      title: item.title,
      notes: item.notes,
      pulled: item.pulled || false,
      pulled_date: item.pulled_date,
      pulled_from: item.pulled_from || null,
      stock: listings.stock,
      listingCount: listings.listingCount || listings.stock,
      avgPrice: sales.avgPrice,
      lastSold: sales.lastSold,
      matchedTitles: listings.matchedTitles,
      matchMethod: listings.method,
      confidence: listings.method === 'PART_NUMBER' ? 'high' : listings.method === 'VEHICLE_MATCH' ? 'medium' : listings.method === 'KEYWORD' ? 'low' : 'none',
      matchDebug: listings.debug,
      created_at: item.created_at
    });
  }

  // Sort: OUT OF STOCK (0, not pulled) > PULLED > LOW (1-2) > STOCKED (3+)
  results.sort((a, b) => {
    const rank = (item) => {
      if (item.stock === 0 && !item.pulled) return 0;
      if (item.pulled) return 1;
      if (item.stock <= 2) return 2;
      return 3;
    };
    const ra = rank(a), rb = rank(b);
    if (ra !== rb) return ra - rb;
    return a.stock - b.stock;
  });

  res.json({ success: true, items: results, total: results.length });
});

// "Just Sold" — perch items that sold in the last 3 days
// Uses shared parseTitle for strict model+part matching (no loose keyword overlap)
router.get('/just-sold', async (req, res) => {
  const wantList = await database('restock_want_list').where({ active: true });
  const recentSales = await database('YourSale')
    .where('soldDate', '>=', database.raw("NOW() - INTERVAL '3 days'"))
    .whereNotNull('title')
    .select('title', 'salePrice', 'soldDate')
    .orderBy('soldDate', 'desc');

  // Pre-parse each want list item (with numeric model fix for Mazda 6, BMW 3, etc.)
  const parsedWantList = wantList.map(item => {
    const parsed = parseTitle(item.title);
    if (parsed && parsed.models.length === 0) {
      // Handle numeric model names: "Mazda 6", "BMW 3", "Audi 4"
      const numMatch = item.title.match(/\b(mazda|bmw|audi|saab)\s*(\d{1,2})\b/i);
      if (numMatch) parsed.models.push(numMatch[1].toLowerCase() + ' ' + numMatch[2]);
      // Handle combined form: "Mazda6", "Mazda3"
      const combined = item.title.match(/\b(mazda|bmw)(\d{1,2})\b/i);
      if (combined && parsed.models.length === 0) parsed.models.push(combined[1].toLowerCase() + ' ' + combined[2]);
    }
    return { title: item.title, parsed, yearRange: piParseYearRange(item.title) };
  }).filter(w => w.parsed);

  // Group sales by want list item — strict matching: model + part phrase + year overlap
  const grouped = new Map();
  for (const sale of recentSales) {
    const saleLower = (sale.title || '').toLowerCase();
    // Normalize for numeric models: "Mazda6" → "Mazda 6", "BMW328i" → "BMW 328i"
    const saleNorm = saleLower.replace(/([a-z])(\d)/gi, '$1 $2');

    for (const want of parsedWantList) {
      const p = want.parsed;

      // Must match at least one model (or make if no model)
      let vehicleMatch = false;
      if (p.models.length > 0) {
        vehicleMatch = p.models.some(m => {
          const mLower = m.toLowerCase();
          return saleLower.includes(mLower) || saleNorm.includes(mLower);
        });
      } else if (p.make) {
        vehicleMatch = saleLower.includes(p.make.toLowerCase());
      }
      if (!vehicleMatch) continue;

      // Must match part phrase or at least 2 part words
      let partMatch = false;
      if (p.partPhrase) {
        partMatch = saleLower.includes(p.partPhrase);
      } else if (p.partWords.length >= 2) {
        const wordHits = p.partWords.filter(w => saleLower.includes(w));
        partMatch = wordHits.length >= 2;
      }
      if (!partMatch) continue;

      // Year range filtering: sale's year range must overlap want list's year range
      const saleYearRange = piParseYearRange(sale.title);
      if (saleYearRange && want.yearRange) {
        const overlaps = saleYearRange.start <= want.yearRange.end && saleYearRange.end >= want.yearRange.start;
        if (!overlaps) continue; // Wrong year range — skip
      }

      const daysAgo = Math.floor((Date.now() - new Date(sale.soldDate).getTime()) / 86400000);
      if (!grouped.has(want.title)) {
        grouped.set(want.title, { wantTitle: want.title, sales: [], matchedSaleTitles: [] });
      }
      const g = grouped.get(want.title);
      g.sales.push({
        price: Math.round(parseFloat(sale.salePrice) || 0),
        soldAgo: daysAgo <= 0 ? 'today' : daysAgo + 'd ago',
      });
      if (g.matchedSaleTitles.length < 5) g.matchedSaleTitles.push(sale.title);
      break; // one want match per sale
    }
  }

  // Fetch yard matches once per grouped item
  const results = [];
  for (const [, group] of grouped) {
    const yardVehicles = await matchPartToYardVehicles(group.wantTitle);
    results.push({
      wantTitle: group.wantTitle,
      sales: group.sales,
      matchedSaleTitles: group.matchedSaleTitles,
      yardMatches: yardVehicles.slice(0, 5).map(v => ({
        desc: [v.year, v.make, v.model].filter(Boolean).join(' '),
        yard: v.yard, row: v.row
      }))
    });
  }

  res.json({ success: true, items: results });
});

// Toggle pulled status — syncs with scout_alerts
router.post('/pull', async (req, res) => {
  const { id, pulled } = req.body;
  if (!id) return res.status(400).json({ error: 'ID required' });

  const item = await database('restock_want_list').where({ id }).first();
  await database('restock_want_list').where({ id }).update({
    pulled: !!pulled,
    pulled_date: pulled ? new Date().toISOString() : null,
    pulled_from: pulled ? null : null, // no yard context when pulled from PERCH page
  });

  // Sync: mark matching scout_alerts as claimed/unclaimed
  if (item) {
    await database('scout_alerts')
      .where('source', 'hunters_perch')
      .where('source_title', item.title)
      .update({
        claimed: !!pulled,
        claimed_at: pulled ? new Date().toISOString() : null,
      });
  }

  res.json({ success: true });
});

// Find matching vehicles in yards
router.post('/find-in-yard', async (req, res) => {
  const { title } = req.body;
  if (!title) return res.status(400).json({ error: 'Title required' });

  const vehicles = await matchPartToYardVehicles(title);
  res.json({ success: true, vehicles });
});

// Add a new part
router.post('/add', async (req, res) => {
  const { title, notes } = req.body;
  if (!title || !title.trim()) return res.status(400).json({ error: 'Title required' });

  const [item] = await database('restock_want_list')
    .insert({ title: title.trim(), notes: notes || null, active: true })
    .returning('*');

  res.json({ success: true, item });
});

// Delete (soft) a part
router.post('/delete', async (req, res) => {
  const { id } = req.body;
  if (!id) return res.status(400).json({ error: 'ID required' });

  await database('restock_want_list').where({ id }).update({ active: false });
  res.json({ success: true });
});

// ══════════════════════════════════════════════════════════════
// WATCHLIST — curated manual list for SCOUR STREAM pullers
// ══════════════════════════════════════════════════════════════

// Ensure table exists
async function ensureWatchlistTable() {
  try { await database.raw('SELECT 1 FROM restock_watchlist LIMIT 0'); }
  catch (e) {
    await database.raw(`
      CREATE TABLE IF NOT EXISTS restock_watchlist (
        id SERIAL PRIMARY KEY, part_number_base VARCHAR(50) NOT NULL UNIQUE,
        part_description TEXT, target_stock INTEGER DEFAULT 1,
        priority VARCHAR(20) DEFAULT 'normal', notes TEXT,
        added_at TIMESTAMP DEFAULT NOW(), active BOOLEAN DEFAULT TRUE
      )
    `);
  }
}

/**
 * GET /restock-want-list/watchlist
 * Returns curated watchlist with live stock counts + market data.
 */
router.get('/watchlist', async (req, res) => {
  await ensureWatchlistTable();
  const items = await database('restock_watchlist').where('active', true).orderBy('priority', 'desc').orderBy('added_at', 'asc');

  const results = [];
  for (const item of items) {
    const pn = item.part_number_base;

    // Stock count: YourListing ONLY
    let stock = 0;
    try {
      const listings = await database('YourListing')
        .where('listingStatus', 'Active')
        .where(function() {
          this.where('title', 'ilike', `%${pn}%`).orWhere('sku', 'ilike', `%${pn}%`);
        })
        .select(database.raw('SUM(COALESCE("quantityAvailable"::int, 1)) as qty'));
      stock = parseInt(listings[0]?.qty) || 0;
    } catch (e) {}

    // Last sold from YourSale
    let lastSold = null, lastSoldPrice = null;
    try {
      const sale = await database('YourSale')
        .where('title', 'ilike', `%${pn}%`)
        .orderBy('soldDate', 'desc').first();
      if (sale) { lastSold = sale.soldDate; lastSoldPrice = parseFloat(sale.salePrice) || null; }
    } catch (e) {}

    // Market data from cache
    let marketMedian = null, marketSold = null, marketVelocity = null;
    try {
      const cached = await database('market_demand_cache')
        .where('part_number_base', pn)
        .where('ebay_avg_price', '>', 0).first();
      if (cached) {
        marketMedian = parseFloat(cached.ebay_avg_price) || null;
        marketSold = parseInt(cached.ebay_sold_90d) || null;
        marketVelocity = cached.market_velocity || null;
      }
    } catch (e) {}

    // Days since last in stock
    let daysSinceStocked = null;
    try {
      const lastListing = await database('YourSale')
        .where('title', 'ilike', `%${pn}%`)
        .orderBy('soldDate', 'desc').first();
      if (lastListing) {
        daysSinceStocked = Math.floor((Date.now() - new Date(lastListing.soldDate).getTime()) / 86400000);
      }
    } catch (e) {}

    results.push({
      id: item.id,
      partNumberBase: item.part_number_base,
      description: item.part_description,
      targetStock: item.target_stock,
      priority: item.priority,
      notes: item.notes,
      stock,
      lastSold,
      lastSoldPrice,
      marketMedian,
      marketSold,
      marketVelocity,
      daysSinceStocked,
      needsRestock: stock < (item.target_stock || 1),
    });
  }

  // Sort: out of stock + high market demand first
  results.sort((a, b) => {
    if (a.needsRestock !== b.needsRestock) return a.needsRestock ? -1 : 1;
    const prioRank = { high: 0, normal: 1, low: 2 };
    if ((prioRank[a.priority] || 1) !== (prioRank[b.priority] || 1)) return (prioRank[a.priority] || 1) - (prioRank[b.priority] || 1);
    return (b.marketMedian || 0) - (a.marketMedian || 0);
  });

  res.json({ success: true, items: results, total: results.length });
});

// POST /restock-want-list/watchlist/add
router.post('/watchlist/add', async (req, res) => {
  await ensureWatchlistTable();
  const { partNumberBase, description, targetStock, priority, notes } = req.body;
  if (!partNumberBase) return res.status(400).json({ error: 'partNumberBase required' });
  try {
    await database('restock_watchlist').insert({
      part_number_base: partNumberBase.trim().toUpperCase(),
      part_description: description || null,
      target_stock: targetStock || 1,
      priority: priority || 'normal',
      notes: notes || null,
    });
    res.json({ success: true });
  } catch (e) {
    if (e.message.includes('unique')) return res.json({ success: true, message: 'Already on watchlist' });
    res.status(500).json({ error: e.message });
  }
});

// POST /restock-want-list/watchlist/remove
router.post('/watchlist/remove', async (req, res) => {
  const { id } = req.body;
  if (!id) return res.status(400).json({ error: 'id required' });
  await database('restock_watchlist').where({ id }).update({ active: false });
  res.json({ success: true });
});

// POST /restock-want-list/watchlist/update
router.post('/watchlist/update', async (req, res) => {
  const { id, targetStock, priority, notes } = req.body;
  if (!id) return res.status(400).json({ error: 'id required' });
  const update = {};
  if (targetStock !== undefined) update.target_stock = targetStock;
  if (priority) update.priority = priority;
  if (notes !== undefined) update.notes = notes;
  await database('restock_watchlist').where({ id }).update(update);
  res.json({ success: true });
});

// ══════════════════════════════════════════════════════════════
// OVERSTOCK WATCH — group-based inventory monitoring
// ══════════════════════════════════════════════════════════════

// Detect common part types from title
function detectPartType(title) {
  if (!title) return null;
  const t = title.toUpperCase();
  const types = [
    [/\bECM\b|\bECU\b|ENGINE\s*CONTROL\s*MODULE/, 'ECM'],
    [/\bBCM\b|BODY\s*CONTROL\s*MODULE/, 'BCM'],
    [/\bTCM\b|TRANS(MISSION)?\s*CONTROL\s*MODULE/, 'TCM'],
    [/\bABS\b.*\b(PUMP|MODULE)\b/, 'ABS'],
    [/\bPCM\b|POWERTRAIN\s*CONTROL/, 'PCM'],
    [/\bHEADLIGHT\b|\bHEADLAMP\b/, 'HEADLIGHT'],
    [/\bTAILLIGHT\b|\bTAIL\s*LIGHT\b|\bTAILLAMP\b/, 'TAILLIGHT'],
    [/\bMIRROR\b/, 'MIRROR'],
    [/\bDOOR\b.*\bHANDLE\b/, 'DOOR HANDLE'],
    [/\bALTERNATOR\b/, 'ALTERNATOR'],
    [/\bSTARTER\b/, 'STARTER'],
    [/\bRADIATOR\b/, 'RADIATOR'],
    [/\bCOMPRESSOR\b|\bA\/?C\b/, 'AC COMPRESSOR'],
    [/\bSPINDLE\b|\bKNUCKLE\b/, 'SPINDLE'],
    [/\bCALIPER\b/, 'CALIPER'],
    [/\bSTRUT\b|\bSHOCK\b/, 'STRUT'],
    [/\bFUSE\s*BOX\b/, 'FUSE BOX'],
    [/\bINSTRUMENT\s*CLUSTER\b|\bSPEEDOMETER\b|\bGAUGE\s*CLUSTER\b/, 'CLUSTER'],
  ];
  for (const [re, label] of types) {
    if (re.test(t)) return label;
  }
  return null;
}

router.get('/overstock', async (req, res) => {
  try {
    const groups = await database('overstock_group')
      .orderByRaw(`
        CASE status
          WHEN 'triggered' THEN 0
          WHEN 'watching' THEN 1
          WHEN 'acknowledged' THEN 2
          ELSE 3
        END
      `)
      .orderByRaw(`
        CASE status
          WHEN 'triggered' THEN EXTRACT(EPOCH FROM triggered_at)
          WHEN 'watching' THEN EXTRACT(EPOCH FROM created_at)
          WHEN 'acknowledged' THEN EXTRACT(EPOCH FROM acknowledged_at)
          ELSE 0
        END DESC
      `);

    // Eager load items + compute live stock for each group
    const results = [];
    for (const group of groups) {
      const items = await database('overstock_group_item')
        .where('group_id', group.id)
        .orderBy('is_active', 'desc')
        .orderBy('added_at', 'asc');

      // Compute live stock
      let liveStock = 0;
      try {
        if (group.group_type === 'single' && items.length > 0) {
          const listing = await database('YourListing')
            .where('ebayItemId', items[0].ebay_item_id)
            .first();
          if (listing && !/ended|inactive/i.test(listing.listingStatus || '')) {
            liveStock = parseInt(listing.quantityAvailable) || 1;
          }
        } else {
          for (const item of items) {
            if (item.is_active) {
              const listing = await database('YourListing')
                .where('ebayItemId', item.ebay_item_id)
                .first();
              if (listing && !/ended|inactive/i.test(listing.listingStatus || '')) {
                liveStock++;
              }
            }
          }
        }
      } catch (e) {
        liveStock = group.current_stock || 0;
      }

      results.push({
        ...group,
        live_stock: liveStock,
        items: items,
      });
    }

    res.json(results);
  } catch (err) {
    res.status(500).json({ error: 'Failed to load overstock groups: ' + err.message });
  }
});

router.post('/overstock/add', async (req, res) => {
  const { ebayItemIds, restockTarget = 1, name, notes } = req.body;
  if (!ebayItemIds || !Array.isArray(ebayItemIds) || ebayItemIds.length === 0) {
    return res.status(400).json({ error: 'At least one eBay item ID required.' });
  }

  const target = parseInt(restockTarget);
  if (isNaN(target) || target < 0) return res.status(400).json({ error: 'Restock target cannot be negative.' });

  // Look up each item
  const validItems = [];
  const errors = [];
  for (const rawId of ebayItemIds) {
    const id = String(rawId).trim();
    if (!id) continue;
    const listing = await database('YourListing').where('ebayItemId', id).first();
    if (!listing) {
      errors.push(`Item ${id} not found in inventory`);
    } else {
      // Check not already tracked
      const existing = await database('overstock_group_item').where('ebay_item_id', id).first();
      if (existing) {
        errors.push(`Item ${id} is already tracked in another group`);
      } else {
        validItems.push({
          ebayItemId: id,
          title: listing.title || id,
          currentPrice: parseFloat(listing.currentPrice) || null,
          quantity: parseInt(listing.quantityAvailable) || 1,
          listingStatus: listing.listingStatus,
        });
      }
    }
  }

  if (validItems.length === 0) {
    return res.status(400).json({ error: 'No valid items found.', errors });
  }

  let groupType, initialStock;
  if (validItems.length === 1) {
    // Single item — must have quantity 2+
    if (validItems[0].quantity < 2) {
      return res.status(400).json({
        error: 'Single item has quantity 1 — nothing to track. Paste multiple item numbers for group tracking, or use an item with quantity 2+.',
        errors
      });
    }
    groupType = 'single';
    initialStock = validItems[0].quantity;
  } else {
    // Multi group — need at least 2 valid items
    if (validItems.length < 2) {
      return res.status(400).json({
        error: 'Need at least 2 listings to create a group. For single items, the item must have quantity 2+.',
        errors
      });
    }
    groupType = 'multi';
    initialStock = validItems.length;
  }

  if (target >= initialStock) {
    return res.status(400).json({ error: `Restock target (${target}) must be below current stock (${initialStock}).` });
  }

  const groupName = (name && name.trim()) ? name.trim().substring(0, 256) : validItems[0].title.substring(0, 80);
  const partType = detectPartType(validItems[0].title);

  const [group] = await database('overstock_group').insert({
    name: groupName,
    part_type: partType,
    restock_target: target,
    current_stock: initialStock,
    initial_stock: initialStock,
    group_type: groupType,
    status: 'watching',
    notes: notes || null,
    created_at: new Date(),
    updated_at: new Date(),
  }).returning('*');

  // Insert items
  const itemRows = [];
  for (const vi of validItems) {
    const [row] = await database('overstock_group_item').insert({
      group_id: group.id,
      ebay_item_id: vi.ebayItemId,
      title: vi.title,
      current_price: vi.currentPrice,
      is_active: true,
      added_at: new Date(),
    }).returning('*');
    itemRows.push(row);
  }

  res.json({ ...group, items: itemRows, errors: errors.length > 0 ? errors : undefined });
});

router.post('/overstock/add-items', async (req, res) => {
  const { groupId, ebayItemIds } = req.body;
  if (!groupId) return res.status(400).json({ error: 'groupId required.' });
  if (!ebayItemIds || !Array.isArray(ebayItemIds) || ebayItemIds.length === 0) {
    return res.status(400).json({ error: 'At least one eBay item ID required.' });
  }

  const group = await database('overstock_group').where('id', groupId).first();
  if (!group) return res.status(404).json({ error: 'Group not found.' });

  const errors = [];
  const added = [];
  for (const rawId of ebayItemIds) {
    const id = String(rawId).trim();
    if (!id) continue;
    const listing = await database('YourListing').where('ebayItemId', id).first();
    if (!listing) { errors.push(`Item ${id} not found in inventory`); continue; }
    const existing = await database('overstock_group_item')
      .where('group_id', groupId).where('ebay_item_id', id).first();
    if (existing) { errors.push(`Item ${id} already in this group`); continue; }

    const [row] = await database('overstock_group_item').insert({
      group_id: groupId,
      ebay_item_id: id,
      title: listing.title || id,
      current_price: parseFloat(listing.currentPrice) || null,
      is_active: true,
      added_at: new Date(),
    }).returning('*');
    added.push(row);
  }

  // Update initial_stock if it grew
  if (added.length > 0) {
    const totalItems = await database('overstock_group_item').where('group_id', groupId).count('* as count').first();
    const newCount = parseInt(totalItems.count) || 0;
    const update = { updated_at: new Date() };
    if (newCount > group.initial_stock) update.initial_stock = newCount;
    update.current_stock = newCount; // refresh
    await database('overstock_group').where('id', groupId).update(update);
  }

  const updated = await database('overstock_group').where('id', groupId).first();
  const items = await database('overstock_group_item').where('group_id', groupId);
  res.json({ ...updated, items, added: added.length, errors: errors.length > 0 ? errors : undefined });
});

router.post('/overstock/acknowledge', async (req, res) => {
  const { id } = req.body;
  if (!id) return res.status(400).json({ error: 'ID required.' });

  const [row] = await database('overstock_group').where({ id }).update({
    status: 'acknowledged',
    acknowledged_at: new Date(),
    updated_at: new Date(),
  }).returning('*');

  res.json(row);
});

router.post('/overstock/rewatch', async (req, res) => {
  const { id, restockTarget } = req.body;
  if (!id) return res.status(400).json({ error: 'ID required.' });

  const group = await database('overstock_group').where({ id }).first();
  if (!group) return res.status(404).json({ error: 'Not found.' });

  // Recompute live stock
  const items = await database('overstock_group_item').where('group_id', id);
  let liveStock = 0;
  if (group.group_type === 'single' && items.length > 0) {
    const listing = await database('YourListing').where('ebayItemId', items[0].ebay_item_id).first();
    if (listing && !/ended|inactive/i.test(listing.listingStatus || '')) {
      liveStock = parseInt(listing.quantityAvailable) || 1;
    }
  } else {
    for (const item of items) {
      const listing = await database('YourListing').where('ebayItemId', item.ebay_item_id).first();
      if (listing && !/ended|inactive/i.test(listing.listingStatus || '')) liveStock++;
    }
  }

  if (liveStock < 2) return res.status(400).json({ error: `Stock is only at ${liveStock}. Need 2+ to re-watch.` });

  const update = {
    status: 'watching',
    current_stock: liveStock,
    triggered_at: null,
    acknowledged_at: null,
    updated_at: new Date(),
  };

  if (restockTarget !== undefined && restockTarget !== null) {
    const t = parseInt(restockTarget);
    if (!isNaN(t) && t >= 0 && t < liveStock) update.restock_target = t;
  }

  const [row] = await database('overstock_group').where({ id }).update(update).returning('*');
  res.json(row);
});

router.post('/overstock/delete', async (req, res) => {
  const { id } = req.body;
  if (!id) return res.status(400).json({ error: 'ID required.' });

  const group = await database('overstock_group').where({ id }).first();
  if (group) {
    await database('scout_alerts')
      .where('source', 'OVERSTOCK')
      .where('source_title', group.name)
      .del();
  }
  // CASCADE handles overstock_group_item deletion
  await database('overstock_group').where({ id }).del();
  res.json({ success: true });
});

router.post('/overstock/update-target', async (req, res) => {
  const { id, restockTarget } = req.body;
  if (!id) return res.status(400).json({ error: 'ID required.' });
  const target = parseInt(restockTarget);
  if (isNaN(target) || target < 0) return res.status(400).json({ error: 'Restock target must be >= 0.' });

  const group = await database('overstock_group').where({ id }).first();
  if (!group) return res.status(404).json({ error: 'Group not found.' });

  if (target >= group.current_stock && group.current_stock > 0) {
    return res.status(400).json({ error: `Restock target (${target}) must be below current stock (${group.current_stock}).` });
  }

  const update = { restock_target: target, updated_at: new Date() };

  // Handle state changes: if current_stock <= new target and was watching, trigger
  if (group.status === 'watching' && group.current_stock <= target) {
    update.status = 'triggered';
    update.triggered_at = new Date();
  }
  // If was triggered and new target is below current stock, reset to watching
  if (group.status === 'triggered' && group.current_stock > target) {
    update.status = 'watching';
    update.triggered_at = null;
  }

  const [row] = await database('overstock_group').where({ id }).update(update).returning('*');
  res.json(row);
});

router.post('/overstock/check-now', async (req, res) => {
  const OverstockCheckService = require('../services/OverstockCheckService');
  const service = new OverstockCheckService();
  const result = await service.checkAll();
  res.json(result);
});

router.get('/overstock/suggestions', async (req, res) => {
  // Find YourListing items with quantity >= 2 that aren't already tracked
  const tracked = await database('overstock_group_item').select('ebay_item_id');
  const trackedIds = tracked.map(t => t.ebay_item_id);

  let q = database('YourListing')
    .where('listingStatus', 'Active')
    .where('quantityAvailable', '>=', 2)
    .select('ebayItemId', 'title', 'quantityAvailable', 'currentPrice')
    .orderBy('quantityAvailable', 'desc')
    .limit(50);

  if (trackedIds.length > 0) {
    q = q.whereNotIn('ebayItemId', trackedIds);
  }

  const suggestions = await q;
  res.json(suggestions.map(s => ({
    ebayItemId: s.ebayItemId,
    title: s.title,
    quantity: parseInt(s.quantityAvailable) || 1,
    currentPrice: parseFloat(s.currentPrice) || null,
  })));
});

module.exports = router;
```
---
## FILE: service/routes/restockReport.js
```javascript
'use strict';

const router = require('express-promise-router')();
const { database } = require('../database/database');
const { normalizePartNumber } = require('../lib/partNumberUtils');
const { extractPartNumbers: piExtractPNs, vehicleYearMatchesPart } = require('../utils/partIntelligence');

// Make detection — word boundaries, scans entire title
const MAKE_PATTERNS = [
  [/\bToyota\b/i, 'Toyota'], [/\bHonda\b/i, 'Honda'], [/\bFord\b/i, 'Ford'],
  [/\bDodge\b/i, 'Dodge'], [/\bChrysler\b/i, 'Chrysler'], [/\bJeep\b/i, 'Jeep'],
  [/\bRam\b(?!\w)/i, 'Ram'],
  [/\bChevrolet\b/i, 'Chevrolet'], [/\bChevy\b/i, 'Chevrolet'],
  [/\bGMC\b/i, 'GMC'], [/\bNissan\b/i, 'Nissan'], [/\bHyundai\b/i, 'Hyundai'],
  [/\bKia\b/i, 'Kia'], [/\bMazda\b/i, 'Mazda'], [/\bSubaru\b/i, 'Subaru'],
  [/\bBMW\b/i, 'BMW'], [/\bMercedes\b/i, 'Mercedes'], [/\bVolkswagen\b/i, 'Volkswagen'],
  [/\bVW\b/i, 'Volkswagen'], [/\bAudi\b/i, 'Audi'], [/\bLexus\b/i, 'Lexus'],
  [/\bAcura\b/i, 'Acura'], [/\bInfiniti\b/i, 'Infiniti'], [/\bVolvo\b/i, 'Volvo'],
  [/\bMitsubishi\b/i, 'Mitsubishi'], [/\bBuick\b/i, 'Buick'], [/\bCadillac\b/i, 'Cadillac'],
  [/\bLincoln\b/i, 'Lincoln'], [/\bMini\b/i, 'Mini'], [/\bPontiac\b/i, 'Pontiac'],
  [/\bSaturn\b/i, 'Saturn'], [/\bMercury\b/i, 'Mercury'], [/\bScion\b/i, 'Scion'],
  [/\bFiat\b/i, 'Fiat'], [/\bJaguar\b/i, 'Jaguar'], [/\bPorsche\b/i, 'Porsche'],
  [/\bSaab\b/i, 'Saab'], [/\bSuzuki\b/i, 'Suzuki'], [/\bIsuzu\b/i, 'Isuzu'],
  [/\bHummer\b/i, 'Hummer'], [/\bGenesis\b/i, 'Genesis'], [/\bMaserati\b/i, 'Maserati'],
  [/\bAlfa Romeo\b/i, 'Alfa Romeo'], [/\bSmart\b/i, 'Smart'],
  [/\bOldsmobile\b/i, 'Oldsmobile'], [/\bPlymouth\b/i, 'Plymouth'],
  [/\bRange Rover\b/i, 'Land Rover'], [/\bLand Rover\b/i, 'Land Rover'],
  // Model-implies-make: Explorer=Ford, Mountaineer=Mercury, Civic=Honda etc
  [/\bExplorer\b/i, 'Ford'], [/\bMountaineer\b/i, 'Mercury'],
  [/\bEscalade\b/i, 'Cadillac'], [/\bYukon\b/i, 'GMC'],
];

// Known compound models (2+ words that must stay together)
const COMPOUND_MODELS = {
  'GRAND': ['Cherokee','Caravan','Prix','Marquis','Vitara','Am'],
  'SANTA': ['Fe','Cruz'],
  'TOWN': ['Car','Country','&'],
  'CROWN': ['Victoria'],
  'MONTE': ['Carlo'],
  'LAND': ['Cruiser'],
  'PT': ['Cruiser'],
  'RANGE': ['Rover'],
  'COOPER': ['S','Countryman'],
  'WRANGLER': ['JK','JL'],
  'MUSTANG': ['GT','Mach'],
  'CIVIC': ['Si','Type'],
  'PARK': ['Avenue'],
};

const STOP_WORDS = new Set(['ECU','ECM','PCM','BCM','TCM','ABS','TIPM','OEM','NEW','USED','REMAN',
  'ENGINE','BODY','CONTROL','MODULE','ANTI','FUSE','POWER','BRAKE','AMPLIFIER','RADIO','CLUSTER',
  'PROGRAMMED','PLUG','PLAY','AT','MT','4WD','AWD','2WD','FWD','INTEGRATED','LOCK','PUMP',
  'ELECTRIC','STEERING','THROTTLE','VIN','TESTED','GENUINE','REBUILT','V6','V8','V10',
  'HEMI','TURBO','SUPERCHARGED','AUTOMATIC','MANUAL']);

function extractMake(title) {
  for (const [re, name] of MAKE_PATTERNS) {
    if (re.test(title)) return name;
  }
  return null;
}

function extractModel(title, make) {
  if (!make) return null;
  const tu = title.toUpperCase();
  // Find make position — try canonical name first, then aliases
  const makeNames = [make.toUpperCase()];
  if (make === 'Chevrolet') makeNames.push('CHEVY');
  if (make === 'Volkswagen') makeNames.push('VW');
  if (make === 'Land Rover') makeNames.push('RANGE ROVER');

  let mi = -1;
  let matchLen = 0;
  for (const mn of makeNames) {
    const idx = tu.indexOf(mn);
    if (idx !== -1 && (mi === -1 || idx < mi)) { mi = idx; matchLen = mn.length; }
  }
  if (mi === -1) return null;

  const after = title.substring(mi + matchLen).trim().split(/\s+/);
  const mw = [];
  for (let i = 0; i < after.length; i++) {
    const w = after[i];
    const clean = w.replace(/[^A-Za-z0-9\-]/g, '');
    if (!clean) continue;
    if (/^\d{4}$/.test(clean) || /^\d{4}-\d{4}$/.test(clean)) {
      if (mw.length > 0) break; else continue; // skip leading years
    }
    if (/^\d+\.\d+[lL]?$/.test(clean)) break;
    if (STOP_WORDS.has(clean.toUpperCase())) break;
    mw.push(clean);

    // Check if this starts a compound model
    const upper = clean.toUpperCase();
    if (COMPOUND_MODELS[upper] && i + 1 < after.length) {
      const next = after[i + 1]?.replace(/[^A-Za-z0-9\-&]/g, '') || '';
      if (COMPOUND_MODELS[upper].some(c => c.toUpperCase() === next.toUpperCase())) {
        mw.push(next);
        break;
      }
    }

    // Number suffix (Ram 1500, F-150)
    if (mw.length >= 2 && /^\d/.test(clean)) break;
    if (mw.length >= 1 && !COMPOUND_MODELS[upper]) break;
    if (mw.length >= 2) break;
  }
  return mw.length > 0 ? mw.join(' ') : null;
}

function extractPartType(title) {
  const t = title.toUpperCase();
  if (/\b(TCM|TCU|TRANSMISSION CONTROL)\b/.test(t)) return 'TCM';
  if (/\b(BCM|BODY CONTROL)\b/.test(t)) return 'BCM';
  if (/\b(ECU|ECM|PCM|ENGINE CONTROL|ENGINE COMPUTER|ENGINE MODULE|DME)\b/.test(t)) return 'ECM';
  if (/\bTIPM\b/.test(t)) return 'TIPM';
  if (/\b(FUSE BOX|FUSE RELAY|JUNCTION|IPDM|RELAY BOX)\b/.test(t)) return 'Fuse Box';
  if (/\b(ABS|ANTI.?LOCK|BRAKE PUMP|BRAKE MODULE)\b/.test(t)) return 'ABS';
  if (/\b(AMPLIFIER|BOSE|HARMAN|JBL)\b/.test(t)) return 'Amplifier';
  if (/\b(RADIO|STEREO|RECEIVER|INFOTAINMENT)\b/.test(t)) return 'Radio';
  if (/\b(CLUSTER|SPEEDOMETER|GAUGE|INSTRUMENT)\b/.test(t)) return 'Cluster';
  if (/\b(THROTTLE BODY)\b/.test(t)) return 'Throttle';
  if (/\b(MIRROR|SIDE VIEW)\b/.test(t)) return 'Mirror';
  if (/\b(ALTERNATOR)\b/.test(t)) return 'Alternator';
  if (/\b(STARTER MOTOR|STARTER)\b/.test(t)) return 'Starter';
  if (/\b(SEAT BELT|SEATBELT)\b/.test(t)) return 'Seat Belt';
  if (/\b(WINDOW MOTOR|REGULATOR)\b/.test(t)) return 'Regulator';
  if (/\b(HEADLIGHT|HEAD LIGHT|HEAD LAMP)\b/.test(t)) return 'Headlight';
  if (/\b(TAIL LIGHT|TAILLIGHT)\b/.test(t)) return 'Tail Light';
  if (/\b(STEERING|EPS|POWER STEERING)\b/.test(t)) return 'Steering';
  if (/\b(TRANSFER CASE)\b/.test(t)) return 'Transfer Case';
  if (/\b(WIPER)\b/.test(t)) return 'Wiper';
  if (/\b(SENSOR|CAMERA|BLIND SPOT|PARKING)\b/.test(t)) return 'Sensor';
  if (/\b(ACTUATOR|MULTIAIR|VVT)\b/.test(t)) return 'Actuator';
  if (/\b(INTAKE MANIFOLD)\b/.test(t)) return 'Intake';
  if (/\b(CLIMATE|HVAC|AC CONTROL)\b/.test(t)) return 'Climate Control';
  return null;
}

function extractPartNumbers(title) {
  const pns = [];
  const m1 = title.match(/\b(\d{7,10}[A-Z]{0,2})\b/g);
  if (m1) pns.push(...m1);
  const m2 = title.match(/\b([A-Z]{1,4}\d{1,2}[A-Z]-[A-Z0-9]{3,7}(?:-[A-Z]{1,3})?)\b/g);
  if (m2) pns.push(...m2);
  const m3 = title.match(/\b(\d{5}-[A-Z0-9]{2,7}(?:-[A-Z0-9]{1,3})?)\b/g);
  if (m3) pns.push(...m3);
  return pns;
}

function getPartLabel(title, make, model) {
  // Remove make, model, years, PNs, engine specs → what's left is the part description
  let t = title;
  if (make) t = t.replace(new RegExp('\\b' + make.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'gi'), '');
  if (make === 'Chevrolet') t = t.replace(/\bChevy\b/gi, '');
  if (model) t = t.replace(new RegExp('\\b' + model.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'gi'), '');
  t = t.replace(/\b\d{4}(-\d{4})?\b/g, '');
  t = t.replace(/\b\d{7,10}[A-Z]{0,2}\b/g, '');
  t = t.replace(/\b[A-Z]{1,4}\d{1,2}[A-Z]-[A-Z0-9]{3,7}(?:-[A-Z]{1,3})?\b/g, '');
  t = t.replace(/\b\d{5}-[A-Z0-9]{2,7}\b/g, '');
  t = t.replace(/\b\d+\.\d+L\b/gi, '');
  t = t.replace(/\b(OEM|Programmed|Tested|REMAN|AT|MT|4WD|AWD|2WD|FWD|RWD|V6|V8)\b/gi, '');
  t = t.replace(/[,\-]/g, ' ').replace(/\s+/g, ' ').trim();
  return t || 'Part';
}

router.get('/report', async (req, res) => {
  try {
    const days = parseInt(req.query.days) || 30;
    const clampedDays = Math.min(Math.max(days, 1), 365);

    const sales = await database('YourSale')
      .where('soldDate', '>=', database.raw(`NOW() - INTERVAL '${clampedDays} days'`))
      .whereNotNull('title')
      .whereRaw('"salePrice"::numeric >= 50')
      .select('title', 'salePrice', 'soldDate', 'sku');

    const groups = {};
    for (const sale of sales) {
      const title = sale.title || '';
      const make = extractMake(title);
      const model = make ? extractModel(title, make) : null;
      let pt = extractPartType(title);
      if (!pt) pt = getPartLabel(title, make, model);
      const pns = piExtractPNs(title);
      const basePn = pns.length > 0 ? pns[0].base : null;
      const key = `${make || '?'}|${model || ''}|${pt}|${basePn || title.substring(0, 30)}`;

      if (!groups[key]) {
        groups[key] = { make: make || '?', model, partType: pt, basePn, allPns: new Set(), sold: 0, totalPrice: 0, lastSold: null, sampleTitle: title };
      }
      const g = groups[key];
      g.sold++;
      g.totalPrice += parseFloat(sale.salePrice) || 0;
      for (const pn of pns) g.allPns.add(pn.raw);
      if (!g.lastSold || new Date(sale.soldDate) > new Date(g.lastSold)) g.lastSold = sale.soldDate;
    }

    const listings = await database('YourListing').where('listingStatus', 'Active').whereNotNull('title').select('title', 'quantityAvailable', 'sku');
    const stockByBasePn = {};
    const listingTitles = [];
    for (const l of listings) {
      const qty = parseInt(l.quantityAvailable) || 1;
      listingTitles.push({ title: (l.title || '').toUpperCase(), qty });
      // Use shared part number extractor (handles all OEM formats)
      const pns = piExtractPNs(l.title || '');
      for (const pn of pns) {
        if (pn.base) stockByBasePn[pn.base] = (stockByBasePn[pn.base] || 0) + qty;
        if (pn.raw && pn.raw !== pn.base) stockByBasePn[pn.raw] = (stockByBasePn[pn.raw] || 0) + qty;
      }
      // Also index by SKU as part number
      if (l.sku) {
        const skuBase = normalizePartNumber(l.sku);
        if (skuBase && skuBase.length >= 5) stockByBasePn[skuBase] = (stockByBasePn[skuBase] || 0) + qty;
      }
    }

    // Fallback stock lookup: match by make + MODEL + partType keywords in listing titles
    // Model is required to prevent cross-model inflation (Transit != F150)
    function titleStockFallback(make, model, partType, yearStart) {
      if (!make || make === '?' || !partType) return 0;
      const makeUp = make.toUpperCase();
      const modelUp = model ? model.toUpperCase() : null;
      const ptPatterns = {
        'ECM': ['ECM','ECU','PCM','ENGINE CONTROL','ENGINE COMPUTER'],
        'BCM': ['BCM','BODY CONTROL'],
        'TCM': ['TCM','TCU','TRANSMISSION CONTROL'],
        'ABS': ['ABS','ANTI LOCK','ANTI-LOCK','BRAKE MODULE'],
        'TIPM': ['TIPM'],
        'Fuse Box': ['FUSE BOX','JUNCTION','IPDM','RELAY BOX'],
        'Amplifier': ['AMPLIFIER','BOSE','HARMAN','JBL'],
        'Radio': ['RADIO','STEREO','RECEIVER','INFOTAINMENT'],
        'Cluster': ['CLUSTER','SPEEDOMETER','INSTRUMENT','GAUGE'],
        'Throttle': ['THROTTLE BODY'],
        'Ignition': ['IGNITION','IMMOBILIZER'],
      };
      const patterns = ptPatterns[partType];
      if (!patterns) return 0;
      let count = 0;
      for (const lt of listingTitles) {
        if (!lt.title.includes(makeUp)) continue;
        // Model match required when available
        if (modelUp && !lt.title.includes(modelUp)) continue;
        if (!patterns.some(p => lt.title.includes(p))) continue;
        if (yearStart) {
          const yearCheck = vehicleYearMatchesPart(yearStart, lt.title);
          if (yearCheck.confirmed && !yearCheck.matches) continue;
        }
        count += lt.qty;
      }
      return count;
    }

    const items = [];
    for (const [, g] of Object.entries(groups)) {
      let stock = g.basePn ? (stockByBasePn[g.basePn] || 0) : 0;
      // Fallback: if no PN match, try title-based matching
      if (stock === 0 && g.make && g.make !== '?') {
        const yr = g.sampleTitle ? g.sampleTitle.match(/\b((?:19|20)\d{2})\b/) : null;
        stock = titleStockFallback(g.make, g.model, g.partType, yr ? parseInt(yr[1]) : null);
      }
      const avgPrice = g.sold > 0 ? Math.round(g.totalPrice / g.sold * 100) / 100 : 0;
      const years = g.sampleTitle.match(/\b((?:19|20)\d{2})\b/g);
      let yearRange = null;
      if (years) { const s = [...new Set(years.map(Number))].sort(); yearRange = s[0] === s[s.length - 1] ? String(s[0]) : s[0] + '-' + s[s.length - 1]; }

      // === SCORING: price is king ===
      let score = 0;
      // Price (dominant factor, max 35)
      score += avgPrice >= 500 ? 35 : avgPrice >= 300 ? 28 : avgPrice >= 200 ? 22 : avgPrice >= 150 ? 15 : avgPrice >= 100 ? 10 : 5;
      // Stock urgency (max 30)
      score += stock === 0 ? 30 : stock === 1 ? 20 : (g.sold > stock ? 10 : 0);
      // Demand volume (max 20)
      score += g.sold >= 4 ? 20 : g.sold >= 3 ? 15 : g.sold >= 2 ? 10 : 5;
      // Recency (max 15)
      const daysSince = g.lastSold ? Math.floor((Date.now() - new Date(g.lastSold).getTime()) / 86400000) : 99;
      score += daysSince <= 3 ? 15 : daysSince <= 7 ? 12 : daysSince <= 14 ? 8 : 4;
      score = Math.min(100, score);

      // Floor rules: high-value parts always surface
      if (avgPrice >= 500 && g.sold >= 1 && stock <= 1) score = Math.max(score, 85);
      if (avgPrice >= 300 && g.sold >= 1 && stock <= 1) score = Math.max(score, 75);
      if (avgPrice >= 200 && g.sold >= 2 && stock === 0) score = Math.max(score, 75);

      const action = stock === 0 ? 'RESTOCK NOW' : stock === 1 ? 'LOW STOCK' : (g.sold > stock ? 'SELLING FAST' : 'MONITOR');

      items.push({
        score, action, make: g.make, model: g.model, partType: g.partType,
        basePn: g.basePn, variantPns: [...g.allPns].slice(0, 5), yearRange,
        sold7d: g.sold, activeStock: stock, avgPrice, revenue: Math.round(g.totalPrice),
        daysSinceSold: daysSince, sampleTitle: g.sampleTitle,
      });
    }

    const filtered = items.filter(i => i.activeStock <= 1 || i.sold7d > i.activeStock || i.avgPrice >= 300);
    filtered.sort((a, b) => b.score - a.score || b.revenue - a.revenue);
    const top = filtered.slice(0, 100);

    // Tier rules: price-aware — high value parts with low stock are always green
    const tiers = { green: [], yellow: [], orange: [] };
    for (const item of top) {
      if (item.score >= 75) { item.tier = 'green'; tiers.green.push(item); }
      else if (item.score >= 60) { item.tier = 'yellow'; tiers.yellow.push(item); }
      else { item.tier = 'orange'; tiers.orange.push(item); }
    }

    // Get listing count for diagnostics
    let activeListingCount = 0;
    try {
      const lc = await database('YourListing').where('listingStatus', 'Active').count('* as cnt').first();
      activeListingCount = parseInt(lc?.cnt || 0);
    } catch (e) { /* ignore */ }

    res.json({ success: true, generatedAt: new Date().toISOString(), days: clampedDays,
      period: clampedDays === 1 ? 'Last 24 hours' : `Last ${clampedDays} days`, tiers,
      summary: { green: tiers.green.length, yellow: tiers.yellow.length, orange: tiers.orange.length,
        total: top.length, salesAnalyzed: sales.length, activeListings: activeListingCount },
    });
  } catch (err) {
    res.status(500).json({ error: err.message, stack: err.stack });
  }
});

/**
 * GET /restock/found-items
 * Returns all claimed scout alerts (GOT ONE) for THE QUARRY items,
 * so the THE QUARRY page can show "FOUND — Pulled from LKQ Raleigh"
 */
router.get('/found-items', async (req, res) => {
  try {
    const found = await database('scout_alerts')
      .where('source', 'bone_pile')
      .where('claimed', true)
      .select('source_title', 'yard_name', 'claimed_at', 'vehicle_year', 'vehicle_make', 'vehicle_model');

    // Build lookup by normalized title prefix for matching against report items
    const foundMap = {};
    for (const f of found) {
      // Key by first 40 chars of title (same dedup key used in alert generation)
      const key = (f.source_title || '').substring(0, 40).toLowerCase();
      if (!foundMap[key]) {
        foundMap[key] = {
          yard: f.yard_name,
          date: f.claimed_at,
          vehicle: [f.vehicle_year, f.vehicle_make, f.vehicle_model].filter(Boolean).join(' '),
        };
      }
    }

    res.json({ success: true, found: foundMap, count: found.length });
  } catch (err) {
    res.json({ success: true, found: {}, count: 0 });
  }
});

module.exports = router;
```
---
## FILE: service/routes/flyway.js
```javascript
'use strict';

const router = require('express-promise-router')();
const FlywayService = require('../services/FlywayService');
const AttackListService = require('../services/AttackListService');
const DeadInventoryService = require('../services/DeadInventoryService');
const { database } = require('../database/database');
const { log } = require('../lib/logger');

// List trips (optional ?status=active|planning|complete)
router.get('/trips', async (req, res) => {
  try {
    const trips = await FlywayService.getTrips(req.query.status || null);
    res.json({ success: true, trips });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Get single trip with yards
router.get('/trips/:id', async (req, res) => {
  try {
    const trip = await FlywayService.getTrip(req.params.id);
    if (!trip) return res.status(404).json({ success: false, error: 'Trip not found' });
    res.json({ success: true, ...trip });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Create trip
router.post('/trips', async (req, res) => {
  try {
    const { name, start_date, end_date, notes, yard_ids, trip_type } = req.body;
    if (!name || !start_date || !end_date) {
      return res.status(400).json({ success: false, error: 'name, start_date, end_date required' });
    }
    const trip = await FlywayService.createTrip({ name, start_date, end_date, notes, yard_ids, trip_type });
    res.status(201).json({ success: true, ...trip });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Update trip (status, name, dates, notes)
router.patch('/trips/:id', async (req, res) => {
  try {
    const trip = await FlywayService.updateTrip(req.params.id, req.body);
    res.json({ success: true, ...trip });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// Delete trip
router.delete('/trips/:id', async (req, res) => {
  try {
    await FlywayService.deleteTrip(req.params.id);
    res.json({ success: true, deleted: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Add yard to trip
router.post('/trips/:id/yards', async (req, res) => {
  try {
    const { yard_id } = req.body;
    const trip = await FlywayService.addYardToTrip(req.params.id, yard_id);
    res.json({ success: true, ...trip });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Remove yard from trip
router.delete('/trips/:tripId/yards/:yardId', async (req, res) => {
  try {
    const trip = await FlywayService.removeYardFromTrip(req.params.tripId, req.params.yardId);
    res.json({ success: true, ...trip });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Reinstate a completed trip (within 24-hour grace period)
router.post('/trips/:id/reinstate', async (req, res) => {
  try {
    const trip = await FlywayService.getTrip(req.params.id);
    if (!trip) return res.status(404).json({ success: false, error: 'Trip not found' });

    if (trip.status !== 'complete') {
      return res.status(400).json({ success: false, error: 'Only completed trips can be reinstated' });
    }

    if (trip.completed_at) {
      const hoursSinceComplete = (Date.now() - new Date(trip.completed_at).getTime()) / (1000 * 60 * 60);
      if (hoursSinceComplete > 24) {
        return res.status(400).json({ success: false, error: 'Grace period expired. Trip was completed over 24 hours ago.' });
      }
    } else {
      return res.status(400).json({ success: false, error: 'Trip has no completion timestamp. Cannot reinstate.' });
    }

    const updated = await FlywayService.updateTrip(req.params.id, { status: 'active' });
    res.json({ success: true, ...updated });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Dry-run preview: show what cleanup would deactivate
router.get('/cleanup-preview', async (req, res) => {
  try {
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const expiredTrips = await database('flyway_trip')
      .where('status', 'complete')
      .whereNotNull('completed_at')
      .where('completed_at', '<', cutoff)
      .where(function() {
        this.whereNull('cleaned_up').orWhere('cleaned_up', false);
      })
      .select('id', 'name', 'completed_at');

    const coreYardIds = await FlywayService.getCoreYardIds();

    const activeYardIds = await database('flyway_trip_yard')
      .join('flyway_trip', 'flyway_trip.id', 'flyway_trip_yard.trip_id')
      .where('flyway_trip.status', 'active')
      .select('flyway_trip_yard.yard_id')
      .then(rows => rows.map(r => r.yard_id));

    const protectedYardIds = new Set([...coreYardIds, ...activeYardIds]);

    const preview = [];
    for (const trip of expiredTrips) {
      const tripYardIds = await database('flyway_trip_yard')
        .where('trip_id', trip.id)
        .select('yard_id')
        .then(rows => rows.map(r => r.yard_id));

      const yardsToClean = tripYardIds.filter(id => !protectedYardIds.has(id));

      let vehicleCount = 0;
      if (yardsToClean.length > 0) {
        const result = await database('yard_vehicle')
          .whereIn('yard_id', yardsToClean)
          .where('active', true)
          .count('id as count')
          .first();
        vehicleCount = parseInt(result.count);
      }

      const yardNames = await database('yard')
        .whereIn('id', yardsToClean)
        .select('id', 'name', 'chain');

      preview.push({
        trip: trip.name,
        completed_at: trip.completed_at,
        yardsToClean: yardNames,
        yardsProtected: tripYardIds.filter(id => protectedYardIds.has(id)).length,
        vehiclesToDeactivate: vehicleCount,
      });
    }

    res.json({
      coreYardIds,
      activeYardIdsProtected: [...new Set(activeYardIds)],
      trips: preview,
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Get Flyway attack list for a trip
router.get('/trips/:id/attack-list', async (req, res) => {
  try {
    const result = await FlywayService.getFlywayAttackList(req.params.id);
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Load parts for a single vehicle on-demand (matches Daily Feed expand behavior)
router.get('/vehicle/:vehicleId/parts', async (req, res) => {
  try {
    const { vehicleId } = req.params;
    const service = new AttackListService();

    const vehicle = await database('yard_vehicle').where('id', vehicleId).first();
    if (!vehicle) return res.status(404).json({ success: false, error: 'Vehicle not found' });

    const inventoryIndex = await service.buildInventoryIndex();
    const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
    const salesIndex = await service.buildSalesIndex(cutoff);
    const { byMakeModel: stockIndex, byPartNumber: stockPartNumbers } = await service.buildStockIndex();
    const platformIndex = await service.buildPlatformIndex();

    // Enrich with reference transmission if NHTSA didn't provide one
    if (!vehicle.decoded_transmission && vehicle.year && vehicle.make && vehicle.model) {
      try {
        const TrimTierService = require('../services/TrimTierService');
        const trimName = vehicle.decoded_trim || vehicle.trim_level || vehicle.trim || null;
        const engine = vehicle.decoded_engine || vehicle.engine || null;
        const refResult = await TrimTierService.lookup(
          parseInt(vehicle.year) || 0,
          vehicle.make, vehicle.model, trimName, engine,
          null, vehicle.decoded_drivetrain || vehicle.drivetrain || null
        );
        if (refResult && refResult.transmission) {
          vehicle.decoded_transmission = refResult.transmission;
        }
      } catch (e) { /* reference lookup optional */ }
    }

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

    // Enrich with cached market data — same as Daily Feed
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
          p.marketCheckedAt = cached.checkedAt;
        }
      }
    } catch (e) {
      log.warn({ err: e.message }, 'Flyway market enrichment failed');
    }

    res.json({
      success: true,
      id: vehicleId,
      parts: scored.parts || [],
      rebuild_parts: scored.rebuild_parts || null,
      platform_siblings: scored.platform_siblings || null,
    });
  } catch (err) {
    log.error({ err }, 'Error loading flyway vehicle parts');
    res.status(500).json({ success: false, error: err.message });
  }
});

// Get active scrapable yards (for scraper consumption)
router.get('/active-yards', async (req, res) => {
  try {
    const yards = await FlywayService.getActiveScrapableYards();
    res.json(yards);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Get all yards available for trip selection
router.get('/available-yards', async (req, res) => {
  try {
    const yards = await database('yard')
      .orderBy('distance_from_base', 'asc')
      .select('id', 'name', 'chain', 'address', 'distance_from_base',
              'scrape_url', 'scrape_method', 'last_scraped', 'flagged', 'flag_reason');
    res.json({ success: true, yards });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Trigger manual scrape for all yards in a trip (non-LKQ only)
router.post('/trips/:id/scrape', async (req, res) => {
  try {
    const trip = await FlywayService.getTrip(req.params.id);
    if (!trip) return res.status(404).json({ success: false, error: 'Trip not found' });
    if (trip.status !== 'active') return res.status(400).json({ success: false, error: 'Trip must be active to scrape' });

    const FlywayScrapeRunner = require('../lib/FlywayScrapeRunner');
    const runner = new FlywayScrapeRunner();
    runner.work().catch(err => console.error('[Flyway] Manual scrape error:', err.message));

    res.json({
      success: true,
      message: 'Flyway scrape started in background. Non-LKQ yards will be scraped. Refresh in a few minutes.',
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Get scrape status for a trip's yards
router.get('/trips/:id/scrape-status', async (req, res) => {
  try {
    const trip = await FlywayService.getTrip(req.params.id);
    if (!trip) return res.status(404).json({ success: false, error: 'Trip not found' });

    const yardIds = trip.yards.map(y => y.id);
    const yards = await database('yard')
      .whereIn('id', yardIds)
      .select('id', 'name', 'chain', 'scrape_method', 'last_scraped');

    const counts = await database('yard_vehicle')
      .whereIn('yard_id', yardIds)
      .where('active', true)
      .groupBy('yard_id')
      .select('yard_id')
      .count('id as vehicle_count');

    const countMap = {};
    counts.forEach(c => { countMap[c.yard_id] = parseInt(c.vehicle_count); });

    const status = yards.map(y => ({
      id: y.id,
      name: y.name,
      chain: y.chain,
      scrape_method: y.scrape_method,
      last_scraped: y.last_scraped,
      vehicle_count: countMap[y.id] || 0,
      scrape_type: (y.scrape_method || '').toLowerCase() === 'lkq' ? 'local' :
                   (y.scrape_method || '').toLowerCase() === 'manual' || (y.scrape_method || '').toLowerCase() === 'none' ? 'manual' : 'server',
      needs_scrape: !y.last_scraped || (Date.now() - new Date(y.last_scraped).getTime()) > 24 * 60 * 60 * 1000,
    }));

    res.json({ success: true, status });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
```
---
## FILE: service/routes/phoenix.js
```javascript
'use strict';

const router = require('express-promise-router')();
const { log } = require('../lib/logger');
const { database } = require('../database/database');
const PhoenixService = require('../services/PhoenixService');
const SoldItemsManager = require('../managers/SoldItemsManager');

// GET /phoenix — Main scored list
router.get('/', async (req, res) => {
  try {
    const service = new PhoenixService();
    const days = parseInt(req.query.days) || 180;
    const limit = parseInt(req.query.limit) || 100;
    const seller = req.query.seller || null;
    const sellers = await service.getRebuildSellers();
    const data = await service.getPhoenixList({ days, limit, seller });
    res.json({
      success: true,
      data,
      meta: { days, limit, total: data.length, seller: seller || 'all', allSellers: sellers.filter(s => s.enabled).map(s => s.name) },
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /phoenix/stats — Summary metrics
router.get('/stats', async (req, res) => {
  try {
    const service = new PhoenixService();
    const days = parseInt(req.query.days) || 180;
    const seller = req.query.seller || null;
    const stats = await service.getPhoenixStats({ days, seller });
    res.json({ success: true, stats });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /phoenix/sellers — List rebuild sellers
router.get('/sellers', async (req, res) => {
  try {
    const service = new PhoenixService();
    const sellers = await service.getRebuildSellers();
    res.json({ success: true, sellers });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /phoenix/sellers — Add a rebuild seller
router.post('/sellers', async (req, res) => {
  try {
    const { name } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ success: false, message: 'Seller name is required' });
    const service = new PhoenixService();
    const seller = await service.addRebuildSeller(name);
    res.json({ success: true, seller, message: 'Added rebuild seller: ' + name.trim().toLowerCase() });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// DELETE /phoenix/sellers/:name — Remove rebuild seller
router.delete('/sellers/:name', async (req, res) => {
  try {
    const service = new PhoenixService();
    const result = await service.removeRebuildSeller(req.params.name);
    res.json({ success: true, ...result, message: 'Removed rebuild seller: ' + req.params.name });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /phoenix/sellers/:name/scrape — Trigger scrape (non-blocking)
router.post('/sellers/:name/scrape', async (req, res) => {
  const sellerName = req.params.name;
  const maxPages = parseInt(req.body.maxPages) || 5;
  res.json({ success: true, message: 'Scrape started for ' + sellerName, started: true });

  // Run in background — don't block the request
  const manager = new SoldItemsManager();
  try {
    const result = await manager.scrapeCompetitor({
      seller: sellerName,
      categoryId: '6030',
      maxPages,
    });
    log.info({ seller: sellerName, result }, 'Phoenix seller scrape complete');

    // Update seller stats so UI and auto-scrape skip window stay current
    try {
      await database('SoldItemSeller').where('name', sellerName).update({
        lastScrapedAt: new Date(),
        itemsScraped: database.raw('"itemsScraped" + ?', [result.stored]),
        updatedAt: new Date(),
      });
    } catch (e) { log.warn({ err: e.message, seller: sellerName }, 'Could not update seller stats'); }
  } catch (err) {
    log.error({ err: err.message, seller: sellerName }, 'Phoenix seller scrape failed');
  } finally {
    try { await manager.scraper.closeBrowser(); } catch (e) {}
  }
});

module.exports = router;
```
---
## FILE: service/routes/price-check.js
```javascript
'use strict';

const express = require('express');
const router = express.Router();
const { log } = require('../lib/logger');
const PriceCheckService = require('../services/PriceCheckService');
const PriceCheckCronRunner = require('../lib/PriceCheckCronRunner');
const YourListing = require('../models/YourListing');
const PriceCheck = require('../models/PriceCheck');

/**
 * POST /price-check/omit
 * Omit or un-omit one or more listings from automated price checks.
 * Works as both a single and bulk API — pass one or many listingIds.
 * Body: { listingIds: string[], omit: boolean }
 */
router.post('/omit', async (req, res) => {
  try {
    const { listingIds, omit } = req.body;

    if (!listingIds || !Array.isArray(listingIds) || listingIds.length === 0) {
      return res.status(400).json({ success: false, error: 'listingIds array is required' });
    }
    if (typeof omit !== 'boolean') {
      return res.status(400).json({ success: false, error: 'omit (boolean) is required' });
    }

    await YourListing.query()
      .patch({ priceCheckOmitted: omit })
      .whereIn('id', listingIds);

    return res.json({
      success: true,
      updated: listingIds.length,
      omit,
    });
  } catch (error) {
    console.error('Price check omit error:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /price-check/all
 * Get listings with their most recent price check data (paginated)
 * Query params: page (default: 1), limit (default: 50), verdict (optional filter), omitted (optional: 'true'/'false')
 */
router.get('/all', async (req, res) => {
  try {
    const { page = 1, limit = 50, verdict, search, omitted } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    // Get recent price checks for filtering
    const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    // Build listing query - filter by verdict if provided
    let listingQuery = YourListing.query();
    let countQuery = YourListing.query();

    // Omitted filter — default shows non-omitted listings only
    if (omitted === 'true') {
      listingQuery = listingQuery.where('priceCheckOmitted', true);
      countQuery = countQuery.where('priceCheckOmitted', true);
    } else if (omitted === 'false' || omitted === undefined) {
      listingQuery = listingQuery.where('priceCheckOmitted', false);
      countQuery = countQuery.where('priceCheckOmitted', false);
    }
    // omitted=all → no filter applied

    // Title search filter
    if (search && search.trim()) {
      const term = `%${search.trim()}%`;
      listingQuery = listingQuery.whereRaw('LOWER(title) LIKE LOWER(?)', [term]);
      countQuery = countQuery.whereRaw('LOWER(title) LIKE LOWER(?)', [term]);
    }

    if (verdict && verdict !== 'all') {
      // Get listing IDs that match the verdict filter
      let verdictFilter;
      if (verdict === 'unchecked') {
        // Get listings that DON'T have a recent price check
        const checkedListingIds = await PriceCheck.query()
          .where('checkedAt', '>', cutoff)
          .distinct('listingId')
          .pluck('listingId');

        listingQuery = listingQuery.whereNotIn('id', checkedListingIds);
        countQuery = countQuery.whereNotIn('id', checkedListingIds);
      } else {
        // Get listings that have a price check with the specified verdict
        const matchingVerdicts = verdict === 'atMarket'
          ? ['MARKET PRICE', 'GOOD VALUE']
          : verdict === 'high'
            ? ['OVERPRICED', 'SLIGHTLY HIGH']
            : [verdict.toUpperCase()];

        // Get latest price check per listing with matching verdict
        const matchingListingIds = await PriceCheck.query()
          .where('checkedAt', '>', cutoff)
          .whereIn('verdict', matchingVerdicts)
          .distinct('listingId')
          .pluck('listingId');

        listingQuery = listingQuery.whereIn('id', matchingListingIds);
        countQuery = countQuery.whereIn('id', matchingListingIds);
      }
    }

    // Only show listings confirmed active by a recent sync.
    // The eBay sync runs every 6h and only returns active listings — anything
    // not re-synced within 14 days is ended/removed on eBay.
    // This also naturally deduplicates relisted items (old records go stale).
    const staleCutoff = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
    listingQuery = listingQuery.where('syncedAt', '>', staleCutoff)
      .where('listingStatus', 'Active')
      .where('quantityAvailable', '>', 0);
    countQuery = countQuery.where('syncedAt', '>', staleCutoff)
      .where('listingStatus', 'Active')
      .where('quantityAvailable', '>', 0);

    // Get paginated listings
    const [listings, countResult] = await Promise.all([
      listingQuery.clone().orderBy('createdAt', 'desc').limit(parseInt(limit)).offset(offset),
      countQuery.clone().count('* as total').first(),
    ]);

    const total = parseInt(countResult?.total || 0);
    const totalPages = Math.ceil(total / parseInt(limit));

    // Calculate daysListed for each
    const now = new Date();
    const listingsWithDays = listings.map(listing => {
      const startTime = listing.startTime ? new Date(listing.startTime) : now;
      const daysListed = Math.floor((now - startTime) / (1000 * 60 * 60 * 24));
      return { ...listing, daysListed: Math.max(0, daysListed) };
    });

    // Get all recent price checks (within 7 days for bulk view)
    const priceChecks = await PriceCheck.query()
      .where('checkedAt', '>', cutoff)
      .orderBy('checkedAt', 'desc');

    // Create a map of listing ID to most recent price check
    const priceCheckMap = {};
    priceChecks.forEach(pc => {
      if (!priceCheckMap[pc.listingId]) {
        priceCheckMap[pc.listingId] = pc;
      }
    });

    // Merge listings with price checks and calculate suggested price
    const results = listingsWithDays.map(listing => {
      const priceCheck = priceCheckMap[listing.id];
      let suggestedPrice = null;
      let priceDiff = null;

      if (priceCheck && priceCheck.marketMedian) {
        // Suggest slightly below median for faster sales
        suggestedPrice = Math.round(parseFloat(priceCheck.marketMedian) * 0.95 * 100) / 100;
        priceDiff = parseFloat(listing.currentPrice) - suggestedPrice;
      }

      // Parse topComps if stored as string
      let topComps = [];
      if (priceCheck?.topComps) {
        try {
          topComps = typeof priceCheck.topComps === 'string'
            ? JSON.parse(priceCheck.topComps)
            : priceCheck.topComps;
        } catch (e) {
          topComps = [];
        }
      }

      return {
        id: listing.id,
        ebayItemId: listing.ebayItemId,
        title: listing.title,
        sku: listing.sku,
        currentPrice: parseFloat(listing.currentPrice),
        daysListed: listing.daysListed,
        viewItemUrl: listing.viewItemUrl,
        priceCheckOmitted: !!listing.priceCheckOmitted,
        priceCheck: priceCheck ? {
          checkedAt: priceCheck.checkedAt,
          verdict: priceCheck.verdict,
          marketMedian: parseFloat(priceCheck.marketMedian),
          marketMin: parseFloat(priceCheck.marketMin),
          marketMax: parseFloat(priceCheck.marketMax),
          compCount: priceCheck.compCount,
          priceDiffPercent: parseFloat(priceCheck.priceDiffPercent),
          suggestedPrice,
          priceDiff,
          // Additional details for expandable view
          searchQuery: priceCheck.searchQuery,
          topComps,
          salesPerWeek: priceCheck.salesPerWeek ? parseFloat(priceCheck.salesPerWeek) : null,
          partType: priceCheck.partType,
          make: priceCheck.make,
          model: priceCheck.model,
          years: priceCheck.years,
        } : null,
      };
    });

    // Summary stats - calculate across ALL listings, not just current page
    // This runs separate queries to get accurate totals
    const [allPriceChecks, totalListingsCount, omittedCount] = await Promise.all([
      PriceCheck.query()
        .where('checkedAt', '>', cutoff)
        .select('listingId', 'verdict')
        .orderBy('checkedAt', 'desc'),
      YourListing.query().count('* as count').first(),
      YourListing.query().where('priceCheckOmitted', true).count('* as count').first(),
    ]);

    // Create map of latest verdict per listing
    const verdictMap = {};
    allPriceChecks.forEach(pc => {
      if (!verdictMap[pc.listingId]) {
        verdictMap[pc.listingId] = pc.verdict;
      }
    });

    const checkedTotal = Object.keys(verdictMap).length;
    const overpricedTotal = Object.values(verdictMap).filter(v => v === 'OVERPRICED').length;
    const underpricedTotal = Object.values(verdictMap).filter(v => v === 'UNDERPRICED').length;
    const atMarketTotal = Object.values(verdictMap).filter(v => ['MARKET PRICE', 'GOOD VALUE'].includes(v)).length;
    const totalAll = parseInt(totalListingsCount?.count || 0);

    return res.json({
      success: true,
      count: results.length,
      total,
      page: parseInt(page),
      totalPages,
      summary: {
        checked: checkedTotal,
        overpriced: overpricedTotal,
        underpriced: underpricedTotal,
        atMarket: atMarketTotal,
        unchecked: totalAll - checkedTotal,
        omitted: parseInt(omittedCount?.count || 0),
      },
      listings: results,
    });
  } catch (error) {
    console.error('Bulk price check error:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /price-check/bulk
 * Run price check on multiple listings (processes sequentially to avoid rate limits)
 * Body: { listingIds: string[], forceRefresh: boolean }
 */
router.post('/bulk', async (req, res) => {
  try {
    const { listingIds, forceRefresh = false } = req.body;

    if (!listingIds || !Array.isArray(listingIds)) {
      return res.status(400).json({ success: false, error: 'listingIds array is required' });
    }

    // Limit to 20 at a time to prevent timeouts
    const idsToProcess = listingIds.slice(0, 20);
    const results = [];
    const errors = [];

    for (const listingId of idsToProcess) {
      try {
        const listing = await YourListing.query().findById(listingId);
        if (!listing) {
          errors.push({ listingId, error: 'Listing not found' });
          continue;
        }

        const result = await PriceCheckService.checkPrice(
          listingId,
          listing.title,
          parseFloat(listing.currentPrice),
          forceRefresh
        );

        // Calculate suggested price
        let suggestedPrice = null;
        if (result.metrics?.median) {
          suggestedPrice = Math.round(result.metrics.median * 0.95 * 100) / 100;
        }

        results.push({
          listingId,
          title: listing.title,
          currentPrice: parseFloat(listing.currentPrice),
          verdict: result.metrics?.verdict,
          marketMedian: result.metrics?.median,
          suggestedPrice,
          cached: result.cached,
        });

        // Small delay between requests to be nice to eBay
        if (!result.cached) {
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
      } catch (err) {
        errors.push({ listingId, error: err.message });
      }
    }

    return res.json({
      success: true,
      processed: results.length,
      errors: errors.length,
      results,
      errorDetails: errors,
      remaining: listingIds.length - idsToProcess.length,
    });
  } catch (error) {
    console.error('Bulk price check error:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /price-check/title
 * Run price check for an arbitrary title (not tied to a listing)
 * NOTE: Must be defined before /:listingId to avoid route collision
 */
router.post('/title', async (req, res) => {
  try {
    const { title, price } = req.body;

    if (!title || !price) {
      return res.status(400).json({ success: false, error: 'title and price are required' });
    }

    const result = await PriceCheckService.checkPrice(
      null, // no listing ID
      title,
      parseFloat(price),
      true // always run fresh for ad-hoc checks
    );

    return res.json({
      success: true,
      title,
      yourPrice: parseFloat(price),
      ...result,
    });
  } catch (error) {
    console.error('Price check error:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /price-check/:listingId
 * Run price check for a specific listing
 */
router.post('/:listingId', async (req, res) => {
  try {
    const { listingId } = req.params;
    const { forceRefresh } = req.body;

    // Get the listing
    const listing = await YourListing.query().findById(listingId);
    if (!listing) {
      return res.status(404).json({ success: false, error: 'Listing not found' });
    }

    const result = await PriceCheckService.checkPrice(
      listingId,
      listing.title,
      parseFloat(listing.currentPrice),
      forceRefresh
    );

    return res.json({
      success: true,
      listingId,
      title: listing.title,
      yourPrice: parseFloat(listing.currentPrice),
      ...result,
    });
  } catch (error) {
    console.error('Price check error:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /price-check/history/:listingId
 * Get price check history for a listing
 */
router.get('/history/:listingId', async (req, res) => {
  try {
    const { listingId } = req.params;
    const PriceCheck = require('../models/PriceCheck');

    const history = await PriceCheck.query()
      .where('listingId', listingId)
      .orderBy('checkedAt', 'desc')
      .limit(10);

    return res.json({
      success: true,
      history,
    });
  } catch (error) {
    console.error('Price check history error:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /price-check/cron
 * Manually trigger the price check cron job
 * Query params: batchSize (default: 15)
 */
router.post('/cron', async (req, res) => {
  try {
    const { batchSize = 15 } = req.body;
    log.info({ batchSize }, 'Manually triggering price check cron');

    const runner = new PriceCheckCronRunner();

    // Run in background, don't await
    runner.work({ batchSize: parseInt(batchSize) });

    return res.json({
      success: true,
      message: `Price check cron started with batch size ${batchSize}`,
    });
  } catch (error) {
    console.error('Price check cron trigger error:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /price-check/stats
 * Get stats on price check coverage
 */
router.get('/stats', async (req, res) => {
  try {
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const [totalListings, recentChecks, allChecks] = await Promise.all([
      YourListing.query().where('listingStatus', 'Active').count('* as count').first(),
      PriceCheck.query().where('checkedAt', '>', cutoff).distinct('listingId').count('listingId as count').first(),
      PriceCheck.query().distinct('listingId').count('listingId as count').first(),
    ]);

    const total = parseInt(totalListings?.count || 0);
    const checkedLast24h = parseInt(recentChecks?.count || 0);
    const checkedEver = parseInt(allChecks?.count || 0);

    return res.json({
      success: true,
      stats: {
        totalActiveListings: total,
        checkedLast24h,
        checkedEver,
        unchecked: total - checkedEver,
        stale: checkedEver - checkedLast24h,
        coveragePercent: total > 0 ? Math.round((checkedEver / total) * 100) : 0,
        freshPercent: total > 0 ? Math.round((checkedLast24h / total) * 100) : 0,
      },
    });
  } catch (error) {
    console.error('Price check stats error:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
```
---
## FILE: service/routes/vin.js
```javascript
'use strict';

const { log } = require('../lib/logger');
const router = require('express-promise-router')();
const { database } = require('../database/database');
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const { extractPartNumbers: piExtractPNs, vehicleYearMatchesPart: piYearMatch } = require('../utils/partIntelligence');

function formatEngineStr(displacement, cylinders) {
  if (!displacement) return null;
  const d = parseFloat(displacement);
  let e = (!isNaN(d) ? d.toFixed(1) : displacement) + 'L';
  const c = parseInt(cylinders);
  if (c >= 2 && c <= 16) {
    const label = c <= 4 ? '4-cyl' : c === 5 ? '5-cyl' : c === 6 ? 'V6' : c === 8 ? 'V8' : c === 10 ? 'V10' : c === 12 ? 'V12' : c + '-cyl';
    e += ' ' + label;
  }
  return e;
}

// Multer-free: read raw body as base64 from multipart form data
// Assumption: body-parser is configured with 50mb limit in index.js

/**
 * POST /vin/decode-photo
 * Accepts JSON body: { image: "base64-encoded-jpeg" }
 * Calls Claude Vision API via raw fetch (no SDK dependency).
 */
router.post('/decode-photo', async (req, res) => {
  try {
    const imageBase64 = req.body?.image;
    if (!imageBase64 || imageBase64.length < 1000) {
      return res.status(400).json({ error: 'No image provided or image too small (' + (imageBase64?.length || 0) + ' chars)' });
    }
    if (imageBase64.length > 2000000) {
      return res.status(400).json({ error: 'Image too large — max 2MB base64' });
    }
    log.info({ imageSize: imageBase64.length }, 'VIN photo received');

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured' });
    }

    // Call Claude Vision via raw fetch (avoids SDK dependency issues)
    const fetchRes = await axios.post('https://api.anthropic.com/v1/messages', {
      model: 'claude-sonnet-4-20250514',
      max_tokens: 200,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: imageBase64 } },
          { type: 'text', text: 'Read the Vehicle Identification Number (VIN) from this photo. The photo may have glare, be at an angle, dirty, or partially obscured. A VIN is exactly 17 characters — letters and numbers only. VINs never contain I, O, or Q. If a character is unclear, use VIN rules to determine the most likely character. Common misreads: 0/O/D, 1/I/L, 5/S, 8/B. Return ONLY the 17-character VIN string. If unreadable, return UNREADABLE.' }
        ]
      }]
    }, {
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      timeout: 30000,
    });

    const text = fetchRes.data?.content?.[0]?.text?.trim() || '';
    log.info({ rawResponse: text }, 'Claude Vision response');

    // Extract 17-char VIN from response
    const vinMatch = text.match(/[A-HJ-NPR-Z0-9]{17}/i);
    let vin = vinMatch ? vinMatch[0].toUpperCase() : text.replace(/[^A-HJ-NPR-Z0-9?]/gi, '').toUpperCase();

    if (vin === 'UNREADABLE' || vin.length < 14) {
      return res.json({ success: true, vin: 'UNREADABLE' });
    }
    if (vin.includes('?')) {
      return res.json({ success: true, vin, partial: true });
    }

    // Step 2: Check vin_cache first
    let decoded = null;
    let matchedVehicle = null;

    try {
      const cached = await database('vin_cache').where('vin', vin).first();
      if (cached) {
        decoded = {
          year: cached.year, make: cached.make, model: cached.model,
          engine: cached.engine, bodyStyle: cached.body_style,
        };
      }
    } catch (e) {
      // vin_cache table may not exist yet
    }

    // Step 3: If not cached, call NHTSA
    if (!decoded) {
      const nhtsaRes = await axios.get(
        `https://vpic.nhtsa.dot.gov/api/vehicles/decodevin/${vin}?format=json`,
        { timeout: 10000 }
      );

      const results = nhtsaRes.data?.Results || [];
      const getValue = (varId) => {
        const item = results.find(r => r.VariableId === varId);
        return (item && item.Value && item.Value.trim()) || null;
      };

      decoded = {
        year: getValue(29) ? parseInt(getValue(29)) : null,
        make: getValue(26),
        model: getValue(28),
        engine: [getValue(13), getValue(71)].filter(Boolean).join(' ') || null, // displacement + cylinders
        bodyStyle: getValue(5),
      };

      // Cache the result
      try {
        await database('vin_cache').insert({
          vin,
          year: decoded.year,
          make: decoded.make,
          model: decoded.model,
          engine: decoded.engine,
          body_style: decoded.bodyStyle,
          raw_nhtsa: JSON.stringify(nhtsaRes.data?.Results || []),
          decoded_at: new Date(),
          createdAt: new Date(),
        });
      } catch (e) {
        // Ignore duplicate or table-not-exists errors
        log.warn({ err: e.message }, 'vin_cache insert failed');
      }
    }

    // Step 4: Try to match against yard vehicles
    if (decoded.year && decoded.make && decoded.model) {
      try {
        const match = await database('yard_vehicle')
          .where('active', true)
          .where('year', String(decoded.year))
          .whereRaw('UPPER(make) = ?', [decoded.make.toUpperCase()])
          .whereRaw('UPPER(model) LIKE ?', ['%' + decoded.model.toUpperCase() + '%'])
          .first();
        if (match) matchedVehicle = match.id;
      } catch (e) {
        // Ignore
      }
    }

    res.json({ success: true, vin, decoded, matchedVehicle });
  } catch (err) {
    log.error({ err }, 'VIN decode failed');
    res.status(500).json({ success: false, error: err.message });
  }
});

// Image is now sent as JSON base64, no multipart parsing needed

/**
 * POST /vin/scan
 * Full VIN decode with parts intelligence. Used by the standalone VIN scanner page.
 * Body: { vin: "...", source: "manual"|"camera", scannedBy: "..." }
 */
router.post('/scan', async (req, res) => {
  try {
    let { vin, source, scannedBy } = req.body || {};
    if (!vin || vin.length < 11) return res.status(400).json({ error: 'Valid VIN required (11-17 chars)' });
    vin = vin.trim().toUpperCase().replace(/[^A-HJ-NPR-Z0-9]/g, '');

    // --- Step 1: Decode via cache or NHTSA ---
    let decoded = null;
    let rawResults = null;

    try {
      const cached = await database('vin_cache').where('vin', vin).first();
      if (cached) {
        decoded = {
          year: cached.year, make: cached.make, model: cached.model,
          trim: cached.trim, engine: cached.engine, drivetrain: cached.drivetrain,
          bodyStyle: cached.body_style,
        };
        if (cached.raw_nhtsa) {
          try { rawResults = JSON.parse(cached.raw_nhtsa); } catch (e) {}
        }
      }
    } catch (e) { /* table may not exist */ }

    if (!decoded) {
      const nhtsaRes = await axios.get(
        `https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVin/${vin}?format=json`,
        { timeout: 10000 }
      );
      rawResults = nhtsaRes.data?.Results || [];
      const get = (varId) => {
        const item = rawResults.find(r => r.VariableId === varId);
        const val = item?.Value?.trim();
        return (val && val !== '' && val !== 'Not Applicable') ? val : null;
      };

      const displacement = get(13);
      const cylinders = get(71);
      const engine = formatEngineStr(displacement, cylinders);

      const fuelType = get(24);
      let engineType = 'Gas';
      if (fuelType) {
        const ft = fuelType.toLowerCase();
        if (ft.includes('diesel')) engineType = 'Diesel';
        else if (ft.includes('hybrid')) engineType = 'Hybrid';
        else if (ft.includes('electric') && !ft.includes('hybrid')) engineType = 'Electric';
        else if (ft.includes('flex')) engineType = 'Flex Fuel';
      }

      const driveType = get(15);
      let drivetrain = null;
      if (driveType) {
        const dt = driveType.toUpperCase();
        if (dt.includes('4WD') || dt.includes('4X4') || dt.includes('4-WHEEL')) drivetrain = '4WD';
        else if (dt.includes('AWD') || dt.includes('ALL-WHEEL') || dt.includes('ALL WHEEL')) drivetrain = 'AWD';
        else if (dt.includes('FWD') || dt.includes('FRONT-WHEEL') || dt.includes('FRONT WHEEL')) drivetrain = 'FWD';
        else if (dt.includes('RWD') || dt.includes('REAR-WHEEL') || dt.includes('REAR WHEEL')) drivetrain = 'RWD';
      }

      decoded = {
        year: get(29) ? parseInt(get(29)) : null,
        make: get(26), model: get(28), trim: get(38),
        engine, engineType, drivetrain,
        bodyStyle: get(5), plantCity: get(31), plantCountry: get(75),
        paintCode: null, // NHTSA doesn't provide paint code
      };

      // Cache it
      try {
        await database('vin_cache').insert({
          vin, year: decoded.year, make: decoded.make, model: decoded.model,
          trim: decoded.trim, engine: decoded.engine, drivetrain: decoded.drivetrain,
          body_style: decoded.bodyStyle, raw_nhtsa: JSON.stringify(rawResults),
          decoded_at: new Date(), createdAt: new Date(),
        }).onConflict('vin').ignore();
      } catch (e) { /* ignore */ }
    }

    // Extract extra fields from raw NHTSA if available
    if (rawResults && !decoded.engineType) {
      const get = (varId) => {
        const item = rawResults.find(r => r.VariableId === varId);
        const val = item?.Value?.trim();
        return (val && val !== '' && val !== 'Not Applicable') ? val : null;
      };
      const fuelType = get(24);
      decoded.engineType = 'Gas';
      if (fuelType) {
        const ft = fuelType.toLowerCase();
        if (ft.includes('diesel')) decoded.engineType = 'Diesel';
        else if (ft.includes('hybrid')) decoded.engineType = 'Hybrid';
        else if (ft.includes('electric')) decoded.engineType = 'Electric';
      }
      if (!decoded.plantCity) decoded.plantCity = get(31);
      if (!decoded.plantCountry) decoded.plantCountry = get(75);
    }

    // --- Step 2: Parts Intelligence (3 separate sections) ---
    const make = decoded.make;
    const fullModel = decoded.model;
    const year = decoded.year;

    // Strip NHTSA model to base name: "Tacoma Access Cab" → "Tacoma", "Camry LE" → "Camry"
    // Keep compound models like "Grand Cherokee", "CR-V", "RAV4", "4Runner"
    const baseModel = extractBaseModel(fullModel);
    log.info({ make, fullModel, baseModel, year }, 'VIN scan: searching with base model');

    let salesHistory = [];  // YOUR SALES HISTORY
    let currentStock = [];  // YOUR CURRENT STOCK
    let marketRef = [];     // MARKET REFERENCE (competitors)

    if (make && baseModel) {
      // 2a: YourSale — parts we've SOLD for this vehicle
      try {
        const sales = await database('YourSale')
          .whereNotNull('title')
          .whereRaw('"title" ILIKE ?', [`%${make}%`])
          .whereRaw('"title" ILIKE ?', [`%${baseModel}%`])
          .select('title', 'salePrice', 'soldDate')
          .orderBy('soldDate', 'desc');

        const byType = {};
        for (const sale of sales) {
          const pt = detectPartTypeForVin(sale.title);
          if (!byType[pt]) byType[pt] = { partType: pt, sold: 0, salesData: [], lastSoldDate: null, titles: [] };
          byType[pt].sold++;
          byType[pt].salesData.push({ price: parseFloat(sale.salePrice) || 0, soldDate: sale.soldDate });
          if (!byType[pt].lastSoldDate && sale.soldDate) byType[pt].lastSoldDate = sale.soldDate;
          if (byType[pt].titles.length < 2) byType[pt].titles.push(sale.title);
        }
        for (const [pt, data] of Object.entries(byType)) {
          const avg = vinWeightedAvg(data.salesData);
          salesHistory.push({
            partType: pt, sold: data.sold, avgPrice: avg, lastSoldDate: data.lastSoldDate,
            sampleTitle: data.titles[0] || null,
            color: avg >= 300 ? 'green' : avg >= 200 ? 'yellow' : avg >= 100 ? 'orange' : 'red',
          });
        }
        salesHistory.sort((a, b) => b.avgPrice - a.avgPrice);
      } catch (e) {
        log.warn({ err: e.message, make, model }, 'VIN scan: YourSale query failed');
      }

      // 2b: YourListing — parts we currently HAVE IN STOCK
      // TODO: Use partIntelligence.countStock() instead of ILIKE for PN-first matching
      try {
        const listings = await database('YourListing')
          .whereNotNull('title')
          .where('listingStatus', 'Active')
          .whereRaw('"title" ILIKE ?', [`%${make}%`])
          .whereRaw('"title" ILIKE ?', [`%${baseModel}%`])
          .select('title', 'currentPrice', 'quantityAvailable', 'sku');

        const byType = {};
        for (const l of listings) {
          const pt = detectPartTypeForVin(l.title);
          if (!byType[pt]) byType[pt] = { partType: pt, inStock: 0, totalPrice: 0, listings: [] };
          byType[pt].inStock += parseInt(l.quantityAvailable) || 1;
          byType[pt].totalPrice += parseFloat(l.currentPrice) || 0;
          if (byType[pt].listings.length < 3) byType[pt].listings.push({
            title: l.title, price: parseFloat(l.currentPrice) || 0, sku: l.sku,
          });
        }
        for (const [pt, data] of Object.entries(byType)) {
          const avg = data.listings.length > 0 ? Math.round(data.totalPrice / data.listings.length) : 0;
          currentStock.push({
            partType: pt, inStock: data.inStock, avgPrice: avg, listings: data.listings,
            color: avg >= 300 ? 'green' : avg >= 200 ? 'yellow' : avg >= 100 ? 'orange' : 'red',
          });
        }
        currentStock.sort((a, b) => b.avgPrice - a.avgPrice);
      } catch (e) {
        log.warn({ err: e.message, make, model }, 'VIN scan: YourListing query failed');
      }

      // 2c: Item table — specific parts with verdicts, rebuild separated
      try {
        let items = [];
        // Auto+AIC join with ±1 year range
        if (year) {
          items = await database('Auto')
            .join('AutoItemCompatibility', 'Auto.id', 'AutoItemCompatibility.autoId')
            .join('Item', 'AutoItemCompatibility.itemId', 'Item.id')
            .whereRaw('"Auto"."year"::int >= ? AND "Auto"."year"::int <= ?', [year - 1, year + 1])
            .whereRaw('UPPER("Auto"."make") = ?', [make.toUpperCase()])
            .whereRaw('UPPER(REPLACE(REPLACE("Auto"."model", \'-\', \'\'), \' \', \'\')) = UPPER(REPLACE(REPLACE(?, \'-\', \'\'), \' \', \'\'))', [baseModel])
            .where('Item.price', '>', 0)
            .select('Item.title', 'Item.price', 'Item.seller', 'Item.manufacturerPartNumber', 'Item.isRepair')
            .orderBy('Item.price', 'desc')
            .limit(200);
        }
        // Fallback for sparse results on newer vehicles: title ILIKE with year range
        if (items.length < 5 && year) {
          const yearRange = [];
          for (let y = year - 2; y <= year + 2; y++) yearRange.push(String(y));
          const yearRegex = '(' + yearRange.join('|') + ')';
          const fallback = await database('Item')
            .where('price', '>', 0)
            .whereRaw('"title" ILIKE ?', [`%${make}%`])
            .whereRaw('"title" ILIKE ?', [`%${baseModel}%`])
            .whereRaw('"title" ~ ?', [yearRegex])
            .select('title', 'price', 'seller', 'manufacturerPartNumber', 'isRepair')
            .orderBy('price', 'desc')
            .limit(20);
          // Merge without duplicates
          const existingPNs = new Set(items.map(i => i.manufacturerPartNumber).filter(Boolean));
          for (const fb of fallback) {
            if (fb.manufacturerPartNumber && existingPNs.has(fb.manufacturerPartNumber)) continue;
            items.push(fb);
          }
        }

        // Extract vehicle engine displacement for filtering
        const vDispMatch = (decoded.engine || '').match(/(\d+\.\d)/);
        const vDisp = vDispMatch ? vDispMatch[1] : null;

        // Build sales/stock lookups
        const salesByType = {};
        for (const sh of salesHistory) salesByType[sh.partType] = { sold: sh.sold, avgPrice: sh.avgPrice };
        const stockByType = {};
        for (const cs of currentStock) stockByType[cs.partType] = cs.inStock;

        // Filter + group items by part type
        const EXCLUDED_TYPES = new Set(['XFER CASE', 'STEERING', null]);
        const byType = {};
        for (const item of items) {
          const title = item.title || '';
          const titleUpper = title.toUpperCase();
          const pt = detectPartTypeForVin(title);

          // Exclude transfer case and steering
          if (EXCLUDED_TYPES.has(pt) || titleUpper.includes('TRANSFER CASE') || titleUpper.includes('XFER CASE') ||
              titleUpper.includes('POWER STEERING') || titleUpper.includes('STEERING PUMP') || titleUpper.includes('STEERING RACK')) continue;

          // Year range check: parse years from title and check vehicle fits
          if (year) {
            const rangeMatch = titleUpper.match(/\b((?:19|20)?\d{2})\s*[-–]\s*((?:19|20)?\d{2})\b/);
            if (rangeMatch) {
              let y1 = parseInt(rangeMatch[1]), y2 = parseInt(rangeMatch[2]);
              if (y1 < 100) y1 += y1 >= 70 ? 1900 : 2000;
              if (y2 < 100) y2 += y2 >= 70 ? 1900 : 2000;
              if (y1 > y2) { const tmp = y1; y1 = y2; y2 = tmp; }
              if (year < y1 || year > y2) continue;
            }
            const singleYears = titleUpper.match(/\b((?:19|20)\d{2})\b/g);
            if (singleYears && singleYears.length === 1 && !rangeMatch) {
              const partYear = parseInt(singleYears[0]);
              if (Math.abs(year - partYear) > 2) continue;
            }
          }

          // Engine displacement mismatch
          if (vDisp) {
            const pDispMatch = titleUpper.match(/(\d+\.\d)L/);
            if (pDispMatch && pDispMatch[1] !== vDisp) continue;
          }

          const isRebuild = item.seller === 'pro-rebuild' || item.isRepair === true;
          const key = pt + (isRebuild ? '_rebuild' : '');
          if (!byType[key]) byType[key] = { partType: pt, isRebuild, items: [], totalPrice: 0 };
          byType[key].items.push({
            title, price: parseFloat(item.price) || 0,
            seller: item.seller, partNumber: item.manufacturerPartNumber,
          });
          byType[key].totalPrice += parseFloat(item.price) || 0;
        }

        for (const [key, data] of Object.entries(byType)) {
          const avg = data.items.length > 0 ? Math.round(data.totalPrice / data.items.length) : 0;
          const yourSold = salesByType[data.partType]?.sold || 0;
          const yourAvg = salesByType[data.partType]?.avgPrice || 0;
          const inStock = stockByType[data.partType] || 0;
          let verdict = 'SKIP';
          if (!data.isRebuild) {
            if (inStock === 0 && yourSold >= 2) verdict = 'PULL';
            else if (inStock === 0 && yourSold >= 1) verdict = 'WATCH';
            else if (inStock <= 2 && yourSold >= 3) verdict = 'WATCH';
          }
          const colorPrice = yourAvg > 0 ? yourAvg : avg;
          marketRef.push({
            partType: data.partType, count: data.items.length, avgPrice: avg,
            yourSold, yourAvg, inStock, verdict, isRebuild: data.isRebuild,
            partNumbers: [...new Set(data.items.map(i => i.partNumber).filter(Boolean))].slice(0, 5),
            sellers: [...new Set(data.items.map(i => i.seller).filter(Boolean))],
            topItems: data.items.slice(0, 3).map(i => ({ title: i.title, price: i.price, seller: i.seller, pn: i.partNumber })),
            color: colorPrice >= 300 ? 'green' : colorPrice >= 200 ? 'yellow' : colorPrice >= 100 ? 'orange' : 'red',
          });
        }
        marketRef.sort((a, b) => {
          if (a.isRebuild !== b.isRebuild) return a.isRebuild ? 1 : -1;
          return (b.yourAvg || b.avgPrice) - (a.yourAvg || a.avgPrice);
        });
      } catch (e) {
        log.warn({ err: e.message, make, baseModel }, 'VIN scan: Item query failed');
      }
    }

    // Total estimated value (from sales avg or competitor avg)
    const totalValue = salesHistory.reduce((sum, p) => sum + (p.avgPrice || 0), 0)
      || marketRef.reduce((sum, p) => sum + (p.avgPrice || 0), 0);

    // --- Step 3: Log the scan ---
    try {
      await database('vin_scan_log').insert({
        vin, year: decoded.year, make: decoded.make, model: decoded.model,
        trim: decoded.trim, engine: decoded.engine,
        engine_type: decoded.engineType, drivetrain: decoded.drivetrain,
        scanned_by: scannedBy || null, source: source || 'manual',
        scanned_at: new Date(),
      });
    } catch (e) { /* table may not exist yet */ }

    // --- Step 5: AI Research for newer vehicles with sparse data ---
    let aiResearch = null;
    const nonRebuildParts = marketRef.filter(p => !p.isRebuild).length;
    const minYear = new Date().getFullYear() - 8; // 2017+ for 2025
    if (year >= minYear && nonRebuildParts < 5 && make && baseModel) {
      try {
        // Check cache first
        let cached = null;
        try {
          cached = await database('ai_vehicle_research')
            .where({ year, make: make.toUpperCase(), model: baseModel.toUpperCase() })
            .first();
        } catch (e) { /* table may not exist */ }

        if (cached) {
          aiResearch = cached.research;
        } else {
          const apiKey = process.env.ANTHROPIC_API_KEY;
          if (apiKey) {
            const engineDesc = decoded.engine || '';
            const aiRes = await axios.post('https://api.anthropic.com/v1/messages', {
              model: 'claude-sonnet-4-20250514',
              max_tokens: 500,
              messages: [{
                role: 'user',
                content: `What used OEM parts have the highest resale value for a ${year} ${make} ${baseModel} ${engineDesc}? List the top 10 parts that sell well on eBay as used/pulled parts from junkyards. For each part include: part name, typical eBay price range, and whether it requires programming. Focus on electronic modules, sensors, and hard-to-find components. Format as a simple list.`
              }]
            }, {
              headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
              timeout: 15000,
            });
            aiResearch = aiRes.data?.content?.[0]?.text || null;

            // Cache it
            if (aiResearch) {
              try {
                await database('ai_vehicle_research').insert({
                  year, make: make.toUpperCase(), model: baseModel.toUpperCase(),
                  engine: engineDesc || null, research: aiResearch,
                });
              } catch (e) { /* cache write failure non-fatal */ }
            }
          }
        }
      } catch (e) {
        log.warn({ err: e.message }, 'AI research failed');
      }
    }

    // Limit response size to prevent mobile memory issues
    res.json({
      success: true, vin, decoded, baseModel, totalValue,
      salesHistory: salesHistory.slice(0, 15),
      currentStock: currentStock.slice(0, 15),
      marketRef: marketRef.slice(0, 20),
      aiResearch,
    });
  } catch (err) {
    log.error({ err }, 'VIN scan failed');
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /vin/history
 * Recent scan history
 */
router.get('/history', async (req, res) => {
  try {
    const { limit = 50 } = req.query;
    const scans = await database('vin_scan_log')
      .orderBy('scanned_at', 'desc')
      .limit(parseInt(limit))
      .select('*');
    res.json({ success: true, scans });
  } catch (err) {
    res.json({ success: true, scans: [] });
  }
});

/**
 * Recency-weighted avg price. Recent sales count more.
 */
function vinWeightedAvg(sales) {
  if (!sales || sales.length === 0) return 0;
  let ws = 0, wt = 0;
  for (const s of sales) {
    const d = s.soldDate ? Math.floor((Date.now() - new Date(s.soldDate).getTime()) / 86400000) : 999;
    const w = d <= 30 ? 1.0 : d <= 90 ? 0.75 : d <= 180 ? 0.5 : 0.25;
    ws += (s.price || 0) * w;
    wt += w;
  }
  return wt > 0 ? Math.round(ws / wt) : 0;
}

/**
 * Extract base model from NHTSA full model string.
 * "Tacoma Access Cab" → "Tacoma"
 * "Camry LE" → "Camry"
 * "Grand Cherokee" → "Grand Cherokee"
 * "CR-V" → "CR-V"
 * "RAV4" → "RAV4"
 * "Ram 1500" → "Ram 1500"
 */
function extractBaseModel(model) {
  if (!model) return null;
  const m = model.trim();

  // Known compound models — keep as-is
  const compounds = ['Grand Cherokee','Grand Caravan','Town & Country','Town and Country',
    'Land Cruiser','Ram 1500','Ram 2500','Ram 3500','CR-V','CX-5','CX-9','HR-V',
    'RAV4','4Runner','MR2','RX-8','FR-S','BR-Z','WR-X','NX 200','RX 350',
    'IS 250','GS 350','ES 350','CT 200','LS 460','GX 460','LX 570',
    'Q50','Q60','QX60','QX80','G35','G37','M35','M37','FX35','FX45',
    'MKX','MKZ','MKS','MKC','MKT','GL450','ML350','GLE 350','GLC 300',
    'C 300','E 350','S 550','CLA 250','GLA 250','GLK 350',
    'X5','X3','X1','Z4','M3','M5'];

  for (const c of compounds) {
    if (m.toUpperCase().startsWith(c.toUpperCase())) return c;
  }

  // Trim suffixes: "Tacoma Access Cab" → "Tacoma", "Camry LE" → "Camry"
  // Keep first word, plus second word if it's a number (e.g. "Ram 1500", "F-150")
  const words = m.split(/\s+/);
  if (words.length === 1) return words[0];

  // If second word is a number/trim code, keep both: "Silverado 1500", "F-150"
  if (/^\d/.test(words[1]) || /^[A-Z]-?\d/.test(words[1])) {
    return words.slice(0, 2).join(' ');
  }

  // If second word is a known trim/body suffix, drop it
  const trimSuffixes = ['LE','SE','XLE','XSE','SR','SR5','LX','EX','DX','SX','LT','LS','SS',
    'SXT','RT','GT','SL','SV','S','Limited','Platinum','Premium','Sport','Base',
    'Touring','Laredo','Overland','Trailhawk','Sahara','Rubicon','Willys',
    'Access','Double','Crew','Regular','Cab','Extended','SuperCrew','SuperCab',
    'Sedan','Coupe','Hatchback','Wagon','Convertible','Van','Cargo','Passenger',
    'Short','Long','Bed','Box','4dr','2dr','4D','2D'];

  if (trimSuffixes.some(s => words[1].toUpperCase() === s.toUpperCase())) {
    return words[0];
  }

  // Default: keep first word only
  return words[0];
}

function detectPartTypeForVin(title) {
  const t = (title || '').toUpperCase();
  if (t.includes('TCM') || t.includes('TCU') || t.includes('TRANSMISSION CONTROL')) return 'TCM';
  if (t.includes('BCM') || t.includes('BODY CONTROL')) return 'BCM';
  if (t.includes('ECM') || t.includes('ECU') || t.includes('PCM') || t.includes('ENGINE CONTROL') || t.includes('ENGINE COMPUTER')) return 'ECM';
  if (t.includes('ABS') || t.includes('ANTI LOCK') || t.includes('ANTI-LOCK') || t.includes('BRAKE MODULE')) return 'ABS';
  if (t.includes('TIPM') || t.includes('FUSE BOX') || t.includes('JUNCTION') || t.includes('RELAY BOX') || t.includes('IPDM')) return 'TIPM';
  if (t.includes('AMPLIFIER') || t.includes('BOSE') || t.includes('HARMAN') || t.includes('ALPINE') || t.includes('JBL')) return 'AMP';
  if (t.includes('CLUSTER') || t.includes('SPEEDOMETER') || t.includes('INSTRUMENT') || t.includes('GAUGE')) return 'CLUSTER';
  if (t.includes('RADIO') || t.includes('HEAD UNIT') || t.includes('INFOTAINMENT') || t.includes('STEREO')) return 'RADIO';
  if (t.includes('THROTTLE')) return 'THROTTLE';
  if (t.includes('TRANSFER CASE') || t.includes('XFER CASE')) return null; // excluded
  if (t.includes('STEERING') || t.includes('EPS') || t.includes('POWER STEERING')) return null; // excluded
  if (t.includes('WINDOW') && t.includes('REGULATOR')) return 'REGULATOR';
  if (t.includes('MIRROR')) return 'MIRROR';
  return 'OTHER';
}

module.exports = router;
```
---
## FILE: service/routes/listing-tool.js
```javascript
'use strict';

const router = require('express-promise-router')();
const axios = require('axios');
const cheerio = require('cheerio');
const { database } = require('../database/database');
const { normalizePartNumber } = require('../lib/partNumberUtils');
const { v4: uuidv4 } = require('uuid');

const ListingIntelligenceService = require('../services/ListingIntelligenceService');

const EBAY_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml',
  'Accept-Language': 'en-US,en;q=0.9',
  'Accept-Encoding': 'gzip, deflate, br',
};

/**
 * GET /api/listing-tool/ebay-lookup?url=https://www.ebay.com/itm/12345
 * Fetches a single eBay listing and returns structured data.
 */
router.get('/ebay-lookup', async (req, res) => {
  const { url } = req.query;
  if (!url || !url.includes('ebay.com/itm/')) {
    return res.status(400).json({ success: false, error: 'Valid eBay listing URL required (ebay.com/itm/...)' });
  }

  try {
    const { data: html } = await axios.get(url, { headers: EBAY_HEADERS, timeout: 15000 });
    const $ = cheerio.load(html);

    // Title
    const title = $('h1.x-item-title__mainTitle span').text().trim()
      || $('h1[itemprop="name"]').text().trim()
      || $('h1').first().text().trim();

    // Price
    const priceText = $('.x-price-primary span').first().text().trim()
      || $('[itemprop="price"]').attr('content')
      || '';
    const price = parseFloat(priceText.replace(/[^0-9.]/g, '')) || null;

    // Item ID from URL
    const itemIdMatch = url.match(/\/itm\/(\d+)/);
    const itemId = itemIdMatch ? itemIdMatch[1] : null;

    // Seller
    const seller = $('a.ux-seller-section__item--link span').first().text().trim()
      || $('[data-testid="str-title"] a').text().trim()
      || '';

    // Condition
    const condition = $('.x-item-condition-value span').first().text().trim()
      || $('[data-testid="item-condition-value"]').text().trim()
      || '';

    // Item specifics
    const itemSpecifics = {};
    $('.ux-labels-values').each((_, el) => {
      const label = $(el).find('.ux-labels-values__labels').text().trim().replace(/:$/, '');
      const value = $(el).find('.ux-labels-values__values').text().trim();
      if (label && value && label !== 'Condition') itemSpecifics[label] = value;
    });
    // Fallback
    if (Object.keys(itemSpecifics).length === 0) {
      $('[data-testid="ux-labels-values"]').each((_, el) => {
        const label = $(el).find('[data-testid="ux-labels-values-label"]').text().trim().replace(/:$/, '');
        const value = $(el).find('[data-testid="ux-labels-values-value"]').text().trim();
        if (label && value) itemSpecifics[label] = value;
      });
    }

    const partNumber = itemSpecifics['Manufacturer Part Number']
      || itemSpecifics['OE/OEM Part Number']
      || itemSpecifics['OEM Part Number']
      || null;

    // Compatibility table
    const compatibility = [];
    $('table tr').each((i, el) => {
      const cells = $(el).find('td');
      if (cells.length >= 3) {
        const year = $(cells[0]).text().trim();
        const make = $(cells[1]).text().trim();
        const model = $(cells[2]).text().trim();
        if (!year || year === 'Year' || !make) return;
        compatibility.push({
          year, make, model,
          trim: cells.length > 3 ? $(cells[3]).text().trim() : '',
          engine: cells.length > 4 ? $(cells[4]).text().trim() : '',
        });
      }
    });

    // Description from iframe
    let description = '';
    const descFrame = $('#desc_ifr').attr('src') || $('iframe[id*="desc"]').attr('src');
    if (descFrame) {
      try {
        const descUrl = descFrame.startsWith('http') ? descFrame : `https:${descFrame}`;
        const { data: descHtml } = await axios.get(descUrl, { timeout: 10000, headers: { 'User-Agent': 'Mozilla/5.0' } });
        const $d = cheerio.load(descHtml);
        description = $d('body').text().trim().substring(0, 2000);
      } catch (e) { /* optional */ }
    }

    res.json({
      success: true,
      data: {
        title, price, itemId, condition, seller, partNumber,
        compatibility: compatibility.slice(0, 50),
        itemSpecifics,
        description: description.substring(0, 2000),
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, error: `Failed to fetch listing: ${err.message}` });
  }
});

/**
 * GET /api/listing-tool/parts-lookup?partNumber=68212710AC
 * Check if we have fitment data for this part number.
 * Priority: part_fitment_cache > fitment_data > Item+Auto JOIN
 */
router.get('/parts-lookup', async (req, res) => {
  const { partNumber } = req.query;
  if (!partNumber) return res.status(400).json({ success: false, error: 'partNumber required' });

  const pnBase = normalizePartNumber(partNumber.trim());

  try {
    // 1. Check part_fitment_cache (our confirmed lister data)
    try {
      const cached = await database('part_fitment_cache')
        .where('part_number_base', pnBase)
        .orWhere('part_number_exact', partNumber.trim().toUpperCase())
        .first();
      if (cached) {
        return res.json({ success: true, source: 'cache', data: cached });
      }
    } catch (e) { /* table may not exist yet */ }

    // 2. Check fitment_data (partsLookup legacy)
    try {
      const fd = await database('fitment_data')
        .where('part_number', partNumber.trim())
        .orWhere('part_number_base', pnBase)
        .first();
      if (fd) {
        return res.json({ success: true, source: 'fitment_data', data: fd });
      }
    } catch (e) { /* table may not exist */ }

    // 3. Check Item + Auto + AutoItemCompatibility JOIN
    const fromItems = await database('Item as i')
      .join('AutoItemCompatibility as aic', 'aic.itemId', 'i.id')
      .join('Auto as a', 'a.id', 'aic.autoId')
      .where(function() {
        this.where('i.manufacturerPartNumber', 'ilike', `%${pnBase}%`)
          .orWhere('i.manufacturerPartNumber', 'ilike', `%${partNumber.trim()}%`);
      })
      .select('i.title', 'i.manufacturerPartNumber', 'a.year', 'a.make', 'a.model', 'a.engine', 'a.trim')
      .limit(20);

    if (fromItems.length > 0) {
      return res.json({
        success: true,
        source: 'database',
        data: { partNumber: partNumber.trim(), partNumberBase: pnBase, compatibility: fromItems },
      });
    }

    // 4. Nothing found
    return res.json({ success: true, source: 'none', data: null });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/listing-tool/save-fitment
 * Write confirmed fitment data back to the database.
 */
router.post('/save-fitment', async (req, res) => {
  const {
    partNumber, partName, partType, year, yearRange,
    make, model, engine, trim, drivetrain,
    doesNotFit, programmingRequired, programmingNote,
  } = req.body;

  if (!partNumber) return res.status(400).json({ success: false, error: 'partNumber required' });

  const pnExact = partNumber.trim().toUpperCase();
  const pnBase = normalizePartNumber(pnExact);

  try {
    // Ensure table exists
    try { await database.raw('SELECT 1 FROM part_fitment_cache LIMIT 0'); }
    catch (e) {
      await database.raw(`
        CREATE TABLE IF NOT EXISTS part_fitment_cache (
          id SERIAL PRIMARY KEY, part_number_exact VARCHAR(50) NOT NULL,
          part_number_base VARCHAR(50) NOT NULL UNIQUE, part_name TEXT,
          part_type VARCHAR(30), year INTEGER, year_range VARCHAR(20),
          make VARCHAR(50), model VARCHAR(50), engine VARCHAR(50),
          trim VARCHAR(50), drivetrain VARCHAR(30), does_not_fit TEXT,
          programming_required VARCHAR(20), programming_note TEXT,
          source VARCHAR(30) DEFAULT 'listing_tool',
          confirmed_at TIMESTAMP DEFAULT NOW(), created_at TIMESTAMP DEFAULT NOW()
        );
      `);
    }

    // Upsert
    await database.raw(`
      INSERT INTO part_fitment_cache (
        part_number_exact, part_number_base, part_name, part_type,
        year, year_range, make, model, engine, trim, drivetrain,
        does_not_fit, programming_required, programming_note,
        source, confirmed_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'listing_tool', NOW(), NOW())
      ON CONFLICT (part_number_base) DO UPDATE SET
        part_number_exact = EXCLUDED.part_number_exact,
        part_name = COALESCE(EXCLUDED.part_name, part_fitment_cache.part_name),
        part_type = COALESCE(EXCLUDED.part_type, part_fitment_cache.part_type),
        year = COALESCE(EXCLUDED.year, part_fitment_cache.year),
        year_range = COALESCE(EXCLUDED.year_range, part_fitment_cache.year_range),
        make = COALESCE(EXCLUDED.make, part_fitment_cache.make),
        model = COALESCE(EXCLUDED.model, part_fitment_cache.model),
        engine = COALESCE(EXCLUDED.engine, part_fitment_cache.engine),
        trim = COALESCE(EXCLUDED.trim, part_fitment_cache.trim),
        drivetrain = COALESCE(EXCLUDED.drivetrain, part_fitment_cache.drivetrain),
        does_not_fit = COALESCE(EXCLUDED.does_not_fit, part_fitment_cache.does_not_fit),
        programming_required = COALESCE(EXCLUDED.programming_required, part_fitment_cache.programming_required),
        programming_note = COALESCE(EXCLUDED.programming_note, part_fitment_cache.programming_note),
        source = 'listing_tool',
        confirmed_at = NOW()
    `, [
      pnExact, pnBase, partName || null, partType || null,
      year ? parseInt(year) : null, yearRange || null,
      make || null, model || null, engine || null, trim || null, drivetrain || null,
      doesNotFit || null, programmingRequired || null, programmingNote || null,
    ]);

    // Also ensure Auto + AutoItemCompatibility link exists
    if (make && model && year) {
      try {
        let auto = await database('Auto')
          .where({ year: parseInt(year), make, model })
          .first();
        if (!auto) {
          [auto] = await database('Auto')
            .insert({ id: uuidv4(), year: parseInt(year), make, model, engine: engine || '', trim: trim || '', createdAt: new Date(), updatedAt: new Date() })
            .returning('*');
        }
        if (auto) {
          const item = await database('Item')
            .where('manufacturerPartNumber', 'ilike', `%${pnBase}%`)
            .first();
          if (item) {
            const existing = await database('AutoItemCompatibility')
              .where({ autoId: auto.id, itemId: item.id }).first();
            if (!existing) {
              await database('AutoItemCompatibility')
                .insert({ autoId: auto.id, itemId: item.id, createdAt: new Date() });
            }
          }
        }
      } catch (e) { /* Auto link is optional */ }
    }

    res.json({ success: true, message: 'Fitment saved' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/listing-tool/intelligence?partNumber=56040440AC&year=2006&make=Dodge&model=Ram+1500&engine=5.7L+V8&partType=ecu
 * Aggregated intelligence from all DB sources for the listing tool.
 */
router.get('/intelligence', async (req, res) => {
  const { partNumber, year, make, model, engine, trim, partType } = req.query;
  if (!partNumber) return res.status(400).json({ success: false, error: 'partNumber required' });

  try {
    const service = new ListingIntelligenceService();
    const result = await service.getIntelligence({ partNumber, year, make, model, engine, trim, partType });
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/listing-tool/save-listing-intel
 * Persist new fitment/programming data discovered during listing generation.
 */
router.post('/save-listing-intel', async (req, res) => {
  const {
    partNumber, partName, partType, year, yearRange,
    make, model, engine, trim, drivetrain,
    doesNotFit, programmingRequired, programmingNote,
  } = req.body;

  if (!partNumber) return res.status(400).json({ success: false, error: 'partNumber required' });

  const pnExact = partNumber.trim().toUpperCase();
  const pnBase = normalizePartNumber(pnExact);

  try {
    await database.raw(`
      INSERT INTO part_fitment_cache (
        part_number_exact, part_number_base, part_name, part_type,
        year, year_range, make, model, engine, trim, drivetrain,
        does_not_fit, programming_required, programming_note,
        source, confirmed_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'listing_tool', NOW(), NOW())
      ON CONFLICT (part_number_base) DO UPDATE SET
        part_number_exact = EXCLUDED.part_number_exact,
        part_name = COALESCE(EXCLUDED.part_name, part_fitment_cache.part_name),
        part_type = COALESCE(EXCLUDED.part_type, part_fitment_cache.part_type),
        year = COALESCE(EXCLUDED.year, part_fitment_cache.year),
        year_range = COALESCE(EXCLUDED.year_range, part_fitment_cache.year_range),
        make = COALESCE(EXCLUDED.make, part_fitment_cache.make),
        model = COALESCE(EXCLUDED.model, part_fitment_cache.model),
        engine = COALESCE(EXCLUDED.engine, part_fitment_cache.engine),
        trim = COALESCE(EXCLUDED.trim, part_fitment_cache.trim),
        drivetrain = COALESCE(EXCLUDED.drivetrain, part_fitment_cache.drivetrain),
        does_not_fit = COALESCE(EXCLUDED.does_not_fit, part_fitment_cache.does_not_fit),
        programming_required = COALESCE(EXCLUDED.programming_required, part_fitment_cache.programming_required),
        programming_note = COALESCE(EXCLUDED.programming_note, part_fitment_cache.programming_note),
        source = 'listing_tool',
        confirmed_at = NOW()
    `, [
      pnExact, pnBase, partName || null, partType || null,
      year ? parseInt(year) : null, yearRange || null,
      make || null, model || null, engine || null, trim || null, drivetrain || null,
      doesNotFit || null, programmingRequired || null, programmingNote || null,
    ]);

    res.json({ success: true, message: 'Intelligence saved' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
```
---
## FILE: service/routes/opportunities.js
```javascript
'use strict';

const router = require('express-promise-router')();
const { findOpportunities, normalizeOppTitle } = require('../services/OpportunityService');
const { database } = require('../database/database');

/**
 * GET /opportunities
 * Returns scored opportunity list — parts with market demand we don't stock.
 */
router.get('/', async (req, res) => {
  try {
    const { sort = 'score', minScore = 0, partType } = req.query;
    let opportunities = await findOpportunities();

    // Filter by minimum score
    const min = parseInt(minScore) || 0;
    if (min > 0) opportunities = opportunities.filter(o => o.score >= min);

    // Filter by part type
    if (partType) {
      const pt = partType.toUpperCase();
      opportunities = opportunities.filter(o => o.partType === pt);
    }

    // Sort
    if (sort === 'price') {
      opportunities.sort((a, b) => b.marketMedian - a.marketMedian);
    } else if (sort === 'sold') {
      opportunities.sort((a, b) => b.soldCount - a.soldCount);
    } else if (sort === 'velocity') {
      opportunities.sort((a, b) => b.velocity - a.velocity);
    }
    // default: already sorted by score

    res.json({
      success: true,
      generated_at: new Date().toISOString(),
      total: opportunities.length,
      opportunities,
    });
  } catch (err) {
    console.error('Error generating opportunities:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /opportunities/dismiss
 * Dismiss an opportunity so it never reappears.
 */
router.post('/dismiss', async (req, res) => {
  try {
    const { title } = req.body;
    if (!title) return res.status(400).json({ success: false, error: 'title required' });

    const key = normalizeOppTitle(title);
    if (!key) return res.status(400).json({ success: false, error: 'title is empty after normalization' });

    await database('dismissed_opportunity')
      .insert({ opportunity_key: key, original_title: title, dismissed_at: new Date() })
      .onConflict('opportunity_key')
      .merge();

    res.json({ success: true, dismissed: key });
  } catch (err) {
    console.error('Error dismissing opportunity:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /opportunities/undismiss
 * Restore a previously dismissed opportunity.
 */
router.post('/undismiss', async (req, res) => {
  try {
    const { title } = req.body;
    if (!title) return res.status(400).json({ success: false, error: 'title required' });

    const key = normalizeOppTitle(title);
    const deleted = await database('dismissed_opportunity').where('opportunity_key', key).del();

    res.json({ success: true, undismissed: key, removed: deleted });
  } catch (err) {
    console.error('Error undismissing opportunity:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /opportunities/dismissed
 * List all dismissed opportunities.
 */
router.get('/dismissed', async (req, res) => {
  try {
    const rows = await database('dismissed_opportunity')
      .orderBy('dismissed_at', 'desc')
      .select('*');

    res.json({ success: true, total: rows.length, dismissed: rows });
  } catch (err) {
    console.error('Error fetching dismissed opportunities:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Sky Watch Research endpoints
// ---------------------------------------------------------------------------

function normalizeTitle(title) {
  if (!title) return '';
  return title.toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim();
}

function computeResearchStats(results) {
  const parts = Array.isArray(results) ? results : [];
  const partsFoundCount = parts.length;
  let totalEstimatedValue = 0;
  let highValueCount = 0;

  for (const p of parts) {
    const avg = parseFloat(p.avgPrice) || 0;
    const sold = parseInt(p.soldCount) || 0;
    totalEstimatedValue += avg;
    if (avg >= 150 && sold >= 3) highValueCount++;
  }

  return {
    total_estimated_value: Math.round(totalEstimatedValue * 100) / 100,
    parts_found_count: partsFoundCount,
    high_value_count: highValueCount,
  };
}

/**
 * GET /opportunities/research
 * Returns all sky_watch_research rows with custom sort order.
 */
router.get('/research', async (req, res) => {
  try {
    const { status } = req.query;
    let query = database('sky_watch_research').select('*');

    if (status) {
      query = query.where('status', status);
    }

    query = query.orderByRaw(`
      CASE status
        WHEN 'new' THEN 0
        WHEN 'reviewed' THEN 1
        WHEN 'marked' THEN 2
        WHEN 'dismissed' THEN 3
        ELSE 4
      END ASC,
      created_at DESC
    `);

    const rows = await query;
    res.json({ success: true, total: rows.length, research: rows });
  } catch (err) {
    console.error('Error fetching sky watch research:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /opportunities/research
 * Upsert a sky watch research entry.
 */
router.post('/research', async (req, res) => {
  try {
    const { vehicle_year, vehicle_make, vehicle_model, vehicle_engine, vehicle_trim, source, source_vin, results } = req.body;

    if (!vehicle_year || !vehicle_make || !vehicle_model || !source || !results) {
      return res.status(400).json({ success: false, error: 'vehicle_year, vehicle_make, vehicle_model, source, and results are required' });
    }

    const stats = computeResearchStats(results);

    // Auto-save rule: only save if 1+ high value parts OR 3+ total parts
    if (stats.high_value_count < 1 && stats.parts_found_count < 3) {
      return res.json({ success: true, saved: false, reason: 'too_thin', stats });
    }

    const row = {
      vehicle_year,
      vehicle_make,
      vehicle_model,
      vehicle_engine: vehicle_engine || null,
      vehicle_trim: vehicle_trim || null,
      source,
      source_vin: source_vin || null,
      results: JSON.stringify(results),
      ...stats,
      status: 'new',
      updated_at: new Date(),
    };

    // Upsert: conflict on unique(vehicle_year, vehicle_make, vehicle_model, vehicle_engine)
    const [saved] = await database('sky_watch_research')
      .insert({ ...row, created_at: new Date() })
      .onConflict(['vehicle_year', 'vehicle_make', 'vehicle_model', 'vehicle_engine'])
      .merge({
        ...row,
      })
      .returning('*');

    res.json({ success: true, saved: true, research: saved });
  } catch (err) {
    console.error('Error saving sky watch research:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /opportunities/research/:id/mark
 * Mark a single part from the research into the_mark table.
 */
router.post('/research/:id/mark', async (req, res) => {
  try {
    const { id } = req.params;
    const { partType, title, avgPrice } = req.body;

    if (!partType) return res.status(400).json({ success: false, error: 'partType required' });

    const research = await database('sky_watch_research').where('id', id).first();
    if (!research) return res.status(404).json({ success: false, error: 'research not found' });

    const normalizedTitle = normalizeTitle(`${research.vehicle_year} ${research.vehicle_make} ${research.vehicle_model} ${partType}`);
    const originalTitle = `${research.vehicle_year} ${research.vehicle_make} ${research.vehicle_model} ${partType} — avg $${avgPrice || 0}`;

    await database('the_mark')
      .insert({
        normalizedTitle,
        originalTitle: title || originalTitle,
        partType,
        medianPrice: Math.round(parseFloat(avgPrice) || 0),
        sourceSignal: 'sky_watch',
        source: 'SKY',
        markedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .onConflict('normalizedTitle')
      .merge({
        medianPrice: Math.round(parseFloat(avgPrice) || 0),
        updatedAt: new Date(),
      });

    await database('sky_watch_research').where('id', id).update({ status: 'marked', updated_at: new Date() });

    res.json({ success: true, marked: normalizedTitle });
  } catch (err) {
    console.error('Error marking from sky watch research:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /opportunities/research/:id/mark-all-high
 * Mark all high-value parts from research results at once.
 */
router.post('/research/:id/mark-all-high', async (req, res) => {
  try {
    const { id } = req.params;
    const research = await database('sky_watch_research').where('id', id).first();
    if (!research) return res.status(404).json({ success: false, error: 'research not found' });

    const results = typeof research.results === 'string' ? JSON.parse(research.results) : research.results;
    const parts = Array.isArray(results) ? results : [];

    const highValueParts = parts.filter(p => {
      const avg = parseFloat(p.avgPrice) || 0;
      const sold = parseInt(p.soldCount) || 0;
      return avg >= 150 && sold >= 3;
    });

    if (highValueParts.length === 0) {
      return res.json({ success: true, marked: 0, message: 'no high-value parts found' });
    }

    const marked = [];
    for (const p of highValueParts) {
      const partType = p.partType || p.name || 'Unknown';
      const avgPrice = parseFloat(p.avgPrice) || 0;
      const normalizedTitle = normalizeTitle(`${research.vehicle_year} ${research.vehicle_make} ${research.vehicle_model} ${partType}`);
      const originalTitle = `${research.vehicle_year} ${research.vehicle_make} ${research.vehicle_model} ${partType} — avg $${avgPrice}`;

      await database('the_mark')
        .insert({
          normalizedTitle,
          originalTitle,
          partType,
          medianPrice: Math.round(avgPrice),
          sourceSignal: 'sky_watch',
          source: 'SKY',
          markedAt: new Date(),
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        .onConflict('normalizedTitle')
        .merge({
          medianPrice: Math.round(avgPrice),
          updatedAt: new Date(),
        });

      marked.push(normalizedTitle);
    }

    await database('sky_watch_research').where('id', id).update({ status: 'marked', updated_at: new Date() });

    res.json({ success: true, marked: marked.length, titles: marked });
  } catch (err) {
    console.error('Error marking all high-value from sky watch research:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /opportunities/research/:id/review
 * Set status to reviewed.
 */
router.post('/research/:id/review', async (req, res) => {
  try {
    const { id } = req.params;
    const updated = await database('sky_watch_research')
      .where('id', id)
      .update({ status: 'reviewed', reviewed_at: new Date(), updated_at: new Date() });

    if (!updated) return res.status(404).json({ success: false, error: 'research not found' });
    res.json({ success: true, status: 'reviewed' });
  } catch (err) {
    console.error('Error reviewing sky watch research:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /opportunities/research/:id/dismiss
 * Set status to dismissed.
 */
router.post('/research/:id/dismiss', async (req, res) => {
  try {
    const { id } = req.params;
    const updated = await database('sky_watch_research')
      .where('id', id)
      .update({ status: 'dismissed', updated_at: new Date() });

    if (!updated) return res.status(404).json({ success: false, error: 'research not found' });
    res.json({ success: true, status: 'dismissed' });
  } catch (err) {
    console.error('Error dismissing sky watch research:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * DELETE /opportunities/research/:id
 * Hard delete a research entry.
 */
router.delete('/research/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const deleted = await database('sky_watch_research').where('id', id).del();

    if (!deleted) return res.status(404).json({ success: false, error: 'research not found' });
    res.json({ success: true, deleted: true });
  } catch (err) {
    console.error('Error deleting sky watch research:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
```
---
## FILE: service/index.js
```javascript
'use strict';

const { log } = require('./lib/logger');
const { Model } = require('objection');
const { database } = require('./database/database');

const schedule = require('node-schedule');
const CronWorkRunner = require('./lib/CronWorkRunner');
const PriceCheckCronRunner = require('./lib/PriceCheckCronRunner');
const path = require('path');
const express = require('express');
const bodyParser = require('body-parser');
const dotenv = require('dotenv');
dotenv.config();
const { authMiddleware } = require('./middleware/Middleware');

const app = express();
const cors = require('cors')
const compression = require('compression');
const PORT = process.env.PORT || 9000;
app.use(compression()); // gzip all responses — critical for mobile
app.use(bodyParser.json({ limit: '50mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '50mb' }));
app.use(cors());


app.get('/api/health-check', (req, res) => res.json({ ok: true, time: new Date(), env: process.env.NODE_ENV }));

// Debug: test market cache lookup for a specific key
app.get('/api/debug/market-cache', async (req, res) => {
  const { key, pn } = req.query;
  try {
    const { getCachedPrice, buildSearchQuery } = require('./services/MarketPricingService');
    const { extractPartNumbers } = require('./utils/partIntelligence');

    const results = {};

    // If PN provided, extract and look up
    if (pn) {
      const pns = extractPartNumbers(pn);
      results.extractedPNs = pns;
      if (pns.length > 0) {
        const sq = buildSearchQuery({ title: pn });
        results.searchQuery = sq;
        results.cached = await getCachedPrice(sq.cacheKey);
      }
    }

    // If key provided, look up directly
    if (key) {
      results.directLookup = await getCachedPrice(key);
    }

    // Sample from cache (correct column names)
    const sample = await database.raw('SELECT part_number_base, ebay_avg_price, ebay_sold_90d, last_updated FROM market_demand_cache ORDER BY last_updated DESC LIMIT 10');
    results.cacheSample = sample.rows;

    // Total counts
    const counts = await database.raw('SELECT COUNT(*) as total, COUNT(CASE WHEN ebay_avg_price > 0 THEN 1 END) as with_price FROM market_demand_cache');
    results.cacheStats = counts.rows[0];

    res.json(results);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.use('/items', require('./routes/items'));
app.use('/cron', require('./routes/cron'));
app.use('/autos', require('./routes/autos'));
app.use('/users', require('./routes/user'));
app.use('/filters', require('./routes/filters'));
app.use('/sync', require('./routes/sync'));
app.use('/intelligence', require('./routes/intelligence'));
app.use('/market-research', require('./routes/market-research'));
app.use('/pricing', require('./routes/pricing'));
app.use('/demand-analysis', require('./routes/demand-analysis'));
app.use('/price-check', require('./routes/price-check'));
app.use('/yards', require('./routes/yards'));
app.use('/attack-list', require('./routes/attack-list'));
app.use('/cogs', require('./routes/cogs'));
// partsLookup mounted first so its /lookup takes priority over old parts.js /lookup
app.use('/api/parts', require('./routes/partsLookup'));
app.use('/api/parts', require('./routes/parts'));
app.use('/api/parts-lookup', require('./routes/partsLookup'));
app.use('/restock', require('./routes/restockReport'));
app.use('/restock-want-list', require('./routes/restock-want-list'));
app.use('/scout-alerts', require('./routes/scout-alerts'));
app.use('/opportunities', require('./routes/opportunities'));
app.use('/api/fitment', require('./routes/fitment'));
app.use('/api/listing-tool', require('./routes/listing-tool'));
app.get('/admin/opportunities', (req, res) => {
  res.sendFile(path.resolve(__dirname, 'public', 'opportunities.html'));
});
app.get('/admin/restock', (req, res) => {
  res.sendFile(path.resolve(__dirname, 'public', 'restock.html'));
});
app.get('/admin/restock-list', (req, res) => {
  res.sendFile(path.resolve(__dirname, 'public', 'restock-list.html'));
});

// Test LKQ fetch — try both axios and curl from Railway
app.get('/api/test-lkq', async (req, res) => {
  const { execSync } = require('child_process');
  const url = 'https://www.pyp.com/inventory/raleigh-1168/';
  const results = {};

  // Test 1: curl
  try {
    const curlResult = execSync(
      `curl -s -o /dev/null -w "%{http_code}" -L --max-time 10 -H "User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" "${url}"`,
      { encoding: 'utf-8', timeout: 15000 }
    ).trim();
    results.curl_status = curlResult;
  } catch (e) {
    results.curl_error = e.message?.substring(0, 100);
  }

  // Test 2: curl with body
  try {
    const html = execSync(
      `curl -s -L --max-time 10 -H "User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" "${url}"`,
      { maxBuffer: 5 * 1024 * 1024, encoding: 'utf-8', timeout: 15000 }
    );
    results.curl_body_length = html.length;
    results.curl_has_vehicles = html.includes('pypvi_resultRow');
    results.curl_has_cf = html.includes('Just a moment');
    results.curl_title = (html.match(/<title[^>]*>([^<]*)/)||[])[1] || '';
  } catch (e) {
    results.curl_body_error = e.message?.substring(0, 100);
  }

  // Test 3: which curl
  try {
    results.curl_path = execSync('which curl 2>/dev/null || echo "not found"', { encoding: 'utf-8' }).trim();
    results.curl_version = execSync('curl --version 2>/dev/null | head -1', { encoding: 'utf-8' }).trim();
  } catch (e) {
    results.curl_path = 'error: ' + e.message?.substring(0, 50);
  }

  res.json(results);
});

// Decode all undecoded VINs in yard_vehicle
app.post('/api/decode-vins', async (req, res) => {
  try {
    const VinDecodeService = require('./services/VinDecodeService');
    const service = new VinDecodeService();
    const result = await service.decodeAllUndecoded();
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Build scrape queue from sales data
app.post('/api/build-scrape-queue', async (req, res) => {
  try {
    const { buildQueue } = require('./scripts/buildScrapeQueue');
    const result = await buildQueue();
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
app.use('/part-location', require('./routes/part-location'));
app.use('/vin', require('./routes/vin'));
app.use('/stale-inventory', require('./routes/stale-inventory'));
app.use('/competitors', require('./routes/competitors'));
app.use('/trim-intelligence', require('./routes/trim-intelligence'));
app.use('/ebay-messaging', require('./routes/ebay-messaging'));
// Serve static admin tools with cache headers
app.use('/admin', express.static(path.resolve(__dirname, 'public'), {
  maxAge: '10m',  // Cache static files for 10 minutes
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.png') || filePath.endsWith('.jpg') || filePath.endsWith('.svg')) {
      res.setHeader('Cache-Control', 'public, max-age=86400'); // Images: 24h
    }
  }
}));
app.get('/admin/import', (req, res) => {
  res.sendFile(path.resolve(__dirname, 'public', 'import.html'));
});
// Attack list - public, no auth required (puller-facing)
app.get('/puller', (req, res) => {
  res.sendFile(path.resolve(__dirname, 'public', 'attack-list.html'));
});
app.get('/admin/pull', (req, res) => {
  res.sendFile(path.resolve(__dirname, 'public', 'attack-list.html'));
});
app.get('/admin/gate', (req, res) => {
  res.sendFile(path.resolve(__dirname, 'public', 'gate.html'));
});
app.get('/admin/vin', (req, res) => {
  res.sendFile(path.resolve(__dirname, 'public', 'vin-scanner.html'));
});
app.get('/admin/hunters-perch', (req, res) => {
  res.sendFile(path.resolve(__dirname, 'public', 'hunters-perch.html'));
});
app.get('/admin/phoenix', (req, res) => {
  res.sendFile(path.resolve(__dirname, 'public', 'phoenix.html'));
});
app.get('/admin/the-mark', (req, res) => {
  res.sendFile(path.resolve(__dirname, 'public', 'the-mark.html'));
});
app.get('/admin/velocity', (req, res) => {
  res.sendFile(path.resolve(__dirname, 'public', 'velocity.html'));
});
app.get('/admin/instincts', (req, res) => {
  res.sendFile(path.resolve(__dirname, 'public', 'instincts.html'));
});
app.get('/admin/prey-cycle', (req, res) => {
  res.sendFile(path.resolve(__dirname, 'public', 'prey-cycle.html'));
});
app.get('/admin/carcass', (req, res) => {
  res.sendFile(path.resolve(__dirname, 'public', 'stale-inventory.html'));
});
app.get('/admin/scout-alerts', (req, res) => {
  res.sendFile(path.resolve(__dirname, 'public', 'scout-alerts.html'));
});
app.get('/admin/alerts', (req, res) => {
  res.sendFile(path.resolve(__dirname, 'public', 'alerts.html'));
});
app.get('/admin/sales', (req, res) => {
  res.sendFile(path.resolve(__dirname, 'public', 'sales.html'));
});
app.get('/admin/competitors', (req, res) => {
  res.sendFile(path.resolve(__dirname, 'public', 'competitors.html'));
});
app.get('/admin/test', (req, res) => {
  res.sendFile(path.resolve(__dirname, 'public', 'test.html'));
});
app.get('/admin/listing-tool', (req, res) => {
  res.sendFile(path.resolve(__dirname, 'public', 'listing-tool.html'));
});
app.get('/admin/listing-tool-v2', (req, res) => {
  res.sendFile(path.resolve(__dirname, 'public', 'listing-tool-v2.html'));
});
app.get('/admin/flyway', (req, res) => {
  res.sendFile(path.resolve(__dirname, 'public', 'flyway.html'));
});
// private routes for admin only
app.use('/private', require('./routes/private'));
app.get('/test', (req, res) => {
  res.json('haribol');
});

// Market pricing batch trigger — kicks off full pricing pass in background
app.post('/api/market-price/run-batch', async (req, res) => {
  res.json({ started: true, message: 'Pricing pass started in background. Check /api/debug/full for market_demand_cache freshness.' });
  try {
    const { runPricingPass } = require('./services/MarketPricingService');
    const result = await runPricingPass();
    log.info({ result }, '[MarketPricing] Manual batch complete');
  } catch (err) {
    log.error({ err: err.message }, '[MarketPricing] Manual batch failed');
  }
});

// Market pricing test route — scrapes eBay sold comps for a single query
app.get('/api/market-price', async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  const { q } = req.query;
  if (!q) return res.status(400).json({ error: 'Provide ?q=searchquery or ?q=68163904AC' });
  try {
    const { singlePriceCheck } = require('./services/MarketPricingService');
    const result = await singlePriceCheck(q);
    res.json({ success: true, ...result });
  } catch (err) {
    log.error({ err, query: q }, 'Market price check failed');
    res.status(500).json({ error: err.message, stack: err.stack });
  }
});

// Build Auto + AutoItemCompatibility from uploaded JSON with clean _year/_make/_model
// Body: { records: [{ id, ebayId, _year, _make, _model }], clearFirst: true }
app.post('/api/build-auto-index', async (req, res) => {
  const { database } = require('./database/database');
  const { v4: uuidv4 } = require('uuid');
  try {
    const { records, clearFirst } = req.body || {};

    // If clearFirst, wipe the bad title-parsed data
    if (clearFirst) {
      await database('AutoItemCompatibility').delete();
      await database('Auto').delete();
    }

    // If no records, just return counts
    if (!records || !Array.isArray(records) || records.length === 0) {
      const ac = await database('Auto').count('* as cnt').first();
      const lc = await database('AutoItemCompatibility').count('* as cnt').first();
      return res.json({ success: true, cleared: !!clearFirst, totalAutos: parseInt(ac?.cnt||0), totalLinks: parseInt(lc?.cnt||0) });
    }

    const autoCache = {};
    let autosCreated = 0, linksCreated = 0, skipped = 0, errors = 0;

    for (const r of records) {
      const year = parseInt(r._year);
      const make = (r._make || '').trim();
      const model = (r._model || '').trim();
      const itemId = r.id;

      if (!year || year < 1990 || year > 2030 || !make || !model || !itemId) { skipped++; continue; }

      const engine = 'N/A';
      const ak = `${year}|${make}|${model}`;
      let autoId = autoCache[ak];
      if (!autoId) {
        const ex = await database('Auto').where({ year, make, model, engine }).first();
        if (ex) { autoId = ex.id; }
        else {
          autoId = uuidv4();
          try {
            await database('Auto').insert({ id: autoId, year, make, model, trim: '', engine, createdAt: new Date(), updatedAt: new Date() });
            autosCreated++;
          } catch (e) {
            const f = await database('Auto').where({ year, make, model, engine }).first();
            autoId = f?.id || autoId;
          }
        }
        autoCache[ak] = autoId;
      }

      try {
        const le = await database('AutoItemCompatibility').where({ autoId, itemId }).first();
        if (!le) {
          await database('AutoItemCompatibility').insert({ autoId, itemId, createdAt: new Date() });
          linksCreated++;
        }
      } catch (e) { errors++; }
    }

    const ac = await database('Auto').count('* as cnt').first();
    const lc = await database('AutoItemCompatibility').count('* as cnt').first();
    res.json({ success: true, processed: records.length, autosCreated, linksCreated, skipped, errors, totalAutos: parseInt(ac?.cnt||0), totalLinks: parseInt(lc?.cnt||0) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});


// Full diagnostic — raw SQL queries against production database
app.get('/api/debug/full', async (req, res) => {
  const { database } = require('./database/database');
  const results = {};
  const q = async (label, sql) => {
    try { const r = await database.raw(sql); results[label] = r.rows || r; }
    catch (e) { results[label] = { ERROR: e.message }; }
  };

  await q('all_tables', "SELECT schemaname, tablename, n_live_tup FROM pg_stat_user_tables ORDER BY n_live_tup DESC");
  await q('yard_vehicle_schema', "SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'yard_vehicle' ORDER BY ordinal_position");
  await q('yard_vehicle_sample', "SELECT * FROM yard_vehicle ORDER BY scraped_at DESC LIMIT 3");
  await q('yard_vehicle_vin_status', "SELECT COUNT(*) as total, COUNT(vin) as has_vin, SUM(CASE WHEN vin_decoded = true THEN 1 ELSE 0 END) as decoded FROM yard_vehicle");
  await q('your_sale_90d', "SELECT COUNT(*) as count, ROUND(SUM(\"salePrice\"::numeric), 2) as revenue FROM \"YourSale\" WHERE \"soldDate\" >= NOW() - INTERVAL '90 days'");
  await q('your_sale_180d', "SELECT COUNT(*) as count FROM \"YourSale\" WHERE \"soldDate\" >= NOW() - INTERVAL '180 days'");
  await q('your_sale_sample', "SELECT title, \"salePrice\", \"soldDate\" FROM \"YourSale\" ORDER BY \"soldDate\" DESC LIMIT 3");
  await q('your_listing_active', "SELECT COUNT(*) as count FROM \"YourListing\" WHERE \"listingStatus\" = 'Active'");
  await q('your_listing_sample', "SELECT title, \"currentPrice\", \"quantityAvailable\", sku FROM \"YourListing\" WHERE \"listingStatus\" = 'Active' LIMIT 3");
  await q('your_sale_schema', "SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'YourSale' ORDER BY ordinal_position");
  await q('your_listing_schema', "SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'YourListing' ORDER BY ordinal_position");
  await q('item_schema', "SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'Item' ORDER BY ordinal_position");
  await q('item_sample', "SELECT title, price, seller, \"manufacturerPartNumber\" FROM \"Item\" LIMIT 3");
  await q('platform_group_count', "SELECT COUNT(*) as count FROM platform_group");
  await q('platform_group_sample', "SELECT * FROM platform_group LIMIT 5");
  await q('platform_vehicle_count', "SELECT COUNT(*) as count FROM platform_vehicle");
  await q('platform_shared_part_count', "SELECT COUNT(*) as count FROM platform_shared_part");
  await q('mustang_sales', "SELECT title, \"salePrice\", \"soldDate\" FROM \"YourSale\" WHERE title ILIKE '%mustang%' ORDER BY \"soldDate\" DESC LIMIT 5");
  await q('mustang_stock', "SELECT title, \"currentPrice\", \"quantityAvailable\" FROM \"YourListing\" WHERE title ILIKE '%mustang%' AND \"listingStatus\" = 'Active' LIMIT 5");
  await q('dodge_ram_sales_90d', "SELECT title, \"salePrice\", \"soldDate\" FROM \"YourSale\" WHERE title ILIKE '%dodge%' AND title ILIKE '%ram%' AND \"soldDate\" >= NOW() - INTERVAL '90 days' ORDER BY \"soldDate\" DESC LIMIT 5");
  await q('auto_sample', "SELECT year, make, model, engine FROM \"Auto\" LIMIT 5");
  await q('auto_item_compat_sample', "SELECT a.year, a.make, a.model, i.title, i.price FROM \"Auto\" a JOIN \"AutoItemCompatibility\" aic ON a.id = aic.\"autoId\" JOIN \"Item\" i ON aic.\"itemId\" = i.id LIMIT 5");

  res.json(results);
});

// One-time dedup YourSale — removes duplicate ebayItemId+soldDate rows
app.post('/api/admin/dedup-sales', async (req, res) => {
  const { database } = require('./database/database');
  try {
    const before = await database.raw('SELECT COUNT(*) as count FROM "YourSale"');
    const before90 = await database.raw('SELECT COUNT(*) as count, ROUND(SUM("salePrice"::numeric),2) as revenue FROM "YourSale" WHERE "soldDate" >= NOW() - INTERVAL \'90 days\'');

    // Delete duplicates: keep the row with the smallest id (first inserted)
    // Round 1: same ebayItemId + same soldDate
    await database.raw(`
      DELETE FROM "YourSale" a USING "YourSale" b
      WHERE a.id > b.id
        AND a."ebayItemId" = b."ebayItemId"
        AND a."soldDate"::date = b."soldDate"::date
    `);
    // Round 2: same ebayItemId (item can only be sold once)
    await database.raw(`
      DELETE FROM "YourSale" a USING "YourSale" b
      WHERE a.id > b.id
        AND a."ebayItemId" = b."ebayItemId"
    `);
    // Round 3: same title + same salePrice + same soldDate (different ebayItemId but same transaction)
    const deleted = await database.raw(`
      DELETE FROM "YourSale" a USING "YourSale" b
      WHERE a.id > b.id
        AND a.title = b.title
        AND a."salePrice" = b."salePrice"
        AND a."soldDate"::date = b."soldDate"::date
    `);

    const after = await database.raw('SELECT COUNT(*) as count FROM "YourSale"');
    const after90 = await database.raw('SELECT COUNT(*) as count, ROUND(SUM("salePrice"::numeric),2) as revenue FROM "YourSale" WHERE "soldDate" >= NOW() - INTERVAL \'90 days\'');

    res.json({
      success: true,
      before: { total: before.rows[0].count, ...before90.rows[0] },
      after: { total: after.rows[0].count, ...after90.rows[0] },
      deleted: parseInt(before.rows[0].count) - parseInt(after.rows[0].count),
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Re-format engine strings for already-decoded vehicles (fix "210cyl" → "V6")
// Also retry decoding for failed VINs
app.post('/api/admin/fix-engines', async (req, res) => {
  const { database } = require('./database/database');
  try {
    // Step 1: Fix engine strings — re-parse from vin_cache for ALL decoded vehicles
    // Targets: "2.2L 170cyl" (hp not cyl), "3.5L" (missing V6), raw decimals
    const decoded = await database('yard_vehicle')
      .where('vin_decoded', true)
      .whereNotNull('vin')
      .select('id', 'vin', 'engine');

    let fixed = 0, cacheHits = 0;
    for (const v of decoded) {
      // Re-format ALL engines that are missing cylinder labels or have bad ones
      const needsFix = !v.engine || !/(V6|V8|V10|V12|4-cyl|5-cyl)/.test(v.engine) || /\d{2,3}cyl/.test(v.engine);
      if (needsFix) {
        // Look up vin_cache for raw NHTSA data to re-parse
        try {
          const cached = await database('vin_cache').where('vin', v.vin.trim().toUpperCase()).first();
          if (cached && cached.raw_nhtsa) {
            let results;
            try { results = JSON.parse(cached.raw_nhtsa); } catch(e) { continue; }
            if (!Array.isArray(results)) continue;
            const get = (varId) => { const r = results.find(x => x.VariableId === varId); const val = r?.Value?.trim(); return (val && val !== '' && val !== 'Not Applicable') ? val : null; };
            const disp = get(13), cyl = get(71);
            if (disp) {
              const dn = parseFloat(disp);
              let eng = (!isNaN(dn) ? dn.toFixed(1) : disp) + 'L';
              const cn = parseInt(cyl);
              if (cn >= 2 && cn <= 16) {
                const lb = cn <= 4 ? '4-cyl' : cn === 5 ? '5-cyl' : cn === 6 ? 'V6' : cn === 8 ? 'V8' : cn === 10 ? 'V10' : cn === 12 ? 'V12' : cn + '-cyl';
                eng += ' ' + lb;
              }
              await database('yard_vehicle').where('id', v.id).update({ engine: eng.substring(0, 50), updatedAt: new Date() });
              fixed++;
            }
            cacheHits++;
          }
        } catch (e) { /* skip */ }
      }
    }

    // Step 2: Count remaining undecoded
    const undecoded = await database('yard_vehicle')
      .whereNotNull('vin').where('vin', '!=', '')
      .where(function() { this.where('vin_decoded', false).orWhereNull('vin_decoded'); })
      .count('* as cnt').first();

    res.json({ success: true, enginesFixed: fixed, cacheChecked: cacheHits, stillUndecoded: parseInt(undecoded?.cnt || 0) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// One-time: backfill Auto table from YourSale titles
app.post('/api/admin/backfill-auto', async (req, res) => {
  const { database } = require('./database/database');
  const { v4: uuidv4 } = require('uuid');
  try {
    const MAKES = ['Acura','Audi','BMW','Buick','Cadillac','Chevrolet','Chrysler','Dodge','Fiat','Ford','Genesis','GMC','Honda','Hummer','Hyundai','Infiniti','Isuzu','Jaguar','Jeep','Kia','Land Rover','Lexus','Lincoln','Mazda','Mercedes-Benz','Mercury','Mini','Mitsubishi','Nissan','Oldsmobile','Pontiac','Porsche','Ram','Saab','Saturn','Scion','Subaru','Suzuki','Toyota','Volkswagen','Volvo'];
    const STOP = new Set(['ECU','ECM','PCM','BCM','TCM','ABS','TIPM','OEM','NEW','USED','REMAN','Engine','Body','Control','Module','Anti','Fuse','Power','Brake','Amplifier','Radio','Cluster','Steering','Throttle','Programmed','Plug','Play','AT','MT','4WD','AWD','2WD','FWD','RWD','EX','LX','DX','SE','LE','XLE','SXT','RT','GT','LT','LS','SS','SL','SV','SR','SR5','Limited','Sport','Base','Touring','Laredo','Overland','Trailhawk','Sahara','Rubicon','Premium','Platinum','Hybrid','Diesel','Hemi','Turbo','Supercharged','Sedan','Coupe','Hatchback','Wagon','Van','Cab','Crew','Access','Double','Regular','Extended','SuperCrew','SuperCab','Short','Long','Bed','4dr','2dr','V6','V8','Dodge','Chrysler','Jeep','Ford','Chevy','Toyota','Honda','Nissan','Kia','Hyundai','Lincoln','Mercury','Mazda','Subaru','BMW','Audi','Acura','Lexus','Infiniti','GMC','Buick','Cadillac','Saturn','Pontiac','Volvo','VW','Volkswagen','Mini','Scion','Ram','Mitsubishi','Isuzu','Suzuki','Fiat','Jaguar','Porsche','Saab','Genesis','Hummer','Land','Rover','Oldsmobile']);

    // Load all existing Auto year+make+model
    const existing = new Set();
    const autos = await database('Auto').select('year','make','model');
    for (const a of autos) existing.add(`${a.year}|${a.make}|${a.model}`);
    const beforeCount = existing.size;

    // Parse YourSale titles
    const sales = await database('YourSale').whereNotNull('title').select('title');
    const toInsert = new Map(); // key → {year, make, model}

    for (const sale of sales) {
      const t = sale.title || '';
      // Extract year
      const ym = t.match(/\b((?:19|20)\d{2})\b/);
      if (!ym) continue;
      const year = parseInt(ym[1]);
      if (year < 1990 || year > 2030) continue;

      // Extract make
      const tu = t.toUpperCase();
      let make = null;
      for (const mk of MAKES) {
        if (tu.includes(mk.toUpperCase())) { make = mk; break; }
      }
      if (!make) continue;
      if (make === 'Chevy') make = 'Chevrolet';
      if (make === 'VW') make = 'Volkswagen';

      // Extract model: words after make, before stop word/engine/year
      // Keep compound models (Grand Cherokee, CR-V, Ram 1500) but stop at trims
      const COMPOUNDS = new Set(['GRAND','TOWN','LAND']);
      const makeIdx = tu.indexOf(make.toUpperCase());
      const after = t.substring(makeIdx + make.length).trim().split(/\s+/);
      const mw = [];
      for (const w of after) {
        const clean = w.replace(/[^A-Za-z0-9\-]/g, '');
        if (/^\d{4}$/.test(clean) || /^\d+\.\d+[lL]?$/.test(clean)) break;
        if (STOP.has(clean) || STOP.has(clean.toUpperCase())) break;
        mw.push(clean);
        // Only take 2nd word if first is a compound prefix (Grand, Town, Land)
        if (mw.length === 1 && COMPOUNDS.has(clean.toUpperCase())) continue;
        // Also keep 2nd word if it's a number (Ram 1500, F-150)
        if (mw.length === 2 && /^\d/.test(clean)) break;
        if (mw.length >= 1 && !COMPOUNDS.has(mw[0].toUpperCase())) break;
        if (mw.length >= 2) break;
      }
      if (mw.length === 0 || mw[0].length < 2) continue;
      let model = mw.join(' ').trim();
      if (model.length < 2 || model.length > 30) continue;

      const key = `${year}|${make}|${model}`;
      if (!existing.has(key) && !toInsert.has(key)) {
        toInsert.set(key, { year: String(year), make, model });
      }
    }

    // Batch insert
    let inserted = 0, errors = 0;
    for (const [key, v] of toInsert) {
      try {
        // Double-check not exists (race condition safety)
        const ex = await database('Auto').where({ year: v.year, make: v.make, model: v.model }).first();
        if (!ex) {
          await database('Auto').insert({ id: uuidv4(), year: v.year, make: v.make, model: v.model, trim: '', engine: 'N/A', createdAt: new Date(), updatedAt: new Date() });
          inserted++;
        }
      } catch (e) { errors++; }
    }

    // Cleanup: delete bad entries from previous backfill (multi-word non-compound models)
    const VALID_COMPOUNDS = new Set(['Grand Cherokee','Grand Caravan','Grand Prix','Town & Country','Town Country','Land Cruiser','Ram 1500','Ram 2500','Ram 3500','CR-V','CX-5','CX-9','HR-V','RAV4','4Runner','F-150','F-250','F-350','Super Duty','Monte Carlo','Park Avenue','El Camino','Trans Am','Le Sabre']);
    let cleaned = 0;
    try {
      const allAutos = await database('Auto').where('engine', 'N/A').select('id', 'model');
      for (const a of allAutos) {
        if (a.model && a.model.includes(' ') && !VALID_COMPOUNDS.has(a.model)) {
          // Multi-word model that's not a known compound — delete it
          await database('Auto').where('id', a.id).delete();
          cleaned++;
        }
      }
    } catch (e) { /* ignore cleanup errors */ }

    // Direct insert of commonly missing vehicles
    const MISSING = [
      ['Honda','Civic'],['Honda','Accord'],['Honda','Odyssey'],['Honda','Prelude'],['Honda','Element'],['Honda','Fit'],['Honda','Pilot'],
      ['Toyota','Camry'],['Toyota','Corolla'],['Toyota','Tacoma'],['Toyota','Tundra'],['Toyota','4Runner'],['Toyota','Sienna'],['Toyota','Highlander'],['Toyota','Matrix'],['Toyota','Prius'],['Toyota','Avalon'],['Toyota','Celica'],
      ['Nissan','Altima'],['Nissan','Maxima'],['Nissan','Sentra'],['Nissan','Pathfinder'],['Nissan','Frontier'],['Nissan','Xterra'],['Nissan','Murano'],['Nissan','Rogue'],['Nissan','Versa'],['Nissan','Quest'],
      ['Ford','Mustang'],['Ford','Explorer'],['Ford','Expedition'],['Ford','Ranger'],['Ford','Focus'],['Ford','Taurus'],['Ford','Escape'],['Ford','Crown Victoria'],
      ['Chevrolet','Impala'],['Chevrolet','Malibu'],['Chevrolet','Cruze'],['Chevrolet','Cobalt'],['Chevrolet','Cavalier'],['Chevrolet','Monte Carlo'],['Chevrolet','Blazer'],['Chevrolet','TrailBlazer'],['Chevrolet','Colorado'],
      ['Dodge','Durango'],['Dodge','Dakota'],['Dodge','Neon'],['Dodge','Stratus'],['Dodge','Intrepid'],['Dodge','Caravan'],
      ['Hyundai','Elantra'],['Hyundai','Sonata'],['Hyundai','Tucson'],['Hyundai','Santa Fe'],['Hyundai','Accent'],
      ['Kia','Optima'],['Kia','Sorento'],['Kia','Sportage'],['Kia','Soul'],['Kia','Forte'],['Kia','Rio'],
    ];
    let directInserted = 0;
    for (const [mk, md] of MISSING) {
      for (let yr = 1995; yr <= 2025; yr++) {
        const key = `${yr}|${mk}|${md}`;
        if (!existing.has(key)) {
          try {
            const ex = await database('Auto').where({ year: String(yr), make: mk, model: md }).first();
            if (!ex) {
              await database('Auto').insert({ id: uuidv4(), year: String(yr), make: mk, model: md, trim: '', engine: 'N/A', createdAt: new Date(), updatedAt: new Date() });
              directInserted++;
            }
          } catch (e) { /* dup */ }
        }
      }
    }

    // Flush the cache so dropdowns show new data immediately
    try {
      const CacheManager = require('./middleware/CacheManager');
      const cm = new CacheManager();
      cm.flush();
    } catch (e) { /* ignore */ }

    const afterCount = await database('Auto').count('* as cnt').first();

    res.json({
      success: true,
      before: beforeCount,
      after: parseInt(afterCount?.cnt || 0),
      parsed: toInsert.size,
      inserted,
      errors,
      cleaned,
      sample: [...toInsert.values()].slice(0, 20),
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Check which eBay env vars are configured (names only, not values)
app.get('/api/debug/env-check', async (req, res) => {
  const keys = ['TRADING_API_TOKEN','TRADING_API_DEV_NAME','TRADING_API_APP_NAME','TRADING_API_CERT_NAME','FINDINGS_APP_NAME','EBAY_TOKEN','ANTHROPIC_API_KEY','DATABASE_URL'];
  const result = {};
  for (const k of keys) {
    result[k] = process.env[k] ? `SET (${process.env[k].length} chars)` : 'NOT SET';
  }
  res.json(result);
});

// Seed Florida yards if they don't exist
app.post('/api/admin/seed-florida', async (req, res) => {
  const { database } = require('./database/database');
  const results = [];
  const yards = [
    { name: 'LKQ Tampa', chain: 'LKQ', scrape_method: 'html', visit_frequency: 'road_trip', distance_from_base: 600, enabled: true, flagged: false },
    { name: 'LKQ Largo', chain: 'LKQ', scrape_method: 'html', visit_frequency: 'road_trip', distance_from_base: 610, enabled: true, flagged: false },
    { name: 'LKQ Clearwater', chain: 'LKQ', scrape_method: 'html', visit_frequency: 'road_trip', distance_from_base: 615, enabled: true, flagged: false },
  ];
  for (const yard of yards) {
    try {
      const exists = await database('yard').where('name', yard.name).first();
      if (exists) { results.push({ name: yard.name, status: 'exists', id: exists.id }); continue; }
      const inserted = await database('yard').insert({ id: database.raw('gen_random_uuid()'), ...yard, createdAt: new Date(), updatedAt: new Date() }).returning('id');
      results.push({ name: yard.name, status: 'created', id: inserted[0]?.id || inserted[0] });
    } catch (e) { results.push({ name: yard.name, status: 'error', error: e.message }); }
  }
  res.json({ success: true, results });
});

// Full raw SQL diagnostic — replaces old debug/makes
app.get('/api/debug/makes', async (req, res) => {
  const { database } = require('./database/database');
  const R = {};
  const q = async (k, sql) => { try { const r = await database.raw(sql); R[k] = r.rows || r; } catch(e) { R[k] = {ERROR: e.message}; } };
  try {
    await q('all_tables', "SELECT tablename, n_live_tup FROM pg_stat_user_tables ORDER BY n_live_tup DESC");
    await q('yard_vehicle_schema', "SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'yard_vehicle' ORDER BY ordinal_position");
    await q('yard_vehicle_sample', "SELECT * FROM yard_vehicle ORDER BY scraped_at DESC LIMIT 3");
    await q('yard_vehicle_vin_status', "SELECT COUNT(*) as total, COUNT(vin) as has_vin, SUM(CASE WHEN vin_decoded = true THEN 1 ELSE 0 END) as decoded FROM yard_vehicle");
    await q('your_sale_schema', "SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'YourSale' ORDER BY ordinal_position");
    await q('your_sale_90d', "SELECT COUNT(*) as count, ROUND(SUM(\"salePrice\"::numeric), 2) as revenue, ROUND(AVG(\"salePrice\"::numeric), 2) as avg_price FROM \"YourSale\" WHERE \"soldDate\" >= NOW() - INTERVAL '90 days'");
    await q('your_sale_180d', "SELECT COUNT(*) as count FROM \"YourSale\" WHERE \"soldDate\" >= NOW() - INTERVAL '180 days'");
    await q('your_sale_sample', "SELECT title, \"salePrice\", \"soldDate\" FROM \"YourSale\" WHERE title IS NOT NULL ORDER BY \"soldDate\" DESC LIMIT 3");
    await q('your_listing_schema', "SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'YourListing' ORDER BY ordinal_position");
    await q('your_listing_active', "SELECT COUNT(*) as count FROM \"YourListing\" WHERE \"listingStatus\" = 'Active'");
    await q('your_listing_sample', "SELECT title, \"currentPrice\", \"quantityAvailable\", sku FROM \"YourListing\" WHERE \"listingStatus\" = 'Active' LIMIT 3");
    await q('item_schema', "SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'Item' ORDER BY ordinal_position");
    await q('item_sample', "SELECT title, price, seller, \"manufacturerPartNumber\" FROM \"Item\" LIMIT 3");
    await q('platform_counts', "SELECT (SELECT COUNT(*) FROM platform_group) as groups, (SELECT COUNT(*) FROM platform_vehicle) as vehicles, (SELECT COUNT(*) FROM platform_shared_part) as shared_parts");
    await q('platform_sample', "SELECT pg.name, pg.platform, pg.year_start, pg.year_end FROM platform_group pg LIMIT 5");
    await q('mustang_sales', "SELECT title, \"salePrice\", \"soldDate\" FROM \"YourSale\" WHERE title ILIKE '%mustang%' ORDER BY \"soldDate\" DESC LIMIT 5");
    await q('mustang_stock', "SELECT title, \"currentPrice\", \"quantityAvailable\" FROM \"YourListing\" WHERE title ILIKE '%mustang%' AND \"listingStatus\" = 'Active' LIMIT 5");
    await q('dodge_ram_sales_90d', "SELECT title, \"salePrice\", \"soldDate\" FROM \"YourSale\" WHERE title ILIKE '%dodge%' AND title ILIKE '%ram%' AND \"soldDate\" >= NOW() - INTERVAL '90 days' ORDER BY \"soldDate\" DESC LIMIT 5");
    await q('auto_sample', "SELECT year, make, model, engine FROM \"Auto\" LIMIT 5");
    await q('auto_item_join', "SELECT a.year, a.make, a.model, i.title, i.price FROM \"Auto\" a JOIN \"AutoItemCompatibility\" aic ON a.id = aic.\"autoId\" JOIN \"Item\" i ON aic.\"itemId\" = i.id LIMIT 5");
    // Env var check
    const envKeys = ['TRADING_API_TOKEN','TRADING_API_DEV_NAME','TRADING_API_APP_NAME','TRADING_API_CERT_NAME','FINDINGS_APP_NAME','ANTHROPIC_API_KEY'];
    const envCheck = {};
    for (const k of envKeys) envCheck[k] = process.env[k] ? `SET (${process.env[k].length} chars)` : 'NOT SET';
    R.env_check = envCheck;
    await q('sale_by_store', "SELECT store, COUNT(*) as cnt FROM \"YourSale\" GROUP BY store ORDER BY cnt DESC");
    await q('sale_null_store', "SELECT COUNT(*) as no_store FROM \"YourSale\" WHERE store IS NULL");
    await q('sale_date_range_by_store', "SELECT store, MIN(\"soldDate\") as earliest, MAX(\"soldDate\") as latest, COUNT(*) as cnt FROM \"YourSale\" GROUP BY store ORDER BY cnt DESC");
    await q('sale_dupes', "SELECT \"ebayItemId\", \"soldDate\"::date as sold_date, COUNT(*) as dupes FROM \"YourSale\" GROUP BY \"ebayItemId\", \"soldDate\"::date HAVING COUNT(*) > 1 LIMIT 10");
    await q('sale_most_recent', "SELECT id, \"ebayItemId\", title, \"salePrice\", \"soldDate\", store, \"createdAt\" FROM \"YourSale\" ORDER BY \"createdAt\" DESC LIMIT 5");
    await q('sale_non_csv_count', "SELECT COUNT(*) as cnt FROM \"YourSale\" WHERE \"createdAt\"::text NOT LIKE '2026-03-18T23:1%' AND \"createdAt\"::text NOT LIKE '2026-03-18T23:2%'");
    await q('sale_csv_count', "SELECT COUNT(*) as cnt FROM \"YourSale\" WHERE \"createdAt\"::text LIKE '2026-03-18T23:1%' OR \"createdAt\"::text LIKE '2026-03-18T23:2%'");
    await q('sale_non_csv_date_range', "SELECT MIN(\"soldDate\") as earliest, MAX(\"soldDate\") as latest, COUNT(*) as cnt FROM \"YourSale\" WHERE \"createdAt\"::text NOT LIKE '2026-03-18T23:1%' AND \"createdAt\"::text NOT LIKE '2026-03-18T23:2%'");
    await q('sale_created_at_groups', "SELECT \"createdAt\"::date as created_date, COUNT(*) as cnt FROM \"YourSale\" GROUP BY \"createdAt\"::date ORDER BY created_date DESC LIMIT 10");
    await q('sale_overlap_count', "SELECT COUNT(*) as overlap FROM \"YourSale\" a WHERE (a.\"createdAt\"::text LIKE '2026-03-18T23:1%' OR a.\"createdAt\"::text LIKE '2026-03-18T23:2%') AND EXISTS (SELECT 1 FROM \"YourSale\" b WHERE b.\"createdAt\"::text NOT LIKE '2026-03-18T23:1%' AND b.\"createdAt\"::text NOT LIKE '2026-03-18T23:2%' AND b.\"ebayItemId\" = a.\"ebayItemId\")");
    await q('all_public_tables', "SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename");
    await q('sale_like_tables', "SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND (tablename ILIKE '%sale%' OR tablename ILIKE '%order%' OR tablename ILIKE '%sold%' OR tablename ILIKE '%transaction%')");
    await q('yoursale_latest_created', "SELECT MAX(\"createdAt\") as latest_created, MAX(\"soldDate\") as latest_sold FROM \"YourSale\"");
    await q('yard_vehicle_by_yard', "SELECT y.name, COUNT(yv.id) as total, SUM(CASE WHEN yv.active THEN 1 ELSE 0 END) as active, MAX(yv.scraped_at) as last_scraped FROM yard y LEFT JOIN yard_vehicle yv ON y.id = yv.yard_id WHERE y.enabled = true GROUP BY y.name ORDER BY y.name");
    await q('yard_status', "SELECT id, name, enabled, last_scraped, flagged, flag_reason FROM yard WHERE chain = 'LKQ' ORDER BY name");
    await q('yard_vehicle_by_yard_id', "SELECT yard_id, COUNT(*) as total, SUM(CASE WHEN active THEN 1 ELSE 0 END) as active_count, MAX(scraped_at) as last_scraped FROM yard_vehicle GROUP BY yard_id ORDER BY total DESC");
    await q('attack_list_yards', "SELECT id, name, enabled, flagged FROM yard WHERE enabled = true AND (flagged = false OR flagged IS NULL) ORDER BY name");
    await q('fl_vehicle_dates', "SELECT y.name, COUNT(*) as total, MIN(yv.date_added) as oldest_date, MAX(yv.date_added) as newest_date, COUNT(CASE WHEN yv.date_added >= NOW() - INTERVAL '7 days' THEN 1 END) as within_7d FROM yard y JOIN yard_vehicle yv ON y.id = yv.yard_id WHERE y.name IN ('LKQ Tampa','LKQ Largo','LKQ Clearwater') AND yv.active = true GROUP BY y.name");
    await q('restock_diag_sales_7d', "SELECT COUNT(*) as cnt FROM \"YourSale\" WHERE \"soldDate\" >= NOW() - INTERVAL '7 days'");
    await q('restock_diag_sales_30d', "SELECT COUNT(*) as cnt FROM \"YourSale\" WHERE \"soldDate\" >= NOW() - INTERVAL '30 days'");
    await q('restock_diag_recent_sales', "SELECT title, \"salePrice\", \"soldDate\", sku FROM \"YourSale\" WHERE \"soldDate\" IS NOT NULL ORDER BY \"soldDate\" DESC LIMIT 10");
    await q('restock_diag_active_listings', "SELECT COUNT(*) as cnt FROM \"YourListing\" WHERE \"listingStatus\" = 'Active'");
    await q('restock_diag_sku_sample', "SELECT sku, title, \"salePrice\", \"soldDate\" FROM \"YourSale\" WHERE \"soldDate\" >= NOW() - INTERVAL '7 days' AND sku IS NOT NULL AND sku != '' ORDER BY \"soldDate\" DESC LIMIT 10");
    await q('restock_diag_sku_null_pct', "SELECT COUNT(*) as total, COUNT(CASE WHEN sku IS NOT NULL AND sku != '' THEN 1 END) as has_sku, COUNT(CASE WHEN sku IS NULL OR sku = '' THEN 1 END) as no_sku FROM \"YourSale\" WHERE \"soldDate\" >= NOW() - INTERVAL '7 days'");
    await q('restock_diag_listing_sku_sample', "SELECT sku, title, \"currentPrice\", \"quantityAvailable\" FROM \"YourListing\" WHERE \"listingStatus\" = 'Active' AND sku IS NOT NULL AND sku != '' LIMIT 5");
    await q('restock_diag_part_base_fn', "SELECT part_number_base('AL3T-15604-BD') as ford, part_number_base('56044691AA') as chrysler, part_number_base('39980-TS8-A0') as honda");
    await q('restock_diag_7d_count', "SELECT COUNT(*) as total_sales FROM \"YourSale\" WHERE \"soldDate\" >= NOW() - INTERVAL '7 days'");
    await q('restock_diag_jeep_ecm_stock', "SELECT COUNT(*) as cnt, array_agg(sku) as skus FROM \"YourListing\" WHERE \"listingStatus\" = 'Active' AND (sku ILIKE '%0518731%' OR title ILIKE '%0518731%')");
    await q('restock_diag_model_extract', "SELECT title, SUBSTRING(title FROM '(?:Jeep|Dodge|Ford|Chevrolet|Chevy|Toyota|Honda)\\s+(\\w+(?:\\s+\\w+)?)') as extracted_model FROM \"YourSale\" WHERE \"soldDate\" >= NOW() - INTERVAL '7 days' AND title ILIKE '%Jeep%' LIMIT 5");
    await q('restock_diag_grouped_pre_stock', "SELECT make, part_type, base_pn, sold_7d, sample_title FROM (WITH rs AS (SELECT title, \"salePrice\"::numeric as price, CASE WHEN title ILIKE '%Jeep%' THEN 'Jeep' WHEN title ILIKE '%Dodge%' THEN 'Dodge' WHEN title ILIKE '%Ford%' THEN 'Ford' WHEN title ILIKE '%Honda%' THEN 'Honda' WHEN title ILIKE '%Toyota%' THEN 'Toyota' WHEN title ILIKE '%Chevrolet%' OR title ILIKE '%Chevy%' THEN 'Chevrolet' ELSE 'Other' END as make, CASE WHEN title ~* '\\m(ECU|ECM|PCM|engine control)\\M' THEN 'ECM' WHEN title ~* '\\m(ABS|anti.lock)\\M' THEN 'ABS' WHEN title ~* '\\m(BCM|body control)\\M' THEN 'BCM' WHEN title ~* '\\m(TIPM)\\M' THEN 'TIPM' WHEN title ~* '\\m(fuse box|junction|ipdm)\\M' THEN 'Fuse Box' WHEN title ~* '\\m(amplifier|bose|harman)\\M' THEN 'Amplifier' WHEN title ~* '\\m(radio|stereo)\\M' THEN 'Radio' ELSE 'Other' END as part_type, part_number_base(COALESCE((regexp_match(title, '\\m(\\d{8}[A-Z]{2})\\M'))[1], (regexp_match(title, '\\m([A-Z]{1,4}\\d{1,2}[A-Z]-[A-Z0-9]{4,6})\\M'))[1], (regexp_match(title, '\\m(\\d{5}-[A-Z0-9]{2,7})\\M'))[1])) as base_pn FROM \"YourSale\" WHERE \"soldDate\" >= NOW() - INTERVAL '7 days' AND title IS NOT NULL AND \"salePrice\"::numeric >= 50) SELECT make, part_type, base_pn, COUNT(*) as sold_7d, (array_agg(title))[1] as sample_title FROM rs WHERE make != 'Other' AND part_type != 'Other' GROUP BY make, part_type, base_pn ORDER BY COUNT(*) DESC LIMIT 20) sub");
    await q('restock_diag_raw_query', "SELECT make, part_type, sold_7d, stock, avg_price, action, sample_title FROM (WITH recent_sales AS (SELECT CASE WHEN title ILIKE '%Toyota%' THEN 'Toyota' WHEN title ILIKE '%Honda%' THEN 'Honda' WHEN title ILIKE '%Ford%' THEN 'Ford' WHEN title ILIKE '%Dodge%' THEN 'Dodge' WHEN title ILIKE '%Chrysler%' THEN 'Chrysler' WHEN title ILIKE '%Jeep%' THEN 'Jeep' WHEN title ILIKE '%Ram%' AND title NOT ILIKE '%Ramcharger%' THEN 'Ram' WHEN title ILIKE '%Chevrolet%' OR title ILIKE '%Chevy%' THEN 'Chevrolet' WHEN title ILIKE '%GMC%' THEN 'GMC' WHEN title ILIKE '%Nissan%' THEN 'Nissan' WHEN title ILIKE '%Hyundai%' THEN 'Hyundai' WHEN title ILIKE '%Kia%' THEN 'Kia' ELSE 'Other' END as make, CASE WHEN title ~* '\\m(TCM|TCU|transmission control)\\M' THEN 'TCM' WHEN title ~* '\\m(BCM|body control)\\M' THEN 'BCM' WHEN title ~* '\\m(ECU|ECM|PCM|engine control|engine computer)\\M' THEN 'ECM' WHEN title ~* '\\m(TIPM)\\M' THEN 'TIPM' WHEN title ~* '\\m(fuse box|junction box|ipdm|relay box)\\M' THEN 'Fuse Box' WHEN title ~* '\\m(ABS|anti.lock|brake pump)\\M' THEN 'ABS' WHEN title ~* '\\m(amplifier|bose|harman|JBL)\\M' THEN 'Amplifier' WHEN title ~* '\\m(radio|stereo|receiver)\\M' THEN 'Radio' WHEN title ~* '\\m(cluster|speedometer|gauge)\\M' THEN 'Cluster' WHEN title ~* '\\m(throttle body)\\M' THEN 'Throttle' ELSE 'Other' END as part_type, title, \"salePrice\"::numeric as price, \"soldDate\" FROM \"YourSale\" WHERE \"soldDate\" >= NOW() - INTERVAL '7 days' AND title IS NOT NULL), grouped AS (SELECT make, part_type, COUNT(*) as sold_7d, ROUND(AVG(price),2) as avg_price, (array_agg(title))[1] as sample_title FROM recent_sales WHERE make != 'Other' AND part_type != 'Other' GROUP BY make, part_type), with_stock AS (SELECT g.*, COALESCE((SELECT COUNT(*) FROM \"YourListing\" l WHERE l.\"listingStatus\" = 'Active' AND l.title ILIKE '%' || g.make || '%' AND l.title ~* (CASE g.part_type WHEN 'ECM' THEN '\\m(ECU|ECM|PCM)\\M' WHEN 'ABS' THEN '\\m(ABS|anti.lock)\\M' WHEN 'BCM' THEN '\\m(BCM|body control)\\M' WHEN 'TCM' THEN '\\m(TCM|TCU)\\M' WHEN 'TIPM' THEN '\\m(TIPM)\\M' WHEN 'Fuse Box' THEN '\\m(fuse box|junction|ipdm)\\M' WHEN 'Amplifier' THEN '\\m(amplifier|bose|harman)\\M' WHEN 'Radio' THEN '\\m(radio|stereo|receiver)\\M' WHEN 'Cluster' THEN '\\m(cluster|speedometer|gauge)\\M' WHEN 'Throttle' THEN '\\m(throttle body)\\M' ELSE g.part_type END)), 0) as stock FROM grouped g) SELECT *, CASE WHEN stock = 0 AND avg_price >= 200 THEN 'RESTOCK NOW' WHEN stock = 0 THEN 'OUT OF STOCK' WHEN stock <= 1 AND sold_7d >= 2 THEN 'LOW STOCK' ELSE 'MONITOR' END as action FROM with_stock ORDER BY avg_price DESC) sub WHERE stock <= 1 LIMIT 30");
    await q('honda_2000_with_items', "SELECT a.year, a.make, a.model, COUNT(aic.\"itemId\") as item_count FROM \"Auto\" a JOIN \"AutoItemCompatibility\" aic ON aic.\"autoId\" = a.id WHERE a.make ILIKE '%Honda%' AND a.year::text = '2000' GROUP BY a.year, a.make, a.model ORDER BY a.model");
    await q('honda_2000_auto_only', "SELECT DISTINCT a.model FROM \"Auto\" a WHERE a.make ILIKE '%Honda%' AND a.year::text = '2000' ORDER BY a.model");
    await q('honda_2000_auto_linked', "SELECT DISTINCT a.model FROM \"Auto\" a JOIN \"AutoItemCompatibility\" aic ON aic.\"autoId\" = a.id WHERE a.make ILIKE '%Honda%' AND a.year::text = '2000' ORDER BY a.model");
    await q('aic_columns', "SELECT column_name FROM information_schema.columns WHERE table_name = 'AutoItemCompatibility' ORDER BY column_name");
    await q('honda_civic_camelCase', "SELECT i.title, i.price, i.seller FROM \"Item\" i JOIN \"AutoItemCompatibility\" aic ON aic.\"itemId\" = i.id JOIN \"Auto\" a ON a.id = aic.\"autoId\" WHERE a.make = 'Honda' AND a.model = 'Civic' AND a.year::text = '2000' LIMIT 5");
    await q('honda_civic_any_year', "SELECT a.year, i.title, i.price FROM \"Item\" i JOIN \"AutoItemCompatibility\" aic ON aic.\"itemId\" = i.id JOIN \"Auto\" a ON a.id = aic.\"autoId\" WHERE a.make = 'Honda' AND a.model ILIKE '%Civic%' LIMIT 5");
    await q('honda_civic_count_all_years', "SELECT a.year::text, COUNT(*) as cnt FROM \"Item\" i JOIN \"AutoItemCompatibility\" aic ON aic.\"itemId\" = i.id JOIN \"Auto\" a ON a.id = aic.\"autoId\" WHERE a.make = 'Honda' AND a.model ILIKE '%Civic%' GROUP BY a.year ORDER BY a.year");
    await q('q1_aic_columns', "SELECT column_name FROM information_schema.columns WHERE table_name = 'AutoItemCompatibility' ORDER BY column_name");
    await q('q2_lowercase_2000', "SELECT COUNT(*) as cnt FROM \"Item\" i JOIN \"AutoItemCompatibility\" aic ON aic.\"itemId\" = i.id JOIN \"Auto\" a ON a.id = aic.\"autoId\" WHERE a.make = 'Honda' AND a.model = 'Civic' AND a.year::text = '2000'");
    await q('q3_lowercase_1999', "SELECT COUNT(*) as cnt FROM \"Item\" i JOIN \"AutoItemCompatibility\" aic ON aic.\"itemId\" = i.id JOIN \"Auto\" a ON a.id = aic.\"autoId\" WHERE a.make = 'Honda' AND a.model = 'Civic' AND a.year::text = '1999'");
    await q('q4_lowercase_2001', "SELECT COUNT(*) as cnt FROM \"Item\" i JOIN \"AutoItemCompatibility\" aic ON aic.\"itemId\" = i.id JOIN \"Auto\" a ON a.id = aic.\"autoId\" WHERE a.make = 'Honda' AND a.model = 'Civic' AND a.year::text = '2001'");
    await q('q5_lowercase_range', "SELECT COUNT(*) as cnt FROM \"Item\" i JOIN \"AutoItemCompatibility\" aic ON aic.\"itemId\" = i.id JOIN \"Auto\" a ON a.id = aic.\"autoId\" WHERE a.make = 'Honda' AND a.model = 'Civic' AND a.year::int >= 1999 AND a.year::int <= 2001");
    await q('q6_brute_force_ilike', "SELECT COUNT(*) as cnt FROM \"Item\" WHERE title ILIKE '%Honda%' AND title ILIKE '%Civic%' AND (title ~ '(1996|1997|1998|1999|2000|2001|2002)')");
    await q('q7_original_app_query', "SELECT COUNT(*) as cnt FROM \"Auto\" a JOIN \"AutoItemCompatibility\" aic ON a.id = aic.\"autoId\" JOIN \"Item\" i ON aic.\"itemId\" = i.id WHERE a.year = 2000 AND a.make = 'Honda' AND a.model = 'Civic'");
    await q('q8_year_as_int', "SELECT COUNT(*) as cnt FROM \"Auto\" a JOIN \"AutoItemCompatibility\" aic ON a.id = aic.\"autoId\" JOIN \"Item\" i ON aic.\"itemId\" = i.id WHERE a.year = '2000' AND a.make = 'Honda' AND a.model = 'Civic'");
    await q('q9_auto_civic_exists', "SELECT id, year, make, model, trim, engine FROM \"Auto\" WHERE make = 'Honda' AND model = 'Civic' AND year::text IN ('1999','2000','2001') ORDER BY year");
    await q('q10_aic_for_civic_autos', "SELECT aic.\"autoId\", aic.\"itemId\" FROM \"AutoItemCompatibility\" aic JOIN \"Auto\" a ON a.id = aic.\"autoId\" WHERE a.make = 'Honda' AND a.model = 'Civic' AND a.year::text IN ('1999','2000','2001') LIMIT 10");
    await q('yard_vehicle_engine_samples', "SELECT engine, engine_type, drivetrain, vin_decoded, COUNT(*) as cnt FROM yard_vehicle WHERE active = true AND engine IS NOT NULL GROUP BY engine, engine_type, drivetrain, vin_decoded ORDER BY cnt DESC LIMIT 15");
    await q('yard_vehicle_decode_status', "SELECT COUNT(*) as total, SUM(CASE WHEN vin_decoded THEN 1 ELSE 0 END) as decoded, SUM(CASE WHEN vin_decoded AND engine IS NOT NULL THEN 1 ELSE 0 END) as has_engine, SUM(CASE WHEN vin IS NOT NULL AND NOT COALESCE(vin_decoded, false) THEN 1 ELSE 0 END) as vin_not_decoded FROM yard_vehicle WHERE active = true");
    await q('market_demand_cache_freshness', "SELECT COUNT(*) as total, COUNT(CASE WHEN last_updated >= NOW() - INTERVAL '7 days' THEN 1 END) as last_7d, COUNT(CASE WHEN last_updated >= NOW() - INTERVAL '30 days' THEN 1 END) as last_30d, MIN(last_updated) as oldest, MAX(last_updated) as newest FROM market_demand_cache");
    res.json(R);
  } catch(e) { res.status(500).json({error: e.message, stack: e.stack}); }
});


// Instant Research — live eBay market research for a vehicle
app.use('/api/instant-research', require('./routes/instant-research'));

// Market pricing cache status
app.get('/api/market-price/status', async (req, res) => {
  try {
    const result = await database.raw(`
      SELECT COUNT(*) as cached_parts, MAX(last_updated) as last_run
      FROM market_demand_cache
      WHERE last_updated > NOW() - INTERVAL '24 hours'
    `);
    const row = result.rows[0];
    res.json({
      cachedParts: parseInt(row.cached_parts) || 0,
      lastRun: row.last_run || null,
      stale: parseInt(row.cached_parts) === 0,
    });
  } catch (err) {
    res.json({ cachedParts: 0, lastRun: null, stale: true });
  }
});

app.use('/return-intelligence', require('./routes/return-intelligence'));
app.use('/flyway', require('./routes/flyway'));
app.use('/phoenix', require('./routes/phoenix'));

// ═══ SPA CATCH-ALL — MUST BE LAST ═══
// All API routes are registered above this point.
// Static files + SPA fallback below catches everything else.
app.use(express.static(path.resolve(__dirname, '../client/build'), {
  maxAge: '1h',
  setHeaders: (res, filePath) => {
    if (filePath.includes('/static/js/') || filePath.includes('/static/css/')) {
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    }
  }
}));
app.get('/*', (req, res) => {
  res.sendFile(path.resolve(__dirname, '../client/build', 'index.html'));
});


async function start() {
  try {
    log.level('debug');

    Model.knex(database);

    log.info(`Running as process: ${process.env.NODE_ENV}`);

    log.debug('running latest database migrations');
    try {
      await database.migrate.latest(database.client.config.migration);
      log.info('Migrations complete');
    } catch (migrationErr) {
      log.error({ err: migrationErr }, 'Migration failed — server will start anyway');
    }

    app.listen(PORT, function () {
      log.info(`Server started at port ${PORT}`);
    });

    // DISABLED: CronWorkRunner used SellerItemManager → FindingsAPI (dead since Feb 2025).
    // Item table (21K records) is permanently frozen. market_demand_cache is the pricing source of truth (see priceResolver.js).
    // if (process.env.RUN_JOB_NOW === '1') {
    //   const cronWorker = new CronWorkRunner();
    //   cronWorker.work();
    // }
    // const ebaySellerProcessingJob = schedule.scheduleJob('0 6 * * *', function (scheduledTime) {
    //   const cronWorker = new CronWorkRunner();
    //   cronWorker.work();
    // });

    // YOUR eBay data sync — orders + listings every 6 hours (offset by 1 hour from competitor cron)
    const YourDataManager = require('./managers/YourDataManager');
    const yourDataSyncJob = schedule.scheduleJob('0 1,7,13,19 * * *', async function (scheduledTime) {
      log.info({ scheduledTime }, 'Starting scheduled eBay YourData sync (orders + listings)');
      try {
        const manager = new YourDataManager();
        const results = await manager.syncAll({ daysBack: 30 });
        log.info({ results, scheduledTime }, 'Completed scheduled eBay YourData sync');
      } catch (err) {
        log.error({ err }, 'Scheduled eBay YourData sync failed');
      }
    });

    // Run an immediate sync on startup if sales data is stale (> 24 hours old)
    (async () => {
      try {
        const staleCheck = await database.raw('SELECT MAX("soldDate") as latest FROM "YourSale"');
        const latest = staleCheck.rows[0]?.latest;
        const hoursOld = latest ? Math.floor((Date.now() - new Date(latest).getTime()) / 3600000) : 999;
        if (hoursOld > 24) {
          log.info({ hoursOld, latestSale: latest }, 'YourSale data is stale — triggering immediate sync');
          const manager = new YourDataManager();
          const results = await manager.syncAll({ daysBack: 30 });
          log.info({ results }, 'Startup YourData sync completed');
        } else {
          log.info({ hoursOld }, 'YourSale data is fresh — skipping startup sync');
        }
      } catch (err) {
        log.warn({ err: err.message }, 'Startup YourData stale check failed (non-fatal)');
      }
    })();

    // Price check cron - runs once a week (Sunday at 2:00 AM)
    const priceCheckJob = schedule.scheduleJob('0 2 * * 0', async function (scheduledTime) {
      log.info({ scheduledTime }, 'Starting weekly price check cron');
      const priceCheckRunner = new PriceCheckCronRunner();
      await priceCheckRunner.work({ batchSize: 15 });
    });

    // DISABLED: MarketDemandCronRunner used findCompletedItems (Finding API dead since Feb 2025).
    // Market cache now populated by: PriceCheckService (weekly), yard sniper (on-demand), importapart drip (manual).
    // const MarketDemandCronRunner = require('./lib/MarketDemandCronRunner');
    // const marketDemandJob = schedule.scheduleJob('0 3 * * *', async function (scheduledTime) {
    //   const runner = new MarketDemandCronRunner();
    //   await runner.work();
    // });

    // Stale inventory automation - runs weekly Wednesday at 3:00 AM
    const StaleInventoryService = require('./services/StaleInventoryService');
    const staleInventoryJob = schedule.scheduleJob('0 3 * * 3', async function (scheduledTime) {
      log.info({ scheduledTime }, 'Starting weekly stale inventory automation');
      try {
        const service = new StaleInventoryService();
        const result = await service.runAutomation();
        log.info({ result }, 'Stale inventory automation complete');
      } catch (err) {
        log.error({ err }, 'Stale inventory automation failed');
      }
    });

    // Dead inventory scan - runs weekly Monday at 4:00 AM
    const DeadInventoryService = require('./services/DeadInventoryService');
    const deadInventoryJob = schedule.scheduleJob('0 4 * * 1', async function (scheduledTime) {
      log.info({ scheduledTime }, 'Starting weekly dead inventory scan');
      try {
        const service = new DeadInventoryService();
        await service.scanAndLog();
      } catch (err) {
        log.error({ err }, 'Dead inventory scan failed');
      }
    });

    // Restock scan - runs weekly Tuesday at 4:00 AM
    const RestockService = require('./services/RestockService');
    const restockJob = schedule.scheduleJob('0 4 * * 2', async function (scheduledTime) {
      log.info({ scheduledTime }, 'Starting weekly restock scan');
      try {
        const service = new RestockService();
        await service.scanAndFlag();
      } catch (err) {
        log.error({ err }, 'Restock scan failed');
      }
    });

    // Competitor monitoring - runs weekly Thursday at 4:00 AM
    const CompetitorMonitorService = require('./services/CompetitorMonitorService');
    const competitorJob = schedule.scheduleJob('0 4 * * 4', async function (scheduledTime) {
      log.info({ scheduledTime }, 'Starting weekly competitor monitoring');
      try {
        const service = new CompetitorMonitorService();
        await service.scan();
      } catch (err) {
        log.error({ err }, 'Competitor monitoring failed');
      }
    });

    // Flyway scrape: daily 6am UTC - scrapes Pull-A-Part/Foss/Carolina PNP for active road trips
    const FlywayScrapeRunner = require('./lib/FlywayScrapeRunner');
    const flywayJob = schedule.scheduleJob('0 6 * * *', async function (scheduledTime) {
      log.info({ scheduledTime }, 'Starting Flyway scrape run');
      try {
        const runner = new FlywayScrapeRunner();
        await runner.work();
      } catch (err) {
        log.error({ err }, 'Flyway scrape run failed');
      }
    });

    // Competitor drip scraping — 4x daily with random 0-45min startup jitter
    // Each run: picks 1 least-recently-scraped seller, scrapes 1-2 pages
    // Replaces old Sunday 8pm blast-all-sellers cron (removed from competitors.js)
    const CompetitorDripRunner = require('./lib/CompetitorDripRunner');

    const dripJob5am = schedule.scheduleJob('0 5 * * *', async function () {
      log.info('Competitor drip cron fired (5am UTC window)');
      try { await CompetitorDripRunner.runDrip(); } catch (err) { log.error({ err: err.message }, 'Drip 5am failed'); }
    });

    const dripJobNoon = schedule.scheduleJob('0 12 * * *', async function () {
      log.info('Competitor drip cron fired (noon UTC window)');
      try { await CompetitorDripRunner.runDrip(); } catch (err) { log.error({ err: err.message }, 'Drip noon failed'); }
    });

    const dripJob6pm = schedule.scheduleJob('0 18 * * *', async function () {
      log.info('Competitor drip cron fired (6pm UTC window)');
      try { await CompetitorDripRunner.runDrip(); } catch (err) { log.error({ err: err.message }, 'Drip 6pm failed'); }
    });

    const dripJobMidnight = schedule.scheduleJob('0 0 * * *', async function () {
      log.info('Competitor drip cron fired (midnight UTC window)');
      try { await CompetitorDripRunner.runDrip(); } catch (err) { log.error({ err: err.message }, 'Drip midnight failed'); }

      // Graduate marks once daily (moved from old Sunday-only cron in competitors.js)
      try {
        const axios = require('axios');
        await axios.post('http://localhost:' + (process.env.PORT || 9000) + '/competitors/mark/graduate');
        log.info('Daily mark graduation complete');
      } catch (err) {
        log.error({ err: err.message }, 'Daily mark graduation failed');
      }
    });

    // eBay Messaging — poll for new orders every 15 minutes, process queue every 2 minutes
    const EbayMessagingService = require('./services/EbayMessagingService');
    const messagingService = new EbayMessagingService();

    const messagingPollJob = schedule.scheduleJob('*/15 * * * *', async function () {
      log.info('Cron: Polling for new orders to message');
      try {
        await messagingService.pollNewOrders();
      } catch (err) {
        log.error({ err }, 'Cron: Order polling failed');
      }
    });

    const messagingProcessJob = schedule.scheduleJob('*/2 * * * *', async function () {
      try {
        await messagingService.processQueue();
      } catch (err) {
        log.error({ err }, 'Cron: Message queue processing failed');
      }
    });

    // Load Auto table models into partMatcher cache, then regenerate scout alerts
    try {
      const { loadModelsFromDB } = require('./utils/partMatcher');
      const { generateAlerts } = require('./services/ScoutAlertService');
      setTimeout(async () => {
        try {
          await loadModelsFromDB();
          const r = await generateAlerts();
          log.info({ alertCount: r.alerts }, 'Scout alerts regenerated on startup');
        } catch (e) {
          log.warn({ err: e.message }, 'Scout alert startup generation failed');
        }
      }, 10000); // delay 10s to let migrations finish
    } catch (e) { /* ignore */ }

    // Auto-complete expired flyway trips
    try {
      const FlywayService = require('./services/FlywayService');
      FlywayService.autoCompleteExpiredTrips()
        .then(count => { if (count > 0) log.info({ count }, 'Flyway: auto-completed expired trips'); })
        .catch(err => log.warn({ err: err.message }, 'Flyway: auto-complete error'));
    } catch (e) { /* ignore */ }

    // LKQ scraping runs locally via Task Scheduler — CloudFlare blocks Railway

  } catch (err) {
    log.error({ err }, 'Unable to start server')
  }
}

// istanbul ignore next
if (require.main === module) {
  start();
}```
---
