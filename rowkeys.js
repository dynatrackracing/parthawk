const k = require('./service/database/database').database;
(async () => {
  // Mimic what buildInventoryIndex queries ? adjust if it does something fancier
  const rows = await k('Item').select('*').limit(2);
  console.log('COLUMNS ON Item ROW:');
  console.log(Object.keys(rows[0]));
  console.log('\nFULL ROW:');
  console.log(JSON.stringify(rows[0], null, 2));
  process.exit();
})();
