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
