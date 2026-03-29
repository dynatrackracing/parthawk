const https = require('https');

const { Client } = require('pg');
const client = new Client('postgresql://postgres:jOWykUhLuUbWSVASAAZZHqsDVfyqaFTN@switchyard.proxy.rlwy.net:12023/railway');

async function run() {
  await client.connect();

  // Get 10 real VINs from yard_vehicle
  const q = await client.query(`
    SELECT vin, year, make, model, engine
    FROM yard_vehicle
    WHERE vin IS NOT NULL AND LENGTH(vin) = 17
    ORDER BY date_added DESC LIMIT 10
  `);

  console.log('Test VINs:', q.rows.map(r => `${r.year} ${r.make} ${r.model} — ${r.vin}`).join('\n'));

  const vinString = q.rows.map(r => r.vin).join(';');

  // Call NHTSA batch decode
  const postData = `format=json&data=${vinString}`;

  const result = await new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'vpic.nhtsa.dot.gov',
      path: '/api/vehicles/DecodeVINValuesBatch/',
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(postData)
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(JSON.parse(data)));
    });
    req.on('error', reject);
    req.write(postData);
    req.end();
  });

  console.log('\n=== NHTSA Transmission Fields ===\n');
  for (const r of result.Results) {
    console.log(`${r.ModelYear} ${r.Make} ${r.Model}`);
    console.log(`  TransmissionStyle: ${JSON.stringify(r.TransmissionStyle)} (type: ${typeof r.TransmissionStyle})`);
    console.log(`  TransmissionSpeeds: ${JSON.stringify(r.TransmissionSpeeds)} (type: ${typeof r.TransmissionSpeeds})`);
    console.log(`  DriveType: ${JSON.stringify(r.DriveType)} (type: ${typeof r.DriveType})`);
    console.log('');
  }

  await client.end();
}

run().catch(e => { console.error(e); process.exit(1); });
