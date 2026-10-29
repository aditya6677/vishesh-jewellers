'use strict';
const { TransactionService, validateTransactionDetails } = require('../services/transaction-service');
const { randomUUID } = require('node:crypto');
const { balances } = require('./metal-balances');
const { ensureProperty } = require('./properties');
const collections = Object.freeze({ purchases: 'purchase-records', payments: 'payment-records' });
const prefixes = Object.freeze({ purchases: 'purchase:', payments: 'payment:' });

class TransactionRepository {
  constructor(db, storeId, dependencies = {}) {
    this.db = db; this.storeId = storeId; this.dependencies = dependencies;
    if (typeof storeId !== 'string' || !db.prepare('SELECT 1 FROM stores WHERE store_id=?').get(storeId)) throw new Error('Import a store first.');
    db.exec('CREATE TABLE IF NOT EXISTS store_revisions (store_id TEXT PRIMARY KEY REFERENCES stores(store_id), revision INTEGER NOT NULL)');
    db.prepare('INSERT OR IGNORE INTO store_revisions VALUES(?,0)').run(storeId);
    db.exec("CREATE INDEX IF NOT EXISTS metal_source_lookup ON documents(store_id,collection,json_extract(payload,'$.sourceId')) WHERE collection='old-gold-records'");
  }
  collection(kind) { if (!collections[kind]) throw new Error('Unknown transaction kind.'); return collections[kind]; }
  get(kind, id) {
    return this.db.transaction(() => {
    const collection = this.collection(kind);
    const row = this.db.prepare('SELECT payload FROM documents WHERE store_id=? AND collection=? AND identity=?').get(this.storeId, collection, String(id));
    if (!row) throw Object.assign(new Error('This entry no longer exists. Refresh the list.'), { statusCode: 404 });
    const item = JSON.parse(row.payload);
    const linked = this.db.prepare("SELECT payload FROM documents WHERE store_id=? AND collection='old-gold-records' AND json_extract(payload,'$.sourceId')=? ORDER BY ordinal").all(this.storeId, prefixes[kind] + item.id).map(entry => JSON.parse(entry.payload));
    return { item, version: new TransactionService(null).revision(kind, item, linked) };
    })();
  }
  page(kind, { limit = 10, cursor = null } = {}) {
    return this.db.transaction(() => {
    const collection = this.collection(kind);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error('Page size must be 1–100.');
    if (cursor !== null && !Number.isSafeInteger(cursor)) throw new Error('Invalid transaction cursor.');
    const rows = this.db.prepare(`SELECT ordinal,payload FROM documents WHERE store_id=? AND collection=? ${cursor === null ? '' : 'AND ordinal>?'} ORDER BY ordinal LIMIT ?`).all(...(cursor === null ? [this.storeId, collection, limit + 1] : [this.storeId, collection, cursor, limit + 1]));
    const selected = rows.slice(0, limit), items = selected.map(row => JSON.parse(row.payload));
    return { items, versions: Object.fromEntries(items.map(item => [item.id, this.get(kind, item.id).version])), next: rows.length > limit ? selected.at(-1).ordinal : null };
    })();
  }
  save(kind, input, id, deleting = false) {
    const collection = this.collection(kind);
    if (deleting && id === undefined) throw new Error('Select an entry before deleting.');
    return this.db.transaction(() => {
      const previous = id === undefined ? null : this.get(kind, id);
      if (previous && input?.version !== previous.version) throw Object.assign(new Error('This entry changed. Refresh and reopen it before saving.'), { statusCode: 409 });
      const entryId = previous?.item.id ?? (this.dependencies.id || randomUUID)();
      const sourceId = prefixes[kind] + entryId;
      const before = balances(this.db, this.storeId);
      const available = balances(this.db, this.storeId, { excludeSource: sourceId });
      let item = previous?.item;
      if (!deleting) {
        const values = validateTransactionDetails(kind, input);
        item = { ...item, ...values, id: entryId, savedAt: item?.savedAt || (this.dependencies.now || (() => new Date()))().toISOString() };
        if (kind === 'payments') for (const field of ['amount','metal','weight','purity','fineWeight','rate']) if (!(field in values)) delete item[field];
        if (kind === 'payments' && item.type === 'metal' && item.weight > available[item.metal] + .0001) throw Object.assign(new Error('Not enough old ' + item.metal + ' available for this payment.'), { statusCode: 400 });
      }
      const identity = String(entryId);
      ensureProperty(this.db, this.storeId, collection, true, null);
      ensureProperty(this.db, this.storeId, 'old-gold-records', true, null);
      if (deleting) this.db.prepare('DELETE FROM documents WHERE store_id=? AND collection=? AND identity=?').run(this.storeId, collection, identity);
      else if (previous) this.db.prepare('UPDATE documents SET payload=? WHERE store_id=? AND collection=? AND identity=?').run(JSON.stringify(item), this.storeId, collection, identity);
      else {
        const ordinal = this.db.prepare('SELECT coalesce(min(ordinal),0)-1 AS n FROM documents WHERE store_id=? AND collection=?').get(this.storeId, collection).n;
        if (!Number.isSafeInteger(ordinal)) throw new Error('Transaction position overflow.');
        this.db.prepare('INSERT INTO documents VALUES(?,?,?,?,?)').run(this.storeId, collection, ordinal, identity, JSON.stringify(item));
      }
      this.db.prepare("DELETE FROM documents WHERE store_id=? AND collection='old-gold-records' AND json_extract(payload,'$.sourceId')=?").run(this.storeId, sourceId);
      if (!deleting && (kind === 'purchases' || item.type === 'metal')) {
        const receipt = { sourceId, metal: item.metal, source: kind === 'purchases' ? 'Old metal purchase' : 'Metal payment', invoice: '—', customer: '—', date: new Date(item.savedAt).toLocaleDateString('en-GB'), weight: kind === 'purchases' ? item.weight : -item.weight, rate: item.rate || 0, value: kind === 'purchases' ? item.amount : 0, receivedAt: item.savedAt };
        const ordinal = this.db.prepare("SELECT coalesce(min(ordinal),0)-1 AS n FROM documents WHERE store_id=? AND collection='old-gold-records'").get(this.storeId).n;
        if (!Number.isSafeInteger(ordinal)) throw new Error('Metal ledger position overflow.');
        this.db.prepare("INSERT INTO documents VALUES(?,'old-gold-records',?,NULL,?)").run(this.storeId, ordinal, JSON.stringify(receipt));
      }
      const after = balances(this.db, this.storeId);
      for (const metal of ['gold','silver']) if (after[metal] < Math.min(before[metal], 0) - .0001) throw Object.assign(new Error('This change would leave insufficient old ' + metal + '. Adjust the linked metal payments first.'), { statusCode: 400 });
      this.db.prepare('UPDATE store_revisions SET revision=revision+1 WHERE store_id=?').run(this.storeId);
      const result = deleting ? null : this.get(kind, entryId);
      return { items: result ? [result.item] : [], versions: result ? { [entryId]: result.version } : {}, balances: after, scope: 'affected-only', deleted: deleting };
    }).immediate();
  }
}
module.exports = { TransactionRepository };
