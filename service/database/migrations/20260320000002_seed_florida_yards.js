'use strict';

module.exports = {
  async up(knex) {
    const yards = [
      { name: 'LKQ Tampa', chain: 'LKQ', slug: 'tampa-1180', scrape_method: 'html', visit_frequency: 'road_trip', distance_from_base: 600, enabled: true, flagged: false },
      { name: 'LKQ Largo', chain: 'LKQ', slug: 'largo-1189', scrape_method: 'html', visit_frequency: 'road_trip', distance_from_base: 610, enabled: true, flagged: false },
      { name: 'LKQ Clearwater', chain: 'LKQ', slug: 'clearwater-1190', scrape_method: 'html', visit_frequency: 'road_trip', distance_from_base: 615, enabled: true, flagged: false },
    ];

    for (const yard of yards) {
      const exists = await knex('yard').where('name', yard.name).first();
      if (!exists) {
        await knex('yard').insert({
          id: knex.raw('gen_random_uuid()'),
          ...yard,
          createdAt: new Date(),
          updatedAt: new Date(),
        });
      }
    }
  },

  async down(knex) {
    await knex('yard').whereIn('name', ['LKQ Tampa', 'LKQ Largo', 'LKQ Clearwater']).delete();
  }
};
