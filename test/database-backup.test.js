'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomBytes } = require('node:crypto');
const { openDatabase } = require('../lib/database/database');
const { importSnapshot, readSnapshot } = require('../lib/database/snapshot-migration');
const { createDatabaseBackup, restoreDatabaseCopy } = require('../lib/database/backup');
const { TransactionRepository } = require('../lib/database/transaction-repository');
const { DatabaseQueries } = require('../lib/database/queries');

test('guarded encrypted backups recover to new files without overwriting source or existing backups', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vj-db-backup-'));
  const key = randomBytes(32), file = path.join(directory, 'source.db');
  const db = openDatabase(file, key, { create: true });
  t.after(() => { if (db.open) db.close(); key.fill(0); fs.rmSync(directory, { recursive: true, force: true }); });
  importSnapshot(db, { 'invoice-counter': 16, 'business-info': { name: 'Backup test' } }, { storeId: 'main', sourceSha256: 'a'.repeat(64), acknowledgeLegacy: true });
  const trades = new TransactionRepository(db, 'main');
  trades.save('purchases', { metal: 'gold', weight: 10, rate: 1000 });
  trades.save('payments', { type: 'metal', metal: 'gold', weight: 2, purity: 40 });
  trades.save('payments', { type: 'amount', amount: 100 });
  const original = readSnapshot(db, 'main');
  const report = new DatabaseQueries(db, 'main').dashboard();
  const backup = path.join(directory, 'backup.db');
  assert.equal(createDatabaseBackup(db, key, backup).verified, true);
  assert.notEqual(fs.readFileSync(backup).subarray(0, 16).toString(), 'SQLite format 3\0');
  assert.throws(() => createDatabaseBackup(db, key, backup), /exists/);
  const restored = path.join(directory, 'restored.db');
  assert.throws(() => restoreDatabaseCopy(backup, randomBytes(32), restored));
  assert.equal(fs.existsSync(restored), false);
  assert.equal(restoreDatabaseCopy(backup, key, restored).verified, true);
  const recovered = openDatabase(restored, key);
  try {
    assert.deepEqual(readSnapshot(recovered, 'main'), original);
    assert.deepEqual(new DatabaseQueries(recovered, 'main').dashboard(), report);
  } finally { recovered.close(); }
  assert.deepEqual(readSnapshot(db, 'main'), original);
  db.exec('BEGIN IMMEDIATE');
  try { assert.throws(() => createDatabaseBackup(db, key, path.join(directory, 'in-transaction.db')), /transaction/); }
  finally { db.exec('ROLLBACK'); }
  const damaged = path.join(directory, 'damaged.db');
  fs.writeFileSync(damaged, fs.readFileSync(backup).subarray(0, 128));
  const rejected = path.join(directory, 'rejected.db');
  assert.throws(() => restoreDatabaseCopy(damaged, key, rejected));
  assert.equal(fs.existsSync(rejected), false);
  // A reader with an older snapshot prevents a complete checkpoint.
  const reader = openDatabase(file, key, { readonly: true });
  try {
    reader.exec('BEGIN');
    reader.prepare('SELECT count(*) FROM documents').get();
    trades.save('payments', { type: 'amount', amount: 50 });
    db.pragma('busy_timeout=20');
    const busyTarget = path.join(directory, 'busy.db');
    assert.throws(() => createDatabaseBackup(db, key, busyTarget), /busy/);
    assert.equal(fs.existsSync(busyTarget), false);
  } finally { reader.exec('ROLLBACK'); reader.close(); }
  assert.equal(createDatabaseBackup(db, key, path.join(directory, 'after-reader.db')).verified, true);
});
