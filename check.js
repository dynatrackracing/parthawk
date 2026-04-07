const k = require('./service/database/database').database;
(async () => {
  const items = await k('Item')
    .select('itemId', 'title')
    .whereRaw("title ILIKE '%Sonata%' AND title ILIKE '%engine%'")
    .limit(5);
  console.log(JSON.stringify(items, null, 2));
  process.exit();
})();
