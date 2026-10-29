'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { LocalKeyStore } = require('../lib/database/local-key-store');
const { desktopDatabaseKey } = require('../lib/database/desktop-key');
const { openDatabase } = require('../lib/database/database');
const { importSnapshot } = require('../lib/database/snapshot-migration');

// Contract tests only: this mock is deliberately not evidence of Keychain/DPAPI.
function fakeStorage(secret = crypto.randomBytes(32)) {
  return {
    isEncryptionAvailable: () => true,
    encryptString(value) {
      const iv = crypto.randomBytes(12), cipher = crypto.createCipheriv('aes-256-gcm', secret, iv);
      const body = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
      return Buffer.concat([iv, cipher.getAuthTag(), body]);
    },
    decryptString(value) { const decipher = crypto.createDecipheriv('aes-256-gcm', secret, value.subarray(0, 12)); decipher.setAuthTag(value.subarray(12, 28)); return Buffer.concat([decipher.update(value.subarray(28)), decipher.final()]).toString('utf8'); }
  };
}
test('protected desktop keys reject unavailable storage, wrong accounts, malformed files and replacement', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vj-local-key-'));
  const key = crypto.randomBytes(32);
  t.after(() => { key.fill(0); fs.rmSync(directory, { recursive: true, force: true }); });
  const file = path.join(directory, 'protected.bin'), storage = fakeStorage();
  const store = new LocalKeyStore(storage, 'darwin');
  store.save(file, key);
  assert.equal(fs.readFileSync(file).includes(Buffer.from(key.toString('base64'))), false);
  const loaded = store.load(file); assert.deepEqual(loaded, key); loaded.fill(0);
  assert.throws(() => store.save(file, key), /EEXIST/);
  assert.throws(() => new LocalKeyStore(fakeStorage(), 'win32').load(file), /Cannot unlock/);
  assert.throws(() => new LocalKeyStore({ isEncryptionAvailable: () => false }, 'darwin').load(file), /secure storage/);
  assert.throws(() => new LocalKeyStore(storage, 'linux').load(file), /secure storage/);
  fs.writeFileSync(file, 'damaged protected file');
  assert.throws(() => store.load(file), /Cannot unlock/);
});

test('desktop provisioning protects only the existing validated database key and never regenerates a missing key', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vj-key-provision-'));
  const databaseFile = path.join(directory, 'store.db'), userData = path.join(directory, 'user');
  const key = crypto.randomBytes(32), db = openDatabase(databaseFile, key, { create: true });
  importSnapshot(db, {}, { storeId: 'main', sourceSha256: 'a'.repeat(64), acknowledgeLegacy: true }); db.close();
  t.after(() => { key.fill(0); fs.rmSync(directory, { recursive: true, force: true }); });
  const safeStorage = fakeStorage(), bootstrapKeyFile = path.join(directory, 'existing.key');
  fs.writeFileSync(bootstrapKeyFile, key.toString('base64'));
  const options = { safeStorage, userData, databaseFile, platform: 'win32' };
  assert.throws(() => desktopDatabaseKey(options), /No protected/);
  const first = desktopDatabaseKey({ ...options, bootstrapKeyFile });
  assert.deepEqual(first.key, key); first.key.fill(0);
  const second = desktopDatabaseKey(options);
  assert.deepEqual(second.key, key); second.key.fill(0);
  assert.throws(() => desktopDatabaseKey({ ...options, safeStorage: fakeStorage(), bootstrapKeyFile }), /Cannot unlock/);
  assert.equal(fs.readFileSync(first.protectedFile).includes(Buffer.from(key.toString('base64'))), false);
});
