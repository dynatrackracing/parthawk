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

    // Step 2: Decode via LocalVinDecoder (offline, checks vin_cache internally)
    const { decode: localDecode } = require('../lib/LocalVinDecoder');
    let decoded = null;
    let matchedVehicle = null;

    const localResult = await localDecode(vin);
    if (localResult) {
      decoded = {
        year: localResult.year,
        make: localResult.make,
        model: localResult.model,
        engine: localResult.engine,
        bodyStyle: localResult.bodyStyle,
      };
    }

    // Step 3: Try to match against yard vehicles
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

    // --- Step 1: Decode via LocalVinDecoder (offline, checks vin_cache internally) ---
    const { decode: localDecode } = require('../lib/LocalVinDecoder');
    const localResult = await localDecode(vin);

    let decoded = null;
    if (localResult) {
      decoded = {
        year: localResult.year,
        make: localResult.make,
        model: localResult.model,
        trim: localResult.trim,
        engine: localResult.engine,
        engineType: localResult.engineType || 'Gas',
        drivetrain: localResult.drivetrain,
        bodyStyle: localResult.bodyStyle,
        plantCity: null,
        plantCountry: null,
        paintCode: null,
      };
    } else {
      decoded = { year: null, make: null, model: null, trim: null, engine: null, engineType: 'Gas', drivetrain: null, bodyStyle: null };
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

    // Check The Cache for parts already claimed for this vehicle
    let cacheMatches = [];
    try {
      const vinMatches = await database('the_cache')
        .where('status', 'claimed')
        .where('vehicle_vin', vin)
        .select('*');
      if (vinMatches.length > 0) {
        cacheMatches = vinMatches;
      } else if (decoded && decoded.make && decoded.model) {
        // Fallback: check by make+model+year
        cacheMatches = await database('the_cache')
          .where('status', 'claimed')
          .whereRaw('UPPER(vehicle_make) = ?', [decoded.make.toUpperCase()])
          .whereRaw('UPPER(vehicle_model) = ?', [decoded.model.toUpperCase()])
          .where('vehicle_year', decoded.year)
          .select('*');
      }
    } catch (e) { /* cache table may not exist yet */ }

    // Limit response size to prevent mobile memory issues
    res.json({
      success: true, vin, decoded, baseModel, totalValue,
      salesHistory: salesHistory.slice(0, 15),
      currentStock: currentStock.slice(0, 15),
      marketRef: marketRef.slice(0, 20),
      aiResearch,
      cachedParts: cacheMatches.map(c => ({
        partType: c.part_type,
        partNumber: c.part_number,
        description: c.part_description,
        claimedBy: c.claimed_by,
        claimedAt: c.claimed_at,
        source: c.source,
        yardName: c.yard_name,
      })),
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

/**
 * GET /vin/test-local/:vin
 * Test the local VIN decoder. Returns full decode result with timing.
 */
router.get('/test-local/:vin', async (req, res) => {
  try {
    const { decode } = require('../lib/LocalVinDecoder');
    const result = await decode(req.params.vin);
    res.json({ success: true, result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
