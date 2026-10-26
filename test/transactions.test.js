'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { TransactionService } = require('../lib/services/transaction-service');
const { StorageKey } = require('../lib/domain/constants');
const { calculateDashboard } = require('../lib/dashboard-summary');

function fixture() {
  let data = { unrelated: ['preserve'] }, writes = 0, sequence = 0;
  const store = { read: () => structuredClone(data), write: value => { data = structuredClone(value); writes++; } };
  return { store, writes: () => writes, service: new TransactionService(store, { id: () => String(++sequence), now: () => new Date('2026-10-26T06:00:00Z') }) };
}

test('purchase and payment ledger stays atomic through edits, type changes, and deletes', () => {
  const { store, service, writes } = fixture();
  const purchase = service.save('purchases', { metal: 'gold', weight: 100, rate: 5000 });
  const p = purchase.items[0];
  assert.equal(p.amount, 500000);
  let payment = service.save('payments', { type: 'metal', metal: 'gold', weight: 100, purity: 40, reason: 'Party' });
  const id = payment.items[0].id;
  assert.equal(payment.items[0].fineWeight, 40);
  assert.equal(payment.balances.gold, 0);
  assert.equal(writes(), 2);
  const before = store.read();
  assert.throws(() => service.save('purchases', { version: purchase.versions[p.id] }, p.id, true), /insufficient/);
  assert.deepEqual(store.read(), before);
  payment = service.save('payments', { type: 'metal', metal: 'gold', weight: 50, purity: 80, version: payment.versions[id] }, id);
  assert.equal(payment.balances.gold, 50);
  assert.equal(payment.items[0].fineWeight, 40);
  payment = service.save('payments', { type: 'self-expense', amount: 200, reason: 'Electricity', version: payment.versions[id] }, id);
  assert.equal(payment.balances.gold, 100);
  assert.equal(payment.items[0].weight, undefined);
  assert.equal(payment.items[0].fineWeight, undefined);
  assert.equal(payment.items[0].savedAt, p.savedAt);
  service.save('payments', { type: 'amount', amount: 300 });
  const data = store.read();
  const summary = calculateDashboard([], data[StorageKey.PURCHASES], data[StorageKey.PAYMENTS], data[StorageKey.OLD_METAL]);
  assert.equal(summary.purchases, 500000);
  assert.equal(summary.expenses, 200);
  assert.equal(summary.party, 300);
  assert.equal(summary.afterPayment, -500500);
  service.save('payments', { version: payment.versions[id] }, id, true);
  service.save('purchases', { version: purchase.versions[p.id] }, p.id, true);
  assert.deepEqual(service.list('purchases').balances, { gold: 0, silver: 0 });
  assert.deepEqual(store.read().unrelated, ['preserve']);
});

test('purchase revisions replace exactly one linked entry and reject stale changes', () => {
  const { service, store } = fixture();
  let result = service.save('purchases', { metal: 'gold', weight: 10, rate: 100 });
  const id = result.items[0].id, oldVersion = result.versions[id];
  result = service.save('purchases', { metal: 'silver', weight: 20, rate: 50, version: oldVersion }, id);
  assert.deepEqual(result.balances, { gold: 0, silver: 20 });
  assert.equal(store.read()[StorageKey.OLD_METAL].length, 1);
  assert.equal(result.items[0].amount, 1000);
  assert.throws(() => service.save('purchases', { version: oldVersion }, id, true), error => error.statusCode === 409);
  assert.throws(() => service.save('payments', {}, 'missing', true), error => error.statusCode === 404);
  assert.throws(() => service.save('payments', { type: 'metal', metal: 'silver', weight: 21, purity: 90 }), /Not enough/);
});

test('invalid transactions never write, and repeated transactions keep linked ledgers', () => {
  const { service, store, writes } = fixture();
  const before = store.read();
  const invalid = [
    ['purchases', {}], ['purchases', { metal: 'gold', weight: 0, rate: 1 }],
    ['purchases', { metal: 'other', weight: 1, rate: 1 }], ['purchases', { metal: 'gold', weight: 1e308, rate: 1e308 }],
    ['payments', { type: 'unknown', amount: 1 }], ['payments', { type: 'amount', amount: true }],
    ['payments', { type: 'amount', amount: -1 }], ['payments', { type: 'amount', amount: Infinity }],
    ['payments', { type: 'metal', metal: 'gold', weight: 1, purity: 101 }]
  ];
  for (const [kind, input] of invalid) assert.throws(() => service.save(kind, input));
  assert.equal(writes(), 0);
  assert.deepEqual(store.read(), before);
  for (let i = 0; i < 25; i++) service.save('purchases', { metal: 'silver', weight: 2, rate: 10 });
  assert.equal(service.list('purchases').items.length, 25);
  assert.equal(service.list('purchases').balances.silver, 50);
  assert.equal(store.read()[StorageKey.OLD_METAL].length, 25);
});

test('failed atomic persistence leaves both collections unchanged', () => {
  const initial = {};
  const service = new TransactionService({ read: () => structuredClone(initial), write: () => { throw new Error('Disk full'); } });
  assert.throws(() => service.save('purchases', { metal: 'gold', weight: 1, rate: 10 }), /Disk full/);
  assert.deepEqual(initial, {});
});
