'use strict';

const BaseModel = require('./BaseModel');
const moment = require('moment');

class BaseModelWithTimestamps extends BaseModel {
  async $beforeInsert(opt, queryContext) {
    await super.$beforeInsert(opt, queryContext);

    // inject the createdAt/updatedAt timestamps
    // if created from an old db exists, set the createdAt equal to the created value
    const now = moment.utc().toISOString();
    this.createdAt = now;
    this.updatedAt = now;
  }

  async $beforeUpdate(opt, queryContext) {
    await super.$beforeUpdate(opt, queryContext);

    // inject the updatedAt timestamp
    this.updatedAt = moment.utc().toISOString();
  }
}

module.exports = BaseModelWithTimestamps;