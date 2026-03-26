'use strict';

// Wipe all existing scout alerts so they get regenerated with the
// strict matching rules (no fuzzy years, model required, exact match only).
// Alerts will be rebuilt on next scrape or manual refresh.

exports.up = async function(knex) {
  await knex('scout_alerts').truncate();
};

exports.down = async function(knex) {
  // Can't restore — alerts are regenerated
};
