'use strict';

const knex = require('knex')({
  client: 'pg',
  connection: process.env.DATABASE_URL
});

async function run() {
  // ═══ TASK 1: trim_intelligence table ═══
  console.log('═══════════════════════════════════════════');
  console.log('TASK 1: trim_intelligence table');
  console.log('═══════════════════════════════════════════');

  const [{count: totalRows}] = await knex('trim_intelligence').count('* as count');
  console.log('Total rows:', totalRows);

  const combos = await knex.raw('SELECT COUNT(DISTINCT (year, make, model, trim)) as count FROM trim_intelligence');
  console.log('Distinct year/make/model/trim combos:', combos.rows[0].count);

  const sample = await knex('trim_intelligence').select('*').limit(5);
  console.log('\nSample 5 rows:');
  sample.forEach((r, i) => {
    console.log(`\n--- Row ${i+1}: ${r.year} ${r.make} ${r.model} ${r.trim} ---`);
    console.log('expected_parts:', JSON.stringify(r.expected_parts, null, 2));
    console.log('confidence:', r.confidence, '| researched_at:', r.researched_at);
  });

  // Check if any rows have non-empty expected_parts (JSON column)
  const nonEmpty = await knex('trim_intelligence')
    .whereNotNull('expected_parts')
    .whereRaw("expected_parts::text != '[]'")
    .whereRaw("expected_parts::text != '\"\"'");
  console.log('\nRows with non-empty expected_parts:', nonEmpty.length);
  if (nonEmpty.length > 0) {
    nonEmpty.forEach(r => {
      console.log(`  ${r.year} ${r.make} ${r.model} ${r.trim}:`, JSON.stringify(r.expected_parts).substring(0, 200));
    });
  }

  // ═══ TASK 2: Unique part suggestions from BOTH tables ═══
  console.log('\n═══════════════════════════════════════════');
  console.log('TASK 2: All part suggestions (trim_intelligence + trim_tier_reference)');
  console.log('═══════════════════════════════════════════');

  // trim_intelligence expected_parts is JSON (array of objects)
  const tiParts = {};
  for (const row of nonEmpty) {
    let parts = row.expected_parts;
    if (typeof parts === 'string') {
      try { parts = JSON.parse(parts); } catch(e) { continue; }
    }
    if (Array.isArray(parts)) {
      for (const p of parts) {
        if (typeof p === 'object' && p.part_type) {
          const key = p.part_type + ': ' + (p.description || '').substring(0, 80);
          tiParts[key] = (tiParts[key] || 0) + 1;
        } else if (typeof p === 'string') {
          tiParts[p] = (tiParts[p] || 0) + 1;
        }
      }
    }
  }

  console.log('\n[FROM trim_intelligence - detailed JSON parts]');
  Object.entries(tiParts).sort((a,b) => b[1] - a[1]).forEach(([k,v]) => console.log(`  ${v}x  ${k}`));

  // trim_tier_reference expected_parts is TEXT (comma-separated)
  const ttrParts = {};
  const allTtr = await knex('trim_tier_reference')
    .whereNotNull('expected_parts')
    .whereNot('expected_parts', '')
    .select('expected_parts', 'tier', 'tier_name');

  for (const row of allTtr) {
    const parts = row.expected_parts.split(',').map(p => p.trim()).filter(Boolean);
    for (const p of parts) {
      ttrParts[p] = (ttrParts[p] || 0) + 1;
    }
  }

  const sortedTtr = Object.entries(ttrParts).sort((a,b) => b[1] - a[1]);
  console.log(`\n[FROM trim_tier_reference - ${sortedTtr.length} unique suggestions across ${allTtr.length} rows]`);

  // Group by rough category
  const cats = {
    'AUDIO/AMP': [], 'CAMERA/SENSOR': [], 'ECM/MODULE': [],
    'COMFORT/INTERIOR': [], 'EXTERIOR/WHEELS': [], 'DRIVETRAIN': [],
    'SUSPENSION': [], 'BRAKES': [], 'OTHER': []
  };

  for (const [name, count] of sortedTtr) {
    const n = name.toLowerCase();
    if (n.includes('audio') || n.includes('amp') || n.includes('speaker') || n.includes('subwoof') || n.includes('bose') || n.includes('harman') || n.includes('alpine') || n.includes('jbl') || n.includes('infinity') || n.includes('fender') || n.includes('rockford') || n.includes('mark levinson') || n.includes('burmester') || n.includes('sound') || n.includes('stereo') || n.includes('head unit') || n.includes('uconnect') || n.includes('entune') || n.includes('mylink') || n.includes('sync'))
      cats['AUDIO/AMP'].push([name, count]);
    else if (n.includes('camera') || n.includes('sensor') || n.includes('radar') || n.includes('blind spot') || n.includes('parking'))
      cats['CAMERA/SENSOR'].push([name, count]);
    else if (n.includes('ecm') || n.includes('pcm') || n.includes('bcm') || n.includes('module') || n.includes('ecu') || n.includes('computer'))
      cats['ECM/MODULE'].push([name, count]);
    else if (n.includes('seat') || n.includes('leather') || n.includes('heated') || n.includes('sunroof') || n.includes('moonroof') || n.includes('climate') || n.includes('nav') || n.includes('power') || n.includes('memory') || n.includes('mirror') || n.includes('cruise') || n.includes('keyless') || n.includes('remote'))
      cats['COMFORT/INTERIOR'].push([name, count]);
    else if (n.includes('wheel') || n.includes('alloy') || n.includes('chrome') || n.includes('spoiler') || n.includes('appearance') || n.includes('running board') || n.includes('fog') || n.includes('led') || n.includes('hid') || n.includes('headlight'))
      cats['EXTERIOR/WHEELS'].push([name, count]);
    else if (n.includes('4wd') || n.includes('4x4') || n.includes('awd') || n.includes('transfer') || n.includes('diff') || n.includes('axle') || n.includes('turbo') || n.includes('supercharg') || n.includes('ecoboost') || n.includes('hemi') || n.includes('engine') || n.includes('transmission') || n.includes('manual'))
      cats['DRIVETRAIN'].push([name, count]);
    else if (n.includes('suspension') || n.includes('shock') || n.includes('strut') || n.includes('spring') || n.includes('sway') || n.includes('magneride') || n.includes('air ride') || n.includes('bilstein'))
      cats['SUSPENSION'].push([name, count]);
    else if (n.includes('brake') || n.includes('brembo') || n.includes('caliper') || n.includes('rotor') || n.includes('disc'))
      cats['BRAKES'].push([name, count]);
    else
      cats['OTHER'].push([name, count]);
  }

  let totalUnique = 0;
  let totalMentions = 0;
  for (const [cat, items] of Object.entries(cats).sort()) {
    if (items.length === 0) continue;
    console.log(`\n  [${cat}]`);
    for (const [name, count] of items) {
      console.log(`    ${count}x  ${name}`);
      totalUnique++;
      totalMentions += count;
    }
  }
  console.log(`\nTotal unique part suggestions (trim_tier_reference): ${totalUnique}`);
  console.log(`Total mentions across all trims: ${totalMentions}`);

  // ═══ TASK 3: trim_tier_reference PREMIUM/PERFORMANCE ═══
  console.log('\n═══════════════════════════════════════════');
  console.log('TASK 3: trim_tier_reference — tier 3 (premium) & 4 (performance)');
  console.log('═══════════════════════════════════════════');

  const premiumCount = await knex('trim_tier_reference').where('tier', 3).count('* as count');
  console.log('PREMIUM (tier=3) entries:', premiumCount[0].count);

  const perfCount = await knex('trim_tier_reference').where('tier', 4).count('* as count');
  console.log('PERFORMANCE (tier=4) entries:', perfCount[0].count);

  const distinctMakeModel = await knex.raw(`
    SELECT COUNT(DISTINCT (make, model)) as count
    FROM trim_tier_reference WHERE tier IN (3, 4)
  `);
  console.log('Distinct make/model combos at tier 3/4:', distinctMakeModel.rows[0].count);

  const tierSample = await knex('trim_tier_reference').whereIn('tier', [3, 4]).limit(10);
  console.log('\nSample 10 PREMIUM/PERFORMANCE rows:');
  tierSample.forEach(r => {
    console.log(`  ${r.make} ${r.model} (${r.gen_start}-${r.gen_end}) | ${r.trim} | tier=${r.tier} (${r.tier_name}) | audio=${r.audio_brand || 'none'}`);
    if (r.expected_parts) console.log(`    parts: ${r.expected_parts}`);
  });

  // Audio brands at premium/performance tier
  const audioBrands = await knex('trim_tier_reference')
    .whereIn('tier', [3, 4])
    .whereNotNull('audio_brand')
    .whereNot('audio_brand', '')
    .groupBy('audio_brand')
    .select('audio_brand')
    .count('* as count')
    .orderBy('count', 'desc');
  console.log('\nAudio brands on premium/performance trims:');
  audioBrands.forEach(r => console.log(`  ${r.count}x  ${r.audio_brand}`));

  // ═══ TASK 4: Gap analysis ═══
  console.log('\n═══════════════════════════════════════════');
  console.log('TASK 4: Premium/Performance trims with NO trim_intelligence');
  console.log('═══════════════════════════════════════════');

  const gaps = await knex.raw(`
    SELECT DISTINCT ttr.make, ttr.model, ttr.trim, ttr.tier_name, ttr.audio_brand
    FROM trim_tier_reference ttr
    LEFT JOIN trim_intelligence ti
      ON LOWER(ttr.make) = LOWER(ti.make)
      AND LOWER(ttr.model) = LOWER(ti.model)
      AND LOWER(ttr.trim) = LOWER(ti.trim)
    WHERE ttr.tier IN (3, 4)
      AND ti.id IS NULL
    ORDER BY ttr.make, ttr.model, ttr.trim
  `);
  console.log('Premium/Performance trims with ZERO intelligence:', gaps.rows.length);

  const totalPremPerf = await knex.raw(`
    SELECT COUNT(DISTINCT (make, model, trim)) as count
    FROM trim_tier_reference WHERE tier IN (3, 4)
  `);
  console.log('Total premium/performance trims:', totalPremPerf.rows[0].count);
  console.log('Coverage:', totalPremPerf.rows[0].count - gaps.rows.length, '/', totalPremPerf.rows[0].count);

  if (gaps.rows.length > 0 && gaps.rows.length <= 100) {
    console.log('\nFull gap list:');
    gaps.rows.forEach(r => console.log(`  ${r.make} ${r.model} | ${r.trim} | ${r.tier_name} | audio=${r.audio_brand || 'none'}`));
  } else if (gaps.rows.length > 100) {
    console.log('\nFirst 50 gaps:');
    gaps.rows.slice(0, 50).forEach(r => console.log(`  ${r.make} ${r.model} | ${r.trim} | ${r.tier_name} | audio=${r.audio_brand || 'none'}`));
    console.log(`  ... and ${gaps.rows.length - 50} more`);
  }

  // ═══ TASK 5: YourSale keyword search ═══
  console.log('\n═══════════════════════════════════════════');
  console.log('TASK 5: Sales data keyword counts');
  console.log('═══════════════════════════════════════════');

  // Check available sales tables
  const tables = await knex.raw("SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename");
  const salesTables = tables.rows.filter(r =>
    r.tablename.includes('sale') || r.tablename.includes('sold') ||
    r.tablename.includes('item') || r.tablename.includes('listing')
  );
  console.log('Sales-related tables:', salesTables.map(r => r.tablename).join(', '));

  // Try sold_item first, then item
  let salesTable, titleCol;
  for (const candidate of ['sold_item', 'item']) {
    try {
      const cols = await knex(candidate).columnInfo();
      const colNames = Object.keys(cols);
      titleCol = colNames.find(c => c === 'title') || colNames.find(c => c.includes('title')) || colNames.find(c => c.includes('name'));
      if (titleCol) {
        const [{count}] = await knex(candidate).count('* as count');
        salesTable = candidate;
        console.log(`Using: ${salesTable}.${titleCol} (${count} rows)`);
        console.log(`Columns: ${colNames.join(', ')}`);
        break;
      }
    } catch(e) {}
  }

  if (!salesTable) {
    console.log('No sales table found with title column');
  } else {
    const keywords = [
      'Bose', 'Alpine', 'Harman Kardon', 'B&O', 'Bang Olufsen', 'JBL',
      'Mark Levinson', 'Burmester', 'Meridian', 'Fender', 'Rockford Fosgate',
      'Infinity', 'premium audio', 'navigation'
    ];

    let keywordsWithData = 0;
    let totalKeywordMatches = 0;
    const kwResults = [];

    for (const kw of keywords) {
      const [{count}] = await knex(salesTable).where(titleCol, 'ilike', `%${kw}%`).count('* as count');
      const c = parseInt(count);
      kwResults.push({ keyword: kw, count: c });
      if (c > 0) keywordsWithData++;
      totalKeywordMatches += c;
    }

    console.log('\nKeyword | Count');
    console.log('--------|------');
    kwResults.sort((a,b) => b.count - a.count).forEach(r =>
      console.log(`  ${r.keyword.padEnd(20)} ${r.count}`)
    );
    console.log(`\nTotal keyword matches: ${totalKeywordMatches}`);
    console.log(`Keywords with data: ${keywordsWithData}/${keywords.length}`);

    // ═══ TASK 6: Summary report ═══
    console.log('\n═══════════════════════════════════════════');
    console.log('SUMMARY REPORT');
    console.log('═══════════════════════════════════════════');
    console.log(`\ntrim_intelligence: ${totalRows} rows, ${combos.rows[0].count} distinct combos`);
    console.log(`  Rows with actual part data: ${nonEmpty.length}`);
    console.log(`\ntrim_tier_reference at PREMIUM/PERFORMANCE:`);
    console.log(`  PREMIUM (tier=3): ${premiumCount[0].count}`);
    console.log(`  PERFORMANCE (tier=4): ${perfCount[0].count}`);
    console.log(`  Distinct make/model combos: ${distinctMakeModel.rows[0].count}`);
    console.log(`  Distinct trims: ${totalPremPerf.rows[0].count}`);
    console.log(`  Trims with NO intelligence: ${gaps.rows.length}/${totalPremPerf.rows[0].count}`);
    console.log(`\nPart suggestions (from trim_tier_reference):`);
    console.log(`  Unique suggestions: ${totalUnique}`);
    console.log(`  Total mentions: ${totalMentions}`);
    console.log(`\nYourSale validation capacity:`);
    console.log(`  Keywords with matches: ${keywordsWithData}/${keywords.length}`);
    console.log(`  Total matching listings: ${totalKeywordMatches}`);
    console.log(`  Keywords needing Playwright scrapes: ${keywords.length - keywordsWithData}/${keywords.length}`);
    console.log(`\nTop 10 most-mentioned premium parts (validate first):`);
    sortedTtr.slice(0, 10).forEach(([name, count], i) =>
      console.log(`  ${i+1}. ${name} (${count} trims)`)
    );
  }

  await knex.destroy();
}

run().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
