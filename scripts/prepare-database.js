'use strict';
// Explicit, copy-only import. Never used automatically at application startup.
const fs = require('node:fs');
const path = require('node:path');
const { parseArgs } = require('node:util');
const { randomBytes } = require('node:crypto');
const { openDatabase } = require('../lib/database/database');
const { readExistingKey, readEncryptedSnapshot } = require('../lib/database/read-encrypted-snapshot');
const { importSnapshot, readSnapshot } = require('../lib/database/snapshot-migration');
const { DatabaseQueries } = require('../lib/database/queries');
const { DashboardService } = require('../lib/services/dashboard-service');
const assert = require('node:assert/strict');
function prepareDatabase({ source, sourceKeyFile, target, targetKeyFile, storeId = 'main' }) {
  for (const value of [source, sourceKeyFile, target, targetKeyFile]) if (!value || !path.isAbsolute(value)) throw new Error('All source/target/key paths must be explicit absolute paths.');
  if (target === targetKeyFile || fs.existsSync(target) || fs.existsSync(targetKeyFile)) throw new Error('Target database and target key must be new, distinct files.');
  const sourceKey = readExistingKey(sourceKeyFile), key = randomBytes(32);
  let db;
  try {
    const { snapshot, sourceSha256 } = readEncryptedSnapshot(source, sourceKey);
    fs.mkdirSync(path.dirname(targetKeyFile), { recursive: true, mode: 0o700 });
    fs.writeFileSync(targetKeyFile, key.toString('base64') + '\n', { flag: 'wx', mode: 0o600 });
    const descriptor = fs.openSync(targetKeyFile, 'r+');
    try { fs.fsyncSync(descriptor); } finally { fs.closeSync(descriptor); }
    db = openDatabase(target, key, { create: true });
    const result = importSnapshot(db, snapshot, { storeId, sourceSha256, acknowledgeLegacy: true });
    const queries = new DatabaseQueries(db, storeId);
    for (const range of [{}, { from: '2000-01-01', to: '2100-12-31' }]) assert.deepEqual(queries.dashboard(range), new DashboardService({ read: () => structuredClone(snapshot) }).snapshot(range));
    db.close(); db = openDatabase(target, key);
    assert.deepEqual(readSnapshot(db, storeId), snapshot);
    if (readEncryptedSnapshot(source, sourceKey).sourceSha256 !== sourceSha256) throw new Error('Source changed during import; do not activate this copy.');
    return { ...result, sourceUnchanged: true, sqlReportsMatch: true, integrity: db.pragma('integrity_check', { simple: true }), target, storeId };
  } finally { if (db?.open) db.close(); sourceKey.fill(0); key.fill(0); }
}
if (require.main === module) {
  const { values } = parseArgs({ options: { source: { type: 'string' }, 'source-key-file': { type: 'string' }, target: { type: 'string' }, 'target-key-file': { type: 'string' }, store: { type: 'string', default: 'main' } } });
  try { console.log(JSON.stringify(prepareDatabase({ source: values.source, sourceKeyFile: values['source-key-file'], target: values.target, targetKeyFile: values['target-key-file'], storeId: values.store }), null, 2)); }
  catch (error) { console.error('Copy-only database preparation failed:', error.message); process.exitCode = 1; }
}
module.exports = { prepareDatabase };
