'use strict';
require('dotenv').config();
const { Model } = require('objection');
const { database } = require('../database/database');
Model.knex(database);

const { extractStructuredFields } = require('../utils/partIntelligence');

async function backfill(tableName, titleColumn) {
  titleColumn = titleColumn || 'title';
  console.log('\n=== Backfilling ' + tableName + ' ===');

  var totalResult = await database(tableName).count('* as cnt').first();
  var total = parseInt(totalResult.cnt);

  var filledResult = await database(tableName)
    .whereNotNull('partType')
    .count('* as cnt').first();
  var filled = parseInt(filledResult.cnt);

  console.log('  Total rows: ' + total + ', Already filled: ' + filled + ', To process: ' + (total - filled));

  if (filled >= total) {
    console.log('  Skipping — all rows already backfilled');
    return { table: tableName, total: total, processed: 0, extracted: { pn: 0, type: 0, make: 0, model: 0 } };
  }

  var BATCH_SIZE = 500;
  var processed = 0;
  var extracted = { pn: 0, type: 0, make: 0, model: 0 };

  while (true) {
    var rows = await database(tableName)
      .whereNull('partType')
      .whereNotNull(titleColumn)
      .select('id', titleColumn)
      .limit(BATCH_SIZE);

    if (rows.length === 0) break;

    for (var i = 0; i < rows.length; i++) {
      var row = rows[i];
      var title = row[titleColumn];
      if (!title) continue;

      var fields = extractStructuredFields(title);

      await database(tableName)
        .where('id', row.id)
        .update({
          partNumberBase: fields.partNumberBase || null,
          partType: fields.partType || 'OTHER',
          extractedMake: fields.extractedMake || null,
          extractedModel: fields.extractedModel || null,
        });

      processed++;
      if (fields.partNumberBase) extracted.pn++;
      if (fields.partType) extracted.type++;
      if (fields.extractedMake) extracted.make++;
      if (fields.extractedModel) extracted.model++;
    }

    console.log('  Processed ' + processed + ' rows...');
  }

  console.log('  Done: ' + processed + ' rows updated');
  console.log('  Extracted: PN=' + extracted.pn + ', Type=' + extracted.type + ', Make=' + extracted.make + ', Model=' + extracted.model);

  return { table: tableName, total: total, processed: processed, extracted: extracted };
}

async function main() {
  console.log('=== CLEAN PIPE PHASE B — BACKFILL ===');
  console.log('Time: ' + new Date().toISOString() + '\n');

  var start = Date.now();

  var results = [];
  results.push(await backfill('YourSale', 'title'));
  results.push(await backfill('YourListing', 'title'));
  results.push(await backfill('SoldItem', 'title'));

  var elapsed = ((Date.now() - start) / 1000).toFixed(1);

  console.log('\n=== BACKFILL COMPLETE ===');
  console.log('Total time: ' + elapsed + 's');
  console.table(results.map(function(r) {
    return {
      table: r.table,
      total: r.total,
      processed: r.processed,
      pn: r.extracted.pn,
      type: r.extracted.type,
      make: r.extracted.make,
      model: r.extracted.model,
    };
  }));
}

main()
  .then(function() { process.exit(0); })
  .catch(function(err) {
    console.error('BACKFILL FAILED:', err);
    process.exit(1);
  });
