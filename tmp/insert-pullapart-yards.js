'use strict';
const { Client } = require('pg');
const client = new Client({
  connectionString: 'postgresql://postgres:jOWykUhLuUbWSVASAAZZHqsDVfyqaFTN@switchyard.proxy.rlwy.net:12023/railway',
  ssl: { rejectUnauthorized: false }
});

async function main() {
  await client.connect();

  // Get existing Pull-A-Part names to avoid duplicates
  const existing = await client.query("SELECT LOWER(name) as name FROM yard WHERE chain = 'Pull-A-Part' OR name ILIKE '%pull-a-part%' OR name ILIKE '%u-pull%pay%'");
  const existingNames = new Set(existing.rows.map(r => r.name));
  console.log('Existing Pull-A-Part yards: ' + existingNames.size);

  // All 21 target locations — we'll skip ones that already exist
  const yards = [
    // name, slug, state, dist, lat, lng, tax, chain
    ['Pull-A-Part Charlotte', 'charlotte-nc', 'NC', 170, 35.2271, -80.8431, 0.0675, 'Pull-A-Part'],
    ['Pull-A-Part Winston-Salem', 'winston-salem-nc', 'NC', 105, 36.0999, -80.2442, 0.0675, 'Pull-A-Part'],
    ['Pull-A-Part Columbia SC', 'columbia-sc', 'SC', 240, 34.0007, -81.0348, 0.06, 'Pull-A-Part'],
    ['Pull-A-Part Atlanta North', 'atlanta-north-ga', 'GA', 420, 33.8484, -84.3733, 0.04, 'Pull-A-Part'],
    ['Pull-A-Part Atlanta East', 'atlanta-east-ga', 'GA', 410, 33.7488, -84.2888, 0.04, 'Pull-A-Part'],
    ['Pull-A-Part Atlanta South', 'atlanta-south-ga', 'GA', 415, 33.6407, -84.4117, 0.04, 'Pull-A-Part'],
    ['Pull-A-Part Augusta GA', 'augusta-ga', 'GA', 310, 33.4735, -82.0105, 0.04, 'Pull-A-Part'],
    ['Pull-A-Part Knoxville TN', 'knoxville-tn', 'TN', 355, 35.9606, -83.9207, 0.07, 'Pull-A-Part'],
    ['Pull-A-Part Nashville TN', 'nashville-tn', 'TN', 490, 36.1627, -86.7816, 0.07, 'Pull-A-Part'],
    ['Pull-A-Part Memphis', 'memphis-tn', 'TN', 680, 35.1495, -90.0490, 0.07, 'Pull-A-Part'],
    ['Pull-A-Part Indianapolis', 'indianapolis-in', 'IN', 580, 39.7684, -86.1581, 0.07, 'Pull-A-Part'],
    ['Pull-A-Part Cleveland West', 'cleveland-west-oh', 'OH', 470, 41.4993, -81.6944, 0.0575, 'Pull-A-Part'],
    ['Pull-A-Part Akron', 'akron-oh', 'OH', 440, 41.0814, -81.5190, 0.0575, 'Pull-A-Part'],
    ['Pull-A-Part Canton', 'canton-oh', 'OH', 430, 40.7990, -81.3784, 0.0575, 'Pull-A-Part'],
    ['Pull-A-Part Louisville', 'louisville-ky', 'KY', 460, 38.2527, -85.7585, 0.06, 'Pull-A-Part'],
    ['Pull-A-Part Birmingham', 'birmingham-al', 'AL', 520, 33.5207, -86.8025, 0.04, 'Pull-A-Part'],
    ['Pull-A-Part Montgomery', 'montgomery-al', 'AL', 530, 32.3792, -86.3077, 0.04, 'Pull-A-Part'],
    ['U-Pull-&-Pay Pittsburgh', 'pittsburgh-pa', 'PA', 380, 40.4406, -79.9959, 0.06, 'Pull-A-Part'],
    ['Pull-A-Part Baton Rouge', 'baton-rouge-la', 'LA', 900, 30.4515, -91.1871, 0.0445, 'Pull-A-Part'],
    ['Pull-A-Part New Orleans', 'new-orleans-la', 'LA', 870, 29.9511, -90.0715, 0.0445, 'Pull-A-Part'],
    ['Pull-A-Part Jackson', 'jackson-ms', 'MS', 760, 32.2988, -90.1848, 0.07, 'Pull-A-Part'],
  ];

  let inserted = 0, skipped = 0;
  for (const [name, slug, state, dist, lat, lng, tax, chain] of yards) {
    if (existingNames.has(name.toLowerCase())) {
      console.log('  SKIP (exists): ' + name);
      skipped++;
      continue;
    }

    // U-Pull-&-Pay uses upullandpay.com, Pull-A-Part uses pullapart.com
    const isUPull = name.includes('U-Pull');
    const url = isUPull
      ? 'https://www.upullandpay.com/locations/' + slug + '/'
      : 'https://www.pullapart.com/locations/' + slug + '/';
    const region = dist <= 200 ? 'day_trip' : 'road_trip';
    const freq = dist <= 200 ? 'weekly' : 'monthly';

    try {
      await client.query(`
        INSERT INTO yard (id, name, chain, scrape_url, scrape_method, distance_from_base, lat, lng, entry_fee, tax_rate, enabled, flagged, region, visit_frequency, "createdAt", "updatedAt")
        VALUES (gen_random_uuid(), $1, $2, $3, 'pullapart', $4, $5, $6, 2, $7, true, false, $8, $9, NOW(), NOW())
      `, [name, chain, url, dist, lat, lng, tax, region, freq]);
      console.log('  INSERT: ' + name + ' (' + dist + 'mi, ' + state + ')');
      inserted++;
    } catch (e) {
      console.log('  ERROR ' + name + ': ' + e.message.substring(0, 80));
    }
  }

  console.log('\nInserted: ' + inserted + ', Skipped (already exist): ' + skipped);

  // VERIFY
  const chains = await client.query('SELECT chain, COUNT(*) as count FROM yard GROUP BY chain ORDER BY count DESC');
  console.log('\n=== YARD COUNTS BY CHAIN ===');
  chains.rows.forEach(r => console.log('  ' + (r.chain || 'NULL') + ': ' + r.count));

  const all = await client.query("SELECT name, scrape_url, distance_from_base, enabled FROM yard WHERE scrape_method = 'pullapart' OR chain = 'Pull-A-Part' ORDER BY distance_from_base");
  console.log('\n=== ALL PULL-A-PART YARDS (' + all.rows.length + ') ===');
  all.rows.forEach(r => console.log('  ' + (r.enabled ? 'ON ' : 'OFF') + ' ' + r.name + ' | ' + r.distance_from_base + 'mi | ' + (r.scrape_url || 'NULL').substring(0, 55)));

  await client.end();
}

main().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
