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
  for (const route of ['/', '/index.html', '/assets/vishesh-jewellers-logo.png', '/manifest.webmanifest', '/service-worker.js']) {
    const response = await request(route);
    assert.equal(response.status, 200, route);
    await response.arrayBuffer();
  }
  assert.equal((await request('/unknown')).status, 404);
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

test('React preview owns only dashboard and serves built assets; original remains available', async t => {
  const { request } = await runningApp(t);
  const legacy = await (await request('/?frontend=legacy')).text();
  assert.ok(!legacy.includes('id="react-dashboard"'));
  assert.ok(legacy.includes("const renderDashboard = async (forceLiveRates"));
  const preview = await request('/?frontend=react');
  assert.equal(preview.status, 200);
  const html = await preview.text();
  assert.ok(html.includes('id="react-dashboard"'));
  assert.ok(!html.includes("document.getElementById('dashboardRangeForm').addEventListener"));
  assert.ok(html.includes("const openRecords = async"));
  const script = html.match(/type="module" src="([^\"]+)"/)[1];
  const asset = await request(script);
  assert.equal(asset.status, 200);
  assert.match(asset.headers.get('content-type'), /javascript/);
  await asset.arrayBuffer();
  assert.equal((await request('/frontend/assets/missing.js')).status, 404);
  assert.equal((await request('/frontend/assets/%2e%2e%2fstore.json')).status, 404);
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
