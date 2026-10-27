'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { applyReactInvoiceDetails } = require('../lib/ui/react-invoice-details');

function fixture() {
  const values = {
    'biz-name': 'Saved Shop', 'biz-gstin': 'Saved GSTIN', 'biz-phone': '1234567890', 'biz-email': 'test@example.com', 'biz-address': 'Saved address',
    'cust-name': 'Customer', 'cust-mobile': '9999999999', 'cust-address': 'Customer address', 'inv-no': 'VJ000021', 'inv-date': '2026-10-26', invoiceType: 'sale'
  };
  const events = [];
  const nodes = Object.fromEntries(Object.entries(values).map(([id, value]) => [id, { value, dispatchEvent: event => events.push({ id, type: event.type, bubbles: event.bubbles }) }]));
  const context = { window: {}, document: { getElementById: id => nodes[id] }, Event: class { constructor(type, options) { this.type = type; this.bubbles = options.bubbles; } } };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../source/scripts/invoice/details-bridge.js'), 'utf8'), context);
  return { values, nodes, events, bridge: context.window.vjInvoiceDetails };
}

test('invoice details read existing values without mutating fields or dispatching persistence events', () => {
  const f = fixture();
  assert.deepEqual(JSON.parse(JSON.stringify(f.bridge.read())), f.values);
  assert.equal(f.events.length, 0);
  f.nodes['inv-no'].value = 'VJ000022';
  f.nodes['cust-name'].value = '';
  assert.equal(f.bridge.read()['inv-no'], 'VJ000022');
  assert.equal(f.bridge.read()['cust-name'], '');
  assert.equal(f.bridge.read()['biz-name'], 'Saved Shop');
});

test('React customer/date edits reach the existing preview and mode changes reach the order handler', () => {
  const f = fixture();
  f.bridge.update('cust-name', 'Updated Customer');
  f.bridge.update('inv-date', '2026-10-20');
  f.bridge.update('invoiceType', 'pending');
  assert.equal(f.nodes['cust-name'].value, 'Updated Customer');
  assert.equal(f.nodes['inv-date'].value, '2026-10-20');
  assert.equal(f.nodes.invoiceType.value, 'pending');
  assert.deepEqual(f.events, [
    { id: 'cust-name', type: 'input', bubbles: true },
    { id: 'inv-date', type: 'input', bubbles: true },
    { id: 'invoiceType', type: 'change', bubbles: true }
  ]);
});

test('business edits update the preview immediately and persist only when committed', () => {
  const f = fixture();
  f.bridge.update('biz-name', 'Updated Shop');
  assert.deepEqual(f.events, [{ id: 'biz-name', type: 'input', bubbles: true }]);
  f.bridge.commitBusiness('biz-name');
  assert.deepEqual(f.events[1], { id: 'biz-name', type: 'change', bubbles: true });
  f.bridge.commitBusiness('cust-name');
  assert.equal(f.events.length, 2);
  assert.throws(() => f.bridge.update('inv-no', 'VJ000001'), /not editable/);
  assert.equal(f.nodes['inv-no'].value, 'VJ000021');
});

test('invoice details adapter fails closed when legacy initialization boundaries change', () => {
  assert.throws(() => applyReactInvoiceDetails('<html></html>'), /migration boundary changed/);
});
