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

function formatResult(match, engineInferred, cultOverride) {
  const tierInfo = TIER_MAP[match.tier] || TIER_MAP[2];
  return {
    tierString: tierInfo.tier,
    multiplier: tierInfo.multiplier,
    audioBrand: match.audio_brand || null,
    expectedParts: match.expected_parts || null,
    cult: cultOverride !== undefined ? cultOverride : (match.cult === true),
    topEngine: match.top_engine || null,
    notes: match.notes || null,
    tierNum: match.tier,
    trimName: match.trim,
    engineInferred: engineInferred || false,
    engineConfident: false,
  };
}

/**
 * Lookup a vehicle's trim tier from trim_tier_reference.
 * Fuzzy trim matching: exact → starts-with → first-word → engine inference.
 *
 * @param {number} year
 * @param {string} make
 * @param {string} model
 * @param {string} trimName - decoded trim from NHTSA (may be null)
 * @param {string} engineDisplacement - e.g. "5.7L", "3.6", "6.2L Supercharged" (may be null)
 * @returns {{ tierString, multiplier, audioBrand, expectedParts, cult, topEngine, notes, engineInferred, engineConfident } | null}
 */
async function lookup(year, make, model, trimName, engineDisplacement) {
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

    // If we matched by trim, return it
    if (match) return formatResult(match, false);

    // 5. Engine-based inference when trim is unknown
    if (engineDisplacement) {
      const engineNum = (engineDisplacement || '').replace(/[^0-9.]/g, ''); // "5.7L" → "5.7"
      if (engineNum && engineNum.length >= 2) {
        // Get ALL candidates for this make/model/year
        const candidates = await baseQuery().select('*');

        if (candidates.length > 0) {
          const engineMatches = candidates.filter(c => {
            if (!c.top_engine) return false;
            const refNum = c.top_engine.replace(/[^0-9.]/g, '');
            if (!refNum || refNum.length < 2) return false; // skip EV/empty engines
            // Match if displacement starts the same (e.g., "5.7" matches "5.7L HEMI")
            return refNum.startsWith(engineNum) || engineNum.startsWith(refNum);
          });

          if (engineMatches.length > 0) {
            const tiers = [...new Set(engineMatches.map(c => c.tier))];
            // Cult is true if ANY matching entry OR any candidate for this vehicle is cult
            const isCult = engineMatches.some(c => c.cult === true) || candidates.some(c => c.cult === true);

            if (tiers.length === 1) {
              // Confident: only one tier has this engine
              const best = engineMatches.reduce((a, b) => a.tier > b.tier ? a : b);
              const result = formatResult(best, true, isCult);
              result.engineConfident = true;
              return result;
            } else {
              // Ambiguous: multiple tiers share this engine, use lowest (conservative)
              const conservative = engineMatches.reduce((a, b) => a.tier < b.tier ? a : b);
              const result = formatResult(conservative, true, isCult);
              result.engineConfident = false;
              return result;
            }
          }

          // No engine match but we have candidates — check if all are cult
          const allCult = candidates.every(c => c.cult === true);
          if (allCult) {
            // All trims for this vehicle are cult — return null tier but cult=true
            const best = candidates.reduce((a, b) => a.tier > b.tier ? a : b);
            const result = formatResult(best, true, true);
            result.engineConfident = false;
            return result;
          }
        }
      }
    }

    // 6. No trim, no engine match — return highest-tier reference (best-case)
    if (!trimName) {
      match = await baseQuery()
        .orderBy('tier', 'desc')
        .first();
      if (match) return formatResult(match, false);
    }

    return null;
  } catch (e) {
    // Table may not exist yet
    return null;
  }
}

module.exports = { lookup };
