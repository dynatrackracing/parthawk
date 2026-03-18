const { log } = require('../lib/logger');
const axios = require('axios').default;
const TokenManager = require('./TokenManager');

class BrowseAPI {
    constructor() {
        this.log = log.child({ class: 'BrowseAPI' }, true);
        this.baseUrl = 'https://api.ebay.com/buy/browse/v1/item_summary/search';
        this.tokenManager = new TokenManager();
    }

    async makeRequest({ categoryId, seller }) {
        const token = await this.tokenManager.getToken();

        try {
            const response = await axios({
                method: 'GET',
                url: `${this.baseUrl}?category_ids=${categoryId}&filter=sellers:{${seller}}`,
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json',
                }
            });

            return response.data;
        } catch (error) {
            this.log.error(`Error fetching data from eBay API: ${error.message}`);
            if (error.response) {
                this.log.error(`Status: ${error.response.status}, Data: ${JSON.stringify(error.response.data)}`);
            }
            throw error;
        }
    }

    async makeRequestUrl({ url }) {
        const token = await this.tokenManager.getToken();

        try {
            const response = await axios({
                method: 'GET',
                url: url,
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json',
                }
            });

            return response.data;
        } catch (error) {
            this.log.error(`Error fetching data from eBay API: ${error.message}`);
            if (error.response) {
                this.log.error(`Status: ${error.response.status}, Data: ${JSON.stringify(error.response.data)}`);
            }
            throw error;
        }
    }
}

module.exports = BrowseAPI;
