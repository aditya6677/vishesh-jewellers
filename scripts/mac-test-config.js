'use strict';
const path = require('node:path');
const base = require('../package.json').build;
module.exports = {
  ...base,
  productName: 'Vishesh Jewellers Test',
  appId: 'com.visheshjewellers.billing.test',
  extraMetadata: { name: 'vishesh-jewellers-test', productName: 'Vishesh Jewellers Test', version: '1.2.0-test.1' },
  directories: { output: 'release/mac-test-1.2.0-test.1' },
  artifactName: 'Vishesh-Jewellers-Test-1.2.0-test.1-mac-${arch}.${ext}',
  electronDist: path.resolve(__dirname, '../node_modules/electron/dist'),
  mac: { ...base.mac, identity: null }
};
