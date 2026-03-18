'use strict';

const Joi = require('@hapi/joi');
const { log } = require('../lib/logger');
const TokenManager = require('../ebay/TokenManager');
const axios = require('axios');

// hardcoded category thats enabled for auto
const CATEGORY_ID = 33563;

class TaxonomyAPI {
  constructor() {
    this.log = log.child({ class: 'TaxonomyAPI' }, true);
    this.tokenManager = new TokenManager();
  }

  createHeaders({ accessToken }) {
    const headers = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${accessToken}`,
    }

    return headers;
  }

  async makeRequest(options) {
    const accessToken = await this.tokenManager.getToken();
    const headers = this.createHeaders({ accessToken });

    const url = `https://api.ebay.com/commerce/taxonomy/v1/category_tree/100/get_compatibility_property_values`

    let response;
    try {
      response = await axios({
        method: 'GET',
        url,
        headers,
        params: {
          compatibility_property: options.select,
          category_id: CATEGORY_ID,
          filter: options.filter,
        }
      });
    } catch (err) {
      this.log.error({ err }, 'There was an error with calling the Taxonomy API');
    }

    return response.data;
  }
}

module.exports = TaxonomyAPI;