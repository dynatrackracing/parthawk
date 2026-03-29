'use strict';

exports.up = async function(knex) {
  const existing = await knex('trim_tier_reference')
    .where({ make: 'Ford', model: 'F-150', gen_start: 1992, gen_end: 1996 })
    .first();
  if (existing) return;

  await knex('trim_tier_reference').insert([
    { make: 'Ford', model: 'F-150', gen_start: 1992, gen_end: 1996, trim: 'XL 4.9', tier: 1, tier_name: 'base', top_engine: '4.9L I6', audio_brand: '', expected_parts: '', notes: '300 inline-6. Work truck.', cult: false, transmission: 'CHECK_MT' },
    { make: 'Ford', model: 'F-150', gen_start: 1992, gen_end: 1996, trim: 'XLT 5.0', tier: 2, tier_name: 'mid', top_engine: '5.0L V8', audio_brand: '', expected_parts: 'Power windows, cruise', notes: '302 V8', cult: false, transmission: '4-speed Automatic' },
    { make: 'Ford', model: 'F-150', gen_start: 1992, gen_end: 1996, trim: 'XLT 5.8', tier: 3, tier_name: 'premium', top_engine: '5.8L V8', audio_brand: '', expected_parts: 'Power seats, cruise, A/C', notes: '351W V8', cult: false, transmission: '4-speed Automatic' },
    { make: 'Ford', model: 'F-150', gen_start: 1992, gen_end: 1996, trim: '7.5L', tier: 4, tier_name: 'performance', top_engine: '7.5L V8', audio_brand: '', expected_parts: '460 big block ECM, heavy duty cooling, heavy duty trans', notes: '460 Hercules. Rare at yards.', cult: false, transmission: '4-speed Automatic' },
    { make: 'Ford', model: 'F-150', gen_start: 1992, gen_end: 1996, trim: '7.3L Diesel', tier: 4, tier_name: 'performance', top_engine: '7.3L Diesel', audio_brand: '', expected_parts: 'Power Stroke ECM, turbo, HPOP, injectors, IPR, CPS, glow plugs', notes: 'IDI pre-94, Power Stroke 94+. Diesel gold.', cult: true, transmission: '5-speed Manual' },
  ]);

  // 1997-2003 F-150 7.3L Power Stroke (if not already present)
  const existing73 = await knex('trim_tier_reference')
    .where({ make: 'Ford', model: 'F-150', gen_start: 1997, gen_end: 2003 })
    .whereRaw("LOWER(top_engine) LIKE '%7.3%'")
    .first();
  if (!existing73) {
    await knex('trim_tier_reference').insert([
      { make: 'Ford', model: 'F-150', gen_start: 1997, gen_end: 2003, trim: '7.3L Diesel', tier: 4, tier_name: 'performance', top_engine: '7.3L Diesel', audio_brand: '', expected_parts: 'Power Stroke ECM, turbo, HPOP, injectors, IPR, CPS, ICP sensor, glow plugs, up-pipes', notes: '7.3L Power Stroke. Most sought after diesel ever made.', cult: true, transmission: 'CHECK_MT' },
    ]);
  }
};

exports.down = async function(knex) {
  await knex('trim_tier_reference').where({ make: 'Ford', model: 'F-150', gen_start: 1992, gen_end: 1996 }).delete();
  await knex('trim_tier_reference').where({ make: 'Ford', model: 'F-150', gen_start: 1997, gen_end: 2003 }).whereRaw("LOWER(top_engine) LIKE '%7.3%'").delete();
};
