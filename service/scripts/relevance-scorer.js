'use strict';

/**
 * Relevance Scorer
 *
 * Evaluates how closely a scraped sold item matches our item.
 * Returns a score from 0-100 and details about what matched.
 *
 * Scoring weights:
 * - Part Type match: 40 points (most important)
 * - Make match: 25 points
 * - Model match: 20 points
 * - Year overlap: 15 points
 */

const { extractPartType, extractMake, extractModel, extractYears } = require('./smart-query-builder');

/**
 * Parse year range string into [start, end]
 */
function parseYearRange(yearStr) {
  if (!yearStr) return null;

  if (yearStr.includes('-')) {
    const [start, end] = yearStr.split('-').map(y => parseInt(y));
    return [start, end];
  }

  const year = parseInt(yearStr);
  return [year, year];
}

/**
 * Check if two year ranges overlap
 */
function yearsOverlap(range1, range2) {
  if (!range1 || !range2) return false;
  const [start1, end1] = range1;
  const [start2, end2] = range2;
  return start1 <= end2 && start2 <= end1;
}

/**
 * Normalize part type for comparison
 */
function normalizePartType(partType) {
  if (!partType) return null;
  return partType
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/module|unit|assembly/g, '')
    .trim();
}

/**
 * Calculate relevance score between our item and a scraped item
 *
 * @param {Object} ourItem - { title, make, model, years, partType }
 * @param {Object} scrapedItem - { title, price, soldDate }
 * @returns {Object} { score, breakdown, isRelevant }
 */
function scoreRelevance(ourItem, scrapedItem) {
  const scraped = {
    title: scrapedItem.title,
    partType: extractPartType(scrapedItem.title),
    make: extractMake(scrapedItem.title),
    model: extractModel(scrapedItem.title, extractMake(scrapedItem.title)),
    years: extractYears(scrapedItem.title),
  };

  const breakdown = {
    partType: 0,
    make: 0,
    model: 0,
    years: 0,
  };

  // Part Type match (40 points)
  const ourPartNorm = normalizePartType(ourItem.partType);
  const scrapedPartNorm = normalizePartType(scraped.partType);

  if (ourPartNorm && scrapedPartNorm) {
    if (ourPartNorm === scrapedPartNorm) {
      breakdown.partType = 40;
    } else if (ourPartNorm.includes(scrapedPartNorm) || scrapedPartNorm.includes(ourPartNorm)) {
      breakdown.partType = 30; // Partial match
    } else {
      // Check for common abbreviations
      const ourParts = ourPartNorm.split(' ');
      const scrapedParts = scrapedPartNorm.split(' ');
      const overlap = ourParts.filter(p => scrapedParts.includes(p));
      if (overlap.length > 0) {
        breakdown.partType = 20;
      }
    }
  }

  // Make match (25 points)
  if (ourItem.make && scraped.make) {
    if (ourItem.make.toLowerCase() === scraped.make.toLowerCase()) {
      breakdown.make = 25;
    }
  }

  // Model match (20 points)
  if (ourItem.model && scraped.model) {
    const ourModel = ourItem.model.toLowerCase().replace(/[-\s]/g, '');
    const scrapedModel = scraped.model.toLowerCase().replace(/[-\s]/g, '');
    if (ourModel === scrapedModel) {
      breakdown.model = 20;
    } else if (ourModel.includes(scrapedModel) || scrapedModel.includes(ourModel)) {
      breakdown.model = 15;
    }
  }

  // Year overlap (15 points)
  const ourYears = parseYearRange(ourItem.years);
  const scrapedYears = parseYearRange(scraped.years);
  if (yearsOverlap(ourYears, scrapedYears)) {
    breakdown.years = 15;
  } else if (ourYears && scrapedYears) {
    // Close years (within 2 years) get partial credit
    const [ourStart] = ourYears;
    const [scrapedStart] = scrapedYears;
    if (Math.abs(ourStart - scrapedStart) <= 2) {
      breakdown.years = 8;
    }
  }

  const score = breakdown.partType + breakdown.make + breakdown.model + breakdown.years;

  // Consider relevant if:
  // - Part type matches (score >= 30 for part type) - MUST match part type
  // - AND make matches OR (model + year match)
  const hasPartMatch = breakdown.partType >= 30;
  const hasMakeMatch = breakdown.make >= 25;
  const hasModelYearMatch = breakdown.model >= 15 && breakdown.years >= 8;
  const isRelevant = hasPartMatch && (hasMakeMatch || hasModelYearMatch);

  return {
    score,
    breakdown,
    isRelevant,
    extracted: scraped,
  };
}

/**
 * Filter and score scraped items, returning only relevant ones
 * Uses isRelevant flag (part type match + make/model-year match) not just score threshold
 */
function filterRelevantItems(ourItem, scrapedItems) {
  const scored = scrapedItems.map(item => ({
    ...item,
    relevance: scoreRelevance(ourItem, item),
  }));

  // Use the isRelevant flag which requires part type match AND (make OR model+year)
  const relevant = scored.filter(item => item.relevance.isRelevant);

  // Sort by relevance score descending
  relevant.sort((a, b) => b.relevance.score - a.relevance.score);

  return {
    total: scrapedItems.length,
    relevant: relevant.length,
    filtered: scrapedItems.length - relevant.length,
    items: relevant,
    avgScore: relevant.length > 0
      ? relevant.reduce((sum, i) => sum + i.relevance.score, 0) / relevant.length
      : 0,
  };
}

// Test the scorer
if (require.main === module) {
  console.log('=== Relevance Scorer Test ===\n');

  const ourItem = {
    title: 'BMW 323i 328i 528i 1999 2000 Electronic Throttle Body Assembly',
    make: 'BMW',
    model: '3-series',
    years: '1999-2000',
    partType: 'throttle body',
  };

  const testScrapedItems = [
    { title: 'BMW 323i E46 Throttle Body 1999-2001', price: 89.99 },
    { title: 'BMW 528i Throttle Body Assembly 2000', price: 95.00 },
    { title: 'Honda Civic Throttle Body 1999', price: 45.00 },  // Wrong make
    { title: 'BMW 323i Headlight Assembly 2000', price: 120.00 },  // Wrong part
    { title: 'BMW E46 325i Throttle Body 2001 2002', price: 85.00 },  // Close match
    { title: 'Generic Throttle Body Universal', price: 25.00 },  // No make/model
  ];

  console.log('Our Item:', ourItem.title);
  console.log('Part Type:', ourItem.partType);
  console.log('Make:', ourItem.make);
  console.log('Model:', ourItem.model);
  console.log('Years:', ourItem.years);
  console.log('\n--- Scoring Scraped Items ---\n');

  testScrapedItems.forEach((item, i) => {
    const result = scoreRelevance(ourItem, item);
    const status = result.isRelevant ? '✓ RELEVANT' : '✗ FILTERED';
    console.log(`[${i + 1}] ${item.title}`);
    console.log(`    Score: ${result.score}/100 | ${status}`);
    console.log(`    Breakdown: Part=${result.breakdown.partType} Make=${result.breakdown.make} Model=${result.breakdown.model} Year=${result.breakdown.years}`);
    console.log('');
  });

  const filtered = filterRelevantItems(ourItem, testScrapedItems);
  console.log(`--- Summary: ${filtered.relevant}/${filtered.total} items relevant (avg score: ${filtered.avgScore.toFixed(1)}) ---`);
}

module.exports = { scoreRelevance, filterRelevantItems };
