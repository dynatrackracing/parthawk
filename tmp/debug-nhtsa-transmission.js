const https = require('https');
const vin = '4T1BK46K57U557715'; // 2007 Toyota Camry from Durham

const url = `https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVin/${vin}?format=json`;

https.get(url, (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    const parsed = JSON.parse(data);
    const results = parsed.Results;

    // Show ALL fields that contain "trans" in the variable name
    console.log('=== TRANSMISSION RELATED FIELDS ===');
    results.forEach(r => {
      if (r.Variable && /trans/i.test(r.Variable)) {
        console.log(`  VariableId=${r.VariableId} Variable="${r.Variable}" Value="${r.Value}"`);
      }
    });

    // Also show trim, engine, drivetrain for reference
    console.log('\n=== OTHER KEY FIELDS ===');
    results.forEach(r => {
      if (r.Variable && /trim|engine|displace|drive.type|fuel/i.test(r.Variable)) {
        console.log(`  VariableId=${r.VariableId} Variable="${r.Variable}" Value="${r.Value}"`);
      }
    });
  });
});
