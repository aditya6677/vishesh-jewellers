'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { randomUUID, createHash } = require('node:crypto');
const { provisionStore, readInstallation } = require('../lib/database/first-run');
const { desktopDatabaseKey } = require('../lib/database/desktop-key');
const { openDatabase } = require('../lib/database/database');
const { readSnapshot } = require('../lib/database/snapshot-migration');
const { StockRepository } = require('../lib/database/stock-repository');
const { InvoiceRepository } = require('../lib/database/invoice-repository');
const { TransactionRepository } = require('../lib/database/transaction-repository');
const { DatabaseQueries } = require('../lib/database/queries');
const { DashboardService } = require('../lib/services/dashboard-service');
const { createPortableBackup } = require('../lib/database/portable-backup');
const { activateRecovery } = require('../lib/database/startup-recovery');

async function setupRecoveryScenario(safeStorage, platform) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vj-full-recovery-check-'));
  const passphrase = 'Disposable test recovery phrase ' + randomUUID();
  let db, key;
  try {
    const userData = path.join(root, 'original');
    const config = await provisionStore({ userData, safeStorage, platform, mode: 'new', passphrase, confirmPassphrase: passphrase, recoveryAcknowledged: true, backupDirectory: root });
    assert.deepEqual(readInstallation(userData), config);
    ({ key } = desktopDatabaseKey({ userData, safeStorage, platform, databaseFile: config.databaseFile }));
    db = openDatabase(config.databaseFile, key);
    const now = () => new Date('2026-10-29T08:00:00Z');
    const stocks = new StockRepository(db, 'main', { now, id: () => 'test-ring' });
    stocks.create({ item: 'Recovery test ring', purity: '22K', qty: 20, gross: 100, net: 90 });
    const invoices = new InvoiceRepository(db, 'main', { now });
    invoices.create({ requestId: randomUUID(), number: 'VJ000001', status: 'completed', customer: 'Disposable recovery test', mobile: '9000012345', invoiceDate: '2026-10-29', items: [{ stockId: 'test-ring', name: 'Recovery test ring', purity: '22K', gross: 10, net: 9, pcs: 4, rate: 1000, making: 0 }], exchanges: [{ metal: 'silver', weight: 1, rate: 100 }], manualDiscount: 20, gstRate: 3, paid: 1000, expectedTotal: 9150 });
    invoices.settle('VJ000001', { version: invoices.get('VJ000001').version, method: 'gold', weight: .1, rate: 1000 });
    const trades = new TransactionRepository(db, 'main', { now });
    trades.save('purchases', { metal: 'gold', weight: 10, rate: 1000 });
    trades.save('payments', { type: 'metal', metal: 'gold', weight: 2, purity: 40 });
    trades.save('payments', { type: 'amount', amount: 100 });
    trades.save('payments', { type: 'self-expense', amount: 50 });
    const stock = stocks.get('test-ring').item;
    assert.equal(stock.qty, 16); assert.equal(stock.gross, 90); assert.equal(stock.net, 81);
    const snapshot = readSnapshot(db, 'main');
    const ranges = [{}, { from: '2026-10-29', to: '2026-10-29' }, { from: '2026-10-30', to: '2026-10-30' }];
    const reports = ranges.map(range => new DatabaseQueries(db, 'main').dashboard(range));
    reports.forEach((report, i) => assert.deepEqual(report, new DashboardService({ read: () => structuredClone(snapshot) }).snapshot(ranges[i])));
    const backupDirectory = path.join(root, 'updated-backup');
    await createPortableBackup(db, key, passphrase, backupDirectory);
    db.close(); db = undefined; key.fill(0); key = undefined;
    // Simulate loss of the original installation's OS-wrapped key, not just reopening it.
    fs.rmSync(path.join(userData, 'database-keys'), { recursive: true });
    const restoredUserData = path.join(root, 'fresh-installation');
    await assert.rejects(provisionStore({ userData: restoredUserData, safeStorage, platform, mode: 'restore', backupDirectory, passphrase: 'Incorrect recovery passphrase' }));
    assert.equal(readInstallation(restoredUserData), null);
    const restored = await provisionStore({ userData: restoredUserData, safeStorage, platform, mode: 'restore', backupDirectory, passphrase });
    ({ key } = desktopDatabaseKey({ userData: restoredUserData, safeStorage, platform, databaseFile: restored.databaseFile }));
    db = openDatabase(restored.databaseFile, key);
    assert.deepEqual(readSnapshot(db, 'main'), snapshot);
    ranges.forEach((range, i) => assert.deepEqual(new DatabaseQueries(db, 'main').dashboard(range), reports[i]));
    assert.equal(db.pragma('integrity_check', { simple: true }), 'ok');
    assert.deepEqual(db.pragma('foreign_key_check'), []);
    db.close(); db = undefined; key.fill(0); key = undefined;
    // Exercise the startup-error recovery path against disposable files, using
    // the real OS keystore when this scenario runs through Electron in CI.
    const previousSettings = fs.readFileSync(path.join(restoredUserData, 'database-installation.json'));
    const oldDatabaseHash = createHash('sha256').update(fs.readFileSync(restored.databaseFile)).digest('hex');
    const brokenKeyFile = path.join(restoredUserData, 'database-keys', createHash('sha256').update(restored.databaseFile).digest('hex') + '.bin');
    fs.writeFileSync(brokenKeyFile, 'Disposable simulated damaged key');
    const recoveryDirectory = fs.mkdtempSync(path.join(restoredUserData, 'recovery-'));
    const repaired = await provisionStore({ userData: recoveryDirectory, safeStorage, platform, mode: 'restore', backupDirectory, passphrase });
    const activated = activateRecovery({ userData: restoredUserData, recoveryDirectory, safeStorage, platform });
    assert.deepEqual(readInstallation(restoredUserData), repaired);
    assert.deepEqual(fs.readFileSync(path.join(activated.archive, 'database-installation.json')), previousSettings);
    assert.equal(fs.readFileSync(brokenKeyFile, 'utf8'), 'Disposable simulated damaged key');
    assert.equal(createHash('sha256').update(fs.readFileSync(restored.databaseFile)).digest('hex'), oldDatabaseHash);
    ({ key } = desktopDatabaseKey({ userData: restoredUserData, safeStorage, platform, databaseFile: repaired.databaseFile }));
    db = openDatabase(repaired.databaseFile, key);
    assert.deepEqual(readSnapshot(db, 'main'), snapshot);
    ranges.forEach((range, i) => assert.deepEqual(new DatabaseQueries(db, 'main').dashboard(range), reports[i]));
    return { verified: true, platform, initialSetup: true, stockDeduction: true, invoiceAndSettlement: true, purchasesAndPayments: true, recoveryWithoutOriginalKey: true, wrongPassphraseRejected: true, exactRecordsMatch: true, financialReportRangesMatched: ranges.length, startupRecoveryPreservesOriginalFiles: true, businessDataTouched: false };
  } finally { if (db?.open) db.close(); key?.fill(0); fs.rmSync(root, { recursive: true, force: true }); }
}
module.exports = { setupRecoveryScenario };
