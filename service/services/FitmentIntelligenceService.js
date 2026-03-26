'use strict';

/**
 * FitmentIntelligenceService — Deduces fitment negations from competitor data.
 *
 * Core logic: "subtraction" — compare competitor's compatibility table against
 * the full eBay taxonomy. What's in the taxonomy but NOT in the compatibility
 * table = DOES NOT FIT.
 *
 * Data flow:
 *   1. scrape-competitor-fitment.js pulls compatibility tables from eBay
 *   2. This service takes raw compatibility data + taxonomy → negations
 *   3. GET /api/fitment/lookup serves the result to the listing tool
 */

const { database } = require('../database/database');
const TradingAPI = require('../ebay/TradingAPI');
const TaxonomyAPI = require('../ebay/TaxonomyAPI');
const xml2js = require('xml2js');

const tradingAPI = new TradingAPI();
const taxonomyAPI = new TaxonomyAPI();

// Part types that require strict PN matching
const PN_STRICT_TYPES = new Set([
  'ECM', 'PCM', 'ECU', 'BCM', 'TCM', 'TCU', 'ABS', 'TIPM', 'IPDM',
  'CLUSTER', 'AMPLIFIER', 'AMP', 'RADIO',
]);

/**
 * Parse a GetItem XML response for compatibility list.
 * Returns [{ year, make, model, trim, engine }]
 */
function parseCompatibilityList(parsed) {
  const entries = [];
  try {
    const item = parsed?.GetItemResponse?.Item?.[0];
    if (!item) return entries;

    const compList = item.ItemCompatibilityList?.[0]?.Compatibility;
    if (!compList) return entries;

    for (const c of compList) {
      const kvList = c.NameValueList || [];
      const entry = {};
      for (const kv of kvList) {
        const name = kv.Name?.[0];
        const value = kv.Value?.[0];
        if (name === 'Year') entry.year = parseInt(value) || null;
        if (name === 'Make') entry.make = value;
        if (name === 'Model') entry.model = value;
        if (name === 'Trim') entry.trim = value;
        if (name === 'Engine') entry.engine = value;
      }
      if (entry.year && entry.make && entry.model) entries.push(entry);
    }
  } catch (e) {}
  return entries;
}

/**
 * Parse item specifics from GetItem response.
 * Returns { manufacturerPartNumber, interchangeNumbers }
 */
function parseItemSpecifics(parsed) {
  const result = { manufacturerPartNumber: null, interchangeNumbers: [] };
  try {
    const specifics = parsed?.GetItemResponse?.Item?.[0]?.ItemSpecifics?.[0]?.NameValueList;
    if (!specifics) return result;
    for (const nv of specifics) {
      const name = (nv.Name?.[0] || '').toLowerCase();
      const value = nv.Value?.[0] || '';
      if (name === 'manufacturer part number' || name === 'oem part number') {
        result.manufacturerPartNumber = value;
      }
      if (name === 'interchange part number') {
        result.interchangeNumbers = value.split(/[,;\/]/).map(s => s.trim()).filter(Boolean);
      }
    }
  } catch (e) {}
  return result;
}

/**
 * Fetch compatibility table for an eBay item via Trading API GetItem.
 */
async function fetchItemCompatibility(ebayItemId) {
  const parsed = await tradingAPI.makeRequest({
    ebayItemId: String(ebayItemId),
    options: { includeItemCompatibility: 'true', includeItemSpecifics: 'true' },
  });
  if (!parsed) return { compatibility: [], specifics: { manufacturerPartNumber: null, interchangeNumbers: [] } };

  const ack = parsed?.GetItemResponse?.Ack?.[0];
  if (ack === 'Failure') return { compatibility: [], specifics: { manufacturerPartNumber: null, interchangeNumbers: [] } };

  return {
    compatibility: parseCompatibilityList(parsed),
    specifics: parseItemSpecifics(parsed),
    title: parsed?.GetItemResponse?.Item?.[0]?.Title?.[0] || '',
    seller: parsed?.GetItemResponse?.Item?.[0]?.Seller?.[0]?.UserID?.[0] || '',
  };
}

/**
 * Fetch taxonomy values (trims/engines) for a make+model+year from eBay.
 * Returns { trims: string[], engines: string[] }
 */
async function fetchTaxonomy(make, model, year) {
  const result = { trims: [], engines: [] };
  try {
    // Fetch trims
    const trimRes = await taxonomyAPI.makeRequest({
      select: 'Trim',
      filter: `Year:${year},Make:${make},Model:${model}`,
    });
    if (trimRes?.compatibilityPropertyValues) {
      result.trims = trimRes.compatibilityPropertyValues.map(v => v.value);
    }
  } catch (e) {}

  try {
    // Fetch engines
    const engineRes = await taxonomyAPI.makeRequest({
      select: 'Engine',
      filter: `Year:${year},Make:${make},Model:${model}`,
    });
    if (engineRes?.compatibilityPropertyValues) {
      result.engines = engineRes.compatibilityPropertyValues.map(v => v.value);
    }
  } catch (e) {}

  return result;
}

/**
 * Build fitment profile by comparing competitor compatibility against taxonomy.
 *
 * The subtraction: taxonomy - compatibility = does_not_fit
 */
async function buildFitmentProfile(compatEntries, make, model, yearStart, yearEnd) {
  const allFitsTrims = new Set();
  const allFitsEngines = new Set();
  const allDoesNotFitTrims = new Set();
  const allDoesNotFitEngines = new Set();

  // Collect what the competitor listed as fitting
  const compTrims = new Set();
  const compEngines = new Set();
  for (const entry of compatEntries) {
    if (entry.year >= yearStart && entry.year <= yearEnd) {
      if (entry.trim) compTrims.add(entry.trim);
      if (entry.engine) compEngines.add(entry.engine);
    }
  }

  // For each year in range, fetch full taxonomy and subtract
  for (let y = yearStart; y <= yearEnd; y++) {
    const taxonomy = await fetchTaxonomy(make, model, y);
    // Rate limit — taxonomy API has limits
    await new Promise(r => setTimeout(r, 300));

    // Trim subtraction
    if (compTrims.size > 0 && taxonomy.trims.length > 0) {
      for (const trim of taxonomy.trims) {
        if (compTrims.has(trim)) {
          allFitsTrims.add(trim);
        } else {
          allDoesNotFitTrims.add(trim);
        }
      }
    } else if (taxonomy.trims.length > 0) {
      // Competitor didn't specify trims — assume fits all
      for (const t of taxonomy.trims) allFitsTrims.add(t);
    }

    // Engine subtraction
    if (compEngines.size > 0 && taxonomy.engines.length > 0) {
      for (const engine of taxonomy.engines) {
        if (compEngines.has(engine)) {
          allFitsEngines.add(engine);
        } else {
          allDoesNotFitEngines.add(engine);
        }
      }
    } else if (taxonomy.engines.length > 0) {
      // Competitor didn't specify engines — assume fits all
      for (const e of taxonomy.engines) allFitsEngines.add(e);
    }
  }

  // Remove items from doesNotFit if they also appear in fits
  // (edge case: a trim fits some years but not others — still mark as fits)
  for (const t of allFitsTrims) allDoesNotFitTrims.delete(t);
  for (const e of allFitsEngines) allDoesNotFitEngines.delete(e);

  return {
    fitsTrims: [...allFitsTrims].sort(),
    fitsEngines: [...allFitsEngines].sort(),
    doesNotFitTrims: [...allDoesNotFitTrims].sort(),
    doesNotFitEngines: [...allDoesNotFitEngines].sort(),
  };
}

/**
 * Generate human-readable negation text for listing descriptions.
 */
function generateNegationText(profile, make, model, yearStart, yearEnd) {
  const parts = [];
  const yearRange = yearStart === yearEnd ? String(yearStart) : `${yearStart}-${yearEnd}`;

  if (profile.doesNotFitTrims.length > 0 && profile.fitsTrims.length > 0) {
    // More helpful to state what it DOES fit if fewer
    if (profile.fitsTrims.length <= profile.doesNotFitTrims.length) {
      parts.push(`Fits ${yearRange} ${make} ${model} ${profile.fitsTrims.join(', ')} ONLY.`);
      parts.push(`Does NOT fit: ${profile.doesNotFitTrims.join(', ')}.`);
    } else {
      parts.push(`THIS PART DOES NOT FIT: ${yearRange} ${make} ${model} ${profile.doesNotFitTrims.join(', ')}.`);
    }
  }

  if (profile.doesNotFitEngines.length > 0 && profile.fitsEngines.length > 0) {
    if (profile.fitsEngines.length <= profile.doesNotFitEngines.length) {
      parts.push(`Fits ${profile.fitsEngines.join(', ')} ONLY.`);
      parts.push(`Does NOT fit ${profile.doesNotFitEngines.join(', ')}.`);
    } else {
      parts.push(`Does NOT fit ${profile.doesNotFitEngines.join(', ')} engine(s).`);
    }
  }

  if (profile.doesNotFitTransmissions?.length > 0) {
    const fits = profile.fitsTransmissions || [];
    if (fits.length > 0) {
      parts.push(`Fits ${fits.join(' / ')} ONLY.`);
    }
  }

  if (parts.length === 0) return null;

  parts.push('Please verify your trim level and engine before purchasing.');
  return parts.join(' ');
}

/**
 * Generate part number warning for module-type parts.
 */
function generatePartNumberWarning(partNumber, partType) {
  if (!partNumber) return null;
  const pt = (partType || '').toUpperCase();
  if (!PN_STRICT_TYPES.has(pt)) return null;

  return `YOUR PART NUMBER MUST MATCH: ${partNumber}. This module is vehicle-specific. A different part number, even from the same vehicle, may not be compatible. Verify your existing part number before ordering.`;
}

/**
 * Look up fitment intelligence for a part.
 * First checks the database cache, then falls back to live computation.
 */
async function lookupFitment({ partType, make, model, year, partNumber }) {
  const yearNum = parseInt(year) || 0;
  const pt = (partType || '').toUpperCase();
  const mk = (make || '').trim();
  const md = (model || '').trim();

  // Try exact match in fitment_intelligence table
  let row = null;
  try {
    row = await database('fitment_intelligence')
      .where('part_type', 'ilike', pt)
      .where('make', 'ilike', mk)
      .where('model', 'ilike', md)
      .where('year_start', '<=', yearNum || 9999)
      .where('year_end', '>=', yearNum || 0)
      .first();
  } catch (e) {
    // Table might not exist yet
  }

  if (row) {
    return {
      partType: row.part_type,
      make: row.make,
      model: row.model,
      yearRange: `${row.year_start}-${row.year_end}`,
      fits: {
        trims: row.fits_trims || [],
        engines: row.fits_engines || [],
        transmissions: row.fits_transmissions || [],
      },
      doesNotFit: {
        trims: row.does_not_fit_trims || [],
        engines: row.does_not_fit_engines || [],
        transmissions: row.does_not_fit_transmissions || [],
      },
      negationText: row.negation_text,
      partNumberWarning: partNumber ? generatePartNumberWarning(partNumber, pt) : row.part_number_warning,
      partNumberVariants: row.part_number_variants || {},
      confidence: row.confidence,
      sourceSeller: row.source_seller,
      scrapedAt: row.scraped_at,
    };
  }

  // No cached data — try part number search in our own inventory
  if (partNumber) {
    const pnWarning = generatePartNumberWarning(partNumber, pt);
    return {
      partType: pt, make: mk, model: md,
      yearRange: yearNum ? String(yearNum) : null,
      fits: { trims: [], engines: [], transmissions: [] },
      doesNotFit: { trims: [], engines: [], transmissions: [] },
      negationText: null,
      partNumberWarning: pnWarning,
      partNumberVariants: {},
      confidence: pnWarning ? 'low' : 'none',
      sourceSeller: null,
      scrapedAt: null,
    };
  }

  return {
    partType: pt, make: mk, model: md,
    yearRange: yearNum ? String(yearNum) : null,
    fits: { trims: [], engines: [], transmissions: [] },
    doesNotFit: { trims: [], engines: [], transmissions: [] },
    negationText: null,
    partNumberWarning: null,
    partNumberVariants: {},
    confidence: 'none',
    sourceSeller: null,
    scrapedAt: null,
  };
}

/**
 * Store fitment intelligence result in the database.
 */
async function storeFitmentProfile(data) {
  await database.raw(`
    INSERT INTO fitment_intelligence
      (id, part_type, make, model, year_start, year_end,
       fits_trims, fits_engines, fits_transmissions,
       does_not_fit_trims, does_not_fit_engines, does_not_fit_transmissions,
       part_number_variants, negation_text, part_number_warning,
       source_seller, source_listings, confidence, scraped_at, created_at, updated_at)
    VALUES (gen_random_uuid(), ?, ?, ?, ?, ?,
            ?::jsonb, ?::jsonb, ?::jsonb,
            ?::jsonb, ?::jsonb, ?::jsonb,
            ?::jsonb, ?, ?,
            ?, ?::jsonb, ?, NOW(), NOW(), NOW())
    ON CONFLICT (part_type, make, model, year_start, year_end)
    DO UPDATE SET
      fits_trims = EXCLUDED.fits_trims,
      fits_engines = EXCLUDED.fits_engines,
      fits_transmissions = EXCLUDED.fits_transmissions,
      does_not_fit_trims = EXCLUDED.does_not_fit_trims,
      does_not_fit_engines = EXCLUDED.does_not_fit_engines,
      does_not_fit_transmissions = EXCLUDED.does_not_fit_transmissions,
      part_number_variants = EXCLUDED.part_number_variants,
      negation_text = EXCLUDED.negation_text,
      part_number_warning = EXCLUDED.part_number_warning,
      source_seller = EXCLUDED.source_seller,
      source_listings = EXCLUDED.source_listings,
      confidence = EXCLUDED.confidence,
      scraped_at = EXCLUDED.scraped_at,
      updated_at = NOW()
  `, [
    data.partType, data.make, data.model, data.yearStart, data.yearEnd,
    JSON.stringify(data.fitsTrims || []),
    JSON.stringify(data.fitsEngines || []),
    JSON.stringify(data.fitsTransmissions || []),
    JSON.stringify(data.doesNotFitTrims || []),
    JSON.stringify(data.doesNotFitEngines || []),
    JSON.stringify(data.doesNotFitTransmissions || []),
    JSON.stringify(data.partNumberVariants || {}),
    data.negationText || null,
    data.partNumberWarning || null,
    data.sourceSeller || null,
    JSON.stringify(data.sourceListings || []),
    data.confidence || 'low',
  ]);
}

module.exports = {
  fetchItemCompatibility,
  fetchTaxonomy,
  buildFitmentProfile,
  generateNegationText,
  generatePartNumberWarning,
  lookupFitment,
  storeFitmentProfile,
  parseCompatibilityList,
};
