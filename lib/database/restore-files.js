'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { createHmac, randomUUID, timingSafeEqual } = require('node:crypto');
const { validateBackup } = require('./backup');

function restorePaths(file, id) {
  if (!path.isAbsolute(file) || typeof id !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(id)) throw new Error('Invalid database recovery identity.');
  return { candidate: file + '.restore-' + id + '.candidate', previous: file + '.restore-' + id + '.previous', failed: file + '.restore-' + id + '.failed', journal: file + '.restore-pending.json' };
}
function signature(file, id, key) { return createHmac('sha256', key).update('vj-restore-v1\0' + file + '\0' + id).digest('hex'); }
function syncDirectory(file) {
  if (process.platform === 'win32') return; // Windows does not support opening directories this way.
  const fd = fs.openSync(path.dirname(file), 'r');
  try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}
function beginRestore(file, id, key) {
  const paths = restorePaths(file, id);
  if (fs.existsSync(paths.previous) || fs.existsSync(paths.failed)) throw new Error('Restore recovery files already exist.');
  const fd = fs.openSync(paths.journal, 'wx', 0o600);
  try { fs.writeFileSync(fd, JSON.stringify({ version: 1, id, mac: signature(file, id, key) })); fs.fsyncSync(fd); }
  finally { fs.closeSync(fd); }
  syncDirectory(file);
  return paths;
}
function readJournal(file, key) {
  const journal = file + '.restore-pending.json';
  if (!fs.existsSync(journal)) return null;
  if (fs.lstatSync(journal).isSymbolicLink() || fs.statSync(journal).size > 1024) throw new Error('Invalid restore journal. Keep all recovery files and contact support.');
  const record = JSON.parse(fs.readFileSync(journal, 'utf8'));
  if (!record || record.version !== 1 || Object.keys(record).sort().join(',') !== 'id,mac,version') throw new Error('Unsupported restore journal.');
  const paths = restorePaths(file, record.id);
  if (typeof record.mac !== 'string' || !/^[a-f0-9]{64}$/.test(record.mac) || !timingSafeEqual(Buffer.from(record.mac, 'hex'), Buffer.from(signature(file, record.id, key), 'hex'))) throw new Error('Restore journal authentication failed. No files were replaced.');
  return { ...paths, id: record.id };
}
function completeRestore(file, id) {
  const paths = restorePaths(file, id);
  fs.renameSync(paths.journal, file + '.restore-' + id + '.completed-' + randomUUID() + '.json');
  syncDirectory(file);
}
function recoverInterruptedRestore(file, key) {
  const state = readJournal(file, key);
  if (!state) return false;
  if (fs.existsSync(state.previous)) {
    validateBackup(state.previous, key);
    if (fs.existsSync(file)) {
      // Never overwrite/delete the interrupted replacement, even if corrupt.
      fs.renameSync(file, state.failed + '-' + randomUUID());
      for (const suffix of ['-wal', '-shm']) if (fs.existsSync(file + suffix)) fs.renameSync(file + suffix, state.failed + '-' + randomUUID() + suffix);
    }
    fs.renameSync(state.previous, file);
    syncDirectory(file);
  }
  validateBackup(file, key); // Missing/corrupt active files fail closed.
  completeRestore(file, state.id);
  return true;
}
module.exports = { restorePaths, beginRestore, completeRestore, recoverInterruptedRestore, readJournal, syncDirectory };
