'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { PageRenderer } = require('../lib/ui/page-renderer');
const { createConfig } = require('../lib/config');

test('retired editor adapter is removed and both frontend modes retain their current editors', () => {
  const root = path.join(__dirname, '..');
  for (const file of ['lib/ui/react-invoice-editor.js', 'source/scripts/invoice/editor-save-api.js']) assert.equal(fs.existsSync(path.join(root, file)), false);
  const renderer = new PageRenderer(createConfig({}));
  const react = renderer.render({ reactDashboard: true }), legacy = renderer.render();
  assert.ok(react.includes('id="react-invoice-editor"'));
  assert.ok(react.includes('window.vjInvoiceEditMath ='));
  assert.ok(!react.includes("getElementById('saveInvoiceEdit').addEventListener"));
  assert.ok(legacy.includes("getElementById('saveInvoiceEdit').addEventListener"));
});

test('both frontends exclude the retired return feature initialization', () => {
  const renderer = new PageRenderer(createConfig({}));
  const react = renderer.render({ reactDashboard: true }), legacy = renderer.render();
  assert.ok(!react.includes('const openReturnModal ='));
  assert.ok(!react.includes("getElementById('saveReturn').addEventListener"));
  assert.ok(!legacy.includes('const openReturnModal ='));
  assert.equal(fs.existsSync(path.join(__dirname, '../source/scripts/records/legacy-returns.js')), false);
  for (const html of [react, legacy]) for (const script of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)) new vm.Script(script[1]);
});
