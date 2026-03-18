'use strict';

const Joi = require('@hapi/joi');

// validate that fn be an actual javascript function
const fnSchema = Joi.func().required();

/**
 * Takes a function param that is a route handler, handles any errors by calling next
 * The purpose of asyncHandler is to avoid having the try/catch/next code in every route method
 * and trying to call next(err) for any possible errors.
 * This allows fn to throw errors, or return rejected promises, or throw errors in async functions
 * that will all get captured and passed to next(err) for restify to handle
 */
function asyncHandler(fn) {
  Joi.assert(fn, fnSchema);

  // return an async function that takes req/res/next and handles errors
  return async (req, res, next) => {
    try {
      // call fn passing the restify route args
      await fn(req, res, next);
    } catch (err) {
      // any errors thrown by fn will be handled here and sent to restify via the next() function
      // http://restify.com/docs/server-api/#errors
      next(err);
    }
  };
}

module.exports = {
  asyncHandler,
};
