'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PageRenderer } = require('../lib/ui/page-renderer');
const { createConfig } = require('../lib/config');

test('React saved viewer replaces legacy modal/output bindings while original mode remains intact', () => {
  const renderer = new PageRenderer(createConfig({}));
  const react = renderer.render({ reactDashboard: true });
  const legacy = renderer.render();
  assert.ok(react.includes('id="react-saved-invoice-viewer"'));
  assert.ok(!react.includes('const reprintInvoice ='));
  assert.ok(!react.includes("regeneratedModal = document.createElement"));
  assert.ok(!react.includes("getElementById('printRegeneratedInvoice').addEventListener"));
  assert.ok(!react.includes("getElementById('downloadRegeneratedInvoice').addEventListener"));
  assert.ok(legacy.includes("regeneratedModal = document.createElement"));
  assert.ok(legacy.includes("getElementById('printRegeneratedInvoice').addEventListener"));
  const records = fs.readFileSync(path.join(__dirname, '../frontend/records/Records.tsx'), 'utf8');
  assert.ok(records.includes('window.vjSavedInvoiceOpen(record.number, version)'));
});
