'use strict';

module.exports = {
  async up(knex) {
    const exists = await knex.schema.hasTable('ai_vehicle_research');
    if (!exists) {
      await knex.schema.createTable('ai_vehicle_research', table => {
        table.increments('id').primary();
        table.integer('year');
        table.string('make', 50);
        table.string('model', 100);
        table.string('engine', 50);
        table.text('research');
        table.timestamp('created_at').defaultTo(knex.fn.now());
        table.unique(['year', 'make', 'model']);
      });
    }
  },
  async down(knex) {
    await knex.schema.dropTableIfExists('ai_vehicle_research');
  }
};
