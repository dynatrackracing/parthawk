const { Client } = require('pg');
const client = new Client('postgresql://postgres:jOWykUhLuUbWSVASAAZZHqsDVfyqaFTN@switchyard.proxy.rlwy.net:12023/railway');

async function run() {
  await client.connect();

  console.log('=== 1. How many YourSale records exist in last 90 days? ===');
  const q1 = await client.query(`
    SELECT COUNT(*)::int as total,
      MIN("soldDate") as earliest,
      MAX("soldDate") as latest
    FROM "YourSale"
    WHERE "soldDate" >= NOW() - INTERVAL '90 days'
    AND title IS NOT NULL
  `);
  console.log(q1.rows[0]);

  console.log('\n=== 2. Sample YourSale titles for Nissan Titan ===');
  const q2 = await client.query(`
    SELECT title, "salePrice", "soldDate"
    FROM "YourSale"
    WHERE title ILIKE '%titan%'
    ORDER BY "soldDate" DESC
    LIMIT 10
  `);
  console.log(q2.rows.length ? q2.rows : 'NO TITAN SALES FOUND');

  console.log('\n=== 3. Total YourSale by make (top 15 makes in last 90d) ===');
  const q3 = await client.query(`
    SELECT
      CASE
        WHEN title ILIKE '%ford%' THEN 'Ford'
        WHEN title ILIKE '%chevy%' OR title ILIKE '%chevrolet%' THEN 'Chevrolet'
        WHEN title ILIKE '%toyota%' THEN 'Toyota'
        WHEN title ILIKE '%honda%' THEN 'Honda'
        WHEN title ILIKE '%nissan%' THEN 'Nissan'
        WHEN title ILIKE '%dodge%' THEN 'Dodge'
        WHEN title ILIKE '%jeep%' THEN 'Jeep'
        WHEN title ILIKE '%bmw%' THEN 'BMW'
        WHEN title ILIKE '%mercedes%' THEN 'Mercedes'
        WHEN title ILIKE '%hyundai%' THEN 'Hyundai'
        WHEN title ILIKE '%kia%' THEN 'Kia'
        WHEN title ILIKE '%lexus%' THEN 'Lexus'
        WHEN title ILIKE '%subaru%' THEN 'Subaru'
        WHEN title ILIKE '%mazda%' THEN 'Mazda'
        WHEN title ILIKE '%chrysler%' THEN 'Chrysler'
        ELSE 'Other'
      END as make,
      COUNT(*)::int as sales
    FROM "YourSale"
    WHERE "soldDate" >= NOW() - INTERVAL '90 days' AND title IS NOT NULL
    GROUP BY 1
    ORDER BY 2 DESC
  `);
  console.log(q3.rows);

  console.log('\n=== 4. Check how buildSalesIndex parses titles — show 20 sample titles ===');
  const q4 = await client.query(`
    SELECT title, "salePrice", "soldDate"
    FROM "YourSale"
    WHERE "soldDate" >= NOW() - INTERVAL '90 days' AND title IS NOT NULL
    ORDER BY "soldDate" DESC
    LIMIT 20
  `);
  console.log(q4.rows);

  console.log('\n=== 5. Check if title parsing would work — do titles contain make AND model? ===');
  const q5 = await client.query(`
    SELECT
      COUNT(*)::int as total,
      COUNT(*) FILTER (WHERE title ~* '(ford|chevy|chevrolet|toyota|honda|nissan|dodge|jeep|bmw|mercedes|hyundai|kia|lexus|subaru|mazda|chrysler|ram|gmc|acura|infiniti|volkswagen)')::int as has_make,
      COUNT(*) FILTER (WHERE title ~* '(camry|civic|accord|altima|f-150|f150|silverado|tacoma|corolla|rav4|cr-v|crv|explorer|escape|mustang|wrangler|cherokee|ram 1500|sierra|titan|frontier|pathfinder|rogue|sentra|maxima|murano|armada)')::int as has_model
    FROM "YourSale"
    WHERE "soldDate" >= NOW() - INTERVAL '90 days' AND title IS NOT NULL
  `);
  console.log(q5.rows[0]);

  await client.end();
}

run().catch(e => { console.error(e); process.exit(1); });
