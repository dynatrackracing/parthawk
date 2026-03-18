'use strict';

const BaseModelWithTimestamps = require('./BaseModelWithTimestamps');

class YourListing extends BaseModelWithTimestamps {
  static get tableName() {
    return 'YourListing';
  }

  static get idColumn() {
    return 'id';
  }

  // Computed property for days listed (can't use generated column with NOW())
  get daysListed() {
    if (!this.startTime) return null;
    const startDate = new Date(this.startTime);
    const now = new Date();
    const diffTime = Math.abs(now - startDate);
    const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
    return diffDays;
  }
}

module.exports = YourListing;
