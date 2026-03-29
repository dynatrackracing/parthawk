const { Client } = require('pg');
const client = new Client('postgresql://postgres:jOWykUhLuUbWSVASAAZZHqsDVfyqaFTN@switchyard.proxy.rlwy.net:12023/railway');

async function run() {
  await client.connect();

  // Pick a vehicle we KNOW has sales — Ford is the top seller with 288 sales
  console.log('=== 1. Find a Ford yard vehicle to test ===');
  const q1 = await client.query(`
    SELECT id, year, make, model, engine
    FROM yard_vehicle
    WHERE active = true AND LOWER(make) LIKE '%ford%'
    ORDER BY date_added DESC LIMIT 5
  `);
  console.log(q1.rows);

  // Check what Ford sales exist
  console.log('\n=== 2. Ford sales in last 90d (by model) ===');
  const q2 = await client.query(`
    SELECT title, "salePrice", "soldDate"
    FROM "YourSale"
    WHERE "soldDate" >= NOW() - INTERVAL '90 days'
    AND title ILIKE '%ford%'
    ORDER BY "soldDate" DESC LIMIT 15
  `);
  console.log(q2.rows);

  // Now hit the actual attack list API for that vehicle
  const vehicleId = q1.rows[0]?.id;
  if (vehicleId) {
    console.log(`\n=== 3. Fetching attack list parts for vehicle ${vehicleId} ===`);
    const https = require('https');

    const data = await new Promise((resolve, reject) => {
      https.get(`https://parthawk-production.up.railway.app/attack-list/vehicle/${vehicleId}/parts`, (res) => {
        let body = '';
        res.on('data', chunk => body += chunk);
        res.on('end', () => {
          try { resolve(JSON.parse(body)); }
          catch(e) { resolve(body); }
        });
      }).on('error', reject);
    });

    if (data && data.parts) {
      console.log(`Total parts returned: ${data.parts.length}`);
      console.log('\nParts breakdown:');
      data.parts.forEach((p, i) => {
        console.log(`  [${i+1}] ${p.partType || 'UNKNOWN'} — $${p.weightedAvgPrice || p.price || '?'}`);
        console.log(`      itemId: ${p.itemId || 'null (YourSale)'}`);
        console.log(`      sold_90d: ${p.sold_90d || 0}`);
        console.log(`      verdict: ${p.verdict}`);
        console.log(`      title: ${(p.title || '').substring(0, 80)}`);
        console.log(`      source: ${p.itemId ? 'ITEM TABLE' : 'YOUR SALE'}`);
      });
    } else {
      console.log('Raw response:', JSON.stringify(data).substring(0, 500));
    }
  }

  await client.end();
}

run().catch(e => { console.error(e); process.exit(1); });
