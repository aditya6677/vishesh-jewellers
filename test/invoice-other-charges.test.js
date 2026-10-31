'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomBytes, randomUUID } = require('node:crypto');
const { openDatabase } = require('../lib/database/database');
const { importSnapshot, readSnapshot } = require('../lib/database/snapshot-migration');
const { InvoiceRepository } = require('../lib/database/invoice-repository');
const { DatabaseQueries } = require('../lib/database/queries');
const { DashboardService } = require('../lib/services/dashboard-service');

test('SQLite other charges survive save/edit and match financial reports without changing inventory arithmetic', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'karatdesk-charges-'));
  const db = openDatabase(path.join(directory, 'test.db'), randomBytes(32), { create: true });
  t.after(() => { db.close(); fs.rmSync(directory, { recursive: true, force: true }); });
  const stock = { id: 'gold', item: 'Ring', purity: '22K', qty: 10, gross: 100, net: 90 };
  importSnapshot(db, { 'stock-list': [stock], 'invoice-records': [], 'invoice-counter': 1, 'old-gold-records': [] }, { storeId: 'main', sourceSha256: 'b'.repeat(64), acknowledgeLegacy: true });
  const invoices = new InvoiceRepository(db, 'main', { now: () => new Date('2026-10-31T10:00:00Z') });
  const queries = new DatabaseQueries(db, 'main');
  const sale = { requestId: randomUUID(), number: 'VJ000001', status: 'completed', customer: 'Test charges', invoiceDate: '2026-10-31',
    items: [{ stockId: 'gold', name: 'Ring', purity: '22K', pcs: 4, gross: 10, net: 9, rate: 1000, making: 0, otherCharges: 500 }],
    exchanges: [], manualDiscount: 0, paid: 0, gstRate: 3, taxTreatment: 'b2b', customerGstin: '27ABCDE1234F1Z5', expectedTotal: 9785 };
  invoices.create(sale);
  assert.equal(invoices.get(sale.number).record.soldItems[0].otherCharges, 500);
  assert.equal(queries.dashboard().summary.gold.sales, 9500);
  assert.deepEqual(queries.dashboard().summary, new DashboardService({ read: () => readSnapshot(db, 'main') }).snapshot().summary);
  invoices.edit(sale.number, { ...sale, version: invoices.get(sale.number).version, items: [{ ...sale.items[0], otherCharges: 1000 }], expectedTotal: 10300 });
  assert.equal(queries.dashboard().summary.gold.sales, 10000);
  assert.equal(invoices.get(sale.number).record.soldItems[0].otherCharges, 1000);
  assert.equal(invoices.get(sale.number).record.customerGstin, '27ABCDE1234F1Z5');
  assert.equal(invoices.get(sale.number).record.taxTreatment, 'b2b');
  assert.equal(readSnapshot(db, 'main')['stock-list'][0].net, 81);
  assert.equal(readSnapshot(db, 'main')['stock-list'][0].qty, 6);
  invoices.delete(sale.number);
  assert.equal(queries.dashboard().summary.gold.sales, 0);
  assert.deepEqual(readSnapshot(db, 'main')['stock-list'][0], stock);
});
