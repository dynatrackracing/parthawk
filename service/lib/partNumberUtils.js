'use strict';

/**
 * Part Number Normalization
 *
 * Strips known revision suffixes from OEM part numbers to produce a
 * normalized "base" part number. All restock logic, dead inventory
 * scoring, and market lookups run against the normalized base.
 *
 * Rules per spec:
 * - Chrysler/Mopar: strip trailing 2-letter alpha suffix (AA, AB, AC, etc.)
 * - GM: strip trailing 2-letter alpha suffix if present
 * - Ford: strip trailing 2-letter or single-digit suffix
 *
 * Examples:
 *   68269652AA → 68269652    (Chrysler)
 *   68269652AB → 68269652    (Chrysler revision)
 *   12345678   → 12345678    (no suffix)
 *   AL3Z-2C204-A → AL3Z-2C204 (Ford)
 */

// Chrysler/Mopar pattern: 8+ digit number followed by 2 uppercase letters
const CHRYSLER_SUFFIX = /^(\d{7,})[A-Z]{2}$/;

// GM pattern: alphanumeric base followed by 2 uppercase letters at end
// e.g., 12630037AB → 12630037
const GM_SUFFIX = /^(\d{7,})[A-Z]{2}$/;

// Ford pattern: alphanumeric with dashes, trailing 1-2 char suffix after last dash
// e.g., AL3Z-2C204-A → AL3Z-2C204, BL3Z-14B205-AB → BL3Z-14B205
const FORD_SUFFIX = /^([A-Z0-9]+-[A-Z0-9]+)-[A-Z]{1,2}$/;

// Generic: any part number ending in 2 uppercase letters after a run of digits
const GENERIC_SUFFIX = /^(.{6,}?)[A-Z]{2}$/;

/**
 * Normalize a part number by stripping revision suffixes.
 * Returns the base part number.
 */
function normalizePartNumber(partNumber) {
  if (!partNumber || typeof partNumber !== 'string') return partNumber || null;

  const pn = partNumber.trim().toUpperCase().replace(/\s+/g, '');
  if (pn.length < 4) return pn;

  // Try Ford pattern first (has dashes)
  if (pn.includes('-')) {
    const fordMatch = pn.match(FORD_SUFFIX);
    if (fordMatch) return fordMatch[1];
    return pn;
  }

  // Try Chrysler/GM pattern (digits + 2-letter suffix)
  const chryslerMatch = pn.match(CHRYSLER_SUFFIX);
  if (chryslerMatch) return chryslerMatch[1];

  // Generic fallback: strip trailing 2 alpha if preceded by at least 6 chars
  const genericMatch = pn.match(GENERIC_SUFFIX);
  if (genericMatch) return genericMatch[1];

  return pn;
}

module.exports = { normalizePartNumber };
