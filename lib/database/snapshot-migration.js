'use strict';

// Lossless canonical documents with transactional relational report projections.
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { StorageKey } = require('../domain/constants');
const { DashboardService } = require('../services/dashboard-service');
const { auditSnapshot } = require('./migration-preflight');
const collections = new Set(Object.values(StorageKey));
const fingerprint = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');

function createStoreSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS stores (
      store_id TEXT PRIMARY KEY CHECK(length(store_id) BETWEEN 1 AND 128), source_sha256 TEXT NOT NULL,
      imported_snapshot_sha256 TEXT NOT NULL, imported_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS store_properties (
      store_id TEXT NOT NULL REFERENCES stores(store_id),
      name TEXT NOT NULL, position INTEGER NOT NULL, is_collection INTEGER NOT NULL CHECK(is_collection IN (0,1)),
      payload TEXT CHECK((is_collection=1 AND payload IS NULL) OR (is_collection=0 AND payload IS NOT NULL AND json_valid(payload))),
      PRIMARY KEY(store_id,name), UNIQUE(store_id,position)
    );
    CREATE TABLE IF NOT EXISTS documents (
      store_id TEXT NOT NULL, collection TEXT NOT NULL CHECK(collection IN ('stock-list','invoice-records','purchase-records','payment-records','old-gold-records')),
      ordinal INTEGER NOT NULL CHECK(ordinal BETWEEN -9007199254740991 AND 9007199254740991),
      identity TEXT, payload TEXT NOT NULL CHECK(json_valid(payload)),
      PRIMARY KEY(store_id,collection,ordinal),
      FOREIGN KEY(store_id,collection) REFERENCES store_properties(store_id,name)
    );
    CREATE UNIQUE INDEX IF NOT EXISTS documents_identity ON documents(store_id,collection,identity) WHERE identity IS NOT NULL;
    CREATE TABLE IF NOT EXISTS store_revisions(store_id TEXT PRIMARY KEY REFERENCES stores(store_id), revision INTEGER NOT NULL CHECK(revision>=0));
    CREATE TRIGGER IF NOT EXISTS revision_insert AFTER INSERT ON documents BEGIN UPDATE store_revisions SET revision=revision+1 WHERE store_id=NEW.store_id; END;
    CREATE TRIGGER IF NOT EXISTS revision_update AFTER UPDATE ON documents BEGIN UPDATE store_revisions SET revision=revision+1 WHERE store_id=NEW.store_id; END;
    CREATE TRIGGER IF NOT EXISTS revision_delete AFTER DELETE ON documents BEGIN UPDATE store_revisions SET revision=revision+1 WHERE store_id=OLD.store_id; END;
  `);
}

function readSnapshot(db, storeId) {
  if (!db.prepare('SELECT 1 FROM stores WHERE store_id=?').get(storeId)) throw new Error('Store not found.');
  return Object.fromEntries(db.prepare('SELECT * FROM store_properties WHERE store_id=? ORDER BY position').all(storeId).map(property => [property.name,
    property.is_collection ? db.prepare('SELECT payload FROM documents WHERE store_id=? AND collection=? ORDER BY ordinal').all(storeId, property.name).map(row => JSON.parse(row.payload)) : JSON.parse(property.payload)
  ]));
}

function dashboard(snapshot, range) { return new DashboardService({ read: () => structuredClone(snapshot) }).snapshot(range); }

function reconcile(source, target) {
  assert.deepStrictEqual(target, source, 'Snapshot records/settings changed during import.');
  assert.deepStrictEqual(dashboard(target), dashboard(source), 'All-time dashboard mismatch.');
  const dates = (source[StorageKey.INVOICES] || []).map(row => row.invoiceDate).filter(date => typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date)).sort();
  const ranges = dates.length ? [{ from: dates[0], to: dates.at(-1) }, { from: dates.at(-1), to: dates.at(-1) }] : [];
  for (const range of ranges) assert.deepStrictEqual(dashboard(target, range), dashboard(source, range), 'Date-range dashboard mismatch.');
  return { exactSnapshotMatch: true, dashboardMatch: true, checkedDateRanges: ranges.length };
}

function importSnapshot(db, snapshot, { storeId, sourceSha256, acknowledgeLegacy = false }) {
  if (typeof storeId !== 'string' || !storeId.trim() || storeId.length > 128) throw new Error('A store identity is required.');
  if (!/^[a-f0-9]{64}$/.test(sourceSha256)) throw new Error('Source fingerprint is required.');
  const audit = auditSnapshot(snapshot);
  if (audit.blockingErrors) throw new Error('Source has blocking preflight errors.');
  if (audit.requiresReview && !acknowledgeLegacy) throw new Error('Explicit legacy-preservation acknowledgement is required.');
  createStoreSchema(db);
  return db.transaction(() => {
    db.prepare('INSERT INTO stores VALUES(?,?,?,?)').run(storeId, sourceSha256, fingerprint(snapshot), new Date().toISOString());
    db.prepare('INSERT INTO store_revisions VALUES(?,0)').run(storeId);
    const property = db.prepare('INSERT INTO store_properties VALUES(?,?,?,?,?)');
    const document = db.prepare('INSERT INTO documents VALUES(?,?,?,?,?)');
    Object.entries(snapshot).forEach(([name, value], position) => {
      const collection = collections.has(name);
      property.run(storeId, name, position, collection ? 1 : 0, collection ? null : JSON.stringify(value));
      if (collection) value.forEach((record, ordinal) => {
        const identity = name === StorageKey.INVOICES ? record.number : name === StorageKey.OLD_METAL ? null : record.id;
        document.run(storeId, name, ordinal, identity == null ? null : String(identity), JSON.stringify(record));
      });
    });
    return { ...reconcile(snapshot, readSnapshot(db, storeId)), counts: audit.counts, legacyWarnings: audit.issues.length, migratedLiveApp: false };
  }).immediate();
}

module.exports = { createStoreSchema, importSnapshot, readSnapshot, reconcile };
