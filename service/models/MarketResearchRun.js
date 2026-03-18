'use strict';

const { Model } = require('objection');
const BaseModel = require('./BaseModel');

class MarketResearchRun extends BaseModel {
  static get tableName() {
    return 'MarketResearchRun';
  }

  static get idColumn() {
    return 'id';
  }

  static get relationMappings() {
    const YourListing = require('./YourListing');
    const CompetitorListing = require('./CompetitorListing');
    const SoldItem = require('./SoldItem');

    return {
      yourListing: {
        relation: Model.BelongsToOneRelation,
        modelClass: YourListing,
        join: {
          from: 'MarketResearchRun.yourListingId',
          to: 'YourListing.id',
        },
      },
      competitorListings: {
        relation: Model.HasManyRelation,
        modelClass: CompetitorListing,
        join: {
          from: 'MarketResearchRun.id',
          to: 'CompetitorListing.researchRunId',
        },
      },
      soldItems: {
        relation: Model.HasManyRelation,
        modelClass: SoldItem,
        join: {
          from: 'MarketResearchRun.id',
          to: 'SoldItem.researchRunId',
        },
      },
    };
  }
}

module.exports = MarketResearchRun;
