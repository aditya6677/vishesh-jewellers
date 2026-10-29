'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomBytes, randomUUID } = require('node:crypto');
const { openDatabase } = require('../lib/database/database');
const { importSnapshot, readSnapshot } = require('../lib/database/snapshot-migration');
const { DatabaseQueries } = require('../lib/database/queries');
const { DashboardService } = require('../lib/services/dashboard-service');
const { InvoiceRepository } = require('../lib/database/invoice-repository');
const { StockRepository } = require('../lib/database/stock-repository');
const { TransactionRepository } = require('../lib/database/transaction-repository');
function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vj-operational-db-'));
  const key = randomBytes(32), file = path.join(directory, 'store.db');
  const db = openDatabase(file, key, { create: true });
  t.after(() => { if (db.open) db.close(); key.fill(0); fs.rmSync(directory, { recursive: true, force: true }); });
  const snapshot = { 'stock-list': [{ id: 'ring', item: 'Gold Ring', purity: '22K', qty: 20, gross: 100, net: 90 }], 'invoice-records': [], 'old-gold-records': [], 'purchase-records': [], 'payment-records': [], 'invoice-counter': 1 };
  importSnapshot(db, snapshot, { storeId: 'a', sourceSha256: 'a'.repeat(64), acknowledgeLegacy: true });
  return { db, file, key, query: new DatabaseQueries(db, 'a') };
}
function parity(db, query, range = {}) {
  const source = new DashboardService({ read: () => readSnapshot(db, 'a') }).snapshot(range);
  assert.deepEqual(query.dashboard(range), source);
}
test('operational schema keeps normalized report tables in the same invoice/stock/payment transaction', t => {
  const { db, query } = fixture(t);
  const now = () => new Date('2026-10-28T08:00:00Z');
  const invoices = new InvoiceRepository(db, 'a', { now, id: randomUUID });
  const stocks = new StockRepository(db, 'a');
  const trades = new TransactionRepository(db, 'a', { now });
  parity(db, query);
  trades.save('purchases', { metal: 'gold', weight: 10, rate: 1000 });
  trades.save('payments', { type: 'metal', metal: 'gold', weight: 2, purity: 40 });
  trades.save('payments', { type: 'amount', amount: 100 });
  trades.save('payments', { type: 'self-expense', amount: 50 });
  const sale = { requestId: randomUUID(), number: 'VJ000001', status: 'completed', customer: 'Synthetic database', mobile: '9000012345', invoiceDate: '2026-10-27', items: [{ stockId: 'ring', name: 'Gold Ring', purity: '22K', gross: 10, net: 9, pcs: 4, rate: 1000, making: 0 }], exchanges: [{ metal: 'silver', weight: 1, rate: 100 }], manualDiscount: 20, gstRate: 3, paid: 1000, expectedTotal: 9150 };
  invoices.create(sale);
  parity(db, query); parity(db, query, { from: '2026-10-28', to: '2026-10-28' }); parity(db, query, { from: '2026-10-27', to: '2026-10-27' });
  invoices.settle(sale.number, { version: invoices.get(sale.number).version, method: 'gold', weight: .1, rate: 1000 });
  parity(db, query); parity(db, query, { from: '2026-10-28', to: '2026-10-28' });
  assert.equal(query.recordList({ query: '12345', status: 'due' }).pagination.total, 1);
  assert.equal(query.recordList({ status: 'advance' }).items.length, 0);
  assert.equal(query.recordList({ from: '2026-10-28' }).items.length, 0);
  assert.equal(query.stockList({ query: 'ring' }).pagination.total, 1);
  assert.equal(query.transactionList('payments').summary.amount, 150);
  const saved = stocks.get('ring'); stocks.mutate('ring', { version: saved.version, qty: 2, gross: 5, net: 4 }, 'batch');
  parity(db, query);
  const before = query.dashboard();
  db.exec("CREATE TRIGGER reject_report_write BEFORE INSERT ON metal_movements BEGIN SELECT RAISE(ABORT,'projection failure'); END;");
  assert.throws(() => invoices.settle(sale.number, { version: invoices.get(sale.number).version, method: 'gold', weight: .1, rate: 1000 }), /projection failure/);
  assert.deepEqual(query.dashboard(), before);
  db.exec('DROP TRIGGER reject_report_write');
  assert.equal(db.pragma('foreign_key_check').length, 0);
});
test('database opening is explicit and refuses missing files, wrong keys and overwrites', t => {
  const { db, file, key } = fixture(t);
  assert.throws(() => openDatabase(file + '.missing', key));
  assert.equal(fs.existsSync(file + '.missing'), false);
  assert.throws(() => openDatabase(file, randomBytes(32)));
  assert.throws(() => openDatabase(file, key, { create: true }), /overwrite/);
  const NativeDatabase = require('better-sqlite3-multiple-ciphers'), plain = new NativeDatabase(file + '.plain');
  plain.exec('CREATE TABLE example(id INTEGER)'); plain.close();
  assert.throws(() => openDatabase(file + '.plain', key), /Unencrypted/);
  db.prepare("UPDATE schema_manifest SET timezone='Unverified-Timezone'").run();
  assert.throws(() => openDatabase(file, key), /timezone changed/);
});

test('SQL reports preserve legacy numeric, date, missing-status and cash-field semantics', t => {
  const { db, query } = fixture(t);
  const snapshot = {
    'stock-list': [{ id: 'legacy', item: 'Legacy Ring', qty: 1, gross: '1,000', net: '500', purity: '22K' }],
    'invoice-records': [{ number: 'VJ000001', customer: null, date: '28/10/2026', total: '₹100.00', paid: 0, due: 0, payments: [] }],
    'purchase-records': [{ id: 'p1', metal: 'gold', weight: 1, rate: 100, amount: .1 }, { id: 'p2', metal: 'gold', weight: 1, rate: 100, amount: .2, savedAt: null }],
    'payment-records': [{ id: 'pay', type: 'amount', metal: 'gold', weight: 999, amount: .3 }],
    'old-gold-records': [{ metal: 'gold', weight: '1,000', value: 1000, source: 'Old metal purchase' }, { metal: 'Gold', weight: 2, receivedAt: '2026-10-28T00:00:00Z' }, { weight: 3, receivedAt: null }]
  };
  const { importSnapshot } = require('../lib/database/snapshot-migration');
  importSnapshot(db, snapshot, { storeId: 'legacy', sourceSha256: 'b'.repeat(64), acknowledgeLegacy: true });
  const legacy = new DatabaseQueries(db, 'legacy');
  const source = new DashboardService({ read: () => structuredClone(snapshot) });
  for (const range of [{}, { to: '2026-10-28' }, { from: '2026-10-28', to: '2026-10-28' }]) assert.deepEqual(legacy.dashboard(range), source.snapshot(range));
  assert.equal(legacy.recordList({ query: 'null', status: 'due', from: '2026-10-28' }).items.length, 1);
  assert.equal(legacy.transactionList('payments').summary.gold, 0);
  assert.equal(query.dashboard().summary.invoices, 0);
});

test('an empty prepared store supports its first stock, invoice and cash payment without whole-store writes', t => {
  const { db } = fixture(t);
  importSnapshot(db, {}, { storeId: 'empty', sourceSha256: 'c'.repeat(64), acknowledgeLegacy: true });
  const now = () => new Date('2026-10-28T08:00:00Z');
  const stocks = new StockRepository(db, 'empty', { now, id: () => 'first-stock' });
  stocks.create({ item: 'Ring', purity: '22K', qty: 10, gross: 10, net: 10 });
  const invoice = new InvoiceRepository(db, 'empty', { now });
  invoice.create({ requestId: randomUUID(), number: 'VJ000001', status: 'completed', customer: 'First customer', invoiceDate: '2026-10-28', items: [{ stockId: 'first-stock', name: 'Ring', purity: '22K', gross: 1, net: 1, pcs: 4, rate: 100, making: 0 }], exchanges: [], manualDiscount: 0, gstRate: 0, paid: 0, expectedTotal: 100 });
  const snapshot = readSnapshot(db, 'empty');
  assert.equal(snapshot['stock-list'][0].qty, 6);
  assert.equal(snapshot['invoice-counter'], 2);
  assert.deepEqual(snapshot['old-gold-records'], []);
  importSnapshot(db, {}, { storeId: 'cash-only', sourceSha256: 'd'.repeat(64), acknowledgeLegacy: true });
  const trades = new TransactionRepository(db, 'cash-only', { now, id: () => 'first-payment' });
  trades.save('payments', { type: 'amount', amount: 10 });
  assert.deepEqual(readSnapshot(db, 'cash-only')['old-gold-records'], []);
});
