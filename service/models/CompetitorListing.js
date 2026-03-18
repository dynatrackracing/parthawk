'use strict';

const { Model } = require('objection');
const BaseModel = require('./BaseModel');

class CompetitorListing extends BaseModel {
  static get tableName() {
    return 'CompetitorListing';
  }

  static get idColumn() {
    return 'id';
  }

  static get relationMappings() {
    const MarketResearchRun = require('./MarketResearchRun');
    const YourListing = require('./YourListing');

    return {
      researchRun: {
        relation: Model.BelongsToOneRelation,
        modelClass: MarketResearchRun,
        join: {
          from: 'CompetitorListing.researchRunId',
          to: 'MarketResearchRun.id',
        },
      },
      yourListing: {
        relation: Model.BelongsToOneRelation,
        modelClass: YourListing,
        join: {
          from: 'CompetitorListing.yourListingId',
          to: 'YourListing.id',
        },
      },
    };
  }
}

module.exports = CompetitorListing;
