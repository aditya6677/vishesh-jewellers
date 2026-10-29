'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomBytes, randomUUID } = require('node:crypto');
const { openDatabase } = require('../lib/database/database');
const { importSnapshot, readSnapshot } = require('../lib/database/snapshot-migration');
const { DatabaseRuntime } = require('../lib/database/runtime');
const { createConfig } = require('../lib/config');
const { createPortableBackup } = require('../lib/database/portable-backup');
const { StockRepository } = require('../lib/database/stock-repository');
const { TransactionRepository } = require('../lib/database/transaction-repository');
const { InvoiceRepository } = require('../lib/database/invoice-repository');
const { DatabaseQueries } = require('../lib/database/queries');
const { beginRestore, restorePaths, recoverInterruptedRestore } = require('../lib/database/restore-files');
const phrase = 'Disposable restore test phrase!';

test('portable import and confirmed restore keep installation key, safety data and functional repositories', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vj-restore-'));
  const key = randomBytes(32), incomingKey = randomBytes(32), file = path.join(directory, 'active.db');
  let db = openDatabase(file, key, { create: true });
  importSnapshot(db, { 'invoice-counter': 16 }, { storeId: 'main', sourceSha256: 'a'.repeat(64), acknowledgeLegacy: true }); db.close();
  const runtime = new DatabaseRuntime(createConfig({ DATA_BACKEND: 'sqlite', DATABASE_FILE: file, DATABASE_KEY: key.toString('base64'), BACKUP_DIR: path.join(directory, 'backups') }));
  t.after(async () => { await runtime.close(); key.fill(0); incomingKey.fill(0); fs.rmSync(directory, { recursive: true, force: true }); });
  db = openDatabase(path.join(directory, 'incoming.db'), incomingKey, { create: true });
  importSnapshot(db, { 'invoice-counter': 42, 'business-info': { name: 'Recovered store' } }, { storeId: 'main', sourceSha256: 'b'.repeat(64), acknowledgeLegacy: true });
  const stock = new StockRepository(db, 'main').create({ item: 'Original Ring', purity: '22K', qty: 10, gross: 100, net: 90 }).item;
  const trades = new TransactionRepository(db, 'main');
  trades.save('purchases', { metal: 'gold', weight: 10, rate: 1000 });
  trades.save('payments', { type: 'metal', metal: 'gold', weight: 2, purity: 50 });
  trades.save('payments', { type: 'amount', amount: 25 });
  new InvoiceRepository(db, 'main').create({ requestId: randomUUID(), number: 'VJ000042', status: 'completed', customer: 'Recovery customer', invoiceDate: '2026-10-29', items: [{ stockId: stock.id, name: stock.item, purity: '22K', gross: 10, net: 9, pcs: 4, rate: 1000, making: 0 }], exchanges: [], manualDiscount: 0, gstRate: 3, paid: 100, expectedTotal: 9270 });
  const expected = readSnapshot(db, 'main'), expectedReport = new DatabaseQueries(db, 'main').dashboard();
  const bundle = path.join(directory, 'external');
  await createPortableBackup(db, incomingKey, phrase, bundle); db.close();
  const files = { database: fs.readFileSync(path.join(bundle, 'database.db')).toString('base64'), manifest: fs.readFileSync(path.join(bundle, 'manifest.json'), 'utf8'), recovery: fs.readFileSync(path.join(bundle, 'recovery.json'), 'utf8') };
  await assert.rejects(runtime.backups.importPortable(files, 'Wrong restore test phrase!'), /Recovery failed/);
  const imported = await runtime.backups.importPortable(files, phrase);
  const prepared = await runtime.backups.prepareRecovery(imported.name, phrase);
  assert.equal(runtime.store.getValue('invoice-counter'), 16);
  await assert.rejects(runtime.backups.activatePrepared(prepared.token, 'yes'), /RESTORE/);
  runtime.store.setValue('business-info', { name: 'Changed after preparation' });
  await assert.rejects(runtime.backups.activatePrepared(prepared.token, 'RESTORE'), /Data changed/);
  const second = await runtime.backups.prepareRecovery(imported.name, phrase);
  const reader = runtime.openReader();
  await assert.rejects(runtime.backups.activatePrepared(second.token, 'RESTORE'), /export/);
  reader.close();
  const result = await runtime.backups.activatePrepared(second.token, 'RESTORE');
  assert.equal(result.restored, true);
  assert.deepEqual(runtime.store.read(), expected);
  const previous = openDatabase(result.safety, key, { readonly: true });
  try { assert.equal(readSnapshot(previous, 'main')['invoice-counter'], 16); } finally { previous.close(); }
  assert.throws(() => openDatabase(file, incomingKey));
  assert.deepEqual(await runtime.dashboard.snapshot({}), expectedReport);
  runtime.stocks.create({ item: 'Recovered Ring', purity: '22K', qty: 1, gross: 1, net: 1 });
  assert.equal(runtime.stocks.list().items.length, 2);
  assert.equal(fs.existsSync(file + '.restore-pending.json'), false);
  // Failure during the second rename must reopen the previous database and
  // leave all services usable, rather than serving stale closed connections.
  const third = await runtime.backups.prepareRecovery(imported.name, phrase);
  const rename = fs.renameSync;
  fs.renameSync = (source, target) => {
    if (source === restorePaths(file, third.token).candidate && target === file) throw new Error('Simulated activation rename failure');
    return rename(source, target);
  };
  try { await assert.rejects(runtime.backups.activatePrepared(third.token, 'RESTORE'), /Simulated/); }
  finally { fs.renameSync = rename; }
  assert.equal(runtime.stocks.list().items.length, 2);
  assert.equal((await runtime.dashboard.snapshot({})).summary.invoices, 1);
  assert.equal(runtime.maintenance, false);
});

test('authenticated interrupted-restore journal rolls back at both rename boundaries and rejects tampering', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vj-restore-journal-'));
  const key = randomBytes(32);
  t.after(() => { key.fill(0); fs.rmSync(directory, { recursive: true, force: true }); });
  for (const installed of [false, true]) {
    const file = path.join(directory, installed ? 'installed.db' : 'renamed.db');
    const original = openDatabase(file, key, { create: true });
    importSnapshot(original, { 'invoice-counter': 16 }, { storeId: 'main', sourceSha256: 'a'.repeat(64), acknowledgeLegacy: true }); original.close();
    const id = randomUUID(), paths = restorePaths(file, id);
    const candidate = openDatabase(paths.candidate, key, { create: true });
    importSnapshot(candidate, { 'invoice-counter': 42 }, { storeId: 'main', sourceSha256: 'b'.repeat(64), acknowledgeLegacy: true }); candidate.close();
    beginRestore(file, id, key);
    fs.renameSync(file, paths.previous);
    if (installed) fs.renameSync(paths.candidate, file);
    assert.equal(recoverInterruptedRestore(file, key), true);
    const recovered = openDatabase(file, key);
    try { assert.equal(readSnapshot(recovered, 'main')['invoice-counter'], 16); } finally { recovered.close(); }
    assert.equal(recoverInterruptedRestore(file, key), false);
    beginRestore(file, randomUUID(), key);
    const journal = JSON.parse(fs.readFileSync(file + '.restore-pending.json'));
    journal.mac = '0'.repeat(64); fs.writeFileSync(file + '.restore-pending.json', JSON.stringify(journal));
    assert.throws(() => recoverInterruptedRestore(file, key), /authentication/);
    assert.equal(fs.existsSync(file), true);
  }
});
