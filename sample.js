const k = require('./service/database/database').database;
(async () => {
  const items = await k('Item').select('id', 'ebayId', 'title', 'manufacturerPartNumber').limit(5);
  console.log(JSON.stringify(items, null, 2));

  const sonata = await k('Item')
    .select('id', 'ebayId', 'title', 'manufacturerPartNumber', 'price', 'categoryTitle')
    .whereRaw("title ILIKE '%Sonata%' AND title ILIKE '%engine%'")
    .limit(5);
  console.log('SONATA ENGINE MATCHES:');
  console.log(JSON.stringify(sonata, null, 2));

  process.exit();
})();
