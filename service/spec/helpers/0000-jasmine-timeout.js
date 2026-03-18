'use strict';

const moment = require('moment');

// set global timeout interval to 30sec
global.jasmine.DEFAULT_TIMEOUT_INTERVAL = moment.duration(30, 'seconds').asMilliseconds();
