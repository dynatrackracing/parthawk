'use strict';

const { Knex } = require('knex');
const { transaction } = require('objection');
const { log } = require('../lib/logger');
const User = require('../models/User');
const CacheManager = require('../middleware/CacheManager');

class UserManager {
  constructor() {
    this.log = log.child({ class: 'UserManager' }, true);
    this.cacheManager = new CacheManager();
  }

  getUserKey(key) {
    return `getUserId_${key}`;
  }
  /**
   *
   * @param {user} Object passed from Google Auth that contains information about the user
   * @param {Knex.trx} The Knex transaction object
   * @returns an object with a boolean field success. The value corresponds to whether the user is verified or not.
   */
  async getOrCreateUser({ user }, { trx = User.knex() } = {}) {
    this.log.info({ user }, 'Receiving initial login for user');
    const { firstName, lastName, email, imageUrl } = user;
    if (firstName && lastName && email) {
      return transaction(trx, async (tx) => {
        let [dbUser] = await User.query(tx).where('email', email);
        if (dbUser) {
          // check whether the user is verified
          if (dbUser.isVerified) {
            this.log.debug('The user has been found and is verified');
            return dbUser;
          } else {
            // the user is in the database but not verified yet
            this.log.debug('The user has been found but is not verified');
            return null;
          }
        } else {
          // change to write trx to commit the new user
          this.log.debug(
            'User not found, creating new user and setting isVerified to false'
          );
          dbUser = await User.query(tx).insert({
            firstName,
            lastName,
            email,
            imageUrl,
            isVerified: false,
            isAdmin: false,
          });
          this.log.info({ dbUser }, 'Added new user to database');
          return dbUser;
        }
      });
    } else {
      this.log.info(
        { user },
        'User did not contain correct information, was not able to confirm or create'
      );
      return null;
    }
  }

  async getUser({ user }, { trx = User.knex() } = {}) {
    const { email } = user;

    if (email) {
      return transaction(trx, async (tx) => {
        const [dbUser] = await User.query(tx).where("email", email);
        return dbUser;
      });
    } else {
      this.log.info(
        { user },
        'User did not contain correct information, was not able to confirm'
      );
      return null;
    }
  }

  async getAllUsers({ trx = User.knex() } = {}) {
    this.log.debug('Getting all users');
    return transaction(trx, async (tx) => {
      const response = await User.query(tx);

      return response;
    });
  }

  async modifyUser({ user, body }, { trx = User.knex() } = {}) {
    //TODO add Joi schema here
    this.log.debug({ user, body }, 'Updating user');

    const response = await User.query().update(body).where('email', user);

    this.cacheManager.del(this.getUserKey(user));

    return response;
  }

  async deleteUser({ user }, { trx = User.knex() }) {
    this.log.debug({ user }, 'Deleting user');

    const response = await User.query().where('email', user).del();

    this.cacheManager.del(this.getUserKey(user));

    return response;
  }
}

module.exports = UserManager;
