'use strict';
// Read-only, point-in-time migration evidence; never activates a database.
const path = require('node:path');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { parseArgs } = require('node:util');
const { openDatabase } = require('../lib/database/database');
const { readExistingKey, readEncryptedSnapshot } = require('../lib/database/read-encrypted-snapshot');
const { readSnapshot, reconcile } = require('../lib/database/snapshot-migration');
const { DatabaseQueries } = require('../lib/database/queries');
const { DashboardService } = require('../lib/services/dashboard-service');

function verifyDatabase({ source, sourceKeyFile, target, targetKeyFile, storeId = 'main' }) {
  for (const value of [source, sourceKeyFile, target, targetKeyFile]) {
    if (typeof value !== 'string' || !path.isAbsolute(value)) throw new Error('Explicit absolute source, database and key paths are required.');
  }
  let sourceKey, key, db;
  try {
    sourceKey = readExistingKey(sourceKeyFile);
    key = readExistingKey(targetKeyFile);
    const { snapshot, sourceSha256 } = readEncryptedSnapshot(source, sourceKey);
    db = openDatabase(target, key, { readonly: true });
    const result = db.transaction(() => {
      assert.equal(db.pragma('integrity_check', { simple: true }), 'ok', 'Database integrity check failed.');
      assert.equal(db.pragma('foreign_key_check').length, 0, 'Database relationship check failed.');
      const origin = db.prepare('SELECT * FROM stores WHERE store_id=?').get(storeId);
      assert.ok(origin, 'Store not found.');
      assert.equal(origin.source_sha256, sourceSha256, 'Source differs from the imported source.');
      assert.equal(origin.imported_snapshot_sha256, createHash('sha256').update(JSON.stringify(snapshot)).digest('hex'), 'Imported snapshot fingerprint differs.');
      // Do not expose assertion diffs containing customer data in CLI output.
      let parity;
      try { parity = reconcile(snapshot, readSnapshot(db, storeId)); }
      catch { throw new Error('Canonical records or financial summaries differ from the source.'); }
      const dates = (snapshot['invoice-records'] || []).map(row => row.invoiceDate).filter(date => typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date)).sort();
      const ranges = [{}, { from: '2000-01-01', to: '2100-12-31' }];
      if (dates.length) ranges.push({ from: dates[0], to: dates.at(-1) }, { from: dates.at(-1), to: dates.at(-1) });
      const queries = new DatabaseQueries(db, storeId);
      const legacy = new DashboardService({ read: () => structuredClone(snapshot) });
      for (const range of ranges) {
        try { assert.deepEqual(queries.dashboard(range), legacy.snapshot(range)); }
        catch { throw new Error('SQL financial report differs from the original calculation.'); }
      }
      return { ...parity, sqlReportsMatch: true, sqlRangesChecked: ranges.length, integrity: 'ok' };
    })();
    if (readEncryptedSnapshot(source, sourceKey).sourceSha256 !== sourceSha256) throw new Error('Source changed during verification; repeat with both apps stopped.');
    return { ...result, sourceUnchanged: true, storeId, migrationDataVerified: true, activated: false, desktopKeyVerification: 'separate-required-check' };
  } finally {
    if (db?.open) db.close();
    sourceKey?.fill(0); key?.fill(0);
  }
}

if (require.main === module) {
  try {
    const { values } = parseArgs({ options: { source: { type: 'string' }, 'source-key-file': { type: 'string' }, target: { type: 'string' }, 'target-key-file': { type: 'string' }, store: { type: 'string', default: 'main' } } });
    console.log(JSON.stringify(verifyDatabase({ source: values.source, sourceKeyFile: values['source-key-file'], target: values.target, targetKeyFile: values['target-key-file'], storeId: values.store }), null, 2));
  } catch (error) { console.error('Database verification failed:', error.message); process.exitCode = 1; }
}
module.exports = { verifyDatabase };
