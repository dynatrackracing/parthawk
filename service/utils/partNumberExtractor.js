// File: utils/partNumberExtractor.js

/**
 * Extracts OEM part numbers from a string (title, description, etc.)
 * Returns array of candidate part numbers, best match first.
 *
 * Covers: Chrysler (56044691AA), Ford (9L34-2C405-A, CT43-2C405-BB),
 * GM (22030-65010, 25888289), Toyota (89661-35A80), Honda (37820-R70-A79),
 * Nissan (284B1-JK600), BMW (61.35-6 943 834), Mercedes (A 164 900 54 01),
 * VW/Audi (1K0 614 517 DL), Hyundai/Kia (91950-3W010), generic alphanumeric
 */
function extractPartNumbers(text) {
  if (!text) return [];

  const candidates = [];
  const seen = new Set();

  // Normalize: collapse multiple spaces, trim
  const t = text.replace(/\s+/g, ' ').trim();

  const patterns = [
    // Ford: XX99-9X999-XX or XX99X-9X999-XX (with or without dashes)
    /\b[A-Z]{1,2}\d{1,2}[A-Z]?-\d[A-Z]\d{3,4}-[A-Z]{1,2}\b/gi,

    // Ford digit-first: 9L34-2C405-A, 7C3T-14B205-AA (starts with digit)
    /\b\d[A-Z]\d{1,2}-\d[A-Z]\d{3,4}-[A-Z]{1,2}\b/gi,

    // Chrysler/Mopar: 8-digit + 2-letter suffix (56044691AA)
    /\b\d{8}[A-Z]{2}\b/gi,

    // Chrysler short: P05026036AD, 04896146AA (leading letter optional)
    /\b[A-Z]?\d{7,8}[A-Z]{2}\b/gi,

    // GM: 8-digit no suffix (25888289) — only match if 8+ digits
    /\b\d{8,10}\b/g,

    // Toyota/Lexus: 89661-35A80, 22030-65010
    /\b\d{5}-[A-Z0-9]{4,6}\b/gi,

    // Honda/Acura: 37820-R70-A79
    /\b\d{5}-[A-Z0-9]{2,4}-[A-Z0-9]{2,4}\b/gi,

    // Nissan/Infiniti: 284B1-JK600
    /\b\d{3,5}[A-Z]\d-[A-Z]{2}\d{3}\b/gi,

    // VW/Audi: 1K0 614 517 DL or 1K0614517DL
    /\b\d[A-Z]\d[\s]?\d{3}[\s]?\d{3}[\s]?[A-Z]{1,2}\b/gi,

    // BMW: 61.35-6 943 834 or 61356943834
    /\b\d{2}\.?\d{2}-?\d[\s]?\d{3}[\s]?\d{3}\b/gi,

    // Mercedes: A 164 900 54 01 or A1649005401
    /\b[A-Z]\s?\d{3}\s?\d{3}\s?\d{2}\s?\d{2}\b/gi,

    // Hyundai/Kia: 91950-3W010
    /\b\d{5}-\d[A-Z]\d{3}\b/gi,

    // Generic: alphanumeric with at least one letter and one digit, 6+ chars
    // This catches things like 5g1t15604bz that don't match specific OEM patterns
    /\b(?=[A-Z0-9]*[A-Z])(?=[A-Z0-9]*\d)[A-Z0-9]{6,}\b/gi,
  ];

  for (const pattern of patterns) {
    const matches = t.match(pattern) || [];
    for (const m of matches) {
      const normalized = m.toUpperCase().replace(/[\s.-]/g, '');
      if (!seen.has(normalized) && !isCommonWord(normalized)) {
        seen.add(normalized);
        candidates.push({
          raw: m,
          normalized: normalized,
          // Strip revision suffix for base matching
          base: stripRevisionSuffix(normalized)
        });
      }
    }
  }

  return candidates;
}

/**
 * Strip OEM revision suffixes to get the base part number.
 * 56044691AA → 56044691, 9L34-2C405-A → 9L342C405
 */
function stripRevisionSuffix(pn) {
  // Chrysler: remove trailing 2-letter suffix from 8-digit numbers
  if (/^\d{8}[A-Z]{2}$/.test(pn)) return pn.slice(0, 8);
  // Ford: remove last segment after final dash
  if (/^[A-Z]{1,2}\d{1,2}[A-Z]?\d[A-Z]\d{3,4}[A-Z]{1,2}$/.test(pn)) {
    return pn.replace(/[A-Z]{1,2}$/, '');
  }
  return pn;
}

/**
 * Filter out common words that look like part numbers but aren't.
 * Years, common abbreviations, model codes etc.
 */
function isCommonWord(s) {
  // Years 1990-2030
  if (/^(199\d|20[0-3]\d)$/.test(s)) return true;
  // Common abbreviations
  const skip = new Set([
    'TESTED', 'PROGRAMMED', 'MODULE', 'CONTROL', 'ASSEMBLY',
    'INTERIOR', 'EXTERIOR', 'ELECTRIC', 'ELECTRONIC',
    'DISCOUNT', 'PRICES', 'CHECK', 'OEM', 'GENUINE',
    'STOCKED', 'KEYWORD', 'MATCH'
  ]);
  return skip.has(s);
}

module.exports = { extractPartNumbers, stripRevisionSuffix };
