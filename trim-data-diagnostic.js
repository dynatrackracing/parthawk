/**
 * TRIM DATA DIAGNOSTIC - DarkHawk Trim Intelligence Validation
 * 
 * Run this against the live database to answer:
 * 1. Does the Auto table actually store distinct trim values?
 * 2. For trim-dependent parts (amps, cameras, sensors), do different trims appear?
 * 3. Is there enough differentiation to suppress base-trim scores?
 * 
 * Usage:
 *   set DATABASE_URL=postgresql://postgres:jOWykUhLuUbWSVASAAZZHqsDVfyqaFTN@switchyard.proxy.rlwy.net:12023/railway
 *   node trim-data-diagnostic.js
 */

'use strict';
require('dotenv').config();

const knex = require('knex')({
  client: 'pg',
  connection: process.env.DATABASE_URL,
  searchPath: ['public'],
});

async function run() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('  DARKHAWK TRIM DATA DIAGNOSTIC');
  console.log('═══════════════════════════════════════════════════════════\n');

  // ─── TEST 1: Overall trim data health ─────────────────────────
  console.log('── TEST 1: Overall Auto Table Trim Distribution ──\n');

  const totalAutos = await knex('Auto').count('* as count').first();
  const withTrim = await knex('Auto').whereNotNull('trim').where('trim', '!=', '').count('* as count').first();
  const nullTrim = await knex('Auto').where(function() {
    this.whereNull('trim').orWhere('trim', '');
  }).count('* as count').first();
  const distinctTrims = await knex('Auto').whereNotNull('trim').where('trim', '!=', '').countDistinct('trim as count').first();

  console.log(`  Total Auto records:     ${totalAutos.count}`);
  console.log(`  With trim data:         ${withTrim.count} (${((withTrim.count / totalAutos.count) * 100).toFixed(1)}%)`);
  console.log(`  Null/empty trim:        ${nullTrim.count} (${((nullTrim.count / totalAutos.count) * 100).toFixed(1)}%)`);
  console.log(`  Distinct trim values:   ${distinctTrims.count}`);

  // Top 20 most common trim values
  const topTrims = await knex('Auto')
    .select('trim')
    .count('* as count')
    .whereNotNull('trim')
    .where('trim', '!=', '')
    .groupBy('trim')
    .orderBy('count', 'desc')
    .limit(20);

  console.log('\n  Top 20 trim values:');
  topTrims.forEach(t => {
    console.log(`    ${String(t.count).padStart(5)} | ${t.trim}`);
  });

  // ─── TEST 2: Trim-dependent part scenarios ────────────────────
  console.log('\n\n── TEST 2: Trim-Dependent Part Scenarios ──');
  console.log('  (Do different trims show up for premium parts?)\n');

  const scenarios = [
    // The exact Ram problem from the discussion
    { make: 'Ram', model: '1500', yearStart: 2014, yearEnd: 2018, partKeyword: 'amplifier', label: 'Ram 1500 Amplifier' },
    { make: 'Dodge', model: 'Ram 1500', yearStart: 2014, yearEnd: 2018, partKeyword: 'amplifier', label: 'Dodge Ram 1500 Amplifier (alt make)' },

    // Ford F-150 camera
    { make: 'Ford', model: 'F-150', yearStart: 2015, yearEnd: 2020, partKeyword: 'camera', label: 'Ford F-150 Camera' },
    { make: 'Ford', model: 'F150', yearStart: 2015, yearEnd: 2020, partKeyword: 'camera', label: 'Ford F150 Camera (no dash)' },

    // Jeep Grand Cherokee amplifier
    { make: 'Jeep', model: 'Grand Cherokee', yearStart: 2014, yearEnd: 2020, partKeyword: 'amplifier', label: 'Jeep Grand Cherokee Amplifier' },

    // Toyota Highlander - parking sensor
    { make: 'Toyota', model: 'Highlander', yearStart: 2014, yearEnd: 2020, partKeyword: 'sensor', label: 'Toyota Highlander Sensor' },

    // Honda Accord - camera
    { make: 'Honda', model: 'Accord', yearStart: 2013, yearEnd: 2020, partKeyword: 'camera', label: 'Honda Accord Camera' },

    // Chevy Silverado amplifier
    { make: 'Chevrolet', model: 'Silverado', yearStart: 2014, yearEnd: 2020, partKeyword: 'amplifier', label: 'Chevy Silverado Amplifier' },

    // Now test UNIVERSAL parts - these should show ALL trims
    { make: 'Ram', model: '1500', yearStart: 2014, yearEnd: 2018, partKeyword: 'ECM', label: 'Ram 1500 ECM (universal - expect all trims)' },
    { make: 'Ford', model: 'F-150', yearStart: 2015, yearEnd: 2020, partKeyword: 'ABS', label: 'Ford F-150 ABS (universal - expect all trims)' },
    { make: 'Honda', model: 'Accord', yearStart: 2013, yearEnd: 2020, partKeyword: 'ECM', label: 'Honda Accord ECM (universal - expect all trims)' },
  ];

  for (const s of scenarios) {
    console.log(`  ┌─ ${s.label}`);
    console.log(`  │  Query: make=${s.make}, model LIKE '%${s.model}%', year ${s.yearStart}-${s.yearEnd}, title ILIKE '%${s.partKeyword}%'`);

    const results = await knex('Auto as a')
      .select('a.trim')
      .count('* as item_count')
      .innerJoin('AutoItemCompatibility as aic', 'a.id', 'aic.autoId')
      .innerJoin('Item as i', 'aic.itemId', 'i.id')
      .where('a.make', s.make)
      .where('a.model', 'like', `%${s.model}%`)
      .whereBetween('a.year', [s.yearStart, s.yearEnd])
      .whereRaw('i.title ILIKE ?', [`%${s.partKeyword}%`])
      .groupBy('a.trim')
      .orderBy('item_count', 'desc');

    if (results.length === 0) {
      console.log('  │  ⚠️  NO RESULTS - no compat data for this combo');
    } else {
      console.log(`  │  Found ${results.length} distinct trims:`);
      results.forEach(r => {
        const trimDisplay = r.trim || '(null/empty)';
        console.log(`  │    ${String(r.item_count).padStart(4)} items │ ${trimDisplay}`);
      });
    }
    console.log('  └─\n');
  }

  // ─── TEST 3: Sample Item titles for a scenario ────────────────
  console.log('\n── TEST 3: Sample Item Titles (what are these parts actually called?) ──\n');

  const sampleScenarios = [
    { make: 'Ram', model: '1500', yearStart: 2014, yearEnd: 2018, partKeyword: 'amplifier' },
    { make: 'Ford', model: 'F-150', yearStart: 2015, yearEnd: 2020, partKeyword: 'camera' },
    { make: 'Ram', model: '1500', yearStart: 2014, yearEnd: 2018, partKeyword: 'ECM' },
  ];

  for (const s of sampleScenarios) {
    console.log(`  ${s.make} ${s.model} ${s.yearStart}-${s.yearEnd} "${s.partKeyword}":`);

    const samples = await knex('Auto as a')
      .select('i.title', 'a.trim', 'a.year', 'i.price')
      .innerJoin('AutoItemCompatibility as aic', 'a.id', 'aic.autoId')
      .innerJoin('Item as i', 'aic.itemId', 'i.id')
      .where('a.make', s.make)
      .where('a.model', 'like', `%${s.model}%`)
      .whereBetween('a.year', [s.yearStart, s.yearEnd])
      .whereRaw('i.title ILIKE ?', [`%${s.partKeyword}%`])
      .limit(10);

    if (samples.length === 0) {
      console.log('    ⚠️  No items found\n');
    } else {
      samples.forEach(r => {
        const trimDisplay = r.trim || '(no trim)';
        console.log(`    [${r.year} ${trimDisplay}] $${r.price || '?'} │ ${(r.title || '').substring(0, 80)}`);
      });
      console.log('');
    }
  }

  // ─── TEST 4: Makes with best/worst trim coverage ─────────────
  console.log('\n── TEST 4: Trim Coverage by Make ──');
  console.log('  (Which makes have the best trim data in your compat tables?)\n');

  const makeCoverage = await knex('Auto')
    .select('make')
    .count('* as total')
    .countDistinct('trim as distinct_trims')
    .count(knex.raw("CASE WHEN trim IS NOT NULL AND trim != '' THEN 1 END as with_trim"))
    .groupBy('make')
    .orderBy('total', 'desc')
    .limit(20);

  console.log('  ' + 'Make'.padEnd(20) + 'Total'.padStart(8) + 'w/Trim'.padStart(8) + '%'.padStart(7) + 'Distinct'.padStart(10));
  console.log('  ' + '─'.repeat(53));
  makeCoverage.forEach(r => {
    const pct = r.total > 0 ? ((r.with_trim / r.total) * 100).toFixed(1) : '0.0';
    console.log(`  ${r.make.padEnd(20)}${String(r.total).padStart(8)}${String(r.with_trim).padStart(8)}${(pct + '%').padStart(7)}${String(r.distinct_trims).padStart(10)}`);
  });

  // ─── TEST 5: Check for "generic" trim values ─────────────────
  console.log('\n\n── TEST 5: Generic/Useless Trim Values ──');
  console.log('  (Values like "All", "Base", "N/A" that dont help differentiate)\n');

  const suspectTrims = await knex('Auto')
    .select('trim')
    .count('* as count')
    .whereNotNull('trim')
    .where('trim', '!=', '')
    .whereRaw("LOWER(trim) IN ('all', 'all trims', 'n/a', 'na', 'base', 'standard', '--', '-', 'none', 'other')")
    .groupBy('trim')
    .orderBy('count', 'desc');

  if (suspectTrims.length === 0) {
    console.log('  ✅ No generic/useless trim values found');
  } else {
    console.log('  ⚠️  Found generic trim values:');
    suspectTrims.forEach(t => {
      console.log(`    ${String(t.count).padStart(5)} │ "${t.trim}"`);
    });
  }

  // ─── TEST 6: Trim differentiation proof ───────────────────────
  console.log('\n\n── TEST 6: Trim Differentiation Proof ──');
  console.log('  (Same make/model/year range - do DIFFERENT parts appear on DIFFERENT trims?)\n');

  // For each make/model combo, count items per trim to see if trim matters
  const diffProof = await knex.raw(`
    SELECT 
      a.make,
      a.model,
      a.trim,
      COUNT(DISTINCT i.id) as unique_parts,
      ROUND(AVG(i.price::numeric), 2) as avg_price
    FROM "Auto" a
    INNER JOIN "AutoItemCompatibility" aic ON a.id = aic."autoId"
    INNER JOIN "Item" i ON aic."itemId" = i.id
    WHERE a.make IN ('Ram', 'Ford', 'Jeep', 'Toyota', 'Honda', 'Chevrolet')
      AND a.trim IS NOT NULL 
      AND a.trim != ''
      AND a.year BETWEEN 2014 AND 2020
    GROUP BY a.make, a.model, a.trim
    HAVING COUNT(DISTINCT i.id) >= 3
    ORDER BY a.make, a.model, COUNT(DISTINCT i.id) DESC
    LIMIT 60
  `);

  let currentMakeModel = '';
  diffProof.rows.forEach(r => {
    const mm = `${r.make} ${r.model}`;
    if (mm !== currentMakeModel) {
      if (currentMakeModel) console.log('');
      console.log(`  ${mm}:`);
      currentMakeModel = mm;
    }
    console.log(`    ${r.trim.padEnd(25)} ${String(r.unique_parts).padStart(4)} parts │ avg $${r.avg_price}`);
  });

  console.log('\n\n═══════════════════════════════════════════════════════════');
  console.log('  DIAGNOSTIC COMPLETE');
  console.log('═══════════════════════════════════════════════════════════');

  await knex.destroy();
}

run().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
