'use strict';

const BaseModelWithTimestamps = require('./BaseModelWithTimestamps');

class Cron extends BaseModelWithTimestamps {
  static get tableName() {
    return 'Cron';
  }
}

module.exports = Cron;