'use strict';
const { log } = require('../lib/logger');
const Competitor = require('../models/Competitor');

class CompetitorManager {
  constructor () {
    this.log = log.child({ class: 'CompetitorManager'}, true)
  }

  async getAllCompetitors() {
    this.log.info('Getting all ENABLED sellers');
    const ret = await Competitor.query().where('enabled', true);
    return ret;
  }
}

module.exports = CompetitorManager;