'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function bridge(fetchResponse) {
  const nodes = new Map();
  const values = {
    'inv-no': 'VJ000001', 'inv-date': '2026-10-26', 'cust-name': 'Test Customer', 'cust-mobile': '', 'cust-address': '',
    'biz-name': 'Vishesh Jewellers', 'biz-gstin': '', 'inv-terms': '', 'invoice-discount': '50', 'amount-paid': '1000',
    'gst-rate': '1.5', invoiceType: 'sale', 'exchange-disc': '0', btnCompleteSale: '', btnSavePendingOrder: ''
  };
  for (const [id, value] of Object.entries(values)) nodes.set(id, {
    value, disabled: id === 'inv-no', handlers: {},
    addEventListener(type, handler) { this.handlers[type] = handler; }, dispatchEvent() {}
  });
  nodes.set('saleStatus', { textContent: '' });
  nodes.set('mini-grand', { textContent: '₹9,147.00' });
  nodes.set('invoicePaper', { outerHTML: '<div id="invoicePaper">Test</div>' });
  const exchanges = [{ dataset: { required: 'false' }, querySelector: selector => ({
    value: selector === '.exchange-row-metal' ? 'gold' : selector === '.exchange-row-weight' ? '0.1' : '10000'
  }) }];
  const requests = [], errors = [], events = [], successes = [], resets = [];
  const initialStock = [{ id: 'ring', qty: 10, gross: 100, net: 90 }];
  const result = { record: { number: 'VJ000001', status: 'completed', total: '₹9,147.00' }, stock: [{ id: 'ring', qty: 6, gross: 90, net: 81 }], nextCounter: 2 };
  const context = {
    document: { getElementById: id => nodes.get(id), querySelectorAll: selector => selector === '#exchangeRows .exchange-row' ? exchanges : [...nodes.values()].filter(node => 'disabled' in node) },
    window: { storage: { set: () => { throw new Error('Unexpected legacy write'); } }, vjInvoiceExchangeEntries: () => [], dispatchEvent: event => events.push(event.type) },
    rows: [{ id: 'line1', stockId: 'ring', name: 'Gold Ring', purity: '22K', gross: '10', net: '9', pcs: '4', rate: '1000', making: '10' }],
    stockList: initialStock, invoiceCounter: 1, saleCompleted: false,
    amount: value => Number(String(value).replace(/[^0-9.-]/g, '')) || 0,
    getExchangeEntries: () => [{ metal: 'gold', weight: 0.1, rate: 10000, value: 1000 }],
    fetch: async (url, options) => {
      requests.push({ url, options, payload: JSON.parse(options.body) });
      return fetchResponse ? fetchResponse(requests.length, result) : { ok: true, json: async () => result };
    },
    crypto: { randomUUID: () => 'test-request-1234567890' },
    AbortSignal: { timeout: () => undefined }, Event: class { constructor(type) { this.type = type; } },
    resetInvoiceForm: async bump => resets.push(bump), updateInvoiceType() {}, setSaleStatus() {},
    showInvoiceSuccess: record => successes.push(record), showAppMessage: (message, type) => errors.push({ message, type })
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../source/scripts/invoice/save-api.js'), 'utf8'), context);
  return { context, nodes, requests, errors, events, successes, resets, initialStock,
    save: () => nodes.get('btnCompleteSale').handlers.click(), savePending: () => nodes.get('btnSavePendingOrder').handlers.click() };
}

test('preview save blocks double clicks, uses one endpoint, and resets using the server counter', async () => {
  const f = bridge();
  await Promise.all([f.save(), f.save()]);
  assert.equal(f.requests.length, 1);
  assert.equal(f.requests[0].url, '/api/invoices');
  assert.equal(f.requests[0].payload.items[0].pcs, '4');
  assert.equal(f.requests[0].payload.items[0].net, '9');
  assert.equal(f.requests[0].payload.expectedTotal, 9147);
  assert.deepEqual(f.resets, [false]);
  assert.equal(f.context.invoiceCounter, 2);
  assert.equal(f.context.stockList[0].qty, 6);
  assert.ok(f.events.includes('vj:invoice-reset'));
  assert.equal(f.successes.length, 1);
  assert.equal(f.errors.length, 0);
  assert.equal(f.nodes.get('inv-no').disabled, true);
  assert.equal(f.nodes.get('btnCompleteSale').disabled, false);
});

test('failed preview save keeps the draft and inventory and reuses its request ID on retry', async () => {
  const f = bridge((attempt, result) => {
    if (attempt === 1) throw new Error('Network unavailable');
    return { ok: true, json: async () => result };
  });
  await f.save();
  assert.equal(f.resets.length, 0);
  assert.equal(f.context.stockList, f.initialStock);
  assert.equal(f.nodes.get('amount-paid').value, '1000');
  assert.equal(f.nodes.get('btnCompleteSale').disabled, false);
  assert.equal(f.errors[0].message, 'Network unavailable');
  await f.save();
  assert.equal(f.requests.length, 2);
  assert.equal(f.requests[0].payload.requestId, f.requests[1].payload.requestId);
  assert.equal(f.successes.length, 1);
});

test('backend rejection shows an app error without resetting or changing local inventory', async () => {
  const f = bridge(() => ({ ok: false, json: async () => ({ error: 'Not enough remaining quantity or weight.' }) }));
  await f.save();
  assert.equal(f.errors[0].type, 'error');
  assert.equal(f.resets.length, 0);
  assert.equal(f.successes.length, 0);
  assert.equal(f.context.stockList, f.initialStock);
});

test('pending-order collection preserves the legacy rule for ignoring untouched empty rows', async () => {
  const f = bridge();
  f.context.rows.push({ id: 'empty', name: '', stockId: '', gross: '', net: '', rate: '', pcs: 1, making: '10' });
  await f.savePending();
  assert.equal(f.requests[0].payload.status, 'pending');
  assert.equal(f.requests[0].payload.items.length, 1);
});

test('save flushes the React preview before capturing its invoice markup', async () => {
  const f = bridge();
  let flushed = false;
  f.context.window.vjInvoicePreview = { flush: () => { flushed = true; f.nodes.get('invoicePaper').outerHTML = '<div id="invoicePaper">Latest preview</div>'; } };
  await f.save();
  assert.equal(flushed, true);
  assert.ok(f.requests[0].payload.invoiceMarkup.includes('Latest preview'));
});
