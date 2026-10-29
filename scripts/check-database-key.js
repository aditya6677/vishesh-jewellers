'use strict';
// Run with Electron (not node), on the target OS/account. No business files are opened.
const { app, safeStorage } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomBytes } = require('node:crypto');
const { LocalKeyStore } = require('../lib/database/local-key-store');
const { openDatabase } = require('../lib/database/database');

app.whenReady().then(() => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vj-native-db-check-'));
  const key = randomBytes(32);
  let db, recovered, exitCode = 1;
  try {
    const store = new LocalKeyStore(safeStorage), verification = store.verify(directory);
    const keyFile = path.join(directory, 'key.bin'), databaseFile = path.join(directory, 'store.db');
    store.save(keyFile, key);
    db = openDatabase(databaseFile, key, { create: true }); db.close(); db = null;
    key.fill(0); recovered = store.load(keyFile);
    db = openDatabase(databaseFile, recovered);
    if (db.pragma('integrity_check', { simple: true }) !== 'ok') throw new Error('Encrypted database verification failed.');
    console.log(JSON.stringify({ ...verification, databaseReopened: true }));
    exitCode = 0;
  } catch (error) { console.error(JSON.stringify({ verified: false, platform: process.platform, error: error.message })); }
  finally {
    if (db?.open) db.close(); key.fill(0); recovered?.fill(0);
    fs.rmSync(directory, { recursive: true, force: true });
  }
  app.exit(exitCode);
}).catch(error => { console.error(error.message); app.exit(1); });
