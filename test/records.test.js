'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { RecordService } = require('../lib/services/record-service');
const { StorageKey } = require('../lib/domain/constants');

function fixture(record = {}) {
  let data = { [StorageKey.INVOICES]: [{ number: 'VJ1', total: 1000, paid: 0, due: 1000, status: 'completed', ...record }], untouched: true }, writes = 0;
  const store = { read: () => structuredClone(data), write: value => { data = structuredClone(value); writes++; } };
  return { store, writes: () => writes, service: new RecordService(store) };
}
test('settlements update invoice and metal ledger with one write and reject repeated revisions', () => {
  const { store, service, writes } = fixture();
  const version = service.list().versions.VJ1;
  const result = service.settle('VJ1', { method: 'gold', weight: 2, rate: 100, version });
  assert.equal(result.record.paid, 200); assert.equal(result.record.due, 800);
  assert.equal(writes(), 1);
  assert.equal(store.read()[StorageKey.OLD_METAL][0].weight, 2);
  assert.equal(store.read()[StorageKey.OLD_METAL][0].value, 200);
  assert.throws(() => service.settle('VJ1', { method: 'gold', weight: 2, rate: 100, version }), error => error.statusCode === 409);
  const final = service.settle('VJ1', { fullyPaid: true, method: 'silver', weight: 99, rate: 99, version: result.version });
  assert.equal(final.record.due, 0);
  assert.deepEqual(final.record.payments[0], { method: 'amount', amount: 800, weight: null, rate: null, settledAt: final.record.payments[0].settledAt });
  assert.equal(store.read()[StorageKey.OLD_METAL].length, 1);
  assert.equal(store.read().untouched, true);
});
test('settlement validation rejects invalid amounts, negative metal inputs, voided and settled invoices', () => {
  const { service, store, writes } = fixture();
  const version = service.list().versions.VJ1;
  const before = store.read();
  for (const input of [{ method: 'amount', amount: 0 }, { method: 'amount', amount: 1001 }, { method: 'amount', amount: Infinity }, { method: 'other', amount: 1 }, { method: 'gold', weight: -2, rate: -100 }, { method: 'silver', weight: 1, rate: 0 }]) {
    assert.throws(() => service.settle('VJ1', { ...input, version }));
    assert.deepEqual(store.read(), before);
  }
  assert.equal(writes(), 0);
  for (const record of [{ status: 'voided', due: 0 }, { paid: 1000, due: 0 }]) {
    const { service } = fixture(record);
    assert.equal(service.list().items[0].due, 0);
    assert.throws(() => service.settle('VJ1', { method: 'amount', amount: 1, version: service.list().versions.VJ1 }));
  }
});
test('record normalization is read-only and settlement preserves historical payments', () => {
  const { service, store, writes } = fixture({ due: undefined, paid: 100, payments: [{ method: 'amount', amount: 100 }] });
  const data = store.read(); delete data[StorageKey.INVOICES][0].due; store.write(data);
  const result = service.list();
  assert.equal(result.items[0].due, 900);
  assert.equal(writes(), 1);
  assert.equal(store.read()[StorageKey.INVOICES][0].due, undefined);
  const settled = service.settle('VJ1', { version: result.versions.VJ1, method: 'silver', weight: 1, rate: 50 });
  assert.equal(settled.record.payments.length, 2);
  assert.equal(settled.record.due, 850);
});

test('record filtering handles statuses, mobile numbers, and inclusive invoice dates', () => {
  const { service, store } = fixture();
  store.write({ [StorageKey.INVOICES]: [
    { number: 'DUE', customer: 'Vishesh', mobile: '99999', invoiceDate: '2026-10-01', total: 100, paid: 20, due: 80 },
    { number: 'ADV', date: '31/10/2026', total: 100, paid: 120, due: 0 },
    { number: 'PAID', invoiceDate: '2026-10-15', total: 100, paid: 100, due: 0 },
    { number: 'VOID', status: 'voided', total: 100, due: 0 },
    { number: 'ORDER', status: 'pending', total: 100, due: 100 }
  ] });
  for (const [status, number] of [['due', 'DUE'], ['advance', 'ADV'], ['settled', 'PAID'], ['voided', 'VOID'], ['pending', 'ORDER']]) {
    assert.deepEqual(service.list({ status }).items.map(item => item.number), [number]);
  }
  assert.equal(service.list({ query: '99999' }).items[0].number, 'DUE');
  assert.equal(service.list({ from: '2026-10-01', to: '2026-10-31' }).items.length, 3);
  assert.throws(() => service.list({ from: '2026-02-30' }));
  assert.throws(() => service.list({ from: '2026-10-31', to: '2026-10-01' }));
});
