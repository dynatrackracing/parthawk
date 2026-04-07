'use strict';

/**
 * yearParser.js — Canonical 2-digit and 4-digit year parser for DarkHawk
 *
 * Single source of truth for parsing years from eBay listing titles.
 * Handles: 4-digit ranges, 4-digit space-separated, 2-digit dash ranges,
 * 2-digit space-separated, 2-digit slash ranges, standalone 2-digit with
 * contextual make-following rule.
 *
 * Used by: partIntelligence.js, partMatcher.js, AttackListService.js,
 * restock-want-list.js, attack-list.js route
 */

// Make names for contextual 2-digit year validation (Pattern D).
// Lowercase keys only. Must stay in sync with MAKE_NORMALIZE in partIntelligence.js.
const MAKE_NAMES = new Set([
  'chevrolet', 'chevy', 'dodge', 'ram', 'chrysler', 'jeep', 'ford', 'gmc',
  'toyota', 'honda', 'nissan', 'bmw', 'mercedes', 'mercedes-benz', 'mazda',
  'kia', 'hyundai', 'subaru', 'mitsubishi', 'infiniti', 'lexus', 'acura',
  'cadillac', 'buick', 'lincoln', 'volvo', 'audi', 'volkswagen', 'vw',
  'mini', 'pontiac', 'saturn', 'mercury', 'scion', 'land rover', 'porsche',
  'jaguar', 'saab', 'fiat', 'genesis', 'suzuki', 'isuzu', 'oldsmobile',
  'hummer', 'plymouth', 'datsun', 'renault',
]);

/**
 * Convert a 2-digit year to 4-digit.
 * 80-99 → 1980-1999, 00-35 → 2000-2035.
 * Returns null if out of valid range.
 */
function twoDigitToFour(d) {
  const n = typeof d === 'string' ? parseInt(d, 10) : d;
  if (isNaN(n)) return null;
  if (n >= 80 && n <= 99) return 1900 + n;
  if (n >= 0 && n <= 35) return 2000 + n;
  return null;
}

/**
 * Check if a word (lowercase) is a known make name.
 * Also checks two-word makes by accepting a second word.
 */
function isMake(word, nextWord) {
  if (!word) return false;
  const w = word.toLowerCase();
  if (MAKE_NAMES.has(w)) return true;
  if (nextWord) {
    const twoWord = w + ' ' + nextWord.toLowerCase();
    if (MAKE_NAMES.has(twoWord)) return true;
  }
  return false;
}

/**
 * Parse year range from a title string.
 * Returns { start, end } or null.
 *
 * Pattern priority (first match wins):
 * 1. 4-digit dash range: "2007-2011", "1999–2000", "1994-97"
 * 2. 2-digit dash range: "07-11", "94-97"
 * 3. 4-digit space-separated: "2005 2006", "2005 2006 2007"
 * 4. 2-digit space-separated: "97 98", "99 00 01"
 * 5. 2-digit slash range: "07/11", "97/98"
 * 6. Single 4-digit year: "2014"
 * 7. Standalone 2-digit at start of string: "13 Caravan..."
 * 8. Standalone 2-digit mid-title before a known make: "94 LEXUS"
 */
function parseYearRange(title) {
  if (!title) return null;

  // === PATTERN 1: 4-digit dash/en-dash range (with optional 2-digit end) ===
  // "2007-2011", "1999–2000", "1994-97"
  const rangeMatch = title.match(/\b((?:19|20)\d{2})\s*[-–]\s*((?:19|20)?\d{2,4})\b/);
  if (rangeMatch) {
    let start = parseInt(rangeMatch[1]);
    let end = parseInt(rangeMatch[2]);
    if (end < 100) end += (end < 50 ? 2000 : 1900);
    return { start: Math.min(start, end), end: Math.max(start, end) };
  }

  // === PATTERN 2: 2-digit dash/en-dash range ===
  // "07-11", "94-97"
  const shortRange = title.match(/\b(\d{2})\s*[-–]\s*(\d{2})\b/);
  if (shortRange) {
    const s = twoDigitToFour(shortRange[1]);
    const e = twoDigitToFour(shortRange[2]);
    if (s && e) {
      return { start: Math.min(s, e), end: Math.max(s, e) };
    }
  }

  // === PATTERN 3: 4-digit space-separated pairs/triples ===
  // "2005 2006", "2005 2006 2007"
  const fourDigitSpaced = title.match(/\b((?:19|20)\d{2})(?:\s+((?:19|20)\d{2})){1,4}\b/);
  if (fourDigitSpaced) {
    // Extract all 4-digit years from the matched region
    const allYears = fourDigitSpaced[0].match(/(?:19|20)\d{2}/g).map(Number);
    // Validate years are close together (within 10 years)
    const mn = Math.min(...allYears), mx = Math.max(...allYears);
    if (mx - mn <= 10) {
      return { start: mn, end: mx };
    }
  }

  // === PATTERN 4: 2-digit space-separated pairs/triples ===
  // "97 98", "99 00 01", "07 08 09"
  // Must appear within first 40 chars OR immediately before a known make
  const twoDigitSpacedRe = /\b(\d{2})((?:\s+\d{2}){1,4})\b/g;
  let tdsMatch;
  while ((tdsMatch = twoDigitSpacedRe.exec(title)) !== null) {
    const fullMatch = tdsMatch[0];
    const pos = tdsMatch.index;
    const nums = fullMatch.split(/\s+/).map(Number);

    // All numbers must be valid 2-digit years
    const converted = nums.map(twoDigitToFour);
    if (converted.some(y => y === null)) continue;

    // Position constraint: within first 40 chars OR followed by a make
    const afterMatch = title.substring(pos + fullMatch.length).trim();
    const nextWords = afterMatch.split(/\s+/);
    const followedByMake = isMake(nextWords[0], nextWords[1]);
    if (pos >= 40 && !followedByMake) continue;

    // Verify these look like years, not other numbers: check range continuity
    // (all converted years should span at most 10 years)
    const mn = Math.min(...converted), mx = Math.max(...converted);
    if (mx - mn <= 10) {
      return { start: mn, end: mx };
    }
  }

  // === PATTERN 5: 2-digit slash range ===
  // "07/11", "97/98"
  const slashMatch = title.match(/\b(\d{2})\/(\d{2})\b/);
  if (slashMatch) {
    const s = twoDigitToFour(slashMatch[1]);
    const e = twoDigitToFour(slashMatch[2]);
    if (s && e) {
      const pos = slashMatch.index;
      const afterMatch = title.substring(pos + slashMatch[0].length).trim();
      const nextWords = afterMatch.split(/\s+/);
      const followedByMake = isMake(nextWords[0], nextWords[1]);
      if (pos < 40 || followedByMake) {
        return { start: Math.min(s, e), end: Math.max(s, e) };
      }
    }
  }

  // === PATTERN 6: Single 4-digit year ===
  // "2014 Ford Explorer"
  const singleMatch = title.match(/\b((?:19|20)\d{2})\b/);
  if (singleMatch) {
    const yr = parseInt(singleMatch[1]);
    if (yr >= 1980 && yr <= 2030) return { start: yr, end: yr };
  }

  // === PATTERN 7: 2-digit year at start of string, followed by a make ===
  // "94 Lexus ES300..." → 1994, but "94 ECM" → null
  const shortStart = title.match(/^(\d{2})\s+(\S+)\s*(\S*)/);
  if (shortStart) {
    const y = twoDigitToFour(shortStart[1]);
    if (y && isMake(shortStart[2], shortStart[3])) {
      return { start: y, end: y };
    }
  }

  // === PATTERN 8: Standalone 2-digit year mid-title before a known make ===
  // "REBUILT PROGRAMMED 94 LEXUS ES300" → 1994
  // Strict rules:
  //   - Must be a standalone number (word boundary on both sides)
  //   - Must NOT be preceded by $, #, x, or be inside a part number (hyphen-adjacent)
  //   - Must be immediately followed (within 1-3 words) by a known make
  //   - Must be in valid 2-digit year range (80-99 or 00-35)
  const midTitleRe = /(?:^|\s)(\d{2})\s+/g;
  let mtMatch;
  while ((mtMatch = midTitleRe.exec(title)) !== null) {
    const digitStr = mtMatch[1];
    const pos = mtMatch.index;

    // Check preceding character — skip if $, #, x, or hyphen
    if (pos > 0) {
      const preceding = title[pos === mtMatch.index && mtMatch[0][0] !== digitStr[0] ? pos : pos - 1];
      if (preceding === '$' || preceding === '#' || preceding === 'x' || preceding === 'X' || preceding === '-') continue;
    }

    // Convert to 4-digit
    const yr = twoDigitToFour(digitStr);
    if (!yr) continue;

    // Check what follows: the next 1-3 words must contain a known make
    const afterDigit = title.substring(mtMatch.index + mtMatch[0].length).trim();
    const words = afterDigit.split(/\s+/);
    let foundMake = false;
    for (let i = 0; i < Math.min(words.length, 3); i++) {
      if (isMake(words[i], words[i + 1])) {
        foundMake = true;
        break;
      }
    }
    if (!foundMake) continue;

    return { start: yr, end: yr };
  }

  return null;
}

module.exports = { parseYearRange, twoDigitToFour, MAKE_NAMES };
