#!/usr/bin/env node
'use strict';

/**
 * reprocess-clean-pipe.js — Re-extract Clean Pipe fields on rows with gaps.
 *
 * Targets rows where:
 * 1. extractedModel is NULL (model extraction failed)
 * 2. partType is NULL or OTHER
 * 3. partNumberBase looks like a year range (8 digits starting with 19/20)
 *
 * Only updates if the new extraction produces better results.
 * Rerunnable — safe to run multiple times.
 *
 * Usage: DATABASE_URL="..." node service/scripts/reprocess-clean-pipe.js
 */

const { database } = require('../database/database');
const { extractStructuredFields } = require('../utils/partIntelligence');

async function reprocessTable(tableName) {
  // Fetch rows that need reprocessing
  const rows = await database(tableName)
    .whereNotNull('title')
    .where(function() {
      this.whereNull('extractedModel')
        .orWhereNull('partType')
        .orWhere('partType', 'OTHER')
        .orWhereRaw("\"partNumberBase\" ~ '^(19|20)\\d{2}(19|20)\\d{2}$'");
    })
    .select('id', 'title', 'partNumberBase', 'partType', 'extractedMake', 'extractedModel');

  let updated = 0;
  let modelFixed = 0;
  let typeFixed = 0;
  let pnFixed = 0;

  for (const row of rows) {
    const fields = extractStructuredFields(row.title);
    const patch = {};
    let changed = false;

    // Fix model: was null, now has a value
    if (!row.extractedModel && fields.extractedModel) {
      patch.extractedModel = fields.extractedModel;
      modelFixed++;
      changed = true;
    }

    // Fix make: was null, now has a value
    if (!row.extractedMake && fields.extractedMake) {
      patch.extractedMake = fields.extractedMake;
      changed = true;
    }

    // Fix partType: was null/OTHER, now has a specific type
    if ((!row.partType || row.partType === 'OTHER') && fields.partType && fields.partType !== 'OTHER') {
      patch.partType = fields.partType;
      typeFixed++;
      changed = true;
    }

    // Fix partNumberBase: was a year range, now has a real PN
    if (row.partNumberBase && /^(19|20)\d{2}(19|20)\d{2}$/.test(row.partNumberBase)) {
      if (fields.partNumberBase && !/^(19|20)\d{2}(19|20)\d{2}$/.test(fields.partNumberBase)) {
        patch.partNumberBase = fields.partNumberBase;
        pnFixed++;
        changed = true;
      } else {
        patch.partNumberBase = null; // clear the junk
        pnFixed++;
        changed = true;
      }
    }

    if (changed) {
      await database(tableName).where('id', row.id).update(patch);
      updated++;
    }
  }

  console.log(`${tableName}: ${updated} updated (model: ${modelFixed}, type: ${typeFixed}, pn: ${pnFixed}) out of ${rows.length} candidates`);
  return { updated, modelFixed, typeFixed, pnFixed };
}

async function main() {
  console.log('Reprocessing Clean Pipe fields...\n');

  const t1 = await reprocessTable('YourListing');
  const t2 = await reprocessTable('YourSale');
  const t3 = await reprocessTable('SoldItem');

  const total = t1.updated + t2.updated + t3.updated;
  console.log(`\nTotal: ${total} rows updated`);

  // Verify the rollover sensor
  const check = await database.raw(`
    SELECT title, "partNumberBase", "partType", "extractedMake", "extractedModel"
    FROM "YourSale" WHERE title ILIKE '%rollover%' LIMIT 5
  `);
  console.log('\nRollover sensor after reprocess:');
  console.table(check.rows);

  // Check remaining OTHER count
  const otherCount = await database.raw(`SELECT COUNT(*) as cnt FROM "YourSale" WHERE "partType" = 'OTHER'`);
  console.log('Remaining YourSale OTHER count:', otherCount.rows[0].cnt);

  process.exit(0);
}

main().catch(err => { console.error(err); process.exit(1); });
