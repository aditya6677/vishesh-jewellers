'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { createInvoice } = require('../lib/services/invoice-creation');
const { calculateDashboard } = require('../lib/dashboard-summary');
const { deleteInvoice } = require('../lib/delete-invoice');

function fixture() {
  let data = {
    'stock-list': [{ id: 'ring', item: 'Gold Ring', purity: '22K', qty: 10, gross: 100, net: 90, extra: 'retained' }],
    'invoice-records': [], 'old-gold-records': [], 'invoice-counter': 1, unrelated: { retained: true }
  };
  let writes = 0;
  return {
    store: { read: () => data, write: next => { writes++; data = next; } },
    snapshot: () => structuredClone(data), writes: () => writes
  };
}

function draft(overrides = {}) {
  return {
    requestId: randomUUID(), number: 'VJ000001', status: 'completed', invoiceDate: '2026-10-26', customer: 'Test Customer',
    mobile: '9999999999', address: 'Test address', business: 'Vishesh Jewellers', gstin: 'TEST', terms: 'Test terms',
    items: [{ lineId: 'line1', stockId: 'ring', name: 'Gold Ring', purity: '22K', hsn: '7113', pcs: 4, gross: 10, net: 9, rate: 1000, making: 10 }],
    exchanges: [{ metal: 'gold', weight: 0.1, rate: 10000 }, { metal: 'gold', weight: 0.05, rate: 10000, required: true }, { metal: 'silver', weight: 1, rate: 100 }],
    manualDiscount: 50, paid: 1000, gstRate: 3, expectedTotal: 8547, invoiceMarkup: '<div id="invoicePaper">Test</div>', ...overrides
  };
}

test('sale commits invoice, line-total weights, quantity, all exchange rows, and counter in one write', () => {
  const f = fixture();
  const result = createInvoice(f.store, draft(), () => new Date('2026-10-26T10:00:00Z'));
  assert.equal(f.writes(), 1);
  assert.deepEqual(result.stock[0], { id: 'ring', item: 'Gold Ring', purity: '22K', qty: 6, gross: 90, net: 81, extra: 'retained' });
  assert.equal(result.record.subtotal, '₹9,900.00');
  assert.equal(result.record.tax, '₹297.00');
  assert.equal(result.record.discount, '₹1,650.00');
  assert.equal(result.record.total, '₹8,547.00');
  assert.equal(result.record.due, 7547);
  assert.equal(result.record.paid, 1000);
  assert.equal(result.record.payments[0].amount, 1000);
  assert.equal(result.record.weightMode, 'line-total');
  assert.equal(result.nextCounter, 2);
  const snapshot = f.snapshot();
  assert.equal(snapshot['old-gold-records'].length, 3);
  assert.equal(new Set(snapshot['old-gold-records'].map(row => row.sourceId)).size, 3);
  assert.deepEqual(snapshot.unrelated, { retained: true });
  const dashboard = calculateDashboard(snapshot['invoice-records'], [], [], snapshot['old-gold-records']);
  assert.equal(dashboard.collected, 1000);
  assert.equal(dashboard.gold.sold, 9);
  // Existing reversal remains compatible with the newly saved transaction.
  const restored = deleteInvoice(snapshot, 'VJ000001');
  assert.deepEqual(restored['stock-list'], fixture().snapshot()['stock-list']);
  assert.equal(restored['old-gold-records'].length, 0);
});

test('pending orders preserve stock, keep ordered items, exchanges, and customer advance', () => {
  const f = fixture();
  const stockBefore = f.snapshot()['stock-list'];
  const result = createInvoice(f.store, draft({ status: 'pending', paid: 9000 }));
  assert.deepEqual(result.stock, stockBefore);
  assert.deepEqual(result.record.soldItems, []);
  assert.equal(result.record.orderItems[0].stockId, '');
  assert.equal(result.record.orderItems[0].pcs, 4);
  assert.equal(result.record.due, 0);
  assert.equal(result.record.paid - 8547, 453);
  assert.equal(f.snapshot()['old-gold-records'].length, 3);
});

test('same save request is idempotent and different requests cannot reuse invoice numbers', () => {
  const f = fixture();
  const input = draft();
  const saved = createInvoice(f.store, input);
  const after = f.snapshot();
  const replay = createInvoice(f.store, input);
  assert.equal(replay.replayed, true);
  assert.deepEqual(replay.record, saved.record);
  assert.equal(f.writes(), 1);
  assert.throws(() => createInvoice(f.store, { ...input, paid: 2000 }), /already used/);
  assert.throws(() => createInvoice(f.store, { ...input, requestId: randomUUID() }), /already saved/);
  assert.deepEqual(f.snapshot(), after);
});

test('validation, insufficient stock, stale metadata, and mismatched previews never write', () => {
  const invalidDrafts = [
    { customer: '' }, { invoiceDate: '2026-02-30' }, { items: [] }, { paid: -1 }, { paid: false },
    { manualDiscount: -1 }, { gstRate: 5 }, { expectedTotal: 1 },
    { exchanges: [{ metal: 'gold', weight: 0, rate: 100 }] },
    { exchanges: [{ metal: 'gold', weight: 0, rate: 0, required: true }] },
    { exchanges: [{ metal: 'silver', weight: -1, rate: 100 }] },
    { items: [{ ...draft().items[0], pcs: 11 }] },
    { items: [{ ...draft().items[0], gross: 101 }] },
    { items: [{ ...draft().items[0], pcs: 1.5 }] },
    { items: [{ ...draft().items[0], net: 11 }] },
    { items: [{ ...draft().items[0], rate: 0 }] },
    { items: [{ ...draft().items[0], purity: '18K' }] }
  ];
  for (const change of invalidDrafts) {
    const f = fixture();
    const before = f.snapshot();
    assert.throws(() => createInvoice(f.store, draft(change)));
    assert.equal(f.writes(), 0);
    assert.deepEqual(f.snapshot(), before);
  }
  const f = fixture();
  const repeatedRows = [1, 2].map(index => ({ ...draft().items[0], lineId: 'line' + index, pcs: 6 }));
  assert.throws(() => createInvoice(f.store, draft({ items: repeatedRows, expectedTotal: 18744 })), /Not enough/);
  assert.equal(f.writes(), 0);
});

test('non-GST and zero-floor totals preserve the previous payable calculation', () => {
  const f = fixture();
  const result = createInvoice(f.store, draft({ gstRate: 0, expectedTotal: 8250 }));
  assert.equal(result.record.tax, '₹0.00');
  assert.equal(result.record.total, '₹8,250.00');
  const floor = fixture();
  const zero = createInvoice(floor.store, draft({ exchanges: [{ metal: 'gold', weight: 2, rate: 10000 }], expectedTotal: 0 }));
  assert.equal(zero.record.total, '₹0.00');
  assert.equal(zero.record.due, 0);
});

test('fractional exchange credit and discount use the original conversion before final total rounding', () => {
  const f = fixture();
  const input = draft({
    items: [{ ...draft().items[0], gross: 1, net: 1, rate: 10.25, making: 0, pcs: 1 }],
    exchanges: [{ metal: 'gold', weight: 0.001, rate: 5 }], manualDiscount: 0.01,
    paid: 0, gstRate: 0, expectedTotal: 10
  });
  const result = createInvoice(f.store, input);
  assert.equal(result.record.exchanges[0].value, 0.005);
  assert.equal(result.record.discount, '₹0.01');
  assert.equal(result.record.total, '₹10.00');
});

test('failed persistence leaves invoice, inventory, metal ledger, and counter untouched', () => {
  const f = fixture();
  const before = f.snapshot();
  assert.throws(() => createInvoice({ read: f.store.read, write: () => { throw new Error('disk full'); } }, draft()), /disk full/);
  assert.deepEqual(f.snapshot(), before);
});
