'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PageRenderer } = require('../lib/ui/page-renderer');
const { createConfig } = require('../lib/config');

test('both frontend modes use local PDF libraries, copied unchanged with upstream licenses', () => {
  const root = path.join(__dirname, '..'), renderer = new PageRenderer(createConfig({}));
  for (const html of [renderer.render(), renderer.render({ reactDashboard: true })]) {
    assert.ok(html.includes('src="/vendor/html2canvas.min.js"'));
    assert.ok(html.includes('src="/vendor/jspdf.umd.min.js"'));
    assert.ok(!html.includes('src="https://cdnjs.cloudflare.com'));
  }
  for (const [name, file] of [['html2canvas', 'html2canvas.min.js'], ['jspdf', 'jspdf.umd.min.js']]) {
    assert.deepEqual(fs.readFileSync(path.join(root, 'public/vendor', file)), fs.readFileSync(require.resolve(name + '/dist/' + file)));
    assert.ok(fs.readFileSync(path.join(root, 'public/vendor', name + '.LICENSE'), 'utf8').includes('MIT'));
  }
  const pkg = require('../package.json');
  assert.equal(pkg.dependencies.jspdf, '4.2.1'); assert.equal(pkg.dependencies.html2canvas, '1.4.1');
  assert.ok(pkg.build.files.includes('public/**/*'));
  assert.ok(pkg.scripts['build:frontend'].includes('build-offline-assets.js'));
});
