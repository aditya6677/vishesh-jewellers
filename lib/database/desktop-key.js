'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { createHash } = require('node:crypto');
const { LocalKeyStore } = require('./local-key-store');
const { readExistingKey } = require('./read-encrypted-snapshot');
const { validateBackup } = require('./backup');
const { readJournal } = require('./restore-files');

function validateInstallation(file, key) {
  const pending = readJournal(file, key);
  validateBackup(pending && fs.existsSync(pending.previous) ? pending.previous : file, key);
}

function desktopDatabaseKey({ safeStorage, userData, databaseFile, bootstrapKeyFile, platform = process.platform }) {
  if (!path.isAbsolute(databaseFile) || !path.isAbsolute(userData)) throw new Error('Absolute desktop database and user-data paths are required.');
  const store = new LocalKeyStore(safeStorage, platform);
  const verification = store.verify(os.tmpdir());
  const directory = path.join(userData, 'database-keys');
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const protectedFile = path.join(directory, createHash('sha256').update(databaseFile).digest('hex') + '.bin');
  let key;
  try {
    if (fs.existsSync(protectedFile)) key = store.load(protectedFile);
    else {
      if (!bootstrapKeyFile) throw new Error('No protected database key exists. Supply the existing prepared database key file for explicit first-time provisioning; no random key was generated.');
      key = readExistingKey(bootstrapKeyFile);
      validateInstallation(databaseFile, key);
      store.save(protectedFile, key);
    }
    validateInstallation(databaseFile, key);
    return { key, verification, protectedFile };
  } catch (error) { key?.fill(0); throw error; }
}
module.exports = { desktopDatabaseKey };
