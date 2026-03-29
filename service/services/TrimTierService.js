'use strict';

const { database } = require('../database/database');

const TIER_MAP = {
  1: { tier: 'BASE', multiplier: 0.0 },
  2: { tier: 'CHECK', multiplier: 0.5 },
  3: { tier: 'PREMIUM', multiplier: 1.0 },
  4: { tier: 'PERFORMANCE', multiplier: 1.3 },
};

// Make aliases: Dodge ↔ Ram, Chevy ↔ Chevrolet, Mercedes ↔ Mercedes-Benz
const MAKE_ALIASES = {
  'chevrolet': ['chevy'],
  'chevy': ['chevrolet'],
  'mercedes-benz': ['mercedes'],
  'mercedes': ['mercedes-benz'],
  'dodge': ['ram'],
  'ram': ['dodge'],
};

function getMakeVariants(make) {
  const norm = (make || '').trim().toLowerCase();
  const aliases = MAKE_ALIASES[norm] || [];
  return [norm, ...aliases];
}

// Model normalization: strip body codes, normalize common names
const MODEL_NORMALIZATIONS = {
  'CRV': 'CR-V', 'HRV': 'HR-V', 'RAV 4': 'RAV4',
  'F150': 'F-150', 'F250': 'F-250', 'F350': 'F-350',
  'E350': 'E-350', 'E450': 'E-450',
  'CX5': 'CX-5', 'CX9': 'CX-9', 'CX3': 'CX-3',
  'MX5': 'MX-5',
};

function cleanModelForLookup(model, make) {
  if (!model) return model;
  let clean = model.trim();

  // Strip Dodge/RAM/Chrysler/Jeep body codes (DS1, DS6, DJ7, etc.)
  if (/dodge|ram|chrysler|jeep/i.test(make || '')) {
    clean = clean.replace(/\b[A-Z]{2}\d\b/gi, '');
  }

  // Strip BMW standalone 2-letter option codes (keep real models)
  if (/bmw/i.test(make || '')) {
    const realModels = new Set(['X1','X2','X3','X4','X5','X6','X7','M2','M3','M4','M5','M6','M8','Z3','Z4','I3','I4','I5','I7','I8']);
    clean = clean.replace(/\b([A-Z]{2})\b/gi, (m, code) => realModels.has(code.toUpperCase()) ? code : '');
  }

  // Normalize common model name variations
  for (const [from, to] of Object.entries(MODEL_NORMALIZATIONS)) {
    clean = clean.replace(new RegExp('\\b' + from + '\\b', 'gi'), to);
  }

  // Remove duplicate consecutive words ("350 350" → "350")
  clean = clean.replace(/\b(\w+)\s+\1\b/gi, '$1');

  // Clean leftover punctuation and whitespace
  clean = clean.replace(/,\s*,/g, ',').replace(/^[,\s]+|[,\s]+$/g, '').replace(/\s{2,}/g, ' ').trim();

  return clean;
}

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
 * Supports make aliases (Dodge↔Ram, Chevy↔Chevrolet), model normalization,
 * and ±1 year tolerance.
 */
async function lookup(year, make, model, trimName, engineDisplacement) {
  if (!make || !model) return null;

  try {
    const makeVariants = getMakeVariants(make);
    const modelCleaned = cleanModelForLookup(model, make);
    const modelNorm = (modelCleaned || '').toLowerCase();
    const yearNum = parseInt(year) || 0;

    // Handle Dodge/Ram model naming: "RAM 1500" → try both "Ram 1500" and "1500"
    const modelVariants = [modelNorm];
    if (/^ram\s+/i.test(modelNorm)) modelVariants.push(modelNorm.replace(/^ram\s+/i, ''));
    if (makeVariants.includes('ram') && !modelNorm.startsWith('ram')) modelVariants.push('ram ' + modelNorm);

    // Build base query with make aliases + model variants + year range
    const baseQuery = () => database('trim_tier_reference')
      .whereRaw('LOWER(make) IN (' + makeVariants.map(() => '?').join(',') + ')', makeVariants)
      .whereRaw('LOWER(model) IN (' + modelVariants.map(() => '?').join(',') + ')', modelVariants)
      .where('gen_start', '<=', yearNum || 9999)
      .where('gen_end', '>=', yearNum || 0);

    // Year-tolerant fallback query (±1 year)
    const tolerantQuery = () => database('trim_tier_reference')
      .whereRaw('LOWER(make) IN (' + makeVariants.map(() => '?').join(',') + ')', makeVariants)
      .whereRaw('LOWER(model) IN (' + modelVariants.map(() => '?').join(',') + ')', modelVariants)
      .where('gen_start', '<=', yearNum + 1)
      .where('gen_end', '>=', yearNum - 1);

    // Get all candidates for cult checks
    let candidates = await baseQuery().select('*');
    if (candidates.length === 0) {
      // Year tolerance fallback
      candidates = await tolerantQuery().select('*');
    }

    if (candidates.length === 0) return null;

    const allCult = candidates.every(c => c.cult === true);

    // === TRIM MATCHING ===
    let match = null;

    if (trimName) {
      const trimLower = trimName.toLowerCase().trim();

      // 1. Exact trim match
      match = candidates.find(c => (c.trim || '').toLowerCase() === trimLower) || null;

      // 2. Starts-with match
      if (!match) {
        match = candidates
          .filter(c => trimLower.startsWith((c.trim || '').toLowerCase()))
          .sort((a, b) => (b.trim || '').length - (a.trim || '').length)[0] || null;
      }

      // 3. First-word match
      if (!match) {
        const firstWord = trimLower.split(/\s+/)[0];
        if (firstWord && firstWord.length >= 2) {
          match = candidates.find(c => (c.trim || '').toLowerCase() === firstWord) || null;
        }
      }
    }

    if (match) {
      // Cult: matched entry is cult, OR the entire model is cult
      const isCult = match.cult === true || allCult;
      return formatResult(match, false, isCult);
    }

    // === ENGINE-BASED INFERENCE ===
    if (engineDisplacement) {
      const engineNum = (engineDisplacement || '').replace(/[^0-9.]/g, '');
      if (engineNum && engineNum.length >= 2) {
        const engineMatches = candidates.filter(c => {
          if (!c.top_engine) return false;
          const refNum = c.top_engine.replace(/[^0-9.]/g, '');
          if (!refNum || refNum.length < 2) return false;
          return refNum.startsWith(engineNum) || engineNum.startsWith(refNum);
        });

        if (engineMatches.length > 0) {
          const tiers = [...new Set(engineMatches.map(c => c.tier))];
          // Cult: inferred entry is cult, OR entire model is cult
          const inferredCult = (entry) => entry.cult === true || allCult;

          if (tiers.length === 1) {
            const best = engineMatches.reduce((a, b) => a.tier > b.tier ? a : b);
            const result = formatResult(best, true, inferredCult(best));
            result.engineConfident = true;
            return result;
          } else {
            const conservative = engineMatches.reduce((a, b) => a.tier < b.tier ? a : b);
            const result = formatResult(conservative, true, inferredCult(conservative));
            result.engineConfident = false;
            return result;
          }
        }
      }
    }

    // === NO TRIM, NO ENGINE MATCH — check if entire model is cult ===
    if (allCult) {
      const best = candidates.reduce((a, b) => a.tier > b.tier ? a : b);
      return formatResult(best, false, true);
    }

    // Return highest-tier reference (best-case) without cult
    if (!trimName) {
      const best = candidates.reduce((a, b) => a.tier > b.tier ? a : b);
      return formatResult(best, false, false);
    }

    return null;
  } catch (e) {
    return null;
  }
}

module.exports = { lookup, cleanModelForLookup, getMakeVariants };
