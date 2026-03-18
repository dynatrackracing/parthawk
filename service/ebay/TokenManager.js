'use strict';

const { log } = require('../lib/logger');
const EbayAuthToken = require('ebay-oauth-nodejs-client');
const moment = require('moment');

class TokenManager {
  constructor () {
    this.log = log.child({ class: 'TokenManager '}, true);
  }

  async getToken() {
    // Ensure expiration is properly parsed as a valid Moment object
    if (process.env.EBAY_TOKEN && moment().isBefore(moment(process.env.EBAY_TOKEN_EXPIRATION, moment.ISO_8601))) {
      return process.env.EBAY_TOKEN;
    }
    
    // Otherwise, get a new token
    const ebayAuthToken = new EbayAuthToken({
      clientId: process.env.TRADING_API_APP_NAME,
      clientSecret: process.env.TRADING_API_CERT_NAME,
      redirectUri: process.env.REDIRECT_URL,
    });
  
    const response = await ebayAuthToken.getApplicationToken('PRODUCTION');
    const { expires_in, access_token } = JSON.parse(response);
  
    // Store expiry as an ISO string
    const expiry = moment().add(expires_in, 'seconds').toISOString();
  
    process.env.EBAY_TOKEN_EXPIRATION = expiry; 
    process.env.EBAY_TOKEN = access_token;
  
    return access_token;
  }
}

module.exports = TokenManager;