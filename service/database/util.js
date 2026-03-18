'use strict';

function isoTimestamp(knex) {
  return knex.raw("(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))");
}

module.exports = {
  isoTimestamp,
};
