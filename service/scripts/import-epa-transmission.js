'use strict';

/**
 * Import epa_transmission.csv into vin_decoder.epa_transmission table.
 * Usage: DATABASE_URL=... node service/scripts/import-epa-transmission.js
 */

const fs = require('fs');
const path = require('path');
const { database } = require('../database/database');

async function run() {
  const csvPath = path.join(__dirname, '..', '..', 'epa_transmission.csv');
  if (!fs.existsSync(csvPath)) {
    console.error('epa_transmission.csv not found at', csvPath);
    process.exit(1);
  }

  const raw = fs.readFileSync(csvPath, 'utf8');
  const lines = raw.split('\n').filter(l => l.trim());
  const header = lines[0].split(',');
  console.log('Columns:', header.join(', '));

  // Truncate
  await database.raw('TRUNCATE TABLE vin_decoder.epa_transmission RESTART IDENTITY');
  console.log('Table truncated.');

  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = parseCSVLine(lines[i]);
    if (cols.length < 11) continue;
    rows.push({
      year: parseInt(cols[0]) || 0,
      make: cols[1],
      model_raw: cols[2],
      model_clean: cols[3],
      cylinders: cols[4] || null,
      displacement: cols[5] || null,
      drive: cols[6] || null,
      trans_type: cols[7],
      trans_speeds: cols[8] || null,
      trans_sub_type: cols[9] || null,
      trany_raw: cols[10] || null,
    });
  }

  // Batch insert (500 at a time)
  const batchSize = 500;
  for (let i = 0; i < rows.length; i += batchSize) {
    await database('vin_decoder.epa_transmission').insert(rows.slice(i, i + batchSize));
    if ((i + batchSize) % 5000 === 0 || i + batchSize >= rows.length) {
      console.log(`Inserted ${Math.min(i + batchSize, rows.length)} / ${rows.length}`);
    }
  }

  // Summary
  const stats = await database.raw(`
    SELECT COUNT(*) as total,
           COUNT(DISTINCT make) as makes,
           MIN(year) as min_year,
           MAX(year) as max_year
    FROM vin_decoder.epa_transmission
  `);
  const s = stats.rows[0];
  console.log(`\nDone. ${s.total} rows inserted, ${s.makes} distinct makes, years ${s.min_year}-${s.max_year}`);

  await database.destroy();
}

// Simple CSV parser that handles quoted fields
function parseCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current.trim());
  return result;
}

run().catch(e => { console.error(e); process.exit(1); });
