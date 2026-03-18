const BaseModelWithTimestamps = require('./BaseModelWithTimestamps');


class Competitor extends BaseModelWithTimestamps {
  static get tableName() {
    return 'Competitor';
  }

  static get booleanAttributes() {
    return ['enabled', 'isRepair']
  }
}

module.exports = Competitor;