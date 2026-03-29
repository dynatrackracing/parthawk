'use strict';
const { Client } = require('pg');
const client = new Client({
  connectionString: 'postgresql://postgres:jOWykUhLuUbWSVASAAZZHqsDVfyqaFTN@switchyard.proxy.rlwy.net:12023/railway',
  ssl: { rejectUnauthorized: false }
});

async function main() {
  await client.connect();

  // TASK 1: Check what already exists
  const existing = await client.query(`
    SELECT id, name, chain, scrape_url, scrape_method, distance_from_base
    FROM yard
    WHERE name ILIKE '%chesterfield%'
       OR name ILIKE '%pick-a-part%'
       OR name ILIKE '%pickapart%va%'
       OR name ILIKE '%u pull%save%'
       OR name ILIKE '%bessler%'
       OR name ILIKE '%bluegrass%'
       OR name ILIKE '%raceway%pik%'
       OR chain IN ('upullandsave', 'chesterfield', 'pickapartva')
    ORDER BY chain, distance_from_base
  `);
  console.log('=== EXISTING MATCHES (' + existing.rows.length + ') ===');
  if (existing.rows.length === 0) {
    console.log('  None found — all inserts are new');
  } else {
    existing.rows.forEach(r => console.log('  ' + r.name + ' | chain=' + r.chain + ' | ' + r.distance_from_base + 'mi'));
  }

  const existingNames = new Set(existing.rows.map(r => r.name.toLowerCase()));

  // All 9 new yards
  const yards = [
    // U Pull & Save (4 KY/TN)
    ["Bessler's Hebron KY", 'upullandsave', 'upullandsave', 'https://upullandsave.com/hebron-ky/besslers-u-pull-and-save/inventory/', 450, 39.0834, -84.6002, 2, 0.06],
    ["Bessler's Louisville KY", 'upullandsave', 'upullandsave', 'https://upullandsave.com/louisville-ky/besslers-u-pull-and-save/inventory/', 460, 38.2527, -85.7585, 2, 0.06],
    ['Bluegrass Lexington KY', 'upullandsave', 'upullandsave', 'https://upullandsave.com/lexington-ky/bluegrass-u-pull-and-save/inventory/', 400, 38.0406, -84.5037, 2, 0.06],
    ['Raceway Savannah TN', 'upullandsave', 'upullandsave', 'https://upullandsave.com/savannah-tn/raceway-pik-a-part/inventory/', 500, 35.2246, -88.2490, 2, 0.07],

    // Chesterfield Auto Parts (3 VA)
    ['Chesterfield Richmond', 'chesterfield', 'chesterfield', 'https://chesterfieldauto.com/search-our-inventory-by-location/', 170, 37.4949, -77.4874, 1, 0.053],
    ['Chesterfield Midlothian', 'chesterfield', 'chesterfield', 'https://chesterfieldauto.com/search-our-inventory-by-location/', 175, 37.5071, -77.5972, 1, 0.053],
    ['Chesterfield Fort Lee', 'chesterfield', 'chesterfield', 'https://chesterfieldauto.com/search-our-inventory-by-location/', 160, 37.2432, -77.3414, 1, 0.053],

    // Pick-A-Part Virginia (2 VA)
    ['Pick-A-Part Fredericksburg', 'pickapartva', 'pickapartva', 'https://pickapartva.com/inventory-search/', 190, 38.3032, -77.4605, 2, 0.053],
    ['Pick-A-Part Stafford', 'pickapartva', 'pickapartva', 'https://pickapartva.com/inventory-search/', 200, 38.4220, -77.4083, 2, 0.053],
  ];

  console.log('\n=== INSERTING NEW YARDS ===');
  let inserted = 0, skipped = 0;
  for (const [name, chain, method, url, dist, lat, lng, fee, tax] of yards) {
    if (existingNames.has(name.toLowerCase())) {
      console.log('  SKIP (exists): ' + name);
      skipped++;
      continue;
    }
    const region = dist <= 200 ? 'day_trip' : 'road_trip';
    const freq = dist <= 200 ? 'weekly' : 'monthly';
    try {
      await client.query(`
        INSERT INTO yard (id, name, chain, scrape_url, scrape_method, distance_from_base, lat, lng, entry_fee, tax_rate, enabled, flagged, region, visit_frequency, "createdAt", "updatedAt")
        VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, $9, true, false, $10, $11, NOW(), NOW())
      `, [name, chain, url, method, dist, lat, lng, fee, tax, region, freq]);
      console.log('  INSERT: ' + name + ' | ' + chain + ' | ' + dist + 'mi');
      inserted++;
    } catch (e) {
      console.log('  ERROR ' + name + ': ' + e.message.substring(0, 80));
    }
  }
  console.log('\nInserted: ' + inserted + ', Skipped: ' + skipped);

  // VERIFY
  const chains = await client.query('SELECT chain, COUNT(*) as count FROM yard WHERE enabled = true GROUP BY chain ORDER BY count DESC');
  console.log('\n=== YARD COUNTS BY CHAIN (enabled) ===');
  chains.rows.forEach(r => console.log('  ' + (r.chain || 'NULL') + ': ' + r.count));

  const total = await client.query('SELECT COUNT(*) as c FROM yard');
  console.log('\nTotal yards in DB: ' + total.rows[0].c);

  // Show all yards sorted by distance
  const all = await client.query("SELECT name, chain, scrape_method, distance_from_base, enabled FROM yard WHERE enabled = true ORDER BY distance_from_base");
  console.log('\n=== ALL ENABLED YARDS BY DISTANCE (' + all.rows.length + ') ===');
  all.rows.forEach(r => console.log('  ' + String(r.distance_from_base).padStart(6) + 'mi | ' + (r.chain || '-').padEnd(14) + ' | ' + r.name));

  await client.end();
}

main().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
