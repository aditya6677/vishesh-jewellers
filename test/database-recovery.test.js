'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomBytes } = require('node:crypto');
const { protectRecoveryKey, recoverDatabaseKey } = require('../lib/database/key-recovery');
const { createPortableBackup, restorePortableBackup } = require('../lib/database/portable-backup');
const { openDatabase } = require('../lib/database/database');
const { importSnapshot, readSnapshot } = require('../lib/database/snapshot-migration');
const { TransactionRepository } = require('../lib/database/transaction-repository');
const { DatabaseQueries } = require('../lib/database/queries');

const password = 'Disposable recovery phrase 2026!';

test('recovery envelope authenticates key, backup digest, format and ciphertext', async () => {
  const key = randomBytes(32), digest = randomBytes(32);
  try {
    const serialized = await protectRecoveryKey(key, password, digest);
    assert.notEqual(serialized, await protectRecoveryKey(key, password, digest));
    assert.equal(serialized.includes(key.toString('base64')), false);
    const recovered = await recoverDatabaseKey(serialized, password, digest);
    try { assert.deepEqual(recovered, key); } finally { recovered.fill(0); }
    await assert.rejects(recoverDatabaseKey(serialized, 'Wrong recovery phrase!', digest), /Recovery failed/);
    await assert.rejects(recoverDatabaseKey(serialized, password, randomBytes(32)), /Recovery failed/);
    for (const property of ['salt', 'iv', 'ciphertext', 'tag']) {
      const record = JSON.parse(serialized), bytes = Buffer.from(record[property], 'base64');
      bytes[0] ^= 1; record[property] = bytes.toString('base64');
      await assert.rejects(recoverDatabaseKey(JSON.stringify(record), password, digest), /Recovery failed/);
    }
    await assert.rejects(protectRecoveryKey(key, '5512', digest), /passphrase/);
    await assert.rejects(recoverDatabaseKey(serialized, 'a'.repeat(1025), digest), /passphrase/);
    await assert.rejects(recoverDatabaseKey('x'.repeat(4097), password, digest), /Invalid/);
    await assert.rejects(recoverDatabaseKey(JSON.stringify({ ...JSON.parse(serialized), version: 99 }), password, digest), /Unsupported/);
    await assert.rejects(recoverDatabaseKey(JSON.stringify({ ...JSON.parse(serialized), cost: 1e12 }), password, digest), /Unsupported/);
  } finally { key.fill(0); }
});

test('portable backup recovers after losing the original key without altering active data', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vj-portable-'));
  const key = randomBytes(32), db = openDatabase(path.join(directory, 'active.db'), key, { create: true });
  t.after(() => { if (db.open) db.close(); key.fill(0); fs.rmSync(directory, { recursive: true, force: true }); });
  importSnapshot(db, { 'invoice-counter': 16 }, { storeId: 'main', sourceSha256: 'a'.repeat(64), acknowledgeLegacy: true });
  new TransactionRepository(db, 'main').save('purchases', { metal: 'gold', weight: 10, rate: 1000 });
  const original = readSnapshot(db, 'main'), report = new DatabaseQueries(db, 'main').dashboard();
  const bundle = path.join(directory, 'portable');
  await assert.rejects(createPortableBackup(db, key, '5512', bundle), /passphrase/);
  assert.equal(fs.existsSync(bundle), false);
  assert.equal((await createPortableBackup(db, key, password, bundle)).portable, true);
  assert.deepEqual(fs.readdirSync(bundle).sort(), ['database.db', 'manifest.json', 'recovery.json']);
  await assert.rejects(createPortableBackup(db, key, password, bundle), /EEXIST/);
  assert.deepEqual(readSnapshot(db, 'main'), original);
  db.close(); key.fill(0); // Simulates losing the original installation/key.
  const restoredFile = path.join(directory, 'recovered.db');
  await assert.rejects(restorePortableBackup(bundle, 'Wrong recovery phrase!', restoredFile), /Recovery failed/);
  assert.equal(fs.existsSync(restoredFile), false);
  const result = await restorePortableBackup(bundle, password, restoredFile);
  const restored = openDatabase(restoredFile, result.key);
  try {
    assert.deepEqual(readSnapshot(restored, 'main'), original);
    assert.deepEqual(new DatabaseQueries(restored, 'main').dashboard(), report);
  } finally { restored.close(); result.key.fill(0); }
  await assert.rejects(restorePortableBackup(bundle, password, restoredFile), /exists/);
  const manifestFile = path.join(bundle, 'manifest.json');
  const manifest = fs.readFileSync(manifestFile);
  fs.writeFileSync(manifestFile, JSON.stringify({ format: 'vj-portable-database', version: 1, sha256: '0'.repeat(64) }));
  await assert.rejects(restorePortableBackup(bundle, password, path.join(directory, 'mismatch.db')), /damaged/);
  fs.writeFileSync(manifestFile, manifest);
  fs.truncateSync(path.join(bundle, 'database.db'), 128);
  await assert.rejects(restorePortableBackup(bundle, password, path.join(directory, 'damaged.db')), /damaged/);
  assert.equal(fs.existsSync(path.join(directory, 'damaged.db')), false);
});
