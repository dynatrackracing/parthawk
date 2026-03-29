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

  // BMW: convert model numbers to series names (328I → 3 Series, X5 XDRIVE35I → X5)
  if (/bmw/i.test(make || '')) {
    const bmwSeriesMap = [
      { pattern: /\b3[0-9]{2}[A-Z]*\b/i, series: '3 Series' },
      { pattern: /\bM3\b/i, series: '3 Series' },
      { pattern: /\b5[0-9]{2}[A-Z]*\b/i, series: '5 Series' },
      { pattern: /\bM5\b/i, series: '5 Series' },
      { pattern: /\b4[0-9]{2}[A-Z]*\b/i, series: '4 Series' },
      { pattern: /\bM4\b/i, series: '4 Series' },
      { pattern: /\b7[0-9]{2}[A-Z]*\b/i, series: '7 Series' },
      { pattern: /\b2[0-9]{2}[A-Z]*\b/i, series: '2 Series' },
      { pattern: /\bM2\b/i, series: '2 Series' },
      { pattern: /\b6[0-9]{2}[A-Z]*\b/i, series: '6 Series' },
      { pattern: /\bM6\b/i, series: '6 Series' },
      { pattern: /\b8[0-9]{2}[A-Z]*\b/i, series: '8 Series' },
      { pattern: /\bM8\b/i, series: '8 Series' },
    ];
    let matched = false;
    for (const { pattern, series } of bmwSeriesMap) {
      if (pattern.test(clean)) { clean = series; matched = true; break; }
    }
    if (!matched) {
      // X models: strip xDrive/sDrive suffixes — "X5 XDRIVE35I" → "X5"
      clean = clean.replace(/\b(X[1-7])\s*[A-Z]*DRIVE\d*[A-Z]*/i, '$1');
      // Strip standalone 2-letter option codes (keep real models)
      const realModels = new Set(['X1','X2','X3','X4','X5','X6','X7','Z3','Z4','I3','I4','I5','I7','I8']);
      clean = clean.replace(/\b([A-Z]{2})\b/gi, (m, code) => realModels.has(code.toUpperCase()) ? code : '');
    }
  }

  // Mercedes-Benz: convert model numbers to class names (C300 → C-Class, ML350 → ML)
  if (/mercedes/i.test(make || '')) {
    const mbSeriesMap = [
      { pattern: /\bC\s*\d{2,3}\b/i, series: 'C-Class' },
      { pattern: /\bE\s*\d{2,3}\b/i, series: 'E-Class' },
      { pattern: /\bS\s*\d{2,3}\b/i, series: 'S-Class' },
      { pattern: /\bGLS\s*\d{2,3}\b/i, series: 'GLS' },
      { pattern: /\bGLE\s*\d{2,3}\b/i, series: 'GLE' },
      { pattern: /\bGLC\s*\d{2,3}\b/i, series: 'GLC' },
      { pattern: /\bGLA\s*\d{2,3}\b/i, series: 'GLA' },
      { pattern: /\bCLA\s*\d{2,3}\b/i, series: 'CLA' },
      { pattern: /\bGL[A-Z]*\s*\d{2,3}\b/i, series: 'GLE' },
      { pattern: /\bML\s*\d{2,3}\b/i, series: 'ML' },
    ];
    for (const { pattern, series } of mbSeriesMap) {
      if (pattern.test(clean)) { clean = series; break; }
    }
  }

  // Lexus: ES350 → ES, RX300 → RX, IS250 → IS, GX470 → GX, NX200T → NX
  if (/lexus/i.test(make || '')) {
    clean = clean.replace(/\b([A-Z]{2,3})\s*\d{2,3}[A-Z]?\b/gi, (m, prefix) => prefix.toUpperCase());
  }

  // Infiniti: M35 → M, FX35 → FX, QX56 → QX
  if (/infiniti/i.test(make || '')) {
    clean = clean.replace(/\b([A-Z]{1,2})\s*\d{2,3}\b/gi, (m, prefix) => prefix.toUpperCase());
  }

  // Chrysler 300 — ensure "300C" normalizes to "300" for reference lookup
  if (/chrysler/i.test(make || '')) {
    clean = clean.replace(/\b300[A-Z]?\b/gi, '300');
  }

  // Ford F-250/F-350 SUPER DUTY → F-250/F-350
  clean = clean.replace(/\bSUPER\s*DUTY\b/gi, '').trim();

  // Ford E-series: E-150, E-250, E-350, ECONOLINE → E-Series
  clean = clean.replace(/\bE[\-\s]?(150|250|350)\s*(ECONOLINE|VAN)?\b/gi, 'E-Series');
  clean = clean.replace(/\bECONOLINE\b/gi, 'E-Series');

  // Express 1500/2500/3500 → Express
  clean = clean.replace(/\bEXPRESS\s*\d{4}\b/gi, 'Express');

  // Acura model cleanup — strip trailing generation numbers
  if (/acura/i.test(make || '')) {
    clean = clean.replace(/\b(RDX|MDX|TLX|ILX|TSX|TL|RSX|RL|CL|CDX)\s*\d+\b/gi, (m, model) => model.toUpperCase());
  }

  // Suburban 1500/2500 → Suburban (LKQ adds the tonnage)
  clean = clean.replace(/\bSUBURBAN\s+1500\b/gi, 'Suburban');
  clean = clean.replace(/\bSUBURBAN\s+2500\b/gi, 'Suburban');

  // Yukon XL 1500 → Yukon XL
  clean = clean.replace(/\bYUKON\s+XL\s+1500\b/gi, 'Yukon XL');

  // Avalanche 1500 → Avalanche
  clean = clean.replace(/\bAVALANCHE\s+1500\b/gi, 'Avalanche');

  // Mazda: LKQ stores model as just "3" or "6" but reference uses "Mazda3" or "Mazda6"
  if (/mazda/i.test(make || '')) {
    clean = clean.replace(/^3$/i, 'Mazda3');
    clean = clean.replace(/^6$/i, 'Mazda6');
    clean = clean.replace(/^5$/i, 'Mazda5');
    clean = clean.replace(/^CX-?5$/i, 'CX-5');
    clean = clean.replace(/^CX-?9$/i, 'CX-9');
  }

  // Strip NHTSA trim lists stuffed into model names ("CAMRY LE/SE/XLE" → "CAMRY")
  clean = clean.replace(/\s+(LE|SE|XLE|XSE|LX|EX|LT|LS|SL|SV|SR|DX|SXT|SLT|XLT|SEL|Limited|Sport|Base|Premium|Luxury|Touring)(\/[A-Za-z]+)*\s*$/i, '');
  clean = clean.replace(/\s+[A-Z]{1,4}(\/[A-Z]{1,4}){2,}\s*$/i, '');
  clean = clean.replace(/\b(NFA|NFB|NFC|CMA)\b/gi, '');

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
    diesel: match.diesel || false,
    transmission: match.transmission || null,
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
async function lookup(year, make, model, trimName, engineDisplacement, transmission, drivetrain) {
  if (!make || !model) return null;

  // Diesel detection from engine string — catches cases where reference entry lacks diesel flag
  function applyDiesel(result) {
    if (!result) return result;
    if (engineDisplacement && /diesel|cummins|duramax|power.?stroke|tdi|cdi|ecodiesel|crd/i.test(engineDisplacement)) {
      result.diesel = true;
    }
    return result;
  }

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

    // BMW: the model number IS the trim identity (325i, 528i, M3, etc.)
    if (/bmw/i.test(make) && !trimName && model) {
      const originalModel = model.toUpperCase().trim();
      const mCarMatch = originalModel.match(/\b(M[2-8])\b/);
      const numericMatch = originalModel.match(/\b([1-8]\d{2})[A-Z]*/);
      if (mCarMatch) {
        trimName = mCarMatch[1];
      } else if (numericMatch) {
        trimName = numericMatch[1] + 'i';
      }
    }

    // Mercedes: model number is the trim identity (C300, E350, etc.)
    if (/mercedes/i.test(make) && !trimName && model) {
      const originalModel = model.toUpperCase().trim();
      const mbMatch = originalModel.match(/\b([A-Z]{1,3}\s*\d{2,3})\b/);
      if (mbMatch) {
        trimName = mbMatch[1].replace(/\s+/g, '');
      }
    }

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
      return applyDiesel(formatResult(match, false, isCult));
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

        // Transmission-based filtering when ambiguous
        if (transmission && engineMatches.length > 1) {
          const isManual = /manual/i.test(transmission);
          const isDCT = /dual.clutch|dct|dsg|sst|pdk/i.test(transmission);
          if (isManual || isDCT) {
            const isTruck = /1500|2500|3500|f-?150|f-?250|f-?350|silverado|sierra|tundra|tacoma|ranger|colorado|frontier|titan/i.test(modelNorm || '');
            if (!isTruck || isDCT) {
              // Manual on cars or DCT anywhere biases toward sport/performance
              const sportFiltered = engineMatches.filter(c => c.tier >= 3);
              if (sportFiltered.length > 0) {
                engineMatches.splice(0, engineMatches.length, ...sportFiltered);
              }
            }
          }
        }

        if (engineMatches.length > 0) {
          const tiers = [...new Set(engineMatches.map(c => c.tier))];
          // Cult: inferred entry is cult, OR entire model is cult
          const inferredCult = (entry) => entry.cult === true || allCult;

          if (tiers.length === 1) {
            const best = engineMatches.reduce((a, b) => a.tier < b.tier ? a : b);
            const result = formatResult(best, true, inferredCult(best));
            result.engineConfident = true;
            return applyDiesel(result);
          } else {
            const conservative = engineMatches.reduce((a, b) => a.tier < b.tier ? a : b);
            const result = formatResult(conservative, true, inferredCult(conservative));
            result.engineConfident = false;
            return applyDiesel(result);
          }
        }
      }
    }

    // === ENGINE CONTRADICTION: engine provided but matched nothing ===
    // If we had engine data and it didn't match any candidate's top_engine,
    // don't fall through to "best case" — that would give PERFORMANCE to a base vehicle
    if (engineDisplacement && !trimName) {
      const engineNum = (engineDisplacement || '').replace(/[^0-9.]/g, '');
      if (engineNum && engineNum.length >= 2) {
        const anyEngineMatch = candidates.some(c => {
          if (!c.top_engine) return false;
          const refNum = c.top_engine.replace(/[^0-9.]/g, '');
          if (!refNum || refNum.length < 2) return false;
          return refNum.startsWith(engineNum) || engineNum.startsWith(refNum);
        });
        if (!anyEngineMatch) {
          // Engine doesn't match any known trim — only return if entire model is cult
          if (allCult) {
            const lowest = candidates.reduce((a, b) => a.tier < b.tier ? a : b);
            return applyDiesel(formatResult(lowest, false, true));
          }
          return null; // No match — don't guess
        }
      }
    }

    // === NO TRIM, NO ENGINE MATCH — check if entire model is cult ===
    if (allCult) {
      const lowest = candidates.reduce((a, b) => a.tier < b.tier ? a : b);
      return applyDiesel(formatResult(lowest, false, true));
    }

    // Return lowest-tier reference (conservative) without cult
    if (!trimName) {
      const lowest = candidates.reduce((a, b) => a.tier < b.tier ? a : b);
      return applyDiesel(formatResult(lowest, false, false));
    }

    return null;
  } catch (e) {
    return null;
  }
}

module.exports = { lookup, cleanModelForLookup, getMakeVariants };
