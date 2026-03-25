'use strict';

module.exports = {
  async up(knex) {
    await knex('restock_want_list')
      .where('title', 'Saturn L100 Body Control Module')
      .update({ title: '2001-2002 Saturn L100 Body Control Module' });

    await knex('restock_want_list')
      .where('title', 'Infiniti Q60 Q40 Body Control Module')
      .update({ title: '2011-2015 Infiniti Q60 Q40 Body Control Module' });
  },

  async down(knex) {
    await knex('restock_want_list')
      .where('title', '2001-2002 Saturn L100 Body Control Module')
      .update({ title: 'Saturn L100 Body Control Module' });

    await knex('restock_want_list')
      .where('title', '2011-2015 Infiniti Q60 Q40 Body Control Module')
      .update({ title: 'Infiniti Q60 Q40 Body Control Module' });
  }
};
