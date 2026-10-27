'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { voidInvoice } = require('../lib/services/invoice-voiding');
const { deleteInvoice } = require('../lib/delete-invoice');
const { calculateDashboard } = require('../lib/dashboard-summary');
const { PageRenderer } = require('../lib/ui/page-renderer');
const { createConfig } = require('../lib/config');

const revision = record => createHash('sha256').update(JSON.stringify(record)).digest('hex');
const now = () => new Date('2026-10-26T10:00:00Z');
function fixture(overrides = {}) {
  const record = { number: 'VJ000001', customer: 'Test', status: 'completed', weightMode: 'line-total', total: 1000, paid: 500, due: 500,
    soldItems: [{ stockId: 'ring', lineId: 'one', name: 'Gold Ring', purity: '22K', gross: 10, net: 9, pcs: 4, rate: 100, making: 0 }],
    payments: [{ method: 'amount', amount: 300 }, { method: 'gold', weight: 1, rate: 200, amount: 200 }], invoiceMarkup: '<div id="invoicePaper">Original</div>', ...overrides };
  let data = { 'invoice-records': [{ number: 'OTHER', status: 'voided' }, record], 'stock-list': [{ id: 'ring', item: 'Gold Ring', qty: 6, gross: 90, net: 81 }],
    'old-gold-records': [{ sourceId: 'exchange1', invoice: record.number, metal: 'gold', source: 'Invoice exchange', weight: 2, rate: 100, value: 200 }, { sourceId: 'settlement1', invoice: record.number, metal: 'silver', source: 'Silver settlement', weight: 5, rate: 10, value: 50 }, { sourceId: 'purchase1', metal: 'gold', source: 'Old metal purchase', weight: 7, rate: 100, value: 700 }],
    'invoice-counter': 8, unrelated: { retained: true } };
  let writes = 0;
  return { record, store: { read: () => data, write: next => { data = next; writes++; } }, snapshot: () => structuredClone(data), writes: () => writes };
}
const input = record => ({ version: revision(record), reason: ' Customer cancelled ' });

test('void restores line-total stock once, preserves audit history and reverses linked metal atomically', () => {
  const f = fixture(); const before = f.snapshot();
  const result = voidInvoice(f.store, f.record.number, input(f.record), now);
  assert.equal(f.writes(), 1); assert.equal(result.record.status, 'voided'); assert.equal(result.record.due, 0);
  assert.equal(result.record.voidReason, 'Customer cancelled'); assert.equal(result.record.voidedAt, now().toISOString());
  assert.equal(result.version, revision(result.record));
  for (const field of ['total', 'paid', 'payments', 'soldItems', 'invoiceMarkup']) assert.deepEqual(result.record[field], before['invoice-records'][1][field]);
  const saved = f.snapshot();
  assert.deepEqual(saved['stock-list'][0], { id: 'ring', item: 'Gold Ring', qty: 10, gross: 100, net: 90 });
  assert.deepEqual(saved['invoice-records'].map(record => record.number), ['OTHER', 'VJ000001']);
  assert.equal(saved['invoice-counter'], 8); assert.deepEqual(saved.unrelated, { retained: true });
  const reversals = saved['old-gold-records'].filter(entry => entry.source === 'Invoice void reversal');
  assert.equal(reversals.length, 2);
  assert.deepEqual(reversals.map(entry => [entry.invoice, entry.metal, entry.weight, entry.value]), [['VJ000001', 'gold', -2, -200], ['VJ000001', 'silver', -5, -50]]);
  assert.equal(new Set(saved['old-gold-records'].map(entry => entry.sourceId)).size, 5);
  const dashboard = calculateDashboard(saved['invoice-records'], [], [], saved['old-gold-records']);
  assert.equal(dashboard.invoices, 0); assert.equal(dashboard.sales, 0); assert.equal(dashboard.collected, 0); assert.equal(dashboard.due, 0);
  assert.equal(dashboard.gold.balance, 7); assert.equal(dashboard.silver.balance, 0);
  assert.throws(() => voidInvoice(f.store, f.record.number, input(f.record)), error => error.statusCode === 409);
  assert.throws(() => voidInvoice(f.store, f.record.number, input(result.record)), error => error.statusCode === 409);
  assert.deepEqual(f.snapshot(), saved); assert.equal(f.writes(), 1);
  const deleted = deleteInvoice(saved, f.record.number);
  assert.deepEqual(deleted['stock-list'], saved['stock-list']);
  assert.deepEqual(deleted['old-gold-records'], before['old-gold-records'].filter(entry => !entry.invoice));
});

test('pending cancellation never restores stock, including orders without soldItems', () => {
  const f = fixture({ status: 'pending', soldItems: undefined });
  const stock = f.snapshot()['stock-list'];
  const result = voidInvoice(f.store, f.record.number, input(f.record), now);
  assert.equal(result.record.status, 'voided'); assert.deepEqual(f.snapshot()['stock-list'], stock);
  assert.equal(f.snapshot()['old-gold-records'].length, 5);
});

test('historical per-piece invoices and prior returns restore only outstanding weights and pieces', () => {
  const f = fixture({ weightMode: undefined, soldItems: [{ stockId: 'ring', lineId: 'one', name: 'Gold Ring', gross: 2.5, net: 2.25, pcs: 4 }], returns: [{ items: [{ lineId: 'one', gross: 2.5, net: 2.25, pcs: 1 }] }] });
  f.store.read()['old-gold-records'].push({ sourceId: 'return', invoice: f.record.number, metal: 'gold', source: 'Invoice return - old metal given back', weight: -1, value: -100 });
  voidInvoice(f.store, f.record.number, input(f.record), now);
  assert.deepEqual(f.snapshot()['stock-list'][0], { id: 'ring', item: 'Gold Ring', qty: 9, gross: 97.5, net: 87.75 });
  const ledger = f.snapshot()['old-gold-records'];
  assert.equal(ledger.find(entry => entry.reversalOf === 'return').weight, 1);
  assert.equal(ledger.filter(entry => entry.metal === 'gold').reduce((sum, entry) => sum + entry.weight, 0), 7);
});

test('unsafe or invalid void requests and persistence failures leave all data unchanged', () => {
  const invalid = [
    f => ({ ...input(f.record), reason: ' ' }), f => ({ ...input(f.record), reason: 'x'.repeat(1001) }),
    f => ({ ...input(f.record), version: 'stale' }), f => ({ reason: 'Reason' })
  ];
  for (const make of invalid) { const f = fixture(), before = f.snapshot(); assert.throws(() => voidInvoice(f.store, f.record.number, make(f), now)); assert.deepEqual(f.snapshot(), before); assert.equal(f.writes(), 0); }
  for (const change of [
    f => { f.store.read()['stock-list'] = []; },
    f => { f.record.soldItems = []; },
    f => { f.store.read()['old-gold-records'].push({ sourceId: 'out', metal: 'silver', weight: -5, source: 'Metal payment' }); },
    f => { f.store.read()['old-gold-records'][0].value = 'not a number'; }
  ]) { const f = fixture(); change(f); const before = f.snapshot(); assert.throws(() => voidInvoice(f.store, f.record.number, input(f.record), now)); assert.deepEqual(f.snapshot(), before); assert.equal(f.writes(), 0); }
  const f = fixture(), before = f.snapshot();
  assert.throws(() => voidInvoice(f.store, 'missing', input(f.record)), error => error.statusCode === 404);
  f.store.write = () => { throw new Error('Disk full'); };
  assert.throws(() => voidInvoice(f.store, f.record.number, input(f.record), now), /Disk full/);
  assert.deepEqual(f.snapshot(), before);
});

test('React mode replaces legacy void handlers while original frontend remains available', () => {
  const renderer = new PageRenderer(createConfig({}));
  const react = renderer.render({ reactDashboard: true }), legacy = renderer.render();
  assert.ok(react.includes('id="react-invoice-void"'));
  assert.ok(!react.includes('const openVoidModal ='));
  assert.ok(!react.includes("voidModal.id = 'voidInvoiceModal'"));
  assert.ok(!react.includes("getElementById('confirmVoidInvoice').addEventListener"));
  assert.ok(legacy.includes("getElementById('confirmVoidInvoice').addEventListener"));
});
