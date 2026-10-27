'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { editInvoice, initialPaidFor, editTotals } = require('../lib/services/invoice-editing');
const { calculateDashboard } = require('../lib/dashboard-summary');

const version = record => createHash('sha256').update(JSON.stringify(record)).digest('hex');
function fixture(overrides = {}) {
  const sold = { stockId: 'ring', name: 'Gold Ring', purity: '22K', gross: 10, net: 9, pcs: 4, rate: 100, making: 0 };
  const record = { number: 'VJ000001', customer: 'Before', status: 'completed', weightMode: 'line-total', soldItems: [sold], total: '₹927.00', paid: 300, initialPaid: 100, due: 627, savedAt: '2026-10-01T10:00:00Z', payments: [{ method: 'amount', amount: 100, initialPayment: true }, { method: 'gold', amount: 200, weight: 1, rate: 200, settledAt: '2026-10-10T10:00:00Z' }], ...overrides };
  let data = { 'invoice-records': [record, { number: 'OTHER' }], 'stock-list': [{ id: 'ring', item: 'Gold Ring', purity: '22K', qty: 6, gross: 90, net: 81 }], 'old-gold-records': [{ sourceId: 'VJ000001:exchange:gold:0', metal: 'gold', weight: 1, value: 100 }, { sourceId: 'VJ000001:settlement:x', metal: 'gold', weight: 1, value: 200 }, { sourceId: 'other', metal: 'silver', weight: 2, value: 20 }], 'invoice-counter': 9, unrelated: true };
  let writes = 0;
  return { store: { read: () => data, write: next => { data = next; writes++; } }, snapshot: () => structuredClone(data), writes: () => writes, record };
}
function input(record, overrides = {}) {
  return { version: version(record), customer: 'Revised', invoiceDate: '2026-10-26', mobile: '', address: 'New address', terms: 'Terms', items: [{ stockId: 'ring', name: 'Gold Ring', purity: '22K', gross: 20, net: 18, pcs: 5, rate: 100, making: 0 }], exchanges: [{ metal: 'silver', weight: 1, rate: 50 }], paid: 150, manualDiscount: 4, gstRate: 3, expectedTotal: 1800, invoiceMarkup: '<div id="invoicePaper">Revised</div>', ...overrides };
}

test('invoice revision atomically reconciles stock/exchanges, keeps settlements, order and counter', () => {
  const f = fixture(); const result = editInvoice(f.store, f.record.number, input(f.record));
  assert.equal(f.writes(), 1);
  assert.deepEqual(result.stock, [{ id: 'ring', item: 'Gold Ring', purity: '22K', qty: 5, gross: 80, net: 72 }]);
  assert.equal(result.record.total, '₹1,800.00'); assert.equal(result.record.tax, '₹54.00');
  assert.equal(result.record.paid, 350); assert.equal(result.record.due, 1450);
  assert.equal(result.record.initialPaid, 150); assert.equal(result.record.payments.length, 2);
  assert.equal(result.record.payments[0].amount, 150); assert.equal(result.record.payments[1].amount, 200);
  assert.equal(result.record.savedAt, f.record.savedAt);
  const snapshot = f.snapshot();
  assert.equal(snapshot['invoice-counter'], 9); assert.equal(snapshot.unrelated, true);
  assert.deepEqual(snapshot['invoice-records'].map(record => record.number), ['VJ000001', 'OTHER']);
  assert.equal(snapshot['old-gold-records'].length, 3);
  assert.equal(snapshot['old-gold-records'].filter(entry => entry.sourceId.includes(':exchange:')).length, 1);
  assert.equal(snapshot['old-gold-records'].find(entry => entry.sourceId.includes(':exchange:')).metal, 'silver');
  assert.ok(snapshot['old-gold-records'].some(entry => entry.sourceId === 'VJ000001:settlement:x'));
  // Metal settlement contributes to paid, not cash collected.
  assert.equal(calculateDashboard([result.record], [], [], snapshot['old-gold-records']).collected, 150);
  const after = f.snapshot();
  assert.throws(() => editInvoice(f.store, f.record.number, input(f.record)), error => error.statusCode === 409);
  assert.deepEqual(f.snapshot(), after); assert.equal(f.writes(), 1);
});

test('failed revision validation or persistence leaves all collections unchanged', () => {
  for (const changes of [{ customer: '' }, { invoiceDate: '2026-02-30' }, { expectedTotal: 1 }, { paid: -1 }, { gstRate: 9 }, { items: [] }, { items: [{ stockId: 'ring', name: 'Gold Ring', purity: '22K', pcs: 99, gross: 20, net: 18, rate: 100, making: 0 }] }]) {
    const f = fixture(); const before = f.snapshot();
    assert.throws(() => editInvoice(f.store, f.record.number, input(f.record, changes)));
    assert.deepEqual(f.snapshot(), before); assert.equal(f.writes(), 0);
  }
  const f = fixture(); const before = f.snapshot();
  f.store.write = () => { throw new Error('Disk full'); };
  assert.throws(() => editInvoice(f.store, f.record.number, input(f.record)), /Disk full/);
  assert.deepEqual(f.snapshot(), before);
  assert.throws(() => editInvoice(f.store, 'missing', input(f.record)), error => error.statusCode === 404);
  const voided = fixture({ status: 'voided' });
  assert.throws(() => editInvoice(voided.store, voided.record.number, input(voided.record)), /Voided/);
  assert.equal(voided.writes(), 0);
});

test('pending delivery deducts once; historical per-piece sales restore their total weights', () => {
  const f = fixture({ status: 'pending', soldItems: [], orderItems: [{ name: 'Gold Ring' }] });
  const result = editInvoice(f.store, f.record.number, input(f.record));
  assert.equal(result.record.status, 'completed'); assert.ok(result.record.deliveredAt);
  assert.deepEqual(result.stock[0], { id: 'ring', item: 'Gold Ring', purity: '22K', qty: 1, gross: 70, net: 63 });
  const historical = fixture({ weightMode: undefined, soldItems: [{ stockId: 'ring', name: 'Gold Ring', purity: '22K', gross: 2.5, net: 2.25, pcs: 4 }] });
  const revised = editInvoice(historical.store, historical.record.number, input(historical.record));
  assert.deepEqual(revised.stock[0], { id: 'ring', item: 'Gold Ring', purity: '22K', qty: 5, gross: 80, net: 72 });
});

test('editor retains verified arithmetic and initial-payment inference', () => {
  assert.equal(initialPaidFor({ paid: 450, payments: [{ amount: 200 }] }), 250);
  assert.equal(initialPaidFor({ paid: 450, savedAt: '2026-10-01T10:00:00Z', payments: [{ amount: 150, settledAt: '2026-10-01T10:00:01Z' }, { amount: 300 }] }), 150);
  for (const gst of [0, 3]) for (const net of [0.1, 1.005, 9, 19.99]) {
    const rows = [{ net, rate: 999.99, making: 12, pcs: 4 }];
    const subtotal = net * 999.99 * 1.12;
    assert.equal(editTotals(rows, 12.3456, gst / 2).grand, Math.round(Math.max(subtotal + subtotal * gst / 100 - 12.3456, 0)));
  }
});

test('revision aggregates repeated stock rows and supports advance payments without inventing stock', () => {
  const f = fixture(); const before = f.snapshot();
  const row = input(f.record).items[0];
  assert.throws(() => editInvoice(f.store, f.record.number, input(f.record, { items: [{ ...row, pcs: 6 }, { ...row, pcs: 6 }], expectedTotal: 3654 })), /Not enough/);
  assert.deepEqual(f.snapshot(), before); assert.equal(f.writes(), 0);
  const result = editInvoice(f.store, f.record.number, input(f.record, { paid: 2000 }));
  assert.equal(result.record.paid, 2200); assert.equal(result.record.due, 0);
  assert.equal(result.record.paid - 1800, 400);
  const missing = fixture();
  missing.store.read()['stock-list'] = [];
  const original = missing.record.soldItems[0];
  const restored = editInvoice(missing.store, missing.record.number, input(missing.record, { items: [original], exchanges: [], manualDiscount: 0, gstRate: 0, expectedTotal: 900 }));
  assert.equal(restored.stock[0].qty, 0);
  assert.equal(restored.stock[0].gross, 0); assert.equal(restored.stock[0].net, 0);
});
