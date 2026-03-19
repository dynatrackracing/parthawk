'use strict';

module.exports = {
  async up(knex) {
    const cols = [
      { name: 'stock_number', type: 'string', args: [30] },
      { name: 'engine', type: 'string', args: [50] },
      { name: 'engine_type', type: 'string', args: [20] },
      { name: 'drivetrain', type: 'string', args: [20] },
      { name: 'trim_level', type: 'string', args: [100] },
      { name: 'body_style', type: 'string', args: [50] },
      { name: 'vin_decoded', type: 'boolean', default: false },
    ];

    for (const col of cols) {
      try {
        const has = await knex.schema.hasColumn('yard_vehicle', col.name);
        if (!has) {
          await knex.schema.alterTable('yard_vehicle', table => {
            if (col.type === 'boolean') table.boolean(col.name).defaultTo(col.default);
            else table.string(col.name, ...(col.args || []));
          });
        }
      } catch (e) { /* ignore */ }
    }
  },

  async down(knex) {
    try {
      await knex.schema.alterTable('yard_vehicle', table => {
        table.dropColumn('stock_number');
        table.dropColumn('engine');
        table.dropColumn('engine_type');
        table.dropColumn('drivetrain');
        table.dropColumn('trim_level');
        table.dropColumn('body_style');
        table.dropColumn('vin_decoded');
      });
    } catch (e) { /* ignore */ }
  }
};
