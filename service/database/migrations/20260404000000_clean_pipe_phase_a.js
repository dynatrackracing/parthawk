'use strict';

const TABLES = ['YourListing', 'YourSale', 'SoldItem'];
const COLUMNS = ['partNumberBase', 'partType', 'extractedMake', 'extractedModel'];

exports.up = async function(knex) {
  for (const table of TABLES) {
    for (const col of COLUMNS) {
      const has = await knex.schema.hasColumn(table, col);
      if (!has) {
        await knex.schema.alterTable(table, function(t) {
          t.text(col).nullable();
        });
      }
    }
  }

  // Indexes for cross-table joins and filtering
  await knex.raw('CREATE INDEX IF NOT EXISTS idx_yourlisting_pnbase ON "YourListing"("partNumberBase")');
  await knex.raw('CREATE INDEX IF NOT EXISTS idx_yoursale_pnbase ON "YourSale"("partNumberBase")');
  await knex.raw('CREATE INDEX IF NOT EXISTS idx_solditem_pnbase ON "SoldItem"("partNumberBase")');
  await knex.raw('CREATE INDEX IF NOT EXISTS idx_yourlisting_parttype ON "YourListing"("partType")');
  await knex.raw('CREATE INDEX IF NOT EXISTS idx_yoursale_parttype ON "YourSale"("partType")');
  await knex.raw('CREATE INDEX IF NOT EXISTS idx_solditem_parttype ON "SoldItem"("partType")');
  await knex.raw('CREATE INDEX IF NOT EXISTS idx_yourlisting_make ON "YourListing"("extractedMake")');
  await knex.raw('CREATE INDEX IF NOT EXISTS idx_solditem_make ON "SoldItem"("extractedMake")');
};

exports.down = async function(knex) {
  // Drop indexes
  await knex.raw('DROP INDEX IF EXISTS idx_yourlisting_pnbase');
  await knex.raw('DROP INDEX IF EXISTS idx_yoursale_pnbase');
  await knex.raw('DROP INDEX IF EXISTS idx_solditem_pnbase');
  await knex.raw('DROP INDEX IF EXISTS idx_yourlisting_parttype');
  await knex.raw('DROP INDEX IF EXISTS idx_yoursale_parttype');
  await knex.raw('DROP INDEX IF EXISTS idx_solditem_parttype');
  await knex.raw('DROP INDEX IF EXISTS idx_yourlisting_make');
  await knex.raw('DROP INDEX IF EXISTS idx_solditem_make');

  // Drop columns
  for (const table of TABLES) {
    for (const col of COLUMNS) {
      const has = await knex.schema.hasColumn(table, col);
      if (has) {
        await knex.schema.alterTable(table, function(t) {
          t.dropColumn(col);
        });
      }
    }
  }
};
