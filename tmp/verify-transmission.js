const { Client } = require('pg');
const client = new Client('postgresql://postgres:jOWykUhLuUbWSVASAAZZHqsDVfyqaFTN@switchyard.proxy.rlwy.net:12023/railway');

async function run() {
  await client.connect();

  console.log('=== Transmission distribution (active vehicles) ===');
  const q1 = await client.query(`
    SELECT decoded_transmission, count(*)::int
    FROM yard_vehicle
    WHERE active = true AND decoded_transmission IS NOT NULL
    GROUP BY decoded_transmission ORDER BY count(*) DESC
  `);
  console.log(q1.rows);

  console.log('\n=== Manual vehicles ===');
  const q2 = await client.query(`
    SELECT year, make, model, decoded_trim, decoded_transmission
    FROM yard_vehicle
    WHERE active = true AND decoded_transmission LIKE '%Manual%'
    LIMIT 20
  `);
  console.log(q2.rows);

  console.log('\n=== Total with transmission vs without ===');
  const q3 = await client.query(`
    SELECT
      COUNT(*) FILTER (WHERE decoded_transmission IS NOT NULL)::int as with_trans,
      COUNT(*) FILTER (WHERE decoded_transmission IS NULL)::int as without_trans,
      COUNT(*)::int as total
    FROM yard_vehicle WHERE active = true
  `);
  console.log(q3.rows[0]);

  await client.end();
}

run().catch(e => { console.error(e); process.exit(1); });
