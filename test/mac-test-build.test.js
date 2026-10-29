'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
test('manual Mac test build stays isolated from production identity, output and release publishing', () => {
  const pkg = require('../package.json'), config = require('../scripts/mac-test-config');
  assert.notEqual(config.appId,pkg.build.appId);
  assert.notEqual(config.productName,pkg.build.productName);
  assert.notEqual(config.extraMetadata.name,pkg.name);
  assert.equal(config.extraMetadata.version,'1.2.0-test.1');
  assert.equal(config.mac.identity,null);
  assert.equal(config.directories.output,'release/mac-test-1.2.0-test.1');
  assert.ok(pkg.scripts['package:mac:test'].includes('--publish never'));
  assert.equal(pkg.scripts['prepackage:mac:test'],'npm run build:frontend');
  assert.deepEqual(config.files,pkg.build.files);
});
