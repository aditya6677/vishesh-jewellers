'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const vm = require('node:vm');
const { once } = require('node:events');
const { fork } = require('node:child_process');
const { createApplication } = require('../lib/app');
const { createConfig } = require('../lib/config');
const { createJsonStore } = require('../lib/json-store');
const { BackupService, isoWeekStamp } = require('../lib/services/backup-service');
const { MetalRatesService } = require('../lib/services/metal-rates-service');
const { PageRenderer } = require('../lib/ui/page-renderer');
const { calculateDashboard } = require('../lib/dashboard-summary');
const { DesktopMessage, StorageKey, InvoiceStatus } = require('../lib/domain/constants');

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vj-refactor-test-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const config = createConfig({
    DATA_DIR: path.join(directory, 'data'), BACKUP_DIR: path.join(directory, 'backups'),
    DATA_ENCRYPTION_KEY: crypto.randomBytes(32).toString('base64'), PORT: '0', BACKEND_MODE: process.env.BACKEND_MODE
  });
  return { directory, config };
}

async function runningApp(t, options = {}) {
  const { config } = fixture(t);
  const store = createJsonStore(config.dataFile, { encryptionKey: config.encryptionKey });
  const errors = [];
  const app = createApplication({ config, store, desktop: { enabled: false }, logger: { error: (...args) => errors.push(args) }, ...options });
  await app.initialize();
  app.server.listen(0, '127.0.0.1');
  await once(app.server, 'listening');
  t.after(() => new Promise(resolve => { app.server.close(resolve); app.server.closeAllConnections(); }));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  return { config, store, errors, request: (url, options) => fetch(base + url, options) };
}

test('page composition includes every menu and produces valid browser JavaScript', t => {
  const { config } = fixture(t);
  const html = new PageRenderer(config).render();
  for (const id of ['home', 'stocks', 'dashboard', 'settings', 'payments', 'purchases', 'records']) {
    assert.ok(html.includes('id="page-' + id + '"'), id);
  }
  assert.ok(html.includes('function calculateDashboard('));
  assert.ok(html.includes('record-method'));
  assert.ok(html.includes('app-select'));
  for (const script of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)) new vm.Script(script[1]);
});

test('HTTP storage contract, encrypted persistence, exports, and asset routes', async t => {
  const { request, config, store } = await runningApp(t);
  assert.equal((await request('/api/storage/missing')).status, 404);
  const data = [{ id: 'ring-1', item: 'Test ring', qty: 4, gross: 10, net: 9, purity: '22K' }];
  const saved = await request('/api/storage/stock-list', { method: 'PUT', body: JSON.stringify({ value: JSON.stringify(data) }) });
  assert.equal(saved.status, 200);
  assert.deepEqual(await (await request('/api/storage/stock-list')).json(), { value: JSON.stringify(data) });
  assert.deepEqual(store.read()[StorageKey.STOCK], data);
  const disk = fs.readFileSync(config.dataFile, 'utf8');
  assert.equal(JSON.parse(disk).algorithm, 'aes-256-gcm');
  assert.ok(!disk.includes('Test ring'));
  assert.equal((await request('/api/storage/stock-list', { method: 'PUT', body: '{bad' })).status, 400);
  assert.deepEqual(store.read()[StorageKey.STOCK], data);
  const oversized = await request('/api/storage/stock-list', { method: 'PUT', body: 'x'.repeat(1_000_001) });
  assert.equal(oversized.status, 413);
  assert.deepEqual(store.read()[StorageKey.STOCK], data);
  const workbook = await request('/api/export.xlsx');
  assert.equal(workbook.status, 200);
  assert.match(workbook.headers.get('content-disposition'), /\.xlsx/);
  assert.equal(Buffer.from(await workbook.arrayBuffer()).subarray(0, 2).toString(), 'PK');
  for (const route of ['/', '/index.html', '/assets/vishesh-jewellers-logo.png', '/manifest.webmanifest', '/service-worker.js', '/vendor/html2canvas.min.js', '/vendor/jspdf.umd.min.js']) {
    const response = await request(route);
    assert.equal(response.status, 200, route);
    await response.arrayBuffer();
  }
  assert.equal((await request('/unknown')).status, 404);
  assert.equal((await request('/vendor/package.json')).status, 404);
  assert.equal((await request('/vendor/fonts/LICENSE')).status, 404);
  const fontCss = await request('/vendor/fonts.css');
  assert.equal(fontCss.status, 200); assert.match(fontCss.headers.get('content-type'), /text\/css/);
  for (const font of require('../lib/ui/offline-fonts')) {
    const response = await request('/vendor/fonts/' + font.file);
    assert.equal(response.status, 200); assert.equal(response.headers.get('content-type'), 'font/woff2');
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), fs.readFileSync(path.join(config.root, 'public/vendor/fonts', font.file)));
  }
  assert.equal((await request('/api/version')).status, 200);
});

test('deleting an invoice restores line-total weight and pieces, and reverses its ledger', async t => {
  const { request, store } = await runningApp(t);
  store.write({
    [StorageKey.STOCK]: [{ id: 'ring', qty: 6, gross: 30, net: 29 }],
    [StorageKey.INVOICES]: [{ number: 'VJ000001', status: InvoiceStatus.COMPLETED, weightMode: 'line-total', soldItems: [{ lineId: 'l1', stockId: 'ring', name: 'Ring', pcs: 4, gross: 10, net: 9 }] }],
    [StorageKey.OLD_METAL]: [{ invoice: 'VJ000001', metal: 'gold', weight: 1 }]
  });
  assert.equal((await request('/api/invoices/VJ000001', { method: 'DELETE' })).status, 200);
  const data = store.read();
  assert.deepEqual(data[StorageKey.STOCK], [{ id: 'ring', qty: 10, gross: 40, net: 38 }]);
  assert.deepEqual(data[StorageKey.INVOICES], []);
  assert.deepEqual(data[StorageKey.OLD_METAL], []);
  assert.equal((await request('/api/invoices/VJ000001', { method: 'DELETE' })).status, 400);
  assert.deepEqual(store.read(), data);
});

test('failed invoice reversal leaves every stored collection unchanged', async t => {
  const { request, store } = await runningApp(t);
  const data = {
    [StorageKey.STOCK]: [{ id: 'ring', qty: 1, gross: 5, net: 5 }],
    [StorageKey.INVOICES]: [{ number: 'VJ000002', status: InvoiceStatus.COMPLETED, soldItems: [{ stockId: 'missing', pcs: 1, gross: 1, net: 1 }] }]
  };
  store.write(data);
  assert.equal((await request('/api/invoices/VJ000002', { method: 'DELETE' })).status, 400);
  assert.deepEqual(store.read(), data);
});

test('invoice HTTP save retries commit one encrypted transaction and reject overselling', async t => {
  const { request, store, config } = await runningApp(t);
  const stock = [{ id: 'ring', item: 'Gold Ring', purity: '22K', qty: 10, gross: 100, net: 90 }];
  store.write({ [StorageKey.STOCK]: stock, 'invoice-counter': 1, unrelated: true });
  const input = {
    requestId: crypto.randomUUID(), number: 'VJ000001', status: 'completed', invoiceDate: '2026-10-26', customer: 'HTTP Test',
    items: [{ lineId: 'one', stockId: 'ring', name: 'Gold Ring', purity: '22K', gross: 10, net: 9, pcs: 4, rate: 1000, making: 10 }],
    exchanges: [{ metal: 'gold', weight: 0, rate: 0 }], manualDiscount: 0, paid: 10000, gstRate: 3, expectedTotal: 10197
  };
  const post = value => request('/api/invoices', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(value) });
  const responses = await Promise.all([post(input), post(input)]);
  for (const response of responses) assert.equal(response.status, 200);
  const saved = store.read();
  assert.equal(saved[StorageKey.INVOICES].length, 1);
  assert.equal(saved[StorageKey.INVOICES][0].due, 197);
  assert.deepEqual(saved[StorageKey.STOCK][0], { ...stock[0], qty: 6, gross: 90, net: 81 });
  assert.equal(saved['invoice-counter'], 2);
  const encrypted = JSON.parse(fs.readFileSync(config.dataFile, 'utf8'));
  assert.equal(encrypted.algorithm, 'aes-256-gcm');
  const failed = await post({ ...input, requestId: crypto.randomUUID(), number: 'VJ000002', items: [{ ...input.items[0], pcs: 7 }] });
  assert.equal(failed.status, 409);
  assert.deepEqual(store.read(), saved);
});

test('invoice revision HTTP endpoint preserves counter and rejects stale, missing and invalid edits', async t => {
  const { request, store } = await runningApp(t);
  const record = { number: 'VJ000003', total: 100, paid: 10, initialPaid: 10, due: 90, status: 'completed', weightMode: 'line-total', soldItems: [{ stockId: 'ring', name: 'Ring', purity: '22K', gross: 1, net: 1, pcs: 1 }] };
  store.write({ [StorageKey.INVOICES]: [record], [StorageKey.STOCK]: [{ id: 'ring', item: 'Ring', purity: '22K', qty: 1, gross: 1, net: 1 }], 'invoice-counter': 4 });
  const snapshot = await (await request('/api/records')).json();
  const input = { version: snapshot.versions.VJ000003, customer: 'Revised Customer', invoiceDate: '2026-10-26', items: [{ stockId: 'ring', name: 'Ring', purity: '22K', gross: 2, net: 2, pcs: 2, rate: 100, making: 0 }], exchanges: [], paid: 50, manualDiscount: 0, gstRate: 0, expectedTotal: 200 };
  const put = (number, body) => request('/api/invoices/' + number, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  assert.equal((await put(record.number, { ...input, customer: '' })).status, 400);
  const response = await put(record.number, input);
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.record.due, 150); assert.equal(result.record.paid, 50);
  assert.equal(store.read()['invoice-counter'], 4);
  assert.equal(store.read()[StorageKey.STOCK][0].qty, 0);
  const after = store.read();
  assert.equal((await put(record.number, input)).status, 409);
  assert.equal((await put('missing', input)).status, 404);
  assert.deepEqual(store.read(), after);
});

test('void HTTP endpoint checks revision and reason, commits reversals, and never voids twice', async t => {
  const { request, store } = await runningApp(t);
  const record = { number: 'VJ000004', status: 'completed', weightMode: 'line-total', paid: 50, total: 100, due: 50, soldItems: [{ stockId: 'ring', name: 'Ring', pcs: 2, gross: 3, net: 2 }] };
  store.write({ [StorageKey.INVOICES]: [record], [StorageKey.STOCK]: [{ id: 'ring', qty: 1, gross: 1, net: 1 }], [StorageKey.OLD_METAL]: [{ sourceId: 'exchange', invoice: record.number, source: 'Invoice exchange', metal: 'gold', weight: 1, value: 100 }], 'invoice-counter': 5 });
  const snapshot = await (await request('/api/records')).json();
  const input = { version: snapshot.versions[record.number], reason: 'Customer cancelled' };
  const post = (number, body) => request('/api/invoices/' + number + '/void', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const before = store.read();
  assert.equal((await post(record.number, { ...input, reason: '' })).status, 400);
  assert.equal((await post(record.number, { ...input, version: 'stale' })).status, 409);
  assert.equal((await post('missing', input)).status, 404);
  assert.deepEqual(store.read(), before);
  const response = await post(record.number, input); assert.equal(response.status, 200);
  const result = await response.json(); assert.equal(result.record.status, 'voided'); assert.equal(result.record.due, 0);
  const after = store.read(); assert.deepEqual(after[StorageKey.STOCK], [{ id: 'ring', qty: 3, gross: 4, net: 3 }]);
  assert.equal(after[StorageKey.OLD_METAL].length, 2); assert.equal(after['invoice-counter'], 5);
  assert.equal((await post(record.number, input)).status, 409);
  assert.equal((await post(record.number, { ...input, version: result.version })).status, 409);
  assert.deepEqual(store.read(), after);
});

test('backup download and restore retain encryption and reject a mismatched key', async t => {
  const { request, config, store } = await runningApp(t);
  store.write({ [StorageKey.PURCHASES]: [{ amount: 100 }] });
  const backup = await (await request('/api/backup/download')).json();
  assert.equal(backup.encryptedStore.algorithm, 'aes-256-gcm');
  store.write({ [StorageKey.PURCHASES]: [{ amount: 200 }] });
  const restore = await request('/api/backup/restore', { method: 'POST', body: JSON.stringify(backup) });
  assert.equal(restore.status, 200);
  assert.equal(store.read()[StorageKey.PURCHASES][0].amount, 100);
  assert.ok(fs.readdirSync(config.backupDir).some(name => name.includes('Before-Restore')));
  const otherConfig = fixture(t).config;
  const otherStore = createJsonStore(otherConfig.dataFile, { encryptionKey: otherConfig.encryptionKey });
  otherStore.write({ unrelated: true });
  const invalidBackup = new BackupService(otherConfig).createPayload();
  const before = fs.readFileSync(config.dataFile, 'utf8');
  assert.equal((await request('/api/backup/restore', { method: 'POST', body: JSON.stringify(invalidBackup) })).status, 400);
  assert.equal(fs.readFileSync(config.dataFile, 'utf8'), before);
  assert.equal((await request('/api/backup/restore', { method: 'POST', body: '{}' })).status, 400);
  assert.ok((await (await request('/api/backup-status')).json()).latest);
});

test('weekly backup scheduling is idempotent and handles an ISO year boundary', t => {
  const { config } = fixture(t);
  const store = createJsonStore(config.dataFile, { encryptionKey: config.encryptionKey });
  store.migrate();
  const backups = new BackupService(config, { now: () => new Date('2021-01-01T12:00:00Z') });
  backups.createWeekly();
  backups.createWeekly();
  assert.equal(isoWeekStamp(new Date('2021-01-01T12:00:00Z')), '2020-53');
  assert.equal(fs.readdirSync(config.backupDir).length, 1);
});

test('rates cache, manual refresh, expiration, and unavailable HTTP response', async t => {
  let calls = 0;
  let time = 0;
  const rates = new MetalRatesService({ now: () => time, parse: text => ({ text }), fetchRates: async () => ({ ok: true, text: async () => String(++calls) }) });
  assert.deepEqual(await rates.getRates(), { text: '1' });
  assert.deepEqual(await rates.getRates(), { text: '1' });
  assert.deepEqual(await rates.getRates(true), { text: '2' });
  time = 60_001;
  assert.deepEqual(await rates.getRates(), { text: '3' });
  const { request } = await runningApp(t, { rates: { getRates: async () => { throw new Error('offline'); } } });
  assert.equal((await request('/api/live-rates')).status, 503);
});

test('dashboard keeps cash, expenses, purchases, and metal settlements separate', () => {
  const summary = calculateDashboard(
    [{ status: 'completed', total: 12000, paid: 10000, due: 2000, weightMode: 'line-total', soldItems: [{ pcs: 4, net: 10, rate: 1000 }], payments: [{ method: 'gold', amount: 2000 }] }],
    [{ amount: 1000 }], [{ type: 'amount', amount: 500 }, { type: 'self-expense', amount: 200 }], []
  );
  assert.equal(summary.gold.sold, 10);
  assert.equal(summary.collected, 8000);
  assert.equal(summary.afterPayment, 6300);
});

test('dashboard API preserves legacy summaries and filters without changing saved data', async t => {
  const { request, store, config } = await runningApp(t);
  const data = {
    [StorageKey.INVOICES]: [
      { number: 'TEST1', status: 'completed', invoiceDate: '2026-10-01', savedAt: '2026-10-01T12:00:00Z', total: 12000, paid: 10000, due: 2000, weightMode: 'line-total', soldItems: [{ pcs: 4, net: 10, rate: 1000 }], payments: [{ method: 'amount', amount: 8000, settledAt: '2026-10-01T12:00:00Z' }, { method: 'gold', amount: 2000, settledAt: '2026-10-03T12:00:00Z' }] },
      { number: 'TEST2', status: 'pending', invoiceDate: '2026-09-01', savedAt: '2026-09-01T12:00:00Z', total: 2000, paid: 500, due: 1500, payments: [] }
    ],
    [StorageKey.PURCHASES]: [{ amount: 1000, savedAt: '2026-10-02T12:00:00Z' }],
    [StorageKey.PAYMENTS]: [{ type: 'self-expense', amount: 200, savedAt: '2026-10-03T12:00:00Z' }],
    [StorageKey.OLD_METAL]: [{ metal: 'gold', weight: 2, value: 2000, source: 'Gold settlement', receivedAt: '2026-10-03T12:00:00Z' }],
    [StorageKey.STOCK]: [{ purity: '22K', net: 9, gross: 10, qty: 4 }, { purity: 'Silver', net: 100, gross: 105, qty: 2 }]
  };
  store.write(data);
  const before = fs.readFileSync(config.dataFile, 'utf8');
  for (const range of [{}, { from: '2026-10-01', to: '2026-10-31' }]) {
    const result = await (await request('/api/dashboard?' + new URLSearchParams(range))).json();
    assert.deepEqual(result.summary, calculateDashboard(data[StorageKey.INVOICES], data[StorageKey.PURCHASES], data[StorageKey.PAYMENTS], data[StorageKey.OLD_METAL], range));
    assert.deepEqual(result.fresh, { gold: 9, silver: 100 });
    assert.deepEqual(result.old, { gold: 2, silver: 0 });
  }
  for (const query of ['from=2026-02-30', 'from=invalid', 'from=2026-10-31&to=2026-10-01']) {
    assert.equal((await request('/api/dashboard?' + query)).status, 400);
  }
  assert.equal(fs.readFileSync(config.dataFile, 'utf8'), before);
});

test('React is default for browser and desktop entry points; explicit legacy remains available', async t => {
  const { request } = await runningApp(t);
  for (const route of ['/', '/index.html', '/?frontend=react']) {
    const response = await request(route);
    assert.equal(response.status, 200);
    const page = await response.text();
    assert.ok(page.includes('id="react-navigation"'), route);
    assert.ok(page.includes('id="react-dashboard"'), route);
    assert.ok(page.includes('id="react-pin-lock"'), route);
  }
  const legacy = await (await request('/?frontend=legacy')).text();
  assert.ok(!legacy.includes('id="react-dashboard"'));
  assert.ok(legacy.includes("const renderDashboard = async (forceLiveRates"));
  const preview = await request('/?frontend=react');
  assert.equal(preview.status, 200);
  const html = await preview.text();
  assert.ok(html.includes('id="react-dashboard"'));
  assert.ok(html.includes('id="react-stocks"'));
  assert.ok(html.includes('id="react-purchases"'));
  assert.ok(html.includes('id="react-payments"'));
  assert.ok(html.includes('id="react-settings"'));
  assert.ok(html.includes('id="react-records"'));
  assert.ok(html.includes('id="react-invoice-exchange"'));
  assert.ok(html.includes('id="react-invoice-details"'));
  assert.ok(html.includes('id="legacy-invoice-details" hidden'));
  assert.ok(html.includes('window.vjInvoiceDetails ='));
  assert.ok(!legacy.includes('id="react-invoice-details"'));
  assert.ok(html.includes('const getExchangeEntries = () => window.vjInvoiceExchangeEntries'));
  assert.ok(html.includes('const saveInvoiceThroughApi = async status'));
  assert.ok(html.includes('data-react-invoice-items="true"'));
  assert.ok(html.includes('window.vjInvoiceItems ='));
  assert.ok(html.includes('id="react-invoice-preview"'));
  assert.ok(html.includes('window.vjInvoicePreviewSource ='));
  assert.ok(!html.includes("document.getElementById('p-items-body').innerHTML ="));
  assert.ok(!html.includes("document.getElementById('btnPrint').addEventListener"));
  assert.ok(!html.includes('const stockPickerMenu ='));
  assert.ok(legacy.includes('const stockPickerMenu ='));
  assert.ok(!html.includes('let pendingRecord = null'));
  assert.ok(!html.includes("await storeSet('stock-list', stockList);\n  renderStockTable(); renderStockStats();\n  saleCompleted = true;"));
  assert.ok(!html.includes("const getExchangeEntries = () => Array.from(exchangeRows.querySelectorAll"));
  assert.ok(!html.includes("document.getElementById('recordsTbody').addEventListener"));
  assert.ok(!html.includes('window.vjRecordAction'));
  assert.ok(legacy.includes('id="recordsTbody"'));
  assert.ok(legacy.includes("const getExchangeEntries = () => Array.from(exchangeRows.querySelectorAll"));
  assert.ok(!html.includes("document.getElementById('settingsChooseData').addEventListener"));
  assert.ok(!html.includes("document.getElementById('paymentForm').addEventListener"));
  assert.ok(!html.includes("document.getElementById('purchaseForm').addEventListener"));
  assert.ok(!html.includes('const stockItemInput ='));
  for (const script of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)) new vm.Script(script[1]);
  assert.ok(!html.includes("document.getElementById('dashboardRangeForm').addEventListener"));
  assert.ok(html.includes('id="react-navigation"'));
  const script = html.match(/type="module" src="([^\"]+)"/)[1];
  const asset = await request(script);
  assert.equal(asset.status, 200);
  assert.match(asset.headers.get('content-type'), /javascript/);
  await asset.arrayBuffer();
  assert.equal((await request('/frontend/assets/missing.js')).status, 404);
  assert.equal((await request('/frontend/assets/%2e%2e%2fstore.json')).status, 404);
});

test('record API rejects stale settlements and writes linked metal receipts', async t => {
  const { request, store } = await runningApp(t);
  store.write({ [StorageKey.INVOICES]: [{ number: 'VJTEST', total: 500, due: 500, paid: 0 }] });
  const snapshot = await (await request('/api/records')).json();
  const before = store.read();
  const saved = await request('/api/records/VJTEST?version=' + snapshot.versions.VJTEST);
  assert.equal(saved.status, 200);
  assert.equal((await saved.json()).record.due, 500);
  assert.deepEqual(store.read(), before);
  assert.equal((await request('/api/records/VJTEST?version=stale')).status, 409);
  assert.equal((await request('/api/records/missing')).status, 404);
  const input = { version: snapshot.versions.VJTEST, method: 'silver', weight: 2, rate: 50 };
  const options = { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input) };
  const response = await request('/api/records/VJTEST/settlements', options);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).record.due, 400);
  assert.equal(store.read()[StorageKey.OLD_METAL][0].weight, 2);
  assert.equal((await request('/api/records/VJTEST/settlements', options)).status, 409);
  assert.equal((await request('/api/records/missing/settlements', options)).status, 404);
});

test('Settings exposes browser capabilities and keeps desktop actions isolated', async t => {
  const { request, config } = await runningApp(t);
  assert.deepEqual(await (await request('/api/data-location')).json(), { path: config.dataDir, desktop: false });
  assert.equal((await request('/api/data-location', { method: 'POST' })).status, 400);
  assert.equal((await request('/api/backup/create', { method: 'POST' })).status, 400);
  const status = await (await request('/api/backup-status')).json();
  assert.equal(status.desktop, false);
  assert.match(status.latest, /Weekly/);
  const backup = await request('/api/backup/download');
  assert.match(backup.headers.get('content-disposition'), /attachment.*\.json/);
  const payload = await backup.json();
  assert.equal(payload.encryptedStore.algorithm, 'aes-256-gcm');
  assert.equal(payload.encryptionKey, undefined);
  const messages = [];
  const desktopApp = await runningApp(t, { desktop: { enabled: true, send: message => messages.push(message) } });
  assert.equal((await desktopApp.request('/api/backup/download')).status, 400);
  assert.equal((await desktopApp.request('/api/backup/create', { method: 'POST' })).status, 202);
  assert.equal(messages[0].type, DesktopMessage.CREATE_BACKUP);
});

test('transaction HTTP endpoints preserve storage and dashboard contracts', async t => {
  const { request, store } = await runningApp(t);
  const send = (path, method, body) => request(path, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  let response = await send('/api/purchases', 'POST', { metal: 'gold', weight: 100, rate: 10 });
  assert.equal(response.status, 200);
  const purchase = await response.json();
  response = await send('/api/payments', 'POST', { type: 'metal', metal: 'gold', weight: 40, purity: 50 });
  assert.equal(response.status, 200);
  const payment = await response.json();
  assert.equal(payment.items[0].fineWeight, 20);
  assert.equal((await (await request('/api/dashboard')).json()).old.gold, 60);
  assert.equal((await send('/api/purchases/' + purchase.items[0].id, 'DELETE', { version: purchase.versions[purchase.items[0].id] })).status, 400);
  response = await send('/api/payments/' + payment.items[0].id, 'PUT', { type: 'amount', amount: 200, version: payment.versions[payment.items[0].id] });
  assert.equal(response.status, 200);
  const edited = await response.json();
  assert.equal(edited.balances.gold, 100);
  const dashboard = await (await request('/api/dashboard')).json();
  assert.equal(dashboard.summary.afterPayment, -1200);
  assert.equal((await send('/api/payments/' + payment.items[0].id, 'DELETE', { version: edited.versions[payment.items[0].id] })).status, 200);
  assert.equal((await send('/api/purchases/' + purchase.items[0].id, 'DELETE', { version: purchase.versions[purchase.items[0].id] })).status, 200);
  assert.deepEqual(store.read()[StorageKey.OLD_METAL], []);
  assert.deepEqual((await (await request('/api/payments')).json()).items, []);
  assert.equal((await send('/api/purchases', 'POST', { metal: 'gold' })).status, 400);
});

test('stock API adds batches by ID, validates totals, rejects stale edits, and retains other data', async t => {
  const { request, store } = await runningApp(t);
  store.write({ unrelated: { keep: true } });
  const call = (url, method, body) => request(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const input = { item: 'Ring', purity: '22K', qty: 10, gross: 100, net: 100 };
  let result = await (await call('/api/stocks', 'POST', input)).json();
  const id = result.items[0].id;
  const version = result.versions[id];
  result = await (await call(`/api/stocks/${id}/batches`, 'POST', { qty: 5, gross: 200, net: 200, version })).json();
  assert.equal(result.items[0].qty, 15);
  assert.equal(result.items[0].gross, 300);
  assert.equal(result.items[0].net, 300);
  assert.equal((await call(`/api/stocks/${id}`, 'PUT', { ...input, version })).status, 409);
  const before = store.read();
  for (const invalid of [{ item: '' }, { purity: 'invalid' }, { qty: 1.2 }, { qty: 0 }, { gross: 0 }, { net: 101 }]) {
    assert.equal((await call('/api/stocks', 'POST', { ...input, ...invalid })).status, 400);
    assert.deepEqual(store.read(), before);
  }
  for (let i = 0; i < 20; i++) assert.equal((await call('/api/stocks', 'POST', input)).status, 200);
  result = await (await request('/api/stocks')).json();
  assert.equal(result.items.length, 21);
  result = await (await call(`/api/stocks/${id}`, 'PUT', { ...input, purity: 'Silver', version: result.versions[id] })).json();
  assert.equal(result.items[0].purity, 'Silver');
  assert.equal(result.items[0].added, before[StorageKey.STOCK][0].added);
  assert.equal((await call(`/api/stocks/${id}`, 'DELETE', { version: result.versions[id] })).status, 200);
  assert.equal((await call(`/api/stocks/${id}`, 'DELETE', { version })).status, 404);
  assert.equal(store.read()[StorageKey.STOCK].length, 20);
  assert.deepEqual(store.read().unrelated, { keep: true });
  const legacy = await (await request('/api/storage/stock-list')).json();
  assert.deepEqual(JSON.parse(legacy.value), store.read()[StorageKey.STOCK]);
});

test('desktop server starts on an available port and preserves Electron IPC messages', { timeout: 15000 }, async t => {
  const { config } = fixture(t);
  const child = fork(path.join(__dirname, '..', 'server.js'), [], {
    env: { ...process.env, PORT: '0', HOST: '127.0.0.1', DATA_DIR: config.dataDir, BACKUP_DIR: config.backupDir, DATA_ENCRYPTION_KEY: config.encryptionKey },
    stdio: ['ignore', 'ignore', 'pipe', 'ipc']
  });
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) { child.kill(); await once(child, 'exit'); }
  });
  const [message] = await once(child, 'message');
  assert.equal(message.type, DesktopMessage.READY);
  assert.match(message.url, /^http:\/\/127\.0\.0\.1:\d+$/);
  assert.equal((await fetch(message.url)).status, 200);
  for (const [endpoint, type] of [['/api/data-location', DesktopMessage.CHOOSE_LOCATION], ['/api/backup/create', DesktopMessage.CREATE_BACKUP], ['/api/backup/restore', DesktopMessage.RESTORE_BACKUP]]) {
    const notification = once(child, 'message');
    assert.equal((await fetch(message.url + endpoint, { method: 'POST' })).status, 202);
    assert.equal((await notification)[0].type, type);
  }
  assert.equal(fs.existsSync(config.backupDir), false);
});
