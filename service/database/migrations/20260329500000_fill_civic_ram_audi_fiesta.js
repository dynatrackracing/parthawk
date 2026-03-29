'use strict';

exports.up = async function(knex) {
  // Honda Civic LX across all generations
  const civicLX = await knex('trim_tier_reference')
    .where({ make: 'Honda', model: 'Civic' })
    .whereRaw("LOWER(trim) = 'lx'")
    .first();
  if (!civicLX) {
    await knex('trim_tier_reference').insert([
      { make: 'Honda', model: 'Civic', gen_start: 1992, gen_end: 1995, trim: 'LX', tier: 1, tier_name: 'base', top_engine: '1.5L I4 (D15B7)', audio_brand: '', expected_parts: '', notes: '', cult: false, transmission: 'Automatic' },
      { make: 'Honda', model: 'Civic', gen_start: 1996, gen_end: 2000, trim: 'LX', tier: 1, tier_name: 'base', top_engine: '1.6L I4 (D16Y7)', audio_brand: '', expected_parts: '', notes: '', cult: false, transmission: 'Automatic' },
      { make: 'Honda', model: 'Civic', gen_start: 2001, gen_end: 2005, trim: 'LX', tier: 1, tier_name: 'base', top_engine: '1.7L I4 (D17A1)', audio_brand: '', expected_parts: '', notes: '', cult: false, transmission: 'Automatic' },
      { make: 'Honda', model: 'Civic', gen_start: 2006, gen_end: 2011, trim: 'LX', tier: 1, tier_name: 'base', top_engine: '1.8L I4', audio_brand: '', expected_parts: '', notes: '', cult: false, transmission: 'Automatic' },
      { make: 'Honda', model: 'Civic', gen_start: 2012, gen_end: 2015, trim: 'LX', tier: 1, tier_name: 'base', top_engine: '1.8L I4', audio_brand: '', expected_parts: '', notes: '', cult: false, transmission: 'Automatic' },
      { make: 'Honda', model: 'Civic', gen_start: 2016, gen_end: 2021, trim: 'LX', tier: 1, tier_name: 'base', top_engine: '2.0L I4', audio_brand: '', expected_parts: '', notes: '', cult: false, transmission: 'CVT' },
      { make: 'Honda', model: 'Civic', gen_start: 2022, gen_end: 2025, trim: 'LX', tier: 1, tier_name: 'base', top_engine: '2.0L I4', audio_brand: '', expected_parts: '', notes: '', cult: false, transmission: 'CVT' },
    ]);
  }

  // 2002-2003 Dodge Ram 1500 5.9L Magnum entries
  const ram59 = await knex('trim_tier_reference')
    .where({ make: 'Dodge', model: 'Ram 1500' })
    .whereRaw("LOWER(top_engine) LIKE '%5.9%'")
    .first();
  if (!ram59) {
    await knex('trim_tier_reference').insert([
      { make: 'Dodge', model: 'Ram 1500', gen_start: 2002, gen_end: 2003, trim: 'SLT 5.9', tier: 2, tier_name: 'mid', top_engine: '5.9L V8', audio_brand: '', expected_parts: 'Power seats, cruise', notes: '5.9L Magnum V8. Last year 2003.', cult: false, transmission: '4-speed Automatic' },
      { make: 'Dodge', model: 'Ram 1500', gen_start: 2002, gen_end: 2003, trim: 'Laramie 5.9', tier: 3, tier_name: 'premium', top_engine: '5.9L V8', audio_brand: 'Infinity', expected_parts: 'Infinity amp, heated seats, leather', notes: '5.9L Magnum in premium trim', cult: false, transmission: '4-speed Automatic' },
    ]);
  }

  // Audi A6 3.2 (2005-2008 C6)
  const audiA6 = await knex('trim_tier_reference')
    .where({ make: 'Audi', model: 'A6' })
    .whereRaw("LOWER(trim) = '3.2'")
    .first();
  if (!audiA6) {
    await knex('trim_tier_reference').insert([
      { make: 'Audi', model: 'A6', gen_start: 2005, gen_end: 2008, trim: '3.2', tier: 2, tier_name: 'mid', top_engine: '3.2L V6', audio_brand: '', expected_parts: 'Power seats, MMI, heated seats', notes: 'C6. 3.1L and 3.2L both used.', cult: false, transmission: '6-speed Automatic' },
    ]);
  }

  // Ford Fiesta 2011-2013 base entries
  const fiesta = await knex('trim_tier_reference')
    .where({ make: 'Ford', model: 'Fiesta', gen_start: 2011, gen_end: 2013 })
    .first();
  if (!fiesta) {
    await knex('trim_tier_reference').insert([
      { make: 'Ford', model: 'Fiesta', gen_start: 2011, gen_end: 2013, trim: 'S', tier: 1, tier_name: 'base', top_engine: '1.6L I4', audio_brand: '', expected_parts: '', notes: '', cult: false, transmission: 'Automatic' },
      { make: 'Ford', model: 'Fiesta', gen_start: 2011, gen_end: 2013, trim: 'SE', tier: 2, tier_name: 'mid', top_engine: '1.6L I4', audio_brand: '', expected_parts: '', notes: 'Power windows, SYNC', cult: false, transmission: 'Automatic' },
    ]);
  }
};

exports.down = async function(knex) {
  await knex('trim_tier_reference').whereRaw("LOWER(make) = 'honda'").whereRaw("LOWER(model) = 'civic'").whereRaw("LOWER(trim) = 'lx'").delete();
  await knex('trim_tier_reference').whereRaw("LOWER(trim) LIKE '%5.9%'").where({ make: 'Dodge', model: 'Ram 1500' }).delete();
  await knex('trim_tier_reference').where({ make: 'Audi', model: 'A6', trim: '3.2' }).delete();
  await knex('trim_tier_reference').where({ make: 'Ford', model: 'Fiesta', gen_start: 2011, gen_end: 2013 }).delete();
};
