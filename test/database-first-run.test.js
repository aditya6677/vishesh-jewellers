'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { provisionStore, readInstallation } = require('../lib/database/first-run');
const { desktopDatabaseKey } = require('../lib/database/desktop-key');
const { openDatabase } = require('../lib/database/database');
const { readSnapshot } = require('../lib/database/snapshot-migration');

test('first-run creates a separate protected store and restores portable data without overwrites', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vj-first-run-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  // Contract double, not a substitute for native OS acceptance.
  const safeStorage = { isEncryptionAvailable: () => true, encryptString: text => Buffer.from(text).map(x => x ^ 93), decryptString: bytes => Buffer.from(bytes).map(x => x ^ 93).toString() };
  const userData = path.join(dir, 'installation');
  const onboarding = { userData, safeStorage, platform: 'darwin', mode: 'new', backupDirectory: dir, passphrase: 'a long recovery passphrase', confirmPassphrase: 'a long recovery passphrase', recoveryAcknowledged: true };
  await assert.rejects(provisionStore({ ...onboarding, passphrase: '5512' }), /at least 12/);
  await assert.rejects(provisionStore({ ...onboarding, confirmPassphrase: 'different phrase' }), /do not match/);
  await assert.rejects(provisionStore({ ...onboarding, recoveryAcknowledged: false }), /Confirm/);
  assert.equal(fs.existsSync(userData), false);
  const config = await provisionStore(onboarding);
  assert.ok(fs.existsSync(path.join(config.initialBackup, 'manifest.json')));
  assert.equal(fs.readFileSync(path.join(userData, 'database-installation.json'), 'utf8').includes(onboarding.passphrase), false);
  assert.deepEqual(readInstallation(userData), config);
  assert.equal(config.accountsEnabled,true);
  assert.equal(config.licensingEnabled,true);
  await assert.rejects(provisionStore({ userData, safeStorage, platform: 'darwin', mode: 'new' }), /already configured/);
  const { key } = desktopDatabaseKey({ userData, safeStorage, platform: 'darwin', databaseFile: config.databaseFile });
  const db = openDatabase(config.databaseFile, key);
  const expected = readSnapshot(db, 'main');
  assert.equal(expected['invoice-counter'], 1);
  const backupDirectory = config.initialBackup;
  db.close(); key.fill(0);
  const recoveredUserData = path.join(dir, 'reinstalled');
  await assert.rejects(provisionStore({ userData: recoveredUserData, safeStorage, platform: 'darwin', mode: 'restore', backupDirectory, passphrase: 'wrong recovery passphrase' }));
  assert.equal(readInstallation(recoveredUserData), null);
  const recovered = await provisionStore({ userData: recoveredUserData, safeStorage, platform: 'darwin', mode: 'restore', backupDirectory, passphrase: 'a long recovery passphrase' });
  const unlocked = desktopDatabaseKey({ userData: recoveredUserData, safeStorage, platform: 'darwin', databaseFile: recovered.databaseFile });
  const restored = openDatabase(recovered.databaseFile, unlocked.key);
  try { assert.deepEqual(readSnapshot(restored, 'main'), expected); }
  finally { restored.close(); unlocked.key.fill(0); }
  await assert.rejects(provisionStore({ userData: path.join(dir, 'unsupported'), safeStorage, platform: 'linux', mode: 'new' }), /secure storage/);
});
