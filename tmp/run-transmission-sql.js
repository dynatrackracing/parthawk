const { Client } = require('pg');
const fs = require('fs');
const client = new Client('postgresql://postgres:jOWykUhLuUbWSVASAAZZHqsDVfyqaFTN@switchyard.proxy.rlwy.net:12023/railway');

async function run() {
  await client.connect();
  const sql = fs.readFileSync('./transmission_update.sql', 'utf8');
  // Split on semicolons, run each statement
  const statements = sql.split(';').map(s => s.trim()).filter(s => s.length > 0 && !s.startsWith('--'));
  let i = 0;
  for (const stmt of statements) {
    i++;
    try {
      const result = await client.query(stmt);
      if (result.rows && result.rows.length > 0) {
        console.log(`\nStatement ${i} result:`);
        console.log(result.rows);
      } else if (result.rowCount !== null) {
        console.log(`Statement ${i}: ${result.rowCount} rows affected`);
      }
    } catch (e) {
      console.error(`Statement ${i} error: ${e.message}`);
      console.error(`SQL: ${stmt.substring(0, 100)}...`);
    }
  }
  await client.end();
}

run().catch(e => { console.error(e); process.exit(1); });
