'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const fonts = require('../lib/ui/offline-fonts');
const { PageRenderer } = require('../lib/ui/page-renderer');
const { createConfig } = require('../lib/config');

test('offline fonts cover the existing families/weights and are copied byte-for-byte with licenses', () => {
  const root = path.join(__dirname, '..');
  assert.equal(fonts.length, 13);
  assert.equal(new Set(fonts.map(font => font.file)).size, 13);
  assert.deepEqual([...new Set(fonts.map(font => font.family))], ['Cormorant Garamond', 'Jost', 'IBM Plex Mono']);
  const css = fs.readFileSync(path.join(root, 'public/vendor/fonts.css'), 'utf8');
  assert.ok(!css.includes('https://'));
  for (const font of fonts) {
    assert.ok(css.includes("url('/vendor/fonts/" + font.file + "')"));
    assert.deepEqual(fs.readFileSync(path.join(root, 'public/vendor/fonts', font.file)), fs.readFileSync(require.resolve('@fontsource/' + font.packageName + '/files/' + font.file)));
    assert.ok(fs.existsSync(path.join(root, 'public/vendor/fonts', font.packageName + '.LICENSE')));
  }
  assert.ok(fonts.some(font => font.style === 'italic' && font.weight === 500));
});

test('both frontend modes and legacy print output use local font CSS rather than Google Fonts', () => {
  const renderer = new PageRenderer(createConfig({}));
  for (const html of [renderer.render(), renderer.render({ reactDashboard: true })]) {
    assert.ok(html.includes('href="/vendor/fonts.css"'));
    assert.ok(!html.includes('fonts.googleapis.com'));
  }
});
