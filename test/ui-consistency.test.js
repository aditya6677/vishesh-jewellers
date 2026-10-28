'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');

test('React inputs declare their type and use the shared custom dropdown', () => {
  const files = fs.readdirSync(path.join(root, 'frontend'), { recursive: true }).filter(file => file.endsWith('.tsx'));
  for (const file of files) {
    const source = fs.readFileSync(path.join(root, 'frontend', file), 'utf8');
    for (const input of source.matchAll(/<input\b[\s\S]*?\/>/g)) assert.match(input[0], /\btype\s*=/, file + ': explicit input type required for consistent styling');
    assert.doesNotMatch(source, /<select\b/, file + ': use the shared Select component');
  }
});

test('shared UI styles cover default text/search fields, focus states and tablet navigation', () => {
  const html = fs.readFileSync(path.join(root, 'source/index.html'), 'utf8');
  const css = fs.readFileSync(path.join(root, 'source/styles/application.css'), 'utf8');
  assert.match(html, /input:not\(\[type\]\), input\[type=text\], input\[type=search\]/);
  assert.match(css, /#invoice-details-inv-no:disabled/);
  assert.match(css, /\.btn:focus-visible/);
  assert.match(css, /@media \(max-width: 1100px\)/);
  assert.match(css, /header\.topnav nav\.tabs[^}]*flex-wrap: wrap/);
});
