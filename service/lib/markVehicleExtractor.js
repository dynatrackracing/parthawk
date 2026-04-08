'use strict';

const { parseYearRange } = require('../utils/yearParser');
const { parseTitle } = require('../utils/partMatcher');

/**
 * Extract structured vehicle fields from a Mark title string.
 * Best effort — returns nulls for fields that can't be determined.
 * Sets needs_review = true if year cannot be determined.
 */
function extractMarkVehicle(title) {
  const result = {
    year_start: null,
    year_end: null,
    make: null,
    model: null,
    needs_review: false,
  };

  if (!title) {
    result.needs_review = true;
    return result;
  }

  // Year extraction — uses the canonical parser (fixed in 56774b6)
  const yearRange = parseYearRange(title);
  if (yearRange && yearRange.start) {
    result.year_start = yearRange.start;
    result.year_end = yearRange.end || yearRange.start;
  }

  // Make/model extraction
  const parsed = parseTitle(title);
  if (parsed) {
    result.make = parsed.make || null;
    result.model = (parsed.models && parsed.models[0]) || null;
  }

  // Needs review if year is missing — this is the core invariant
  if (!result.year_start) {
    result.needs_review = true;
  }

  return result;
}

/**
 * Same as above, but accepts pre-known structured values (e.g. from sky_watch_research)
 * and fills gaps from title parsing only when structured values are missing.
 */
function extractMarkVehicleWithFallback(title, known) {
  known = known || {};
  const fromTitle = extractMarkVehicle(title);
  const year = known.year ? parseInt(known.year) : null;
  return {
    year_start: year || fromTitle.year_start,
    year_end: year || fromTitle.year_end,
    make: known.make || fromTitle.make,
    model: known.model || fromTitle.model,
    needs_review: !(year || fromTitle.year_start),
  };
}

module.exports = { extractMarkVehicle, extractMarkVehicleWithFallback };
