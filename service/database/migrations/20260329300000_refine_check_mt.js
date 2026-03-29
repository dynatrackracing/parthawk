'use strict';

exports.up = async function(knex) {
  // Remove CHECK_MT from Silverado — not worth checking
  await knex('trim_tier_reference')
    .whereRaw("LOWER(model) LIKE '%silverado%'")
    .where('transmission', 'CHECK_MT')
    .update({ transmission: 'Automatic' });

  // Remove CHECK_MT from Sierra — not worth checking
  await knex('trim_tier_reference')
    .whereRaw("LOWER(model) LIKE '%sierra%'")
    .where('transmission', 'CHECK_MT')
    .update({ transmission: 'Automatic' });

  // Tacoma: keep CHECK_MT only on V6 trims (3.4L, 4.0L, 3.5L)
  await knex('trim_tier_reference')
    .whereRaw("LOWER(make) = 'toyota'")
    .whereRaw("LOWER(model) = 'tacoma'")
    .where('transmission', 'CHECK_MT')
    .whereRaw("LOWER(top_engine) NOT LIKE '%v6%'")
    .whereRaw("LOWER(top_engine) NOT LIKE '%3.4%'")
    .whereRaw("LOWER(top_engine) NOT LIKE '%4.0%'")
    .whereRaw("LOWER(top_engine) NOT LIKE '%3.5%'")
    .update({ transmission: 'Automatic' });
};

exports.down = async function(knex) {
  // Can't perfectly reverse — would need to re-run the original CHECK_MT migration
};
