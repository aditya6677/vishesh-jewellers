'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { randomBytes, createHash } = require('node:crypto');
const { openDatabase } = require('./database');
const { importSnapshot } = require('./snapshot-migration');
const { restorePortableBackup, createPortableBackup } = require('./portable-backup');
const { checkPassword } = require('./key-recovery');
const { LocalKeyStore } = require('./local-key-store');

async function provisionStore({ userData, safeStorage, platform = process.platform, mode, backupDirectory, passphrase, confirmPassphrase, recoveryAcknowledged, storeName = 'Vishesh Jewellers', tagline = 'Beginning... of Special Relationship...' }) {
  if (!path.isAbsolute(userData) || !['new', 'restore'].includes(mode)) throw new Error('Invalid setup request.');
  const configFile = path.join(userData, 'database-installation.json');
  if (fs.existsSync(configFile)) throw new Error('A database installation is already configured.');
  const protectedKeys = new LocalKeyStore(safeStorage, platform);
  protectedKeys.assertSecure();
  if (mode === 'new') {
    require('../services/branding-service').validateBranding({ name: storeName, tagline, logo: '' });
    checkPassword(passphrase);
    if (passphrase !== confirmPassphrase) throw new Error('Recovery passphrases do not match.');
    if (recoveryAcknowledged !== true) throw new Error('Confirm that you will keep the recovery passphrase and backup safely.');
    if (!path.isAbsolute(backupDirectory || '') || !fs.statSync(backupDirectory).isDirectory()) throw new Error('Choose an existing folder for your initial encrypted backup.');
  }
  fs.mkdirSync(userData, { recursive: true, mode: 0o700 });
  // Never overwrite an existing database, including incomplete setup attempts.
  const directory = fs.mkdtempSync(path.join(userData, 'store-'));
  const databaseFile = path.join(directory, 'store.db');
  let key, db;
  try {
    if (mode === 'restore') {
      ({ key } = await restorePortableBackup(backupDirectory, passphrase, databaseFile));
      db = openDatabase(databaseFile, key);
      const stores = db.prepare('SELECT store_id FROM stores').all();
      if (stores.length !== 1) throw new Error('Setup requires a backup containing exactly one store.');
    } else {
      key = randomBytes(32);
      db = openDatabase(databaseFile, key, { create: true });
      importSnapshot(db, { 'stock-list': [], 'invoice-records': [], 'old-gold-records': [], 'purchase-records': [], 'payment-records': [], 'invoice-counter': 1, 'business-info': { name: storeName.trim(), tagline: tagline.trim(), logo: '' } }, { storeId: 'main', sourceSha256: createHash('sha256').update('new-store').digest('hex'), acknowledgeLegacy: true });
    }
    const storeId = db.prepare('SELECT store_id FROM stores').get().store_id;
    if (db.pragma('integrity_check', { simple: true }) !== 'ok') throw new Error('Database integrity check failed.');
    let initialBackup;
    if (mode === 'new') {
      initialBackup = path.join(backupDirectory, 'store-backup-' + path.basename(directory));
      await createPortableBackup(db, key, passphrase, initialBackup);
    }
    db.close(); db = undefined;
    const keyDirectory = path.join(userData, 'database-keys');
    fs.mkdirSync(keyDirectory, { recursive: true, mode: 0o700 });
    protectedKeys.save(path.join(keyDirectory, createHash('sha256').update(databaseFile).digest('hex') + '.bin'), key);
    const config = { version: 1, databaseFile, storeId, accountsEnabled: true, licensingEnabled: true, ...(initialBackup ? { initialBackup } : {}) };
    const fd = fs.openSync(configFile, 'wx', 0o600);
    try { fs.writeFileSync(fd, JSON.stringify(config)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    return config;
  } finally { if (db?.open) db.close(); key?.fill(0); }
}

function readInstallation(userData) {
  const file = path.join(userData, 'database-installation.json');
  if (!fs.existsSync(file)) return null;
  const config = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (config.version !== 1 || !path.isAbsolute(config.databaseFile || '') || typeof config.storeId !== 'string' || !config.storeId) throw new Error('Invalid database installation settings. No new store was created.');
  return config;
}
module.exports = { provisionStore, readInstallation };
