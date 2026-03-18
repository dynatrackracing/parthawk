'use strict';

module.exports = {
    async up(knex) {
        await knex.schema.alterTable('Auto', (table) =>{
            table.unique('id');
        });

        await knex.schema.alterTable('Item', (table) =>{
            table.unique('id');
        });

        await knex.schema.alterTable('AutoItemCompatibility', (table) =>{
            table.foreign('autoId').onDelete('CASCADE').references('id').inTable('Auto');
            table.foreign('itemId').onDelete('CASCADE').references('id').inTable('Item');
        });
    },
    async down(knex){

    }
}
