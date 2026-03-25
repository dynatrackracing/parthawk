'use strict';

// Re-export from shared partMatcher — this file exists for backwards compatibility
// All new code should import from ../utils/partMatcher directly
const { normalizePartNumber, extractPartNumbers } = require('../utils/partMatcher');

module.exports = { normalizePartNumber, extractPartNumbers };
