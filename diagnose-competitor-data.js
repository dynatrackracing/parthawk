const { Client } = require('pg');
const DATABASE_URL = process.env.DATABASE_URL;
async function run() {
  const client = new Client({ connectionString: DATABASE_URL, ssl: false });
  await client.connect();
  console.log('Connected.\n');

  console.log('=== ALL TABLES ===');
  const tables = await client.query(`SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename`);
  tables.rows.forEach(r => console.log('  ' + r.tablename));
  console.log('Total: ' + tables.rows.length + '\n');

  console.log('=== CORE TABLE COUNTS ===');
  for (const t of ['YourSale','YourListing','Item','Auto','AutoItemCompatibility','yard_vehicle','SoldItem','SoldItemSeller','CompetitorListing','MarketResearchRun','PriceSnapshot','PriceCheck','Competitor']) {
    try { const r = await client.query(`SELECT COUNT(*) as c FROM "${t}"`); console.log('  "'+t+'": '+r.rows[0].c+' rows'); }
    catch(e) { console.log('  "'+t+'": NOT FOUND'); }
  }

  console.log('\n=== COMPETITOR TABLE (all rows) ===');
  try { const r = await client.query(`SELECT * FROM "Competitor" LIMIT 50`); r.rows.forEach(row => console.log('  ' + JSON.stringify(row))); } catch(e) { console.log('  Error: '+e.message); }

  console.log('\n=== SOLDITEM SELLER BREAKDOWN ===');
  try { const r = await client.query(`SELECT seller, COUNT(*) as count, ROUND(AVG("soldPrice")::numeric,2) as avg_price, MIN("soldDate")::text as earliest, MAX("soldDate")::text as latest FROM "SoldItem" WHERE seller IS NOT NULL GROUP BY seller ORDER BY count DESC LIMIT 20`); r.rows.forEach(s => console.log('  '+s.seller+': '+s.count+' items, avg $'+s.avg_price+', '+s.earliest+' to '+s.latest)); } catch(e) { console.log('  Error: '+e.message); }

  console.log('\n=== SOLDITEM TOTALS ===');
  try { const r = await client.query(`SELECT COUNT(*) as count, COUNT(DISTINCT seller) as sellers, MIN("soldDate")::text as earliest, MAX("soldDate")::text as latest FROM "SoldItem"`); console.log('  '+JSON.stringify(r.rows[0])); } catch(e) { console.log('  Error: '+e.message); }

  console.log('\n=== SOLDITEMSELLER TABLE (all rows) ===');
  try { const r = await client.query(`SELECT * FROM "SoldItemSeller" LIMIT 50`); r.rows.forEach(row => console.log('  ' + JSON.stringify(row))); if(r.rows.length===0) console.log('  (empty)'); } catch(e) { console.log('  Error: '+e.message); }

  console.log('\n=== COMPETITORLISTING TOTALS ===');
  try { const r = await client.query(`SELECT COUNT(*) as count, COUNT(DISTINCT seller) as sellers FROM "CompetitorListing"`); console.log('  '+JSON.stringify(r.rows[0])); } catch(e) { console.log('  Error: '+e.message); }

  console.log('\n=== ITEM TABLE SELLER BREAKDOWN (top 20) ===');
  try { const r = await client.query(`SELECT seller, COUNT(*) as count, ROUND(AVG(price)::numeric,2) as avg_price FROM "Item" WHERE seller IS NOT NULL GROUP BY seller ORDER BY count DESC LIMIT 20`); r.rows.forEach(s => console.log('  '+s.seller+': '+s.count+' items, avg $'+s.avg_price)); } catch(e) { console.log('  Error: '+e.message); }

  console.log('\n=== IMPORTAPART SEARCH (all tables) ===');
  try { const r = await client.query(`SELECT 'SoldItem' as tbl, COUNT(*) as c FROM "SoldItem" WHERE LOWER(seller) LIKE '%importapart%' UNION ALL SELECT 'CompetitorListing', COUNT(*) FROM "CompetitorListing" WHERE LOWER(seller) LIKE '%importapart%' UNION ALL SELECT 'Item', COUNT(*) FROM "Item" WHERE LOWER(seller) LIKE '%importapart%'`); r.rows.forEach(row => console.log('  '+row.tbl+': '+row.c+' rows')); } catch(e) { console.log('  Error: '+e.message); }

  console.log('\n=== PRICECHECK TOTALS ===');
  try { const r = await client.query(`SELECT COUNT(*) as count, MIN("checkedAt")::text as earliest, MAX("checkedAt")::text as latest FROM "PriceCheck"`); console.log('  '+JSON.stringify(r.rows[0])); } catch(e) { console.log('  Error: '+e.message); }

  console.log('\n=== APPLIED MIGRATIONS ===');
  try { const r = await client.query(`SELECT name FROM knex_migrations ORDER BY id`); r.rows.forEach(m => console.log('  '+m.name)); } catch(e) { console.log('  Error: '+e.message); }

  await client.end();
  console.log('\nDone.');
}
run().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
