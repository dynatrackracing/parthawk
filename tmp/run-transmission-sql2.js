const { Client } = require('pg');
const fs = require('fs');
const client = new Client('postgresql://postgres:jOWykUhLuUbWSVASAAZZHqsDVfyqaFTN@switchyard.proxy.rlwy.net:12023/railway');

async function run() {
  await client.connect();
  const sql = fs.readFileSync('./transmission_update.sql', 'utf8');

  // Run the whole file as one multi-statement query
  await client.query(sql);
  console.log('SQL executed successfully');

  // Show distribution
  const dist = await client.query(`SELECT transmission, count(*)::int as cnt FROM trim_tier_reference GROUP BY transmission ORDER BY cnt DESC`);
  console.log('\n=== Transmission Distribution ===');
  console.log(dist.rows);

  // Show manual/DCT spot check
  const manuals = await client.query(`SELECT make, model, trim, transmission FROM trim_tier_reference WHERE transmission NOT IN ('Automatic', 'CVT') AND transmission NOT LIKE '%Automatic%' ORDER BY make, model LIMIT 30`);
  console.log('\n=== Manual/DCT Spot Check (first 30) ===');
  console.log(manuals.rows);

  await client.end();
}

run().catch(e => { console.error(e); process.exit(1); });
