'use strict';

const { database } = require('../database/database');

const TIER_MAP = {
  1: { tier: 'BASE', multiplier: 0.0 },
  2: { tier: 'CHECK', multiplier: 0.5 },
  3: { tier: 'PREMIUM', multiplier: 1.0 },
  4: { tier: 'PERFORMANCE', multiplier: 1.3 },
};

/**
 * TrimTierService — lookups against the 1,049-row trim_tier_reference table.
 * This is the PRIMARY trim lookup source. trim_catalog and static config are fallbacks.
 */

/**
 * Lookup a vehicle's trim tier from trim_tier_reference.
 * Fuzzy trim matching: exact → starts-with → first-word.
 *
 * @param {number} year
 * @param {string} make
 * @param {string} model
 * @param {string} trimName - decoded trim from NHTSA (may be null)
 * @returns {{ tierString, multiplier, audioBrand, expectedParts, cult, topEngine, notes } | null}
 */
async function lookup(year, make, model, trimName) {
  if (!make || !model) return null;

  try {
    // Build base query: make + model (case-insensitive) + year in range
    const baseQuery = () => database('trim_tier_reference')
      .whereRaw('LOWER(make) = ?', [(make || '').toLowerCase()])
      .whereRaw('LOWER(model) = ?', [(model || '').toLowerCase()])
      .where('gen_start', '<=', year || 9999)
      .where('gen_end', '>=', year || 0);

    let match = null;

    if (trimName) {
      const trimLower = trimName.toLowerCase().trim();

      // 1. Exact trim match
      match = await baseQuery()
        .whereRaw('LOWER(trim) = ?', [trimLower])
        .first();

      // 2. Starts-with match (NHTSA may return "Laramie Crew Cab" but we have "Laramie")
      if (!match) {
        match = await baseQuery()
          .whereRaw('? LIKE LOWER(trim) || \'%\'', [trimLower])
          .orderByRaw('LENGTH(trim) DESC')
          .first();
      }

      // 3. First-word match
      if (!match) {
        const firstWord = trimLower.split(/\s+/)[0];
        if (firstWord && firstWord.length >= 2) {
          match = await baseQuery()
            .whereRaw('LOWER(trim) = ?', [firstWord])
            .first();
        }
      }
    }

    // 4. No trim provided — return highest-tier match for this vehicle (best-case reference)
    if (!match && !trimName) {
      match = await baseQuery()
        .orderBy('tier', 'desc')
        .first();
    }

    if (!match) return null;

    const tierInfo = TIER_MAP[match.tier] || TIER_MAP[2];

    return {
      tierString: tierInfo.tier,
      multiplier: tierInfo.multiplier,
      audioBrand: match.audio_brand || null,
      expectedParts: match.expected_parts || null,
      cult: match.cult === true,
      topEngine: match.top_engine || null,
      notes: match.notes || null,
      tierNum: match.tier,
      trimName: match.trim,
    };
  } catch (e) {
    // Table may not exist yet
    return null;
  }
}

module.exports = { lookup };
