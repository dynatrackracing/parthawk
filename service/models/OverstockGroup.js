'use strict';

const BaseModelWithTimestamps = require('./BaseModelWithTimestamps');

class OverstockGroup extends BaseModelWithTimestamps {
  static get tableName() {
    return 'overstock_group';
  }

  static get idColumn() {
    return 'id';
  }

  static get relationMappings() {
    const OverstockGroupItem = require('./OverstockGroupItem');
    return {
      items: {
        relation: BaseModelWithTimestamps.HasManyRelation,
        modelClass: OverstockGroupItem,
        join: {
          from: 'overstock_group.id',
          to: 'overstock_group_item.group_id',
        },
      },
    };
  }
}

module.exports = OverstockGroup;
