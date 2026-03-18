'use strict';

const BaseModelWithTimestamps = require('./BaseModelWithTimestamps');

class User extends BaseModelWithTimestamps {
  static get tableName() {
    return 'User';
  }

  static getBooleanAttributes() {
    return ['isAdmin', 'isVerified'];
  }
}

module.exports = User;