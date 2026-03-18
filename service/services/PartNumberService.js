'use strict';

/**
 * PartNumberService - Part number normalization and suffix stripping
 * 
 * Spec Section 7.2: Part numbers like 56044691AA and 56044691AB are the same part.
 * Store the base number 56044691 as canonical identifier.
 * 
 * Known suffix patterns:
 * - Chrysler/Mopar: two letter suffix (AA, AB, AC)
 * - GM: two letter suffix or none
 * - Ford: two letter or number suffix
 * - Honda/Toyota: usually no revision suffix
 */
class PartNumberService {

  /**
   * Normalize a part number to its base canonical form
   * Strips revision suffixes so AA, AB, AC all map to the same base
   */
  static normalize(partNumber) {
    if (!partNumber) return null;
    const p = partNumber.trim().toUpperCase();

    // Chrysler/Mopar: 8 digits + 2 letter suffix (e.g. 56044691AA → 56044691)
    const chryslerMatch = p.match(/^(\d{8,10})[A-Z]{2}$/);
    if (chryslerMatch) return chryslerMatch[1];

    // GM: 8 digit part number + optional 2 letter suffix
    const gmMatch = p.match(/^(\d{8})[A-Z]{0,2}$/);
    if (gmMatch) return gmMatch[1];

    // Ford: alphanumeric with dash + optional 2 char suffix (e.g. 3L3Z-14B205-AA → 3L3Z-14B205)
    const fordMatch = p.match(/^([A-Z0-9]+-[A-Z0-9]+-[A-Z0-9]+)-[A-Z]{2}$/);
    if (fordMatch) return fordMatch[1];

    // Ford alternate: ends in two letters (e.g. GV61-8C045-AB → GV61-8C045)
    const fordMatch2 = p.match(/^(.+)-[A-Z]{2}$/);
    if (fordMatch2 && fordMatch2[1].includes('-')) return fordMatch2[1];

    // Toyota/Honda: 5 digits dash 5 alphanumeric (usually no suffix)
    // Return as-is

    return p;
  }

  /**
   * Check if two part numbers are equivalent (same base)
   */
  static areEquivalent(pn1, pn2) {
    if (!pn1 || !pn2) return false;
    return this.normalize(pn1) === this.normalize(pn2);
  }

  /**
   * Get the suffix from a part number
   * Returns null if no suffix detected
   */
  static getSuffix(partNumber) {
    if (!partNumber) return null;
    const p = partNumber.trim().toUpperCase();
    const base = this.normalize(p);
    if (base === p) return null;
    return p.replace(base, '').replace(/^[-_]/, '');
  }

  /**
   * Given a list of part numbers, find all that share the same base
   */
  static groupByBase(partNumbers) {
    const groups = {};
    for (const pn of partNumbers) {
      const base = this.normalize(pn);
      if (!groups[base]) groups[base] = [];
      groups[base].push(pn);
    }
    return groups;
  }

  /**
   * Before inserting a sold item or listing, check for duplicates
   * Returns the normalized base number
   */
  static deduplicateKey(partNumber, vehicleApplication) {
    const base = this.normalize(partNumber);
    return `${base}|${vehicleApplication || 'unknown'}`;
  }
}

module.exports = PartNumberService;
