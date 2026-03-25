'use strict';

// Florida yards should use distance from Tampa puller's base (7413 S O'Brien St, Tampa, FL 33616)
// not from the NC base. Update distance_from_base to local FL distances.
// Approximate driving distances from south Tampa:
//   LKQ Tampa (N Tampa / Orient Rd area): ~12 miles
//   LKQ Largo (Pinellas): ~22 miles
//   LKQ Clearwater (N Pinellas): ~28 miles

module.exports = {
  async up(knex) {
    // Add region column if not exists
    const hasRegion = await knex.schema.hasColumn('yard', 'region');
    if (!hasRegion) {
      await knex.schema.alterTable('yard', table => {
        table.string('region', 20).defaultTo('nc');
      });
    }

    // Tag FL yards and update distances from local base
    await knex('yard').where('name', 'LKQ Tampa').update({
      distance_from_base: 12, region: 'fl', visit_frequency: 'local'
    });
    await knex('yard').where('name', 'LKQ Largo').update({
      distance_from_base: 22, region: 'fl', visit_frequency: 'local'
    });
    await knex('yard').where('name', 'LKQ Clearwater').update({
      distance_from_base: 28, region: 'fl', visit_frequency: 'local'
    });

    // Tag NC yards
    await knex('yard').whereIn('name', ['LKQ Raleigh', 'LKQ Durham', 'LKQ Greensboro', 'LKQ East NC'])
      .update({ region: 'nc' });
  },

  async down(knex) {
    await knex('yard').where('name', 'LKQ Tampa').update({ distance_from_base: 600, visit_frequency: 'road_trip' });
    await knex('yard').where('name', 'LKQ Largo').update({ distance_from_base: 610, visit_frequency: 'road_trip' });
    await knex('yard').where('name', 'LKQ Clearwater').update({ distance_from_base: 615, visit_frequency: 'road_trip' });
    try { await knex.schema.alterTable('yard', table => { table.dropColumn('region'); }); } catch(e) {}
  }
};
