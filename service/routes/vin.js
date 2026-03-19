'use strict';

const { log } = require('../lib/logger');
const router = require('express-promise-router')();
const { database } = require('../database/database');
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');

// Multer-free: read raw body as base64 from multipart form data
// Assumption: body-parser is configured with 50mb limit in index.js

/**
 * POST /vin/decode-photo
 * Accepts multipart form with 'photo' file field.
 * Uses Claude API to read VIN from photo, then NHTSA to decode.
 */
router.post('/decode-photo', async (req, res) => {
  try {
    // Read the file from the raw request body
    // Since we don't have multer, parse the multipart manually
    const chunks = [];
    await new Promise((resolve, reject) => {
      req.on('data', chunk => chunks.push(chunk));
      req.on('end', resolve);
      req.on('error', reject);
    });

    const body = Buffer.concat(chunks);
    if (body.length === 0) {
      return res.status(400).json({ error: 'No photo provided' });
    }

    // Extract image data from multipart form
    const imageBase64 = extractImageFromMultipart(body, req.headers['content-type']);
    if (!imageBase64) {
      return res.status(400).json({ error: 'Could not extract image from upload' });
    }

    // Step 1: Send to Claude API for VIN reading
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured' });
    }

    const Anthropic = require('@anthropic-ai/sdk');
    const client = new Anthropic({ apiKey });

    const claudeRes = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 100,
      messages: [{
        role: 'user',
        content: [
          {
            type: 'image',
            source: { type: 'base64', media_type: 'image/jpeg', data: imageBase64 },
          },
          {
            type: 'text',
            text: 'Read the VIN from this photo. Return only the 17-character VIN string, nothing else. If you cannot read it clearly, return UNREADABLE.',
          },
        ],
      }],
    });

    let vin = '';
    for (const block of claudeRes.content) {
      if (block.type === 'text') vin += block.text.trim();
    }

    vin = vin.replace(/[^A-HJ-NPR-Z0-9]/gi, '').toUpperCase();

    if (vin === 'UNREADABLE' || vin.length !== 17) {
      return res.json({ success: true, vin: 'UNREADABLE' });
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

/**
 * Extract base64 image data from a multipart/form-data request body.
 * Simple parser — assumes single file field named 'photo'.
 */
function extractImageFromMultipart(body, contentType) {
  try {
    const boundaryMatch = (contentType || '').match(/boundary=(.+)/);
    if (!boundaryMatch) {
      // Not multipart — assume raw image bytes
      return body.toString('base64');
    }

    const boundary = boundaryMatch[1].trim();
    const bodyStr = body.toString('latin1');
    const parts = bodyStr.split('--' + boundary);

    for (const part of parts) {
      if (part.includes('filename=')) {
        // Find the blank line separating headers from body
        const headerEnd = part.indexOf('\r\n\r\n');
        if (headerEnd === -1) continue;
        const fileData = part.substring(headerEnd + 4);
        // Remove trailing \r\n--
        const clean = fileData.replace(/\r\n$/, '');
        return Buffer.from(clean, 'latin1').toString('base64');
      }
    }
  } catch (e) {
    log.warn({ err: e.message }, 'Failed to parse multipart');
  }
  return null;
}

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
      let engine = null;
      if (displacement) {
        // Round displacement to 1 decimal: "1.589545208" → "1.6L"
        const dispNum = parseFloat(displacement);
        if (!isNaN(dispNum)) {
          engine = dispNum.toFixed(1) + 'L';
        } else {
          engine = displacement.includes('L') ? displacement : displacement + 'L';
        }
        // Cylinders: only append if it's a reasonable number (not hp)
        if (cylinders) {
          const cylNum = parseInt(cylinders);
          if (cylNum >= 2 && cylNum <= 16) engine += ' ' + cylNum + '-cyl';
        }
      }

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

      // 2c: Item table — competitor/reference, separated by rebuild vs used
      try {
        let items = [];
        // Try Auto join first (exact year match)
        if (year) {
          items = await database('Auto')
            .join('AutoItemCompatibility', 'Auto.id', 'AutoItemCompatibility.autoId')
            .join('Item', 'AutoItemCompatibility.itemId', 'Item.id')
            .where('Auto.year', year)
            .whereRaw('UPPER("Auto"."make") = ?', [make.toUpperCase()])
            .whereRaw('UPPER("Auto"."model") LIKE ?', ['%' + baseModel.toUpperCase() + '%'])
            .where('Item.price', '>', 0)
            .select('Item.title', 'Item.price', 'Item.seller', 'Item.manufacturerPartNumber', 'Item.isRepair')
            .limit(200);
        }
        // Fallback: direct title search on Item table
        if (items.length === 0) {
          items = await database('Item')
            .where('price', '>', 0)
            .whereRaw('"title" ILIKE ?', [`%${make}%`])
            .whereRaw('"title" ILIKE ?', [`%${baseModel}%`])
            .select('title', 'price', 'seller', 'manufacturerPartNumber', 'isRepair')
            .limit(200);
        }

        const byType = {};
        for (const item of items) {
          const pt = detectPartTypeForVin(item.title);
          const isRebuild = item.seller === 'pro-rebuild' || item.isRepair === true;
          const key = pt + (isRebuild ? '_rebuild' : '');
          if (!byType[key]) byType[key] = { partType: pt, count: 0, totalPrice: 0, sellers: new Set(), partNumbers: [], isRebuild };
          byType[key].count++;
          byType[key].totalPrice += parseFloat(item.price) || 0;
          if (item.seller) byType[key].sellers.add(item.seller);
          if (item.manufacturerPartNumber && byType[key].partNumbers.length < 5) {
            byType[key].partNumbers.push(item.manufacturerPartNumber);
          }
        }
        for (const [key, data] of Object.entries(byType)) {
          const avg = data.count > 0 ? Math.round(data.totalPrice / data.count) : 0;
          marketRef.push({
            partType: data.partType, count: data.count, avgPrice: avg,
            sellers: [...data.sellers].slice(0, 5),
            partNumbers: [...new Set(data.partNumbers)].slice(0, 5),
            isRebuild: data.isRebuild,
            color: avg >= 300 ? 'green' : avg >= 200 ? 'yellow' : avg >= 100 ? 'orange' : 'red',
          });
        }
        marketRef.sort((a, b) => {
          if (a.isRebuild !== b.isRebuild) return a.isRebuild ? 1 : -1;
          return b.avgPrice - a.avgPrice;
        });
      } catch (e) {
        log.warn({ err: e.message, make, baseModel }, 'VIN scan: Item query failed');
      }
    }

    // Total estimated value (from sales avg or competitor avg)
    const totalValue = salesHistory.reduce((sum, p) => sum + (p.avgPrice || 0), 0)
      || marketRef.reduce((sum, p) => sum + (p.avgPrice || 0), 0);

    // --- Step 3: Check if vehicle is in yard inventory ---
    let yardMatch = null;
    try {
      const match = await database('yard_vehicle')
        .where('active', true)
        .where('year', String(year))
        .whereRaw('UPPER(make) = ?', [(make || '').toUpperCase()])
        .whereRaw('UPPER(model) LIKE ?', ['%' + (baseModel || '').toUpperCase() + '%'])
        .first();
      if (match) {
        const yard = await database('yard').where('id', match.yard_id).first();
        yardMatch = {
          vehicleId: match.id, yardName: yard?.name || 'Unknown',
          row: match.row_number, color: match.color,
        };
      }
    } catch (e) { /* ignore */ }

    // --- Step 4: Log the scan ---
    try {
      await database('vin_scan_log').insert({
        vin, year: decoded.year, make: decoded.make, model: decoded.model,
        trim: decoded.trim, engine: decoded.engine,
        engine_type: decoded.engineType, drivetrain: decoded.drivetrain,
        scanned_by: scannedBy || null, source: source || 'manual',
        scanned_at: new Date(),
      });
    } catch (e) { /* table may not exist yet */ }

    res.json({
      success: true, vin, decoded, baseModel, totalValue, yardMatch,
      salesHistory, currentStock, marketRef,
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
  if (t.includes('ECM') || t.includes('ECU') || t.includes('PCM') || t.includes('ENGINE CONTROL')) return 'ECM';
  if (t.includes('BCM') || t.includes('BODY CONTROL')) return 'BCM';
  if (t.includes('TCM') || t.includes('TCU') || t.includes('TRANSMISSION CONTROL')) return 'TCM';
  if (t.includes('ABS') || t.includes('ANTI LOCK') || t.includes('BRAKE MODULE')) return 'ABS';
  if (t.includes('TIPM') || t.includes('FUSE BOX') || t.includes('JUNCTION') || t.includes('RELAY BOX')) return 'TIPM';
  if (t.includes('AMPLIFIER') || t.includes('BOSE') || t.includes('HARMAN') || t.includes('ALPINE')) return 'AMP';
  if (t.includes('CLUSTER') || t.includes('SPEEDOMETER') || t.includes('INSTRUMENT')) return 'CLUSTER';
  if (t.includes('RADIO') || t.includes('HEAD UNIT') || t.includes('INFOTAINMENT')) return 'RADIO';
  if (t.includes('WINDOW') && t.includes('REGULATOR')) return 'REGULATOR';
  if (t.includes('THROTTLE')) return 'THROTTLE';
  if (t.includes('STEERING')) return 'STEERING';
  if (t.includes('TRANSFER CASE')) return 'XFER CASE';
  if (t.includes('MIRROR')) return 'MIRROR';
  return 'OTHER';
}

module.exports = router;
