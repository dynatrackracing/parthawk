'use strict';

// Wipe scout alerts so they rebuild with Auto-table-based model matching.
// Previous alerts used hardcoded model list that missed models like Challenger.

exports.up = async function(knex) {
  try { await knex('scout_alerts').truncate(); } catch(e) { /* ignore */ }
};

exports.down = async function(knex) {};
