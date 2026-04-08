'use strict';

const { log } = require('../lib/logger');
const { database } = require('../database/database');
const TrimTierService = require('./TrimTierService');
const { getTrimTier } = require('../config/trim-tier-config');

/**
 * PostScrapeService — Universal post-scrape enrichment pipeline.
 *
 * Runs after ANY scraper completes for a yard:
 *   Step 1: Batch VIN decode via NHTSA (50 per call)
 *   Step 2: Trim tier matching (TrimTierService + trim_catalog + static config)
 *   Step 3: Scout alerts (background, non-blocking)
 *
 * Replaces the inline post-scrape hooks that were only in LKQScraper.
 */

function titleCase(str) {
  if (!str) return str;
  return str.toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
}

function cleanDecodedTrim(raw) {
  if (!raw) return null;
  let t = raw.trim();
  if (!t) return null;

  const JUNK = new Set([
    'nfa','nfb','nfc','cma','std','sa','hev','phev',
    'n/a','na','unknown','standard','unspecified',
    'styleside','flareside','stepside','sportside',
    'crew','crew cab','regular cab','extended cab','supercab','supercrew','double cab','quad cab','king cab','access cab',
    'middle level','middle-low level','high level','low level',
    'middle grade','middle-low grade','high grade','low grade',
    'xdrive','sdrive','4matic','quattro',
    'leather','cloth','premium cloth',
    'f-series','f series',
  ]);
  if (JUNK.has(t.toLowerCase())) return null;

  t = t.replace(/\s*\([^)]*\)\s*/g, '').trim();
  t = t.replace(/\b[VIL][\-\s]?\d\b/gi, '').trim();
  t = t.replace(/\b\d\.\d[A-Z]?\s*(L|LITER)?\b/gi, '').trim();
  t = t.replace(/\bW\/LEA(THER)?\b/gi, '-L').trim();
  t = t.replace(/\bWITH\s+LEATHER\b/gi, '-L').trim();
  t = t.replace(/\bW\/NAV(I|IGATION)?\b/gi, '').trim();
  t = t.replace(/\bW\/RES\b/gi, '').trim();
  t = t.replace(/\bWITH\s+RES\b/gi, '').trim();
  t = t.replace(/\bWITH\s+NAV(IGATION)?\b/gi, '').trim();
  t = t.replace(/\s+\-/g, '-').replace(/\-\s+/g, '-').replace(/\s+/g, ' ').trim();

  if (/^[A-Z]{0,3}\d{2,3}[A-Z]?$/i.test(t)) return null;
  if (/^\d\.\d[a-z]{1,2}$/i.test(t)) return null;

  if (/,/.test(t)) t = t.split(',')[0].trim();
  if (/\//.test(t)) {
    const parts = t.split('/').map(p => p.trim()).filter(Boolean);
    t = parts[parts.length - 1];
  }

  if (!t || t.length < 2 || t.length > 30) return null;
  return t;
}

async function decodeBatch(vins) {
  const { decodeBatchLocal } = require('../lib/LocalVinDecoder');
  return decodeBatchLocal(vins);
}

async function lookupTrimTier(year, make, model, trimName, engineDisplacement, transmission, drivetrain) {
  if (!trimName && !engineDisplacement) return { tier: null, extra: null };

  // Tier 1: trim_tier_reference (curated table)
  try {
    const ref = await TrimTierService.lookup(year, make, model, trimName, engineDisplacement, transmission, drivetrain);
    if (ref) return { tier: ref.tierString, extra: ref };
  } catch (e) {}

  // Tier 2: trim_catalog (eBay Taxonomy API)
  try {
    const match = await database('trim_catalog')
      .where('year', year)
      .whereRaw('LOWER(make) = ?', [make.toLowerCase()])
      .whereRaw('LOWER(model) = ?', [model.toLowerCase()])
      .whereRaw('LOWER(trim_name) = ?', [trimName.toLowerCase()])
      .first();
    if (match) return { tier: match.tier, extra: null };

    const firstWord = trimName.split(/\s+/)[0];
    if (firstWord && firstWord.length >= 2) {
      const partial = await database('trim_catalog')
        .where('year', year)
        .whereRaw('LOWER(make) = ?', [make.toLowerCase()])
        .whereRaw('LOWER(model) = ?', [model.toLowerCase()])
        .whereRaw('LOWER(trim_name) LIKE ?', [firstWord.toLowerCase() + '%'])
        .first();
      if (partial) return { tier: partial.tier, extra: null };
    }
  } catch (e) {}

  // Tier 3: static config fallback
  const result = getTrimTier(make, trimName);
  return { tier: result.tier, extra: null };
}

/**
 * enrichYard — Run the full post-scrape enrichment pipeline for one yard.
 *
 * @param {string} yardId - UUID of the yard to enrich
 * @returns {{ vinsDecoded, trimsTiered, errors }}
 */
async function enrichYard(yardId) {
  const startTime = Date.now();
  const plog = log.child({ service: 'PostScrape', yardId }, true);
  const stats = { vinsDecoded: 0, trimsTiered: 0, errors: 0 };

  // ── STEP 1: VIN DECODE ──────────────────────────────────
  try {
    const rows = await database('yard_vehicle')
      .where('yard_id', yardId)
      .whereNotNull('vin')
      .whereRaw("LENGTH(vin) = 17")
      .whereNull('vin_decoded_at')
      .select('id', 'vin', 'year', 'make', 'model')
      .limit(500);

    plog.info({ count: rows.length }, 'PostScrape: VIN decode starting');

    for (let i = 0; i < rows.length; i += 50) {
      const batch = rows.slice(i, i + 50);
      const vins = batch.map(r => r.vin.trim().toUpperCase());
      const results = await decodeBatch(vins);

      if (results.length === 0) {
        stats.errors += batch.length;
        continue;
      }

      const resultMap = {};
      for (const r of results) {
        if (r.VIN) resultMap[r.VIN.toUpperCase()] = r;
      }

      for (const row of batch) {
        const r = resultMap[row.vin.toUpperCase()];
        if (!r) {
          await database('yard_vehicle').where('id', row.id).update({ vin_decoded_at: new Date() });
          stats.vinsDecoded++;
          continue;
        }

        const decodedTrim = cleanDecodedTrim(r.Trim || null);
        const decodedEngine = r.DisplacementL ? `${r.DisplacementL}L` : null;
        const decodedCylinders = r.Cylinders ? parseInt(r.Cylinders) : null;
        const decodedDrivetrain = r.DriveType || null;
        let decodedTransmission = r.TransmissionStyle || null;
        const transmissionSpeeds = r.TransmissionSpeeds || null;
        const fuelType = r.FuelTypePrimary || null;
        const isDiesel = /diesel/i.test(fuelType || '') || /diesel|cummins|duramax|power.?stroke|tdi|cdi|ecodiesel|crd/i.test(decodedEngine || '');

        // Trim tier lookup
        let trimTier = null;
        let audioBrand = null;
        let expectedParts = null;
        let cult = false;
        const makeTc = titleCase(row.make || r.Make || '');
        const modelTc = titleCase(row.model || r.Model || '');
        const yearNum = parseInt(r.ModelYear || row.year) || 0;

        if (decodedTrim || decodedEngine) {
          const result = await lookupTrimTier(yearNum, makeTc, modelTc, decodedTrim, decodedEngine, decodedTransmission, decodedDrivetrain);
          trimTier = result.tier;
          if (result.extra) {
            audioBrand = result.extra.audioBrand;
            expectedParts = result.extra.expectedParts;
            cult = result.extra.cult;
            if (result.extra.transmission && !decodedTransmission) {
              decodedTransmission = result.extra.transmission;
            }
          }
        }

        const updateData = {
          decoded_trim: decodedTrim,
          decoded_engine: decodedEngine,
          decoded_cylinders: decodedCylinders,
          decoded_drivetrain: decodedDrivetrain,
          decoded_transmission: decodedTransmission,
          transmission_speeds: transmissionSpeeds,
          trim_tier: trimTier,
          vin_decoded_at: new Date(),
          updatedAt: new Date(),
        };
        try { updateData.audio_brand = audioBrand; } catch (e) {}
        try { updateData.expected_parts = expectedParts; } catch (e) {}
        try { updateData.cult = cult; } catch (e) {}
        try { updateData.diesel = isDiesel; } catch (e) {}

        try {
          await database('yard_vehicle').where('id', row.id).update(updateData);
          stats.vinsDecoded++;
          if (trimTier) stats.trimsTiered++;
        } catch (e) {
          stats.errors++;
        }
      }

      // Brief pause between batches (local decode, no rate limit needed)
      if (i + 50 < rows.length) await new Promise(r => setTimeout(r, 50));
    }

    plog.info({ vinsDecoded: stats.vinsDecoded }, 'PostScrape: VIN decode complete');
  } catch (err) {
    plog.error({ err: err.message }, 'PostScrape: VIN decode failed');
    stats.errors++;
  }

  // ── STEP 2: TRIM TIER for non-VIN vehicles ─────────────
  // Vehicles without VINs can still get trim tier from yard-scraped trim field
  try {
    const untiered = await database('yard_vehicle')
      .where('yard_id', yardId)
      .where('active', true)
      .whereNull('trim_tier')
      .whereNotNull('make')
      .whereNotNull('model')
      .select('id', 'year', 'make', 'model', 'trim', 'engine', 'drivetrain')
      .limit(500);

    if (untiered.length > 0) {
      plog.info({ count: untiered.length }, 'PostScrape: Trim tier matching (non-VIN)');

      for (const v of untiered) {
        try {
          const makeTc = titleCase(v.make);
          const modelTc = titleCase(v.model);
          const yearNum = parseInt(v.year) || 0;
          const trimName = v.trim || null;
          const engineDisp = v.engine || null;
          const drivetr = v.drivetrain || null;

          if (!trimName && !engineDisp) continue;

          const result = await lookupTrimTier(yearNum, makeTc, modelTc, trimName, engineDisp, null, drivetr);
          if (result.tier) {
            const upd = { trim_tier: result.tier, updatedAt: new Date() };
            if (result.extra) {
              if (result.extra.cult) upd.cult = true;
              if (result.extra.diesel) upd.diesel = true;
              if (result.extra.audioBrand) upd.audio_brand = result.extra.audioBrand;
              if (result.extra.expectedParts) upd.expected_parts = result.extra.expectedParts;
            }
            await database('yard_vehicle').where('id', v.id).update(upd);
            stats.trimsTiered++;
          }
        } catch (e) {
          stats.errors++;
        }
      }
    }
  } catch (err) {
    plog.error({ err: err.message }, 'PostScrape: Trim tier matching failed');
  }

  // ── STEP 3: SCOUT ALERTS (non-blocking) ─────────────────
  try {
    const { generateAlerts } = require('./ScoutAlertService');
    generateAlerts().catch(err => {
      plog.warn({ err: err.message }, 'PostScrape: Scout alert generation failed');
    });
  } catch (e) { /* table may not exist yet */ }

  const elapsed = Date.now() - startTime;
  plog.info({ ...stats, elapsed }, 'PostScrape: enrichment complete');
  return stats;
}

module.exports = { enrichYard };
