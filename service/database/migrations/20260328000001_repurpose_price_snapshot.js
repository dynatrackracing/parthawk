'use strict';

// PriceSnapshot grows unbounded. Add a cleanup cron later to purge rows older than 6 months.
// At ~200 writes/day, that's ~36,000 rows in 6 months — manageable.

exports.up = async function(knex) {
  const hasTable = await knex.schema.hasTable('PriceSnapshot');
  if (!hasTable) return; // Nothing to repurpose

  // Add columns needed for market data history tracking
  const cols = [
    ['part_number_base', 'text'],
    ['ebay_median_price', 'numeric'],
    ['ebay_min_price', 'numeric'],
    ['ebay_max_price', 'numeric'],
    ['source', 'text'],
    ['snapshot_date', 'timestamp with time zone'],
  ];

  for (const [col, type] of cols) {
    const has = await knex.schema.hasColumn('PriceSnapshot', col);
    if (!has) {
      await knex.schema.alterTable('PriceSnapshot', (table) => {
        if (type === 'text') table.text(col);
        else if (type === 'numeric') table.decimal(col, 10, 2);
        else if (type === 'timestamp with time zone') table.timestamp(col).defaultTo(knex.fn.now());
      });
    }
  }

  // Rename existing columns to match our naming convention
  // soldCount → ebay_sold_90d mapping handled in code, not column rename
  // soldPriceAvg → ebay_avg_price mapping handled in code, not column rename

  // Add indexes if not exists
  try { await knex.raw('CREATE INDEX IF NOT EXISTS idx_price_snapshot_pn ON "PriceSnapshot" (part_number_base)'); } catch (e) {}
  try { await knex.raw('CREATE INDEX IF NOT EXISTS idx_price_snapshot_date ON "PriceSnapshot" (snapshot_date)'); } catch (e) {}
};

exports.down = async function(knex) {
  // Don't drop columns on rollback — they're additive
};
