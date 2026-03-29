const { Client } = require('pg');
const client = new Client('postgresql://postgres:jOWykUhLuUbWSVASAAZZHqsDVfyqaFTN@switchyard.proxy.rlwy.net:12023/railway');

async function run() {
  await client.connect();
  const q = await client.query(`
    SELECT vin, year, make, model, decoded_trim, decoded_engine, decoded_transmission
    FROM yard_vehicle
    WHERE vin IS NOT NULL AND vin != '' AND active = true
    AND yard_id = (SELECT id FROM yard WHERE name ILIKE '%durham%' LIMIT 1)
    ORDER BY last_seen DESC
    LIMIT 10
  `);
  console.log(q.rows);
  await client.end();
}

run().catch(e => { console.error(e); process.exit(1); });
