'use strict';
const { createHash, randomUUID } = require('node:crypto');
const { validateStock } = require('../services/stock-service');
const { ensureProperty } = require('./properties');
const COLLECTION = 'stock-list';
const version = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const fail = (message, statusCode) => { throw Object.assign(new Error(message), { statusCode }); };

class StockRepository {
  constructor(db, storeId, { now = () => new Date(), id = randomUUID } = {}) {
    if (typeof storeId !== 'string' || !storeId) throw new Error('A store identity is required.');
    this.db = db; this.storeId = storeId; this.now = now; this.id = id;
    if (!db.prepare('SELECT 1 FROM stores WHERE store_id=?').get(storeId)) throw new Error('Import a store first.');
    db.exec('CREATE TABLE IF NOT EXISTS store_revisions (store_id TEXT PRIMARY KEY REFERENCES stores(store_id), revision INTEGER NOT NULL)');
    db.prepare('INSERT OR IGNORE INTO store_revisions VALUES(?,0)').run(storeId);
  }
  page({ limit = 10, cursor = null } = {}) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error('Page size must be 1–100.');
    if (cursor !== null && !Number.isSafeInteger(cursor)) throw new Error('Invalid stock cursor.');
    const args = [this.storeId, COLLECTION];
    if (cursor !== null) args.push(cursor);
    const rows = this.db.prepare(`SELECT ordinal,payload FROM documents WHERE store_id=? AND collection=? ${cursor === null ? '' : 'AND ordinal>?'} ORDER BY ordinal LIMIT ?`).all(...args, limit + 1);
    const selected = rows.slice(0, limit), items = selected.map(row => JSON.parse(row.payload));
    return { items, versions: Object.fromEntries(items.map(item => [item.id, version(item)])), next: rows.length > limit ? selected.at(-1).ordinal : null };
  }
  get(id) {
    const row = this.db.prepare('SELECT payload FROM documents WHERE store_id=? AND collection=? AND identity=?').get(this.storeId, COLLECTION, String(id));
    if (!row) fail('This stock item is no longer available. Refresh Stocks and try again.', 404);
    const item = JSON.parse(row.payload);
    return { item, version: version(item) };
  }
  changed() {
    this.db.prepare('UPDATE store_revisions SET revision=revision+1 WHERE store_id=?').run(this.storeId);
  }
  create(input) {
    const details = validateStock(input);
    return this.db.transaction(() => {
      ensureProperty(this.db, this.storeId, COLLECTION, true, null);
      const ordinal = this.db.prepare('SELECT coalesce(max(ordinal),-1)+1 AS value FROM documents WHERE store_id=? AND collection=?').get(this.storeId, COLLECTION).value;
      if (!Number.isSafeInteger(ordinal)) throw new Error('Stock position is too large.');
      const item = { id: this.id(), ...details, rate: 0, added: this.now().toLocaleDateString('en-IN') };
      if (typeof item.id !== 'string' || !item.id) throw new Error('Invalid stock identity.');
      this.db.prepare('INSERT INTO documents VALUES(?,?,?,?,?)').run(this.storeId, COLLECTION, ordinal, item.id, JSON.stringify(item));
      this.changed(); return { item, version: version(item) };
    }).immediate();
  }
  mutate(id, input, operation) {
    if (!['edit', 'batch', 'delete'].includes(operation)) throw new Error('Unknown stock operation.');
    return this.db.transaction(() => {
      const saved = this.get(id);
      if (!input?.version || input.version !== saved.version) fail('This stock item changed since you opened it. Refresh Stocks and reopen the item before saving.', 409);
      let item = saved.item;
      if (operation === 'delete') this.db.prepare('DELETE FROM documents WHERE store_id=? AND collection=? AND identity=?').run(this.storeId, COLLECTION, String(id));
      else {
        if (operation === 'batch') {
          const batch = validateStock(input, true);
          item = { ...item, qty: (Number(item.qty) || 0) + batch.qty, gross: (Number(item.gross) || 0) + batch.gross, net: (Number(item.net) || 0) + batch.net };
          if (!Number.isSafeInteger(item.qty) || !Number.isFinite(item.gross) || !Number.isFinite(item.net)) fail('Resulting quantity or weight is too large.', 400);
        } else item = { ...item, ...validateStock(input) };
        this.db.prepare('UPDATE documents SET payload=? WHERE store_id=? AND collection=? AND identity=?').run(JSON.stringify(item), this.storeId, COLLECTION, String(id));
      }
      this.changed(); return operation === 'delete' ? { deleted: true } : { item, version: version(item) };
    }).immediate();
  }
}
module.exports = { StockRepository };
