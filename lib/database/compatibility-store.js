'use strict';

// Transitional service adapter for parity testing, not the scalable final API.
const { importSnapshot, readSnapshot } = require('./snapshot-migration');

class CompatibilityStore {
  constructor(db, storeId) {
    this.db = db; this.storeId = storeId; this.observedRevision = null;
    db.exec('CREATE TABLE IF NOT EXISTS store_revisions (store_id TEXT PRIMARY KEY REFERENCES stores(store_id), revision INTEGER NOT NULL)');
    db.prepare('INSERT OR IGNORE INTO store_revisions VALUES(?,0)').run(storeId);
  }
  read() {
    return this.db.transaction(() => {
      this.observedRevision = this.db.prepare('SELECT revision FROM store_revisions WHERE store_id=?').get(this.storeId).revision;
      return readSnapshot(this.db, this.storeId);
    })();
  }
  write(snapshot) {
    if (this.observedRevision === null) throw new Error('Read a snapshot before writing.');
    const next = this.db.transaction(() => {
      const current = this.db.prepare('SELECT revision FROM store_revisions WHERE store_id=?').get(this.storeId).revision;
      if (current !== this.observedRevision) throw new Error('Database changed; reload before saving.');
      const source = this.db.prepare('SELECT source_sha256 FROM stores WHERE store_id=?').get(this.storeId).source_sha256;
      this.db.prepare('DELETE FROM store_revisions WHERE store_id=?').run(this.storeId);
      this.db.prepare('DELETE FROM documents WHERE store_id=?').run(this.storeId);
      this.db.prepare('DELETE FROM store_properties WHERE store_id=?').run(this.storeId);
      this.db.prepare('DELETE FROM stores WHERE store_id=?').run(this.storeId);
      importSnapshot(this.db, snapshot, { storeId: this.storeId, sourceSha256: source, acknowledgeLegacy: true });
      this.db.prepare('UPDATE store_revisions SET revision=? WHERE store_id=?').run(current + 1, this.storeId);
      return current + 1;
    }).immediate();
    this.observedRevision = next;
  }
  execute(operation) {
    const observed = this.observedRevision;
    try { return this.db.transaction(() => {
      const result = operation();
      if (result && typeof result.then === 'function') throw new Error('Database service operations must be synchronous.');
      return result;
    }).immediate(); }
    catch (error) { this.observedRevision = observed; throw error; }
  }
}

module.exports = { CompatibilityStore };
