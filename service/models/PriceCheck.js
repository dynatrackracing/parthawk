'use strict';

const BaseModelWithTimestamps = require('./BaseModelWithTimestamps');

class PriceCheck extends BaseModelWithTimestamps {
  static get tableName() {
    return 'PriceCheck';
  }

  static get idColumn() {
    return 'id';
  }

  static get relationMappings() {
    const YourListing = require('./YourListing');

    return {
      listing: {
        relation: BaseModelWithTimestamps.BelongsToOneRelation,
        modelClass: YourListing,
        join: {
          from: 'PriceCheck.listingId',
          to: 'YourListing.id',
        },
      },
    };
  }

  /**
   * Get the most recent price check for a listing (within 24 hours)
   */
  static async getRecent(listingId, maxAgeHours = 24) {
    const cutoff = new Date(Date.now() - maxAgeHours * 60 * 60 * 1000);

    return this.query()
      .where('listingId', listingId)
      .where('checkedAt', '>', cutoff)
      .orderBy('checkedAt', 'desc')
      .first();
  }

  /**
   * Save a new price check result
   */
  static async saveCheck(listingId, title, yourPrice, result) {
    return this.query().insert({
      listingId,
      title,
      yourPrice,
      marketMedian: result.metrics?.median,
      marketMin: result.metrics?.min,
      marketMax: result.metrics?.max,
      marketAvg: result.metrics?.avg,
      compCount: result.metrics?.count,
      salesPerWeek: result.metrics?.salesPerWeek,
      verdict: result.metrics?.verdict,
      priceDiffPercent: result.metrics?.priceDiffPercent,
      partType: result.parts?.partType,
      make: result.parts?.make,
      model: result.parts?.model,
      years: result.parts?.years,
      searchQuery: result.searchQuery,
      topComps: JSON.stringify(result.topComps || []),
      checkedAt: new Date(),
    });
  }
}

module.exports = PriceCheck;
