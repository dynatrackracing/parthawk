'use strict';

const BaseModelWithTimestamps = require('./BaseModelWithTimestamps');

class OverstockGroupItem extends BaseModelWithTimestamps {
  static get tableName() {
    return 'overstock_group_item';
  }

  static get idColumn() {
    return 'id';
  }

  static get relationMappings() {
    const OverstockGroup = require('./OverstockGroup');
    return {
      group: {
        relation: BaseModelWithTimestamps.BelongsToOneRelation,
        modelClass: OverstockGroup,
        join: {
          from: 'overstock_group_item.group_id',
          to: 'overstock_group.id',
        },
      },
    };
  }
}

module.exports = OverstockGroupItem;
