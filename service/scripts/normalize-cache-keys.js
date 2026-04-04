'use strict';
require('dotenv').config();
const { database } = require('../database/database');

async function normalize() {
  console.log('=== CLEAN PIPE PHASE D — CACHE KEY NORMALIZATION ===\n');

  // Step 1: Tag YMM keys
  var ymmResult = await database('market_demand_cache')
    .whereRaw("part_number_base LIKE '%|%'")
    .update({ key_type: 'ymm' });
  console.log('Tagged ' + ymmResult + ' YMM keys');

  // Step 2: Get all PN keys
  var pnRows = await database('market_demand_cache')
    .whereRaw("part_number_base NOT LIKE '%|%'")
    .select('id', 'part_number_base', 'last_updated');

  console.log('Found ' + pnRows.length + ' PN keys to check');

  // Step 3: Compute normalized versions and find duplicates
  function normalizeKey(key) {
    return (key || '').replace(/[\s\-\.]/g, '').toUpperCase();
  }

  var groups = {};
  for (var i = 0; i < pnRows.length; i++) {
    var row = pnRows[i];
    var norm = normalizeKey(row.part_number_base);
    if (!groups[norm]) groups[norm] = [];
    groups[norm].push({
      id: row.id,
      original: row.part_number_base,
      lastUpdated: new Date(row.last_updated),
    });
  }

  // Step 4: Handle duplicates — keep newest, delete rest
  var deleted = 0;
  var renamed = 0;
  var alreadyClean = 0;

  var normKeys = Object.keys(groups);
  for (var k = 0; k < normKeys.length; k++) {
    var norm = normKeys[k];
    var entries = groups[norm];

    entries.sort(function(a, b) { return b.lastUpdated - a.lastUpdated; });
    var keeper = entries[0];
    var losers = entries.slice(1);

    if (losers.length > 0) {
      var loserIds = losers.map(function(l) { return l.id; });
      await database('market_demand_cache').whereIn('id', loserIds).del();
      deleted += losers.length;
    }

    if (keeper.original !== norm) {
      await database('market_demand_cache')
        .where('id', keeper.id)
        .update({ part_number_base: norm, key_type: 'pn' });
      renamed++;
    } else {
      await database('market_demand_cache')
        .where('id', keeper.id)
        .update({ key_type: 'pn' });
      alreadyClean++;
    }
  }

  console.log('\nResults:');
  console.log('  Already clean: ' + alreadyClean);
  console.log('  Renamed (normalized): ' + renamed);
  console.log('  Duplicates deleted: ' + deleted);
  console.log('  Total remaining: ' + (alreadyClean + renamed));

  // Step 5: Verify
  var remaining = await database('market_demand_cache')
    .whereRaw("part_number_base NOT LIKE '%|%'")
    .whereRaw("part_number_base ~ '[\\s\\-\\.]'")
    .count('* as cnt')
    .first();
  console.log('\nVerification: ' + remaining.cnt + ' keys still have spaces/dashes/dots (should be 0)');
}

normalize()
  .then(function() { console.log('\nDone!'); process.exit(0); })
  .catch(function(e) { console.error('FAILED:', e.message); process.exit(1); });
