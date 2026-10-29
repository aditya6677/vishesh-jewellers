'use strict';
// Runs ONLY disposable data against the actual packaged backend/modules.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { createRequire } = require('node:module');
const { fork } = require('node:child_process');
const { once } = require('node:events');
const { randomBytes, randomUUID } = require('node:crypto');

async function check(root) {
  if (!root || !path.isAbsolute(root) || !fs.existsSync(path.join(root, 'server.js'))) throw new Error('Pass the absolute packaged app.asar.unpacked directory.');
  const packaged = createRequire(path.join(root, 'server.js'));
  const { openDatabase } = packaged('./lib/database/database');
  const { importSnapshot } = packaged('./lib/database/snapshot-migration');
  const { restorePortableBackup } = packaged('./lib/database/portable-backup');
  assert.ok(packaged.resolve('better-sqlite3-multiple-ciphers').startsWith(path.join(root, 'node_modules') + path.sep));
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vj-packaged-database-'));
  const file = path.join(directory, 'store.db'), key = randomBytes(32);
  let child, recoveredKey;
  async function stop() {
    if (!child) return;
    const processToStop = child; child = null;
    if (processToStop.exitCode === null && processToStop.signalCode === null) { const exited = once(processToStop, 'exit'); processToStop.kill(); await exited; }
  }
  async function start(databaseFile, databaseKey) {
    let stderr = '';
    const env = { ...process.env, NODE_PATH: '', DATA_BACKEND: 'sqlite', DATABASE_FILE: databaseFile, DATABASE_KEY: undefined, DATABASE_KEY_FILE: undefined, DATA_ENCRYPTION_KEY: undefined, VJ_DATABASE_KEY_IPC: '1', ACCOUNTS_ENABLED: '1', LICENSING_ENABLED: '1', STORE_ID: 'main', PORT: '0', HOST: '127.0.0.1', BACKUP_DIR: path.join(directory, 'backups'), SOURCE_HTML: path.join(root, 'source/index.html') };
    child = fork(path.join(root, 'server.js'), [], { cwd: root, silent: true, serialization: 'advanced', env });
    child.stderr.on('data', chunk => { stderr += chunk.toString(); });
    const ready = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Packaged database startup timed out. ' + stderr)), 30000);
      child.on('message', message => { if (message?.type === 'server-ready') { clearTimeout(timer); resolve(message.url); } });
      child.once('error', error => { clearTimeout(timer); reject(error); });
      child.once('exit', code => { clearTimeout(timer); reject(new Error('Packaged database exited (' + code + '). ' + stderr)); });
    });
    child.send({ type: 'protected-database-key', key: databaseKey });
    return ready;
  }
  try {
    const db = openDatabase(file, key, { create: true });
    importSnapshot(db, { 'stock-list': [], 'invoice-records': [], 'old-gold-records': [], 'purchase-records': [], 'payment-records': [], 'invoice-counter': 1 }, { storeId: 'main', sourceSha256: 'a'.repeat(64), acknowledgeLegacy: true }); db.close();
    let base = await start(file, key), cookie = '';
    const request = (url, method = 'GET', body) => fetch(base + url, { method, headers: { cookie, 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(30000) });
    const json = async (url, method = 'GET', body) => { const response = await request(url, method, body); const value = await response.json(); assert.equal(response.status, 200, value.error || url); return value; };
    const credentials = { username: 'acceptance-admin', name: 'Disposable desktop acceptance', password: 'Disposable desktop acceptance password!', confirmPassword: 'Disposable desktop acceptance password!' };
    async function login() { const response = await request('/api/auth/login', 'POST', credentials); const value = await response.json(); assert.equal(response.status, 200, value.error); cookie = response.headers.get('set-cookie').split(';')[0]; }
    assert.equal((await request('/api/dashboard')).status, 401);
    const setup = await json('/api/auth/status');
    assert.equal(setup.setupRequired, true);
    credentials.legalAcceptance = { accepted: true, acceptanceVersion: setup.legal.acceptanceVersion, documentHash: setup.legal.documentHash };
    await json('/api/auth/setup', 'POST', credentials); await login();
    const legal = await json('/api/legal');
    assert.equal(legal.accepted, true); assert.equal(legal.acceptance.username, credentials.username);
    const trial = await json('/api/license'); assert.equal(trial.state, 'trial'); assert.equal(trial.daysRemaining, 14);
    assert.equal(trial.activationConfigured, true, 'The vendor public verification key must be bundled.');
    const page = await request('/'); const html = await page.text(); assert.equal(page.status, 200); assert.ok(html.includes('window.vjAccountSession='));
    const module = /type="module" src="([^\"]+)"/.exec(html)[1];
    for (const url of [module, '/vendor/html2canvas.min.js', '/vendor/jspdf.umd.min.js', '/vendor/fonts/jost-latin-400-normal.woff2', '/assets/vishesh-jewellers-logo.png']) { const response = await request(url); assert.equal(response.status, 200, url); assert.ok((await response.arrayBuffer()).byteLength > 0); }
    const stock = await json('/api/stocks', 'POST', { item: 'Acceptance Ring', purity: '22K', qty: 10, gross: 100, net: 90 });
    const stockId = stock.items[0].id;
    const line = { stockId, name: 'Acceptance Ring', purity: '22K', gross: 10, net: 9, pcs: 4, rate: 100, making: 0 };
    const sale = { requestId: randomUUID(), number: 'VJ000001', status: 'completed', customer: 'Disposable acceptance customer', invoiceDate: '2026-10-29', items: [line], exchanges: [{ metal: 'gold', weight: .1, rate: 1000 }], manualDiscount: 20, paid: 300, gstRate: 3, expectedTotal: 807 };
    const created = await json('/api/invoices', 'POST', sale); assert.equal(created.record.due, 507);
    const detail = await json('/api/records/VJ000001');
    const settled = await json('/api/records/VJ000001/settlements', 'POST', { version: detail.version, method: 'amount', amount: 100 });
    assert.equal(settled.record.paid, 400); assert.equal(settled.record.due, 407);
    const before = await json('/api/dashboard');
    const recoveryPassphrase = 'Disposable packaged recovery passphrase!';
    const backup = await json('/api/database-backup/portable', 'POST', { passphrase: recoveryPassphrase });
    const name = path.basename(backup.path);
    const edited = await json('/api/invoices/VJ000001', 'PUT', { ...sale, version: settled.version, items: [{ ...line, pcs: 2, gross: 5, net: 4.5 }], expectedTotal: 344 });
    assert.equal(edited.record.paid, 400); assert.equal(edited.record.due, 0);
    const voided = await json('/api/invoices/VJ000001/void', 'POST', { version: edited.version, reason: 'Disposable desktop acceptance' });
    await json('/api/invoices/VJ000001', 'DELETE'); assert.equal((await json('/api/records')).items.length, 0);
    assert.equal((await json('/api/stocks/' + stockId)).item.qty, 10);
    assert.equal((await json('/api/license')).invoicesIssued, 1);
    assert.equal((await json('/api/database-backup/verify', 'POST', { name, passphrase: recoveryPassphrase })).verified, true);
    const prepared = await json('/api/database-backup/prepare', 'POST', { name, passphrase: recoveryPassphrase });
    await json('/api/database-backup/activate', 'POST', { token: prepared.token, confirmation: 'RESTORE' });
    assert.equal((await request('/api/dashboard')).status, 401); await login();
    assert.deepEqual(await json('/api/dashboard'), before);
    assert.equal((await json('/api/records/VJ000001')).record.paid, 400);
    await stop(); base = await start(file, key);
    assert.equal((await request('/api/dashboard')).status, 401); await login();
    assert.deepEqual(await json('/api/dashboard'), before);
    assert.equal((await json('/api/license')).installationId, trial.installationId);
    await stop();
    const recovered = await restorePortableBackup(backup.path, recoveryPassphrase, path.join(directory, 'fresh-installation.db')); recoveredKey = recovered.key;
    base = await start(path.join(directory, 'fresh-installation.db'), recoveredKey); cookie = '';
    assert.equal((await json('/api/auth/status')).setupRequired, false); await login();
    assert.equal((await json('/api/legal')).accepted, true);
    assert.deepEqual(await json('/api/dashboard'), before);
    assert.equal((await json('/api/license')).installationId, trial.installationId);
    const remaining = (await json('/api/stocks/' + stockId)).item;
    assert.equal(remaining.qty, 6); assert.equal(remaining.gross, 90); assert.equal(remaining.net, 81);
    console.log(JSON.stringify({ verified: true, packagedRoot: root, protectedKeyIPC: true, productionDatabaseDriver: true, setupAndLogin: true, trialAndVerificationKey: true, saleSettlementEditVoidDelete: true, backupRestoreParity: true, restartPersistence: true, freshInstallationRecovery: true, businessDataTouched: false, nativeDesktopWindowTested: false }));
  } finally { await stop(); key.fill(0); recoveredKey?.fill(0); fs.rmSync(directory, { recursive: true, force: true }); }
}
if (require.main === module) check(process.argv[2]).catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { check };
