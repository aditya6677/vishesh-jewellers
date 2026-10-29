'use strict';
const { RecordService } = require('../services/record-service');
const { createHash } = require('node:crypto');
const version = record => createHash('sha256').update(JSON.stringify(record)).digest('hex');

class RecordRepository {
  constructor(db, storeId, dependencies = {}) {
    if (typeof storeId !== 'string' || !storeId) throw new Error('A store identity is required.');
    this.db = db; this.storeId = storeId; this.dependencies = dependencies;
    if (!db.prepare('SELECT 1 FROM stores WHERE store_id=?').get(storeId)) throw new Error('Import a store first.');
    db.exec('CREATE TABLE IF NOT EXISTS store_revisions (store_id TEXT PRIMARY KEY REFERENCES stores(store_id), revision INTEGER NOT NULL)');
    db.prepare('INSERT OR IGNORE INTO store_revisions VALUES(?,0)').run(storeId);
  }
  raw(number) {
    const row = this.db.prepare("SELECT payload FROM documents WHERE store_id=? AND collection='invoice-records' AND identity=?").get(this.storeId, String(number));
    if (!row) throw Object.assign(new Error('Invoice no longer exists. Refresh Records.'), { statusCode: 404 });
    return JSON.parse(row.payload);
  }
  service(record) {
    // Existing settlement rules require only this invoice and produce a receipt
    // delta. Never expose unrelated invoices or load the complete metal ledger.
    let data = { 'invoice-records': [record], 'old-gold-records': [] };
    const service = new RecordService({ read: () => structuredClone(data), write: next => { data = structuredClone(next); } }, this.dependencies);
    return { service, result: () => data };
  }
  get(number, revision = '') { return this.service(this.raw(number)).service.get(number, revision); }
  page({ limit = 10, cursor = null } = {}) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error('Page size must be 1–100.');
    if (cursor !== null && !Number.isSafeInteger(cursor)) throw new Error('Invalid record cursor.');
    const rows = this.db.prepare(`SELECT ordinal,payload FROM documents WHERE store_id=? AND collection='invoice-records' ${cursor === null ? '' : 'AND ordinal>?'} ORDER BY ordinal LIMIT ?`).all(...(cursor === null ? [this.storeId, limit + 1] : [this.storeId, cursor, limit + 1]));
    const chosen = rows.slice(0, limit);
    const entries = chosen.map(row => { const original = JSON.parse(row.payload); return this.service(original).service.get(original.number); });
    return { items: entries.map(entry => entry.record), versions: Object.fromEntries(entries.map(entry => [entry.record.number, entry.version])), next: rows.length > limit ? chosen.at(-1).ordinal : null };
  }
  settle(number, input) {
    return this.db.transaction(() => {
      const original = this.raw(number), scoped = this.service(original);
      const result = scoped.service.settle(number, input);
      const changes = scoped.result();
      if (changes['invoice-records'].length !== 1 || changes['invoice-records'][0].number !== number || changes['old-gold-records'].length > 1) throw new Error('Unexpected settlement delta.');
      this.db.prepare("UPDATE documents SET payload=? WHERE store_id=? AND collection='invoice-records' AND identity=?").run(JSON.stringify(changes['invoice-records'][0]), this.storeId, number);
      for (const receipt of changes['old-gold-records']) {
        const property = this.db.prepare("SELECT is_collection FROM store_properties WHERE store_id=? AND name='old-gold-records'").get(this.storeId);
        if (property && property.is_collection !== 1) throw new Error('Invalid metal ledger.');
        if (!property) {
          const position = this.db.prepare('SELECT coalesce(max(position),-1)+1 AS n FROM store_properties WHERE store_id=?').get(this.storeId).n;
          this.db.prepare("INSERT INTO store_properties VALUES(?,'old-gold-records',?,1,NULL)").run(this.storeId, position);
        }
        const ordinal = this.db.prepare("SELECT coalesce(min(ordinal),0)-1 AS n FROM documents WHERE store_id=? AND collection='old-gold-records'").get(this.storeId).n;
        if (!Number.isSafeInteger(ordinal)) throw new Error('Metal ledger position overflow.');
        this.db.prepare("INSERT INTO documents VALUES(?,'old-gold-records',?,NULL,?)").run(this.storeId, ordinal, JSON.stringify(receipt));
      }
      if (result.version !== version(changes['invoice-records'][0])) throw new Error('Settlement revision mismatch.');
      this.db.prepare('UPDATE store_revisions SET revision=revision+1 WHERE store_id=?').run(this.storeId);
      return result;
    }).immediate();
  }
}
module.exports = { RecordRepository };
