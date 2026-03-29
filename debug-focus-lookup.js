'use strict';
process.env.DATABASE_URL = 'postgresql://postgres:jOWykUhLuUbWSVASAAZZHqsDVfyqaFTN@switchyard.proxy.rlwy.net:12023/railway';

const TrimTierService = require('./service/services/TrimTierService');
const { database } = require('./service/database/database');

async function debug() {
  console.log('=== Direct lookup tests ===');

  const r1 = await TrimTierService.lookup(2012, 'Ford', 'Focus', 'SE', '2.0L');
  console.log('2012 Ford Focus SE 2.0L:', JSON.stringify(r1, null, 2));

  const r2 = await TrimTierService.lookup(2012, 'FORD', 'FOCUS', 'SE', '2.0L');
  console.log('2012 FORD FOCUS SE 2.0L:', JSON.stringify(r2, null, 2));

  console.log('\n=== cleanModelForLookup ===');
  console.log('Focus:', TrimTierService.cleanModelForLookup('FOCUS', 'FORD'));
  console.log('Focus SE:', TrimTierService.cleanModelForLookup('FOCUS SE', 'FORD'));

  console.log('\n=== Reference table entries ===');
  const entries = await database('trim_tier_reference')
    .whereRaw("LOWER(make) = 'ford'")
    .whereRaw("LOWER(model) = 'focus'");
  entries.forEach(e => console.log('  ' + e.gen_start + '-' + e.gen_end + ' ' + e.trim + ' tier=' + e.tier + ' engine=' + e.top_engine));

  console.log('\n=== Yard vehicle Focus samples ===');
  const vehicles = await database('yard_vehicle')
    .whereRaw("LOWER(make) = 'ford'")
    .whereRaw("LOWER(model) LIKE '%focus%'")
    .where('active', true)
    .limit(10);
  vehicles.forEach(v => console.log('  ' + v.year + ' ' + v.make + ' ' + v.model + ' trim=' + v.decoded_trim + ' engine=' + v.decoded_engine + ' tier=' + v.trim_tier));

  if (vehicles.length > 0) {
    const v = vehicles[0];
    console.log('\n=== Lookup with exact yard data: ' + v.year + ' ' + v.make + ' ' + v.model + ' trim=' + v.decoded_trim + ' engine=' + v.decoded_engine + ' ===');
    const r3 = await TrimTierService.lookup(parseInt(v.year), v.make, v.model, v.decoded_trim, v.decoded_engine);
    console.log('Result:', JSON.stringify(r3, null, 2));

    // Also test what cleanModelForLookup does with the exact yard model
    console.log('\n=== cleanModelForLookup with exact yard model ===');
    console.log('Input: "' + v.model + '" make: "' + v.make + '"');
    console.log('Output: "' + TrimTierService.cleanModelForLookup(v.model, v.make) + '"');

    // Raw query to see what candidates would match
    console.log('\n=== Raw candidate query ===');
    const makeVariants = TrimTierService.getMakeVariants(v.make);
    const modelCleaned = TrimTierService.cleanModelForLookup(v.model, v.make);
    console.log('makeVariants:', makeVariants);
    console.log('modelCleaned:', modelCleaned);
    console.log('modelNorm:', (modelCleaned || '').toLowerCase());
    console.log('year:', parseInt(v.year));

    const candidates = await database('trim_tier_reference')
      .whereRaw('LOWER(make) IN (' + makeVariants.map(() => '?').join(',') + ')', makeVariants)
      .whereRaw('LOWER(model) = ?', [(modelCleaned || '').toLowerCase()])
      .where('gen_start', '<=', parseInt(v.year))
      .where('gen_end', '>=', parseInt(v.year));
    console.log('Candidates found:', candidates.length);
    candidates.forEach(c => console.log('  ' + c.gen_start + '-' + c.gen_end + ' ' + c.trim + ' tier=' + c.tier));
  }

  await database.destroy();
  process.exit(0);
}

debug().catch(e => { console.error(e); process.exit(1); });
