'use strict';

const { log } = require("../lib/logger");
const crypto = require('crypto');
const { send } = require("process");


class Notifications {
  constructor() {
    this.log = log.child({ class: 'Notifications' }, true);
  }


  createChallengeResponse({ challenge_code }) {
    this.log.info({ challenge_code }, 'Verification endpoint for ebay callback')
    try {
      const hash = crypto.createHash('sha256');

      hash.update(challenge_code);
      hash.update(process.env.VERIFICATION_TOKEN);
      const endpointUrl = 'https://pacific-refuge-49788.herokuapp.com/private/ebay-challenger-api';
      hash.update(endpointUrl);

      const responseHash = hash.digest('hex');
      return Buffer.from(responseHash).toString();
    } catch (err) {
      this.log.error({ err }, 'Exception during challenge code processing!')
    }
  }

  processMessage({ body }) {
    this.log.trace({ body }, 'Received notification from EBAY Account / Closure API');

    const response = 'Ack';

    return response;
  }
}

module.exports = Notifications;