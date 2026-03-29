'use strict';
const { Client } = require('pg');
const client = new Client({
  connectionString: 'postgresql://postgres:jOWykUhLuUbWSVASAAZZHqsDVfyqaFTN@switchyard.proxy.rlwy.net:12023/railway',
  ssl: { rejectUnauthorized: false }
});

async function main() {
  await client.connect();

  // ══════════════════════════════════════════════════════
  // TASK 1a: UPDATE cult=false on non-cult trims
  // ══════════════════════════════════════════════════════
  const updates = [
    [`UPDATE trim_tier_reference SET cult = false WHERE make = 'Toyota' AND model = 'Tacoma' AND trim NOT IN ('TRD Pro')`, 'Tacoma: non-TRD-Pro → cult=false'],
    [`UPDATE trim_tier_reference SET cult = false WHERE make = 'Toyota' AND model = '4Runner' AND trim NOT IN ('TRD Pro')`, '4Runner: non-TRD-Pro → cult=false'],
    [`UPDATE trim_tier_reference SET cult = false WHERE make = 'Toyota' AND model = 'Tundra' AND trim NOT IN ('TRD Pro')`, 'Tundra: non-TRD-Pro → cult=false'],
    [`UPDATE trim_tier_reference SET cult = false WHERE make = 'Subaru' AND model = 'BRZ' AND trim NOT IN ('tS')`, 'BRZ: non-tS → cult=false'],
    [`UPDATE trim_tier_reference SET cult = false WHERE make = 'Chevrolet' AND model = 'Corvette' AND trim NOT IN ('Z06','ZR1')`, 'Corvette: non-Z06/ZR1 → cult=false'],
    [`UPDATE trim_tier_reference SET cult = false WHERE make = 'Acura' AND model = 'Integra' AND trim NOT IN ('Type R','GS-R')`, 'Integra: non-Type-R/GS-R → cult=false'],
    [`UPDATE trim_tier_reference SET cult = false WHERE make = 'Toyota' AND model = 'Supra' AND trim = '2.0'`, 'Supra: 2.0 → cult=false'],
    [`UPDATE trim_tier_reference SET cult = false WHERE make = 'Mitsubishi' AND model = 'Lancer' AND trim NOT LIKE '%Evo%' AND trim NOT LIKE '%Evolution%'`, 'Lancer: non-Evo → cult=false'],
    [`UPDATE trim_tier_reference SET cult = false WHERE make = 'Nissan' AND model IN ('350Z','370Z') AND trim NOT LIKE '%Nismo%'`, '350Z/370Z: non-Nismo → cult=false'],
    [`UPDATE trim_tier_reference SET cult = false WHERE make = 'Infiniti' AND model = 'G35' AND tier <= 2`, 'G35: base/mid → cult=false'],
  ];

  console.log('=== UPDATING cult=false on non-cult trims ===');
  for (const [sql, label] of updates) {
    const r = await client.query(sql);
    console.log('  ' + label + ': ' + r.rowCount + ' rows');
  }

  // ══════════════════════════════════════════════════════
  // TASK 1b: INSERT truly missing entries
  // ══════════════════════════════════════════════════════
  console.log('\n=== INSERTING missing non-cult entries ===');

  const inserts = [
    ['Volkswagen', 'Golf', 'S', 1, false, '1.8L', 2006, 2021, 'Base Golf — not GTI'],
    ['Volkswagen', 'Golf', 'SE', 2, false, '1.8L', 2006, 2021, 'Golf SE — not GTI'],
    ['Volkswagen', 'Golf', 'SEL', 3, false, '1.8L', 2006, 2021, 'Golf SEL — not GTI'],
    ['Volkswagen', 'Golf', 'Wolfsburg', 2, false, '1.8L', 2006, 2021, 'Golf Wolfsburg — not GTI'],
    ['Acura', 'Integra', 'Base', 2, false, '1.5L', 2023, 2025, 'Base Integra — not Type S'],
    ['Acura', 'Integra', 'A-Spec', 2, false, '1.5L', 2023, 2025, 'Integra A-Spec — not Type S'],
    ['Acura', 'Integra', 'A-Spec Tech', 3, false, '1.5L', 2023, 2025, 'Integra A-Spec Tech — not Type S'],
    ['Chevrolet', 'Corvette', 'Stingray', 3, false, '6.2L', 2014, 2025, 'Corvette Stingray — not Z06/ZR1'],
    ['Chevrolet', 'Corvette', 'Grand Sport', 3, false, '6.2L', 2010, 2025, 'Corvette Grand Sport — not Z06/ZR1'],
    ['Chevrolet', 'Corvette', '1LT', 2, false, '6.2L', 2014, 2025, 'Corvette 1LT — base C8'],
    ['Chevrolet', 'Corvette', '2LT', 3, false, '6.2L', 2014, 2025, 'Corvette 2LT — mid C8'],
    ['Chevrolet', 'Corvette', '3LT', 3, false, '6.2L', 2014, 2025, 'Corvette 3LT — loaded C8'],
    ['Toyota', '4Runner', 'Nightshade', 3, false, '4.0L', 2010, 2025, '4Runner Nightshade — premium not cult'],
    ['Toyota', 'Tundra', 'TRD Off-Road', 2, false, '5.7L', 2007, 2021, 'Tundra TRD Off-Road — not cult'],
    ['Honda', 'Civic', 'DX', 1, false, '1.8L', 2006, 2025, 'Base Civic — not Si/Type R'],
    ['Honda', 'Civic', 'LX', 1, false, '1.8L', 2006, 2025, 'Civic LX — not Si/Type R'],
    ['Honda', 'Civic', 'EX', 2, false, '1.8L', 2006, 2025, 'Civic EX — not Si/Type R'],
    ['Honda', 'Civic', 'EX-L', 3, false, '1.8L', 2006, 2025, 'Civic EX-L — not Si/Type R'],
    ['Honda', 'Civic', 'EX-T', 2, false, '1.5L', 2016, 2025, 'Civic EX-T turbo — not Si/Type R'],
    ['Honda', 'Civic', 'Touring', 3, false, '1.5L', 2016, 2025, 'Civic Touring — premium not cult'],
    ['Honda', 'Civic', 'Sport', 2, false, '2.0L', 2016, 2025, 'Civic Sport — not Si/Type R'],
    ['Ford', 'Mustang', 'V6', 1, false, '3.7L', 2005, 2025, 'Base V6 Mustang — not Shelby'],
    ['Ford', 'Mustang', 'EcoBoost', 1, false, '2.3L', 2015, 2025, 'EcoBoost Mustang — not Shelby'],
    ['Ford', 'Mustang', 'GT', 3, false, '5.0L', 2005, 2025, 'Mustang GT — premium but not Shelby cult'],
    ['Ford', 'Mustang', 'EcoBoost Premium', 2, false, '2.3L', 2015, 2025, 'EcoBoost Premium — not Shelby'],
    ['Dodge', 'Challenger', 'SXT', 1, false, '3.6L', 2008, 2025, 'Base Challenger — not Hellcat'],
    ['Dodge', 'Challenger', 'GT', 2, false, '3.6L', 2017, 2025, 'Challenger GT — not Hellcat'],
    ['Dodge', 'Challenger', 'R/T', 2, false, '5.7L', 2008, 2025, 'Challenger R/T — not Hellcat'],
    ['Dodge', 'Challenger', 'R/T Scat Pack', 3, false, '6.4L', 2015, 2025, 'Scat Pack — not Hellcat'],
    ['Dodge', 'Charger', 'SE', 1, false, '3.6L', 2006, 2025, 'Base Charger — not Hellcat'],
    ['Dodge', 'Charger', 'SXT', 1, false, '3.6L', 2006, 2025, 'Charger SXT — not Hellcat'],
    ['Dodge', 'Charger', 'GT', 2, false, '3.6L', 2017, 2025, 'Charger GT — not Hellcat'],
    ['Dodge', 'Charger', 'R/T', 2, false, '5.7L', 2006, 2025, 'Charger R/T — not Hellcat'],
    ['Dodge', 'Charger', 'R/T Scat Pack', 3, false, '6.4L', 2015, 2025, 'Charger Scat Pack — not Hellcat'],
    ['Dodge', 'Charger', 'Daytona', 3, false, '5.7L', 2006, 2025, 'Charger Daytona — not Hellcat'],
  ];

  let inserted = 0, skipped = 0;
  for (const [make, model, trim, tier, cult, eng, ys, ye, notes] of inserts) {
    const existing = await client.query(
      'SELECT id FROM trim_tier_reference WHERE make = $1 AND model = $2 AND trim = $3 AND gen_start = $4 AND gen_end = $5',
      [make, model, trim, ys, ye]
    );
    if (existing.rows.length > 0) { skipped++; continue; }
    try {
      await client.query(
        'INSERT INTO trim_tier_reference (make, model, trim, tier, cult, top_engine, gen_start, gen_end, notes) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
        [make, model, trim, tier, cult, eng, ys, ye, notes]
      );
      inserted++;
    } catch (e) {
      console.log('  SKIP ' + make + ' ' + model + ' ' + trim + ': ' + e.message.substring(0, 60));
      skipped++;
    }
  }
  console.log('  Inserted: ' + inserted + ', Skipped: ' + skipped);

  // ══════════════════════════════════════════════════════
  // TASK 2: Duplicate check + cleanup
  // ══════════════════════════════════════════════════════
  console.log('\n=== DUPLICATE CHECK ===');
  const dupes = await client.query(
    "SELECT make, model, trim, COUNT(*) as cnt FROM trim_tier_reference GROUP BY make, model, trim HAVING COUNT(*) > 1 ORDER BY make, model"
  );
  if (dupes.rows.length === 0) {
    console.log('No duplicates found.');
  } else {
    console.log(dupes.rows.length + ' trim groups with multiple entries (expected for multi-gen):');
    // Only show truly problematic ones (same gen range)
    const exactDupes = await client.query(
      "SELECT make, model, trim, gen_start, gen_end, COUNT(*) as cnt FROM trim_tier_reference GROUP BY make, model, trim, gen_start, gen_end HAVING COUNT(*) > 1 ORDER BY make, model"
    );
    if (exactDupes.rows.length > 0) {
      console.log('  Exact duplicates (same year range):');
      exactDupes.rows.forEach(r => console.log('    ' + r.make + ' ' + r.model + ' ' + r.trim + ' ' + r.gen_start + '-' + r.gen_end + ' (' + r.cnt + 'x)'));
      const del = await client.query(
        "DELETE FROM trim_tier_reference a USING trim_tier_reference b WHERE a.id > b.id AND a.make = b.make AND a.model = b.model AND a.trim = b.trim AND a.gen_start = b.gen_start AND a.gen_end = b.gen_end"
      );
      console.log('  Cleaned ' + del.rowCount + ' exact duplicates');
    } else {
      console.log('  All multi-entry trims are different generations — OK');
    }
  }

  // ══════════════════════════════════════════════════════
  // TASK 3: Re-check cult bleed
  // ══════════════════════════════════════════════════════
  console.log('\n=== REMAINING CULT-ONLY MODELS ===');
  const remaining = await client.query(
    "SELECT make, model, COUNT(*) as entries FROM trim_tier_reference WHERE cult = true GROUP BY make, model HAVING COUNT(*) = (SELECT COUNT(*) FROM trim_tier_reference t2 WHERE t2.make = trim_tier_reference.make AND t2.model = trim_tier_reference.model) ORDER BY make, model"
  );
  console.log(remaining.rows.length + ' models still all-cult:');
  remaining.rows.forEach(r => console.log('  ' + r.make + ' ' + r.model + ' (' + r.entries + ')'));

  // ══════════════════════════════════════════════════════
  // TASK 4: Active yard vehicles for fixed models
  // ══════════════════════════════════════════════════════
  console.log('\n=== ACTIVE YARD VEHICLES FOR FIXED MODELS ===');
  const affected = await client.query(
    `SELECT yv.make, yv.model, yv.trim_tier, COUNT(*) as cnt
     FROM yard_vehicle yv
     WHERE yv.active = true
     AND UPPER(yv.make) || ' ' || UPPER(yv.model) IN (
       'TOYOTA TACOMA','TOYOTA 4RUNNER','TOYOTA TUNDRA',
       'VOLKSWAGEN GOLF','HONDA CIVIC','FORD MUSTANG',
       'DODGE CHALLENGER','DODGE CHARGER','SUBARU BRZ',
       'CHEVROLET CORVETTE','ACURA INTEGRA','FORD FIESTA'
     )
     GROUP BY yv.make, yv.model, yv.trim_tier
     ORDER BY yv.make, yv.model, cnt DESC`
  );
  affected.rows.forEach(r => console.log('  ' + r.make + ' ' + r.model + ' | tier=' + (r.trim_tier || 'NULL') + ' | ' + r.cnt + ' vehicles'));

  // Final count
  const total = await client.query('SELECT count(*) as c FROM trim_tier_reference');
  console.log('\nTotal trim_tier_reference rows: ' + total.rows[0].c);

  await client.end();
}

main().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
