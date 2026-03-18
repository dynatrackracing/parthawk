'use strict';

const bunyan = require('bunyan');
const path = require('path');
const fs = require('fs-extra');

fs.ensureDirSync(path.resolve(__dirname, 'logs'));

const log = bunyan.createLogger({
  name: 'dynatrack',
  level: 'debug',
  serializers: bunyan.stdSerializers,
  path:  path.resolve(__dirname, 'logs', 'dynatrack.log'),
});


module.exports = {
  log,
};