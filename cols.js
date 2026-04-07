const k = require('./service/database/database').database;
(async () => {
  const cols = await k.raw("SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'Item' ORDER BY ordinal_position");
  console.log(JSON.stringify(cols.rows, null, 2));
  process.exit();
})();
