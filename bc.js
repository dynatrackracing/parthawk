const k = require('./service/database/database').database;
(async () => {
  const rows = await k('blocked_comps')
    .orderBy('blocked_at', 'desc')
    .limit(10);
  console.log(JSON.stringify(rows, null, 2));
  process.exit();
})();
