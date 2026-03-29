'use strict';

exports.up = async function(knex) {
  await knex('trim_tier_reference')
    .whereRaw("LOWER(make) = 'ford'")
    .whereRaw("LOWER(model) = 'ranger'")
    .where('transmission', 'CHECK_MT')
    .where(function() {
      this.whereRaw("LOWER(top_engine) LIKE '%i4%'")
        .orWhereRaw("LOWER(top_engine) LIKE '%2.3%'")
        .orWhereRaw("LOWER(top_engine) LIKE '%2.5%'");
    })
    .update({ transmission: 'Automatic' });
};

exports.down = async function(knex) {
  // Would need to re-run original CHECK_MT migration to restore
};
