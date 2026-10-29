'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { PageRenderer } = require('../lib/ui/page-renderer');
const { createConfig } = require('../lib/config');

test('React and legacy pages render identically with Windows source line endings', () => {
  const config = createConfig({});
  const normal = new PageRenderer(config);
  const windows = new PageRenderer(config, {
    readFile: file => fs.readFileSync(file, 'utf8').replace(/\r?\n/g, '\r\n')
  });
  for (const reactDashboard of [false, true]) {
    assert.equal(windows.render({ reactDashboard }), normal.render({ reactDashboard }));
  }
});

test('universal packaging explicitly permits both architecture-specific database prebuilds', () => {
  const { minimatch } = require('minimatch');
  const pattern = require('../package.json').build.mac.x64ArchFiles;
  for (const arch of ['arm64', 'x64']) {
    assert.ok(minimatch(`Contents/Resources/app.asar.unpacked/node_modules/better-sqlite3-multiple-ciphers/prebuilds/darwin-${arch}.node`, pattern));
  }
  assert.equal(minimatch('Contents/MacOS/Vishesh Jewellers', pattern), false);
});
