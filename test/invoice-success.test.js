'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { PageRenderer } = require('../lib/ui/page-renderer');
const { createConfig } = require('../lib/config');

test('invoice success presentation keeps completed/pending wording and rejects incomplete notifications', async () => {
  const { invoiceSuccessMessage } = await import('../lib/invoice-success.mjs');
  const record = { number: 'VJ000001', status: 'completed', paid: 100, total: 500 };
  const before = structuredClone(record);
  assert.deepEqual(invoiceSuccessMessage(record), { number: 'VJ000001', title: 'Invoice generated', note: 'Stock has been updated and the invoice was saved successfully.', viewLabel: 'View Invoice' });
  const pending = invoiceSuccessMessage({ ...record, status: 'pending' });
  assert.equal(pending.title, 'Pending order saved'); assert.equal(pending.viewLabel, 'View Pending Invoice');
  assert.match(pending.note, /only when you deliver it from Records/);
  for (const value of [null, {}, { number: '', status: 'completed' }, { number: 'X', status: 'voided' }]) assert.equal(invoiceSuccessMessage(value), null);
  assert.deepEqual(record, before);
});

test('success bridge sends only saved identity/status and React mode excludes legacy modal handlers', () => {
  const events = [];
  const context = { window: { dispatchEvent: event => events.push(event) }, CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options.detail; } } };
  const source = fs.readFileSync(path.join(__dirname, '../source/scripts/invoice/success-bridge.js'), 'utf8');
  vm.runInNewContext(source + '\nshowInvoiceSuccess({number:"VJ000001",status:"pending",paid:100});', context);
  assert.equal(events.length, 1); assert.equal(events[0].type, 'vj:invoice-saved');
  assert.deepEqual(JSON.parse(JSON.stringify(events[0].detail)), { number: 'VJ000001', status: 'pending' });
  const renderer = new PageRenderer(createConfig({}));
  const react = renderer.render({ reactDashboard: true }), legacy = renderer.render();
  assert.ok(react.includes('id="react-invoice-success"'));
  assert.ok(!react.includes("invoiceSuccessModal.id = 'invoiceSuccessModal'"));
  assert.ok(!react.includes("getElementById('viewGeneratedInvoice').addEventListener"));
  assert.ok(legacy.includes("getElementById('viewGeneratedInvoice').addEventListener"));
});
