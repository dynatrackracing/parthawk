'use strict';
const { Client } = require('pg');
const client = new Client({
  connectionString: 'postgresql://postgres:jOWykUhLuUbWSVASAAZZHqsDVfyqaFTN@switchyard.proxy.rlwy.net:12023/railway',
  ssl: { rejectUnauthorized: false }
});

async function main() {
  await client.connect();

  const newYards = [
    ['LKQ Charleston', 'charleston-1220', 280, 32.7765, -79.9311, 0.06],
    ['LKQ Savannah', 'savannah-1163', 350, 32.0809, -81.0912, 0.04],
    ['LKQ Huntsville', 'huntsville-1223', 470, 34.7304, -86.5861, 0.04],
    ['LKQ Nashville', 'nashville-1218', 490, 36.1627, -86.7816, 0.07],
    ['LKQ Dayton', 'dayton-1257', 430, 39.7589, -84.1916, 0.0575],
    ['LKQ Cincinnati', 'cincinnati-1253', 450, 39.1031, -84.5120, 0.0575],
    ['LKQ Fort Wayne', 'fort-wayne-1254', 570, 41.0793, -85.1394, 0.07],
    ['LKQ South Bend', 'south-bend-1255', 630, 41.6764, -86.2520, 0.07],
    ['LKQ Grand Rapids', 'grand-rapids-1348', 700, 42.9634, -85.6681, 0.06],
    ['LKQ Holland', 'holland-1346', 710, 42.7876, -86.1089, 0.06],
    ['LKQ Chicago South', 'chicago-south-1585', 720, 41.6453, -87.6099, 0.0625],
    ['LKQ Chicago North', 'chicago-north-1581', 720, 41.9742, -87.7399, 0.0625],
    ['LKQ Blue Island', 'blue-island-1582', 715, 41.6564, -87.6801, 0.0625],
    ['LKQ Mount Airy', 'mount-airy-1208', 280, 39.3762, -77.1547, 0.06],
    ['LKQ Baltimore Erdman', 'erdman-1205', 290, 39.3076, -76.5555, 0.06],
    ['LKQ Baltimore Hawkins Point', 'hawkins-point-1207', 290, 39.2498, -76.5891, 0.06],
  ];

  console.log('=== INSERTING 16 NEW LKQ YARDS ===');
  let inserted = 0;
  for (const [name, slug, dist, lat, lng, tax] of newYards) {
    const url = 'https://www.pyp.com/inventory/' + slug + '/';
    const region = dist <= 200 ? 'day_trip' : 'road_trip';
    const freq = dist <= 200 ? 'weekly' : 'monthly';
    try {
      await client.query(`
        INSERT INTO yard (id, name, chain, scrape_url, scrape_method, distance_from_base, lat, lng, entry_fee, tax_rate, enabled, flagged, region, visit_frequency, "createdAt", "updatedAt")
        VALUES (gen_random_uuid(), $1, 'LKQ', $2, 'lkq', $3, $4, $5, 2, $6, true, false, $7, $8, NOW(), NOW())
      `, [name, url, dist, lat, lng, tax, region, freq]);
      console.log('  Inserted: ' + name + ' (' + dist + 'mi)');
      inserted++;
    } catch (e) {
      console.log('  SKIP ' + name + ': ' + e.message.substring(0, 80));
    }
  }
  console.log('Total inserted: ' + inserted);

  // VERIFY
  const chains = await client.query('SELECT chain, COUNT(*) as count FROM yard WHERE enabled = true GROUP BY chain ORDER BY count DESC');
  console.log('\n=== YARD COUNTS BY CHAIN (enabled only) ===');
  chains.rows.forEach(r => console.log('  ' + (r.chain || 'NULL') + ': ' + r.count));

  const lkqAll = await client.query("SELECT name, scrape_url, distance_from_base, enabled, region FROM yard WHERE chain = 'LKQ' ORDER BY distance_from_base");
  console.log('\n=== ALL LKQ YARDS (' + lkqAll.rows.length + ') ===');
  lkqAll.rows.forEach(r => console.log('  ' + r.name + ' | ' + r.distance_from_base + 'mi | ' + (r.region || '-') + ' | ' + (r.scrape_url || 'NULL').substring(0, 50)));

  await client.end();
}

main().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
