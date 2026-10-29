'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createHash, timingSafeEqual } = require('node:crypto');
const { createDatabaseBackup, restoreDatabaseCopy } = require('./backup');
const { protectRecoveryKey, recoverDatabaseKey, checkPassword } = require('./key-recovery');

function digestFile(file) {
  const hash = createHash('sha256'), descriptor = fs.openSync(file, 'r');
  try {
    const chunk = Buffer.alloc(1024 * 1024);
    let count;
    while ((count = fs.readSync(descriptor, chunk, 0, chunk.length, null))) hash.update(chunk.subarray(0, count));
    return hash.digest();
  } finally { fs.closeSync(descriptor); }
}

function writeNew(file, contents) {
  const descriptor = fs.openSync(file, 'wx', 0o600);
  try { fs.writeFileSync(descriptor, contents); fs.fsyncSync(descriptor); }
  finally { fs.closeSync(descriptor); }
}

function readSmall(file, maximum) {
  if (fs.statSync(file).size > maximum) throw new Error('Backup metadata is too large.');
  const value = fs.readFileSync(file, 'utf8');
  if (Buffer.byteLength(value) > maximum) throw new Error('Backup metadata is too large.');
  return value;
}

async function createPortableBackup(db, databaseKey, passphrase, directory) {
  checkPassword(passphrase);
  if (!path.isAbsolute(directory)) throw new Error('An absolute new backup directory is required.');
  // Existing directories are refused, including empty ones and symbolic links.
  fs.mkdirSync(directory, { mode: 0o700 });
  const file = path.join(directory, 'database.db');
  const backup = createDatabaseBackup(db, databaseKey, file);
  const digest = digestFile(file);
  const recovery = await protectRecoveryKey(databaseKey, passphrase, digest);
  writeNew(path.join(directory, 'recovery.json'), recovery);
  // Written last: incomplete folders are not accepted as portable backups.
  writeNew(path.join(directory, 'manifest.json'), JSON.stringify({ format: 'vj-portable-database', version: 1, sha256: digest.toString('hex') }));
  return { ...backup, path: directory, portable: true };
}

async function restorePortableBackup(directory, passphrase, destination) {
  checkPassword(passphrase);
  if (!path.isAbsolute(directory) || !path.isAbsolute(destination)) throw new Error('Absolute backup and recovery paths are required.');
  for (const name of ['database.db', 'manifest.json', 'recovery.json']) {
    const stat = fs.lstatSync(path.join(directory, name));
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Portable backup files must be regular files, not symbolic links.');
  }
  let manifest;
  try { manifest = JSON.parse(readSmall(path.join(directory, 'manifest.json'), 1024)); }
  catch { throw new Error('Invalid portable backup manifest.'); }
  if (!manifest || manifest.format !== 'vj-portable-database' || manifest.version !== 1 || !/^[a-f0-9]{64}$/.test(manifest.sha256) || Object.keys(manifest).sort().join(',') !== 'format,sha256,version') throw new Error('Unsupported portable backup manifest.');
  const file = path.join(directory, 'database.db'), digest = digestFile(file);
  if (!timingSafeEqual(digest, Buffer.from(manifest.sha256, 'hex'))) throw new Error('Backup file is damaged or does not match its manifest.');
  const key = await recoverDatabaseKey(readSmall(path.join(directory, 'recovery.json'), 4096), passphrase, digest);
  try {
    const restored = restoreDatabaseCopy(file, key, destination);
    if (!timingSafeEqual(digestFile(destination), digest)) throw new Error('Backup changed while recovering; candidate was not activated.');
    // Caller must provision this key securely and zero it after use. No key is
    // written in plaintext and no live database is replaced or activated here.
    return { ...restored, key };
  } catch (error) { key.fill(0); throw error; }
}

module.exports = { createPortableBackup, restorePortableBackup };
