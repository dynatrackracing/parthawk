'use strict';

exports.up = async function(knex) {
  // Pre-2008 base/work truck trims: ambiguous manual candidates
  await knex('trim_tier_reference')
    .where('transmission', 'Automatic')
    .where('tier', '<=', 1)
    .where('gen_end', '<=', 2008)
    .whereRaw("LOWER(model) IN ('f-150', 'silverado 1500', 'sierra 1500', 'ram 1500', 'ranger', 's10', 'dakota', 'frontier', 'tacoma')")
    .whereRaw("LOWER(trim) IN ('xl', 'wt', 'base', 'st', 'work special', 'xe', 's')")
    .update({ transmission: 'CHECK_MT' });

  // Pre-2008 mid truck trims with V6
  await knex('trim_tier_reference')
    .where('transmission', 'Automatic')
    .where('tier', '<=', 2)
    .where('gen_end', '<=', 2008)
    .whereRaw("LOWER(model) IN ('f-150', 'silverado 1500', 'sierra 1500', 'ranger', 's10', 'frontier')")
    .where('top_engine', 'like', '%V6%')
    .update({ transmission: 'CHECK_MT' });

  // Toyota Tacoma: manual was common on ALL trims through 2015
  await knex('trim_tier_reference')
    .whereRaw("LOWER(make) = 'toyota'")
    .whereRaw("LOWER(model) = 'tacoma'")
    .where('gen_end', '<=', 2015)
    .where('transmission', 'not like', '%Manual%')
    .update({ transmission: 'CHECK_MT' });

  // Toyota Tacoma 2016+: manual only on SR, SR5, TRD Sport, TRD Off-Road
  await knex('trim_tier_reference')
    .whereRaw("LOWER(make) = 'toyota'")
    .whereRaw("LOWER(model) = 'tacoma'")
    .where('gen_start', '>=', 2016)
    .whereRaw("LOWER(trim) IN ('sr', 'sr5', 'trd sport', 'trd off-road')")
    .update({ transmission: 'CHECK_MT' });

  // Toyota Pickup: manual was standard
  await knex('trim_tier_reference')
    .whereRaw("LOWER(make) = 'toyota'")
    .whereRaw("LOWER(model) = 'pickup'")
    .update({ transmission: '5-speed Manual' });

  // Jeep Wrangler: manual was default on sport/rubicon/se
  await knex('trim_tier_reference')
    .whereRaw("LOWER(make) = 'jeep'")
    .whereRaw("LOWER(model) = 'wrangler'")
    .whereRaw("LOWER(trim) IN ('sport', 'sport s', 'rubicon', 'se')")
    .where('transmission', 'not like', '%Manual%')
    .update({ transmission: 'CHECK_MT' });

  // Jeep Cherokee XJ: manual was common
  await knex('trim_tier_reference')
    .whereRaw("LOWER(make) = 'jeep'")
    .whereRaw("LOWER(model) = 'cherokee'")
    .where('gen_end', '<=', 2001)
    .update({ transmission: 'CHECK_MT' });

  // Ford Ranger: manual was common on all trims
  await knex('trim_tier_reference')
    .whereRaw("LOWER(make) = 'ford'")
    .whereRaw("LOWER(model) = 'ranger'")
    .where('transmission', 'not like', '%Manual%')
    .update({ transmission: 'CHECK_MT' });

  // Nissan Frontier pre-2019: manual available on base/mid trims
  await knex('trim_tier_reference')
    .whereRaw("LOWER(make) = 'nissan'")
    .whereRaw("LOWER(model) = 'frontier'")
    .where('tier', '<=', 2)
    .where('gen_end', '<=', 2019)
    .where('transmission', 'not like', '%Manual%')
    .update({ transmission: 'CHECK_MT' });

  // Chevy S10: manual was common on base and LS
  await knex('trim_tier_reference')
    .whereRaw("LOWER(make) = 'chevrolet'")
    .whereRaw("LOWER(model) = 's10'")
    .whereRaw("LOWER(trim) IN ('base', 'ls')")
    .where('transmission', 'not like', '%Manual%')
    .update({ transmission: 'CHECK_MT' });

  // Dodge Dakota pre-2005: manual available
  await knex('trim_tier_reference')
    .whereRaw("LOWER(make) = 'dodge'")
    .whereRaw("LOWER(model) = 'dakota'")
    .where('gen_end', '<=', 2004)
    .where('tier', '<=', 2)
    .where('transmission', 'not like', '%Manual%')
    .update({ transmission: 'CHECK_MT' });
};

exports.down = async function(knex) {
  // Revert CHECK_MT back to Automatic
  await knex('trim_tier_reference')
    .where('transmission', 'CHECK_MT')
    .update({ transmission: 'Automatic' });

  // Revert Toyota Pickup back to null/Automatic
  await knex('trim_tier_reference')
    .whereRaw("LOWER(make) = 'toyota'")
    .whereRaw("LOWER(model) = 'pickup'")
    .where('transmission', '5-speed Manual')
    .update({ transmission: 'Automatic' });
};
