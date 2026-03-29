'use strict';

/**
 * DECODE YARD VINS
 *
 * Batch-decodes VINs from yard_vehicle using NHTSA API.
 * Stores decoded_trim, decoded_engine, decoded_drivetrain, and trim_tier.
 * Safe to run repeatedly - skips already-decoded VINs.
 *
 * Usage: node decode-yard-vins.js
 * Requires: DATABASE_URL env var
 */

const knex = require('knex');
const axios = require('axios').default;
const path = require('path');
const { getTrimTier } = require('./service/config/trim-tier-config');
const TrimTierService = require('./service/services/TrimTierService');

try { require('dotenv').config({ path: path.resolve(__dirname, '.env') }); } catch (e) {}

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('DATABASE_URL is required');
  process.exit(1);
}

const db = knex({
  client: 'pg',
  connection: {
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  },
  pool: { min: 1, max: 3 },
});

function titleCase(str) {
  if (!str) return str;
  return str.toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function decodeBatch(vins) {
  const data = `format=json&data=${vins.join(';')}`;
  try {
    const response = await axios.post(
      'https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVINValuesBatch/',
      data,
      {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        timeout: 30000,
      }
    );
    return response.data?.Results || [];
  } catch (err) {
    console.error(`  NHTSA batch error: ${err.message}`);
    return [];
  }
}

async function lookupTrimTier(year, make, model, trimName, engineDisplacement, transmission, drivetrain) {
  if (!trimName && !engineDisplacement) return { tier: null, extra: null };

  // TIER 1: trim_tier_reference (1,049-row curated table — most accurate)
  // Handles trim, engine, transmission, and drivetrain signals
  try {
    const ref = await TrimTierService.lookup(year, make, model, trimName, engineDisplacement, transmission, drivetrain);
    if (ref) return { tier: ref.tierString, extra: ref };
  } catch (e) {}

  // TIER 2: trim_catalog (eBay Taxonomy API data)
  try {
    const match = await db('trim_catalog')
      .where('year', year)
      .whereRaw('LOWER(make) = ?', [make.toLowerCase()])
      .whereRaw('LOWER(model) = ?', [model.toLowerCase()])
      .whereRaw('LOWER(trim_name) = ?', [trimName.toLowerCase()])
      .first();
    if (match) return { tier: match.tier, extra: null };

    const firstWord = trimName.split(/\s+/)[0];
    if (firstWord && firstWord.length >= 2) {
      const partial = await db('trim_catalog')
        .where('year', year)
        .whereRaw('LOWER(make) = ?', [make.toLowerCase()])
        .whereRaw('LOWER(model) = ?', [model.toLowerCase()])
        .whereRaw('LOWER(trim_name) LIKE ?', [firstWord.toLowerCase() + '%'])
        .first();
      if (partial) return { tier: partial.tier, extra: null };
    }
  } catch (e) {}

  // TIER 3: Static config fallback
  const result = getTrimTier(make, trimName);
  return { tier: result.tier, extra: null };
}

async function main() {
  console.log('=== DECODE YARD VINS ===');
  console.log('Time:', new Date().toISOString());

  // Check columns exist
  try {
    await db.raw("SELECT decoded_trim FROM yard_vehicle LIMIT 0");
  } catch (e) {
    console.error('decoded_trim column not found - run migration first');
    await db.destroy();
    return;
  }

  // Get undecoded VINs
  const rows = await db('yard_vehicle')
    .whereNotNull('vin')
    .whereRaw("LENGTH(vin) = 17")
    .whereNull('vin_decoded_at')
    .select('id', 'vin', 'year', 'make', 'model')
    .limit(10000);

  console.log(`Found ${rows.length} VINs to decode`);

  if (rows.length === 0) {
    console.log('Nothing to decode. Done.');
    await db.destroy();
    return;
  }

  let totalDecoded = 0;
  let withTrim = 0;
  let noTrim = 0;
  let errors = 0;

  // Process in batches of 50
  for (let i = 0; i < rows.length; i += 50) {
    const batch = rows.slice(i, i + 50);
    const vins = batch.map(r => r.vin);

    const results = await decodeBatch(vins);

    if (results.length === 0) {
      errors += batch.length;
      console.log(`  Batch ${i}-${i + batch.length}: NHTSA error, skipping`);
      await sleep(2000);
      continue;
    }

    // Map results by VIN
    const resultMap = {};
    for (const r of results) {
      if (r.VIN) resultMap[r.VIN.toUpperCase()] = r;
    }

    for (const row of batch) {
      const r = resultMap[row.vin.toUpperCase()];
      if (!r) {
        // No result for this VIN - mark as decoded with nulls
        await db('yard_vehicle').where('id', row.id).update({ vin_decoded_at: new Date() });
        noTrim++;
        totalDecoded++;
        continue;
      }

      const decodedTrim = r.Trim || null;
      const decodedEngine = r.DisplacementL ? `${r.DisplacementL}L` : null;
      const decodedDrivetrain = r.DriveType || null;
      const decodedTransmission = r.TransmissionStyle || null;
      const transmissionSpeeds = r.TransmissionSpeeds || null;

      // Look up trim tier
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
        }
        if (decodedTrim) withTrim++;
        else noTrim++;
      } else {
        noTrim++;
      }

      const updateData = {
        decoded_trim: decodedTrim,
        decoded_engine: decodedEngine,
        decoded_drivetrain: decodedDrivetrain,
        decoded_transmission: decodedTransmission,
        transmission_speeds: transmissionSpeeds,
        trim_tier: trimTier,
        vin_decoded_at: new Date(),
      };
      // Add new columns if they exist on the table
      try { updateData.audio_brand = audioBrand; } catch (e) {}
      try { updateData.expected_parts = expectedParts; } catch (e) {}
      try { updateData.cult = cult; } catch (e) {}

      await db('yard_vehicle').where('id', row.id).update(updateData);

      totalDecoded++;
    }

    console.log(`  Decoded ${Math.min(i + 50, rows.length)}/${rows.length} VINs... (${withTrim} with trim, ${noTrim} no trim)`);
    await sleep(1000);
  }

  console.log('\n=== VIN DECODE COMPLETE ===');
  console.log(`Total decoded: ${totalDecoded}`);
  console.log(`With trim: ${withTrim}`);
  console.log(`No trim: ${noTrim}`);
  console.log(`Errors: ${errors}`);

  // Print tier distribution
  try {
    const dist = await db('yard_vehicle')
      .whereNotNull('trim_tier')
      .select('trim_tier')
      .count('* as count')
      .groupBy('trim_tier');
    console.log('\nTrim tier distribution:');
    for (const row of dist) {
      console.log(`  ${row.trim_tier}: ${row.count}`);
    }
  } catch (e) {}

  await db.destroy();
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
