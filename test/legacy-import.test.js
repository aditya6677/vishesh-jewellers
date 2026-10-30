'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomBytes } = require('node:crypto');
const { openDatabase } = require('../lib/database/database');
const { importSnapshot, readSnapshot } = require('../lib/database/snapshot-migration');
const { DatabaseQueries } = require('../lib/database/queries');
const { LegacyImportService, prepare, portable, unlock } = require('../lib/services/legacy-import-service');
const { createJsonStore } = require('../lib/json-store');
const { readLegacySource } = require('../lib/legacy-desktop-source');

const source = () => ({
  'business-info': { name: 'Synthetic older shop' },
  'stock-list': [{ id: 'stock', item: 'Existing pure gold', purity: '24K', qty: 4, gross: 40, net: 40 }],
  'invoice-records': [{ number: 'VJ000009', status: 'completed', weightMode: 'line-total', invoiceDate: '2026-10-30', savedAt: '2026-10-30T08:00:00Z', total: 1000, paid: 600, due: 400, payments: [{ method: 'amount', amount: 600, settledAt: '2026-10-30T08:00:00Z' }], soldItems: [{ stockId: 'stock', purity: '24K', net: 1, gross: 1, pcs: 1, rate: 1000, making: 0 }] }],
  'purchase-records': [], 'payment-records': [], 'old-gold-records': [], 'invoice-counter': 1,
  'user-accounts': { unsafe: 'Must not import' }, 'license': { unsafe: 'Must not import' }
});
function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'karatdesk-legacy-import-'));
  const key = randomBytes(32), file = path.join(directory, 'target.db');
  const db = openDatabase(file, key, { create: true });
  t.after(async () => { if (runtime.testApp) { runtime.testApp.server.closeAllConnections(); await runtime.testApp.close(); } if (db.open) db.close(); key.fill(0); fs.rmSync(directory, { recursive: true, force: true }); });
  importSnapshot(db, { 'business-info': { name: 'Destination' }, 'stock-list': [], 'invoice-records': [], 'payment-records': [], 'purchase-records': [], 'old-gold-records': [], 'invoice-counter': 1 }, { storeId: 'main', sourceSha256: 'a'.repeat(64), acknowledgeLegacy: true });
  db.exec('CREATE TABLE security_test(id INTEGER PRIMARY KEY, payload TEXT)');
  db.prepare('INSERT INTO security_test VALUES(1,?)').run('Existing accounts and licence');
  const runtime = { db, databaseKey: key, databaseFile: file, storeId: 'main', query: new DatabaseQueries(db, 'main'), backups: { directory: path.join(directory, 'backups') }, assertAvailable() {} };
  return { db, directory, runtime, service: new LegacyImportService(runtime) };
}
test('legacy import previews without writes, verifies records/totals, preserves security and blocks repetition', async t => {
  const f = fixture(t), before = readSnapshot(f.db, 'main');
  const preview = f.service.preview({ snapshot: source() });
  assert.deepEqual(readSnapshot(f.db, 'main'), before);
  assert.equal(preview.nextInvoice, 'VJ000010');
  assert.equal(preview.summary.summary.collected, 600);
  assert.deepEqual(preview.ignoredKeys.sort(), ['license', 'user-accounts']);
  const result = await f.service.commit({ token: preview.token, confirmation: 'IMPORT', acknowledgeLegacy: true });
  assert.equal(result.verified, true);
  assert.ok(fs.existsSync(path.join(f.runtime.backups.directory, result.safetyBackup)));
  const after = readSnapshot(f.db, 'main');
  assert.deepEqual(after['invoice-records'], source()['invoice-records']);
  assert.equal(after['stock-list'][0].purity, '24K');
  assert.equal(after['invoice-counter'], 10);
  assert.equal(after['user-accounts'], undefined);
  assert.equal(after.license, undefined);
  assert.equal(f.db.prepare('SELECT payload FROM security_test').get().payload, 'Existing accounts and licence');
  assert.equal(f.runtime.query.dashboard().summary.due, 400);
  assert.equal(f.runtime.query.dashboard().fresh.fineGold, 0);
  assert.throws(() => f.service.preview({ snapshot: source() }), /empty store/);
  await assert.rejects(() => f.service.commit({ token: preview.token, confirmation: 'IMPORT', acknowledgeLegacy: true }), /Preview expired/);
});
test('legacy import rejects malformed data, expired previews, missing confirmation and concurrent destination changes', async t => {
  const f = fixture(t);
  assert.throws(() => prepare({ ...source(), 'stock-list': [{ ...source()['stock-list'][0], net: -1 }] }), /validation/);
  const preview = f.service.preview({ snapshot: source() });
  await assert.rejects(() => f.service.commit({ token: preview.token, confirmation: 'wrong', acknowledgeLegacy: true }), /type IMPORT/);
  f.service.staged.expires = 0;
  await assert.rejects(() => f.service.commit({ token: preview.token, confirmation: 'IMPORT', acknowledgeLegacy: true }), /expired/);
  const next = f.service.preview({ snapshot: source() });
  f.db.prepare('INSERT INTO documents VALUES(?,?,?,?,?)').run('main', 'stock-list', 0, 'new', JSON.stringify({ id: 'new', item: 'New', purity: '22K', qty: 1, gross: 1, net: 1 }));
  await assert.rejects(() => f.service.commit({ token: next.token, confirmation: 'IMPORT', acknowledgeLegacy: true }), /empty store/);
});
test('failed legacy import rolls back every business write and leaves a safety backup', async t => {
  const f = fixture(t), before = readSnapshot(f.db, 'main');
  const preview = f.service.preview({ snapshot: source() });
  f.db.exec("CREATE TRIGGER reject_legacy BEFORE INSERT ON documents WHEN NEW.collection='invoice-records' BEGIN SELECT RAISE(ABORT,'Synthetic failure'); END");
  await assert.rejects(() => f.service.commit({ token: preview.token, confirmation: 'IMPORT', acknowledgeLegacy: true }), /Synthetic failure/);
  assert.deepEqual(readSnapshot(f.db, 'main'), before);
  assert.equal(fs.readdirSync(f.runtime.backups.directory).length, 1);
});
test('portable legacy files authenticate contents/passphrase and do not contain plaintext records', () => {
  const envelope = portable(source(), 'Synthetic passphrase 123!');
  assert.doesNotMatch(JSON.stringify(envelope), /Synthetic older shop/);
  assert.deepEqual(unlock(envelope, 'Synthetic passphrase 123!'), source());
  assert.throws(() => unlock(envelope, 'wrong password'), /Could not unlock/);
  assert.throws(() => unlock({ ...envelope, tag: randomBytes(16).toString('base64') }, 'Synthetic passphrase 123!'), /Could not unlock/);
});
test('legacy migration permission is enforced for preview, commit and status', () => {
  const { requiredPermissions } = require('../lib/security/http-accounts');
  for (const action of ['status', 'preview', 'commit']) assert.deepEqual(requiredPermissions(action === 'status' ? 'GET' : 'POST', '/api/legacy-import/' + action), ['settings.restore']);
});
test('native legacy file selection decrypts matching existing key without changing original files', async t => {
  const f = fixture(t), file = path.join(f.directory, 'store.json'), keyFile = path.join(f.directory, 'data-key.bin');
  const key = randomBytes(32).toString('base64');
  const safeStorage = { decryptString: value => value.toString('utf8') };
  fs.writeFileSync(keyFile, Buffer.from(key).toString('base64'));
  createJsonStore(file, { encryptionKey: key }).write(source());
  const original = fs.readFileSync(file), originalKey = fs.readFileSync(keyFile);
  const dialog = { showOpenDialog: async () => ({ canceled: false, filePaths: [file] }) };
  assert.deepEqual(await readLegacySource({ dialog, safeStorage, keyFile }), source());
  assert.deepEqual(fs.readFileSync(file), original);
  assert.deepEqual(fs.readFileSync(keyFile), originalKey);
});
test('legacy migration HTTP workflow previews portable data, commits atomically and exposes refreshed dashboard', async t => {
  const f = fixture(t);
  f.db.close();
  const { createApplication } = require('../lib/app');
  const { createConfig } = require('../lib/config');
  const { once } = require('node:events');
  const app = createApplication({ config: createConfig({ DATA_BACKEND: 'sqlite', DATABASE_FILE: f.runtime.databaseFile, DATABASE_KEY: f.runtime.databaseKey.toString('base64'), BACKUP_DIR: f.runtime.backups.directory, PORT: '0' }), desktop: { enabled: false } });
  f.runtime.testApp = app;
  await app.initialize(); app.server.listen(0, '127.0.0.1'); await once(app.server, 'listening');
  const base = 'http://127.0.0.1:' + app.server.address().port;
  const request = (url, input) => fetch(base + url, { method: input ? 'POST' : 'GET', headers: { 'content-type': 'application/json' }, ...(input ? { body: JSON.stringify(input) } : {}) });
  assert.equal((await (await request('/api/legacy-import/status')).json()).available, true);
  const response = await request('/api/legacy-import/preview', { portable: portable(source(), 'Synthetic import passphrase'), passphrase: 'Synthetic import passphrase' });
  assert.equal(response.status, 200);
  const preview = await response.json();
  const committed = await request('/api/legacy-import/commit', { token: preview.token, confirmation: 'IMPORT', acknowledgeLegacy: true });
  assert.equal(committed.status, 200);
  assert.equal((await committed.json()).verified, true);
  const dashboard = await (await request('/api/dashboard')).json();
  assert.equal(dashboard.summary.collected, 600);
  assert.equal(dashboard.summary.due, 400);
  assert.equal(dashboard.fresh.gold, 40);
  assert.equal((await (await request('/api/legacy-import/status')).json()).available, false);
});
