'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { openDatabase } = require('./database');

function validateBackup(file, key) {
  const db = openDatabase(file, key, { readonly: true });
  try {
    if (db.pragma('integrity_check', { simple: true }) !== 'ok') throw new Error('Database backup integrity check failed.');
    if (db.pragma('foreign_key_check').length) throw new Error('Database backup foreign keys are inconsistent.');
    return db.prepare('SELECT store_id FROM stores ORDER BY store_id').all().map(row => row.store_id);
  } finally { db.close(); }
}

function assertNewDestination(destination) {
  if (!path.isAbsolute(destination)) throw new Error('An absolute backup destination is required.');
  for (const suffix of ['', '-wal', '-shm', '-journal']) {
    if (fs.existsSync(destination + suffix)) throw new Error('Backup destination already exists; overwrite is not allowed.');
  }
}

function copyVerified(source, key, destination, standalone = true) {
  assertNewDestination(destination);
  // Exclusive creation prevents replacement even if another caller races us.
  const output = fs.openSync(destination, 'wx', 0o600);
  let input;
  try {
    input = fs.openSync(source, 'r');
    const chunk = Buffer.alloc(1024 * 1024);
    let count;
    while ((count = fs.readSync(input, chunk, 0, chunk.length, null))) {
      let offset = 0;
      while (offset < count) offset += fs.writeSync(output, chunk, offset, count - offset);
    }
    fs.fsyncSync(output);
  } finally {
    if (input !== undefined) fs.closeSync(input);
    fs.closeSync(output);
  }
  // Make the candidate self-contained: validation of a WAL-mode copy can
  // otherwise leave sidecar files that users might omit when moving backups.
  if (standalone) {
    const candidate = openDatabase(destination, key);
    try {
      candidate.pragma('wal_checkpoint(TRUNCATE)');
      if (candidate.pragma('journal_mode=DELETE', { simple: true }) !== 'delete') throw new Error('Could not finalize a standalone backup.');
    } finally { candidate.close(); }
  }
  const finalized = fs.openSync(destination, 'r+');
  try { fs.fsyncSync(finalized); } finally { fs.closeSync(finalized); }
  // Failed copies are retained for diagnosis, never advertised as verified.
  const stores = validateBackup(destination, key);
  return { path: destination, bytes: fs.statSync(destination).size, stores, verified: true };
}

function createDatabaseBackup(db, key, destination) {
  assertNewDestination(destination);
  if (db.inTransaction) throw new Error('Finish the current transaction before creating a database backup.');
  const checkpoint = db.pragma('wal_checkpoint(TRUNCATE)')[0];
  if (checkpoint.busy || checkpoint.log > 0) throw new Error('Database is busy; retry the backup after active reports finish.');
  db.exec('BEGIN IMMEDIATE');
  try {
    // A writer might have committed between checkpoint and lock acquisition.
    // Refuse rather than silently omit that transaction from the copied file.
    if (fs.existsSync(db.name + '-wal') && fs.statSync(db.name + '-wal').size > 0) throw new Error('Database changed during backup preparation; retry.');
    validateBackup(db.name, key);
    return copyVerified(db.name, key, destination);
  } finally { db.exec('ROLLBACK'); }
}

function restoreDatabaseCopy(source, key, destination) {
  assertNewDestination(destination);
  // Recovery only creates a separate candidate; it cannot replace a live store.
  // Sources with pending WAL require the guarded live-backup workflow instead.
  if (fs.existsSync(source + '-wal') && fs.statSync(source + '-wal').size > 0) throw new Error('Recovery source has pending journal data; use a verified backup.');
  validateBackup(source, key);
  return copyVerified(source, key, destination, false);
}

module.exports = { createDatabaseBackup, restoreDatabaseCopy, validateBackup };
