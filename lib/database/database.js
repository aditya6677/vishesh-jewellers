'use strict';
const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3-multiple-ciphers');
const { createStoreSchema } = require('./snapshot-migration');
const { registerProjectionFunctions, createReportingSchema } = require('./reporting-schema');
const { createSearchSchema } = require('./search-schema');
const APPLICATION_ID = 0x564a4442;
const SCHEMA_SIGNATURE = 'vj-financial-schema-v1-20261028';
function openDatabase(file, key, { create = false, readonly = false } = {}) {
  if (create && readonly) throw new Error('Cannot create a read-only database.');
  if (!path.isAbsolute(file) || !Buffer.isBuffer(key) || key.length !== 32) throw new Error('An absolute database path and existing 32-byte key are required.');
  if (create && fs.existsSync(file)) throw new Error('Refusing to overwrite an existing database.');
  if (!create) {
    const descriptor = fs.openSync(file, 'r'), header = Buffer.alloc(16);
    try { fs.readSync(descriptor, header, 0, 16, 0); } finally { fs.closeSync(descriptor); }
    if (header.equals(Buffer.from('SQLite format 3\0'))) throw new Error('Unencrypted SQLite databases are not accepted.');
  }
  if (create) fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const db = new Database(file, { fileMustExist: !create, readonly, timeout: 5000 });
  try {
    db.pragma("cipher='sqlcipher'"); db.pragma('legacy=4'); db.key(key);
    db.prepare('SELECT count(*) FROM sqlite_master').get();
    registerProjectionFunctions(db);
    db.pragma('foreign_keys=ON'); db.pragma('temp_store=MEMORY');
    db.pragma('cache_size=-32768'); if (!readonly) { db.pragma('journal_mode=WAL'); db.pragma('synchronous=FULL'); }
    const version = db.pragma('user_version', { simple: true });
    if (create && version === 0) db.transaction(() => {
      createStoreSchema(db); createReportingSchema(db); createSearchSchema(db);
      db.exec('CREATE TABLE schema_manifest(version INTEGER PRIMARY KEY CHECK(version=1), signature TEXT NOT NULL, timezone TEXT NOT NULL)');
      db.prepare('INSERT INTO schema_manifest VALUES(1,?,?)').run(SCHEMA_SIGNATURE, Intl.DateTimeFormat().resolvedOptions().timeZone);
      db.pragma('application_id=' + APPLICATION_ID); db.pragma('user_version=1');
    })();
    else if (version !== 1 || db.pragma('application_id', { simple: true }) !== APPLICATION_ID || !db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='schema_manifest'").get() || db.prepare('SELECT signature FROM schema_manifest WHERE version=1').get()?.signature !== SCHEMA_SIGNATURE) throw new Error('Unsupported application database; no automatic upgrade was attempted.');
    if (db.prepare('SELECT timezone FROM schema_manifest WHERE version=1').get().timezone !== Intl.DateTimeFormat().resolvedOptions().timeZone) throw new Error('Database reporting timezone changed. Prepare and verify a new copy before using date-range reports.');
    if (create) fs.chmodSync(file, 0o600);
    return db;
  } catch (error) { db.close(); throw error; }
}
module.exports = { openDatabase, APPLICATION_ID, SCHEMA_SIGNATURE };
