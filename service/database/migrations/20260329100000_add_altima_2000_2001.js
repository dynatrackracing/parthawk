'use strict';

exports.up = async function(knex) {
  // Check if entries already exist
  const existing = await knex('trim_tier_reference')
    .where({ make: 'Nissan', model: 'Altima', gen_start: 2000, gen_end: 2001 })
    .first();
  if (existing) return;

  await knex('trim_tier_reference').insert([
    { make: 'Nissan', model: 'Altima', gen_start: 2000, gen_end: 2001, trim: 'GXE', tier: 1, tier_name: 'base', top_engine: '2.4L I4', audio_brand: '', expected_parts: '', notes: 'KA24DE', cult: false, transmission: 'Automatic' },
    { make: 'Nissan', model: 'Altima', gen_start: 2000, gen_end: 2001, trim: 'GLE', tier: 2, tier_name: 'mid', top_engine: '2.4L I4', audio_brand: '', expected_parts: 'Heated leather, moonroof, power seats', notes: '', cult: false, transmission: 'Automatic' },
    { make: 'Nissan', model: 'Altima', gen_start: 2000, gen_end: 2001, trim: 'SE', tier: 2, tier_name: 'mid', top_engine: '2.4L I4', audio_brand: '', expected_parts: 'Sport suspension, sport seats, rear disc brakes', notes: '', cult: false, transmission: '5-speed Manual' },
  ]);
};

exports.down = async function(knex) {
  await knex('trim_tier_reference')
    .where({ make: 'Nissan', model: 'Altima', gen_start: 2000, gen_end: 2001 })
    .delete();
};
