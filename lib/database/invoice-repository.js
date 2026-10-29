'use strict';
const { RecordRepository } = require('./record-repository');
const { createInvoice } = require('../services/invoice-creation');
const { editInvoice } = require('../services/invoice-editing');
const { voidInvoice } = require('../services/invoice-voiding');
const { deleteInvoice } = require('../delete-invoice');
const { balances } = require('./metal-balances');
const { ensureProperty } = require('./properties');

class InvoiceRepository extends RecordRepository {
  constructor(db, storeId, dependencies = {}) {
    super(db, storeId, dependencies);
    db.exec("CREATE INDEX IF NOT EXISTS invoice_request_lookup ON documents(store_id,collection,json_extract(payload,'$.creationRequestId')) WHERE collection='invoice-records'");
    db.exec("CREATE INDEX IF NOT EXISTS metal_source_lookup ON documents(store_id,collection,json_extract(payload,'$.sourceId')) WHERE collection='old-gold-records'");
  }
  void(number, input) { return this.reverse(number, input, false); }
  delete(number) { return this.reverse(number, null, true); }
  reverse(number, input, deleting) {
    return this.db.transaction(() => {
      const original = this.raw(number);
      const stockQuery = this.db.prepare("SELECT payload FROM documents WHERE store_id=? AND collection='stock-list' AND identity=?");
      const stocks = [];
      for (const id of new Set((original.soldItems || []).map(item => String(item.stockId)))) {
        const row = stockQuery.get(this.storeId, id); if (row) stocks.push(JSON.parse(row.payload));
      }
      const before = balances(this.db, this.storeId, { legacyDefault: true });
      const after = balances(this.db, this.storeId, { legacyDefault: true, excludeInvoice: number });
      for (const metal of ['gold','silver']) if (after[metal] < Math.min(0, before[metal]) - .0001) throw new Error('Cannot ' + (deleting ? 'delete' : 'void') + ': the old ' + metal + ' received on this invoice has already been used. Adjust the linked outgoing metal payments first.');
      const linked = this.db.prepare("SELECT d.ordinal,d.payload,(SELECT count(*) FROM documents p WHERE p.store_id=d.store_id AND p.collection=d.collection AND p.ordinal<d.ordinal) AS original_index FROM documents d JOIN metal_movements m ON m.store_id=d.store_id AND m.ordinal=d.ordinal WHERE d.store_id=? AND d.collection='old-gold-records' AND m.invoice=? ORDER BY d.ordinal").all(this.storeId, number);
      const ledger = linked.map(row => JSON.parse(row.payload));
      let scoped = { 'invoice-records': [original], 'stock-list': stocks, 'old-gold-records': ledger };
      let result;
      if (deleting) scoped = deleteInvoice(scoped, number);
      else result = voidInvoice({ read: () => structuredClone(scoped), write: next => { scoped = next; } }, number, input, this.dependencies.now);
      for (const collection of ['stock-list','old-gold-records']) this.ensureProperty(collection, true, null);
      for (const stock of scoped['stock-list']) this.db.prepare("UPDATE documents SET payload=? WHERE store_id=? AND collection='stock-list' AND identity=?").run(JSON.stringify(stock), this.storeId, String(stock.id));
      if (deleting) {
        this.db.prepare("DELETE FROM documents WHERE store_id=? AND collection='invoice-records' AND identity=?").run(this.storeId, number);
        this.db.prepare("DELETE FROM documents WHERE store_id=? AND collection='old-gold-records' AND json_extract(payload,'$.invoice')=?").run(this.storeId, number);
      } else {
        this.db.prepare("UPDATE documents SET payload=? WHERE store_id=? AND collection='invoice-records' AND identity=?").run(JSON.stringify(result.record), this.storeId, number);
        const receipts = scoped['old-gold-records'].slice(0, scoped['old-gold-records'].length - ledger.length);
        receipts.forEach((receipt, index) => { receipt.sourceId = 'void:' + number + ':' + linked[index].original_index; });
        if (receipts.length) {
          const start = this.db.prepare("SELECT coalesce(min(ordinal),0) AS n FROM documents WHERE store_id=? AND collection='old-gold-records'").get(this.storeId).n - receipts.length;
          if (!Number.isSafeInteger(start)) throw new Error('Metal ledger position overflow.');
          receipts.forEach((receipt, i) => this.db.prepare("INSERT INTO documents VALUES(?,'old-gold-records',?,NULL,?)").run(this.storeId, start + i, JSON.stringify(receipt)));
        }
      }
      this.db.prepare('UPDATE store_revisions SET revision=revision+1 WHERE store_id=?').run(this.storeId);
      return deleting ? { deleted: true } : result;
    }).immediate();
  }
  edit(number, input) {
    return this.db.transaction(() => {
      const previous = this.raw(number);
      const ids = new Set((previous.soldItems || []).map(item => String(item.stockId)));
      if (Array.isArray(input?.items) && input.items.length <= 500) for (const item of input.items) if (typeof item?.stockId === 'string') ids.add(item.stockId.trim());
      const stocks = [];
      const query = this.db.prepare("SELECT payload FROM documents WHERE store_id=? AND collection='stock-list' AND identity=?");
      for (const id of ids) { const row = query.get(this.storeId, id); if (row) stocks.push(JSON.parse(row.payload)); }
      const prefix = number + ':exchange:';
      const exchanges = this.db.prepare("SELECT ordinal,payload FROM documents WHERE store_id=? AND collection='old-gold-records' AND json_extract(payload,'$.sourceId')>=? AND json_extract(payload,'$.sourceId')<? ORDER BY ordinal").all(this.storeId, prefix, prefix + '\uffff');
      const counter = this.db.prepare("SELECT payload FROM store_properties WHERE store_id=? AND name='invoice-counter' AND is_collection=0").get(this.storeId);
      let scoped = { 'invoice-records': [previous], 'stock-list': stocks, 'old-gold-records': exchanges.map(row => JSON.parse(row.payload)), 'invoice-counter': counter ? JSON.parse(counter.payload) : 1 };
      const result = editInvoice({ read: () => structuredClone(scoped), write: next => { scoped = next; } }, number, input, this.dependencies.now);
      for (const collection of ['stock-list','old-gold-records']) this.ensureProperty(collection, true, null);
      for (const stock of scoped['stock-list']) {
        const saved = query.get(this.storeId, String(stock.id));
        if (saved) this.db.prepare("UPDATE documents SET payload=? WHERE store_id=? AND collection='stock-list' AND identity=?").run(JSON.stringify(stock), this.storeId, String(stock.id));
        else {
          const ordinal = this.db.prepare("SELECT coalesce(max(ordinal),-1)+1 AS n FROM documents WHERE store_id=? AND collection='stock-list'").get(this.storeId).n;
          if (!Number.isSafeInteger(ordinal)) throw new Error('Stock position overflow.');
          this.db.prepare("INSERT INTO documents VALUES(?,'stock-list',?,?,?)").run(this.storeId, ordinal, String(stock.id), JSON.stringify(stock));
        }
      }
      this.db.prepare("UPDATE documents SET payload=? WHERE store_id=? AND collection='invoice-records' AND identity=?").run(JSON.stringify(result.record), this.storeId, number);
      for (const row of exchanges) this.db.prepare("DELETE FROM documents WHERE store_id=? AND collection='old-gold-records' AND ordinal=?").run(this.storeId, row.ordinal);
      const receipts = scoped['old-gold-records'];
      if (receipts.length) {
        this.ensureProperty('old-gold-records', true, null);
        const start = this.db.prepare("SELECT coalesce(min(ordinal),0) AS n FROM documents WHERE store_id=? AND collection='old-gold-records'").get(this.storeId).n - receipts.length;
        if (!Number.isSafeInteger(start)) throw new Error('Metal ledger position overflow.');
        receipts.forEach((receipt, i) => this.db.prepare("INSERT INTO documents VALUES(?,'old-gold-records',?,NULL,?)").run(this.storeId, start + i, JSON.stringify(receipt)));
      }
      this.db.prepare('UPDATE store_revisions SET revision=revision+1 WHERE store_id=?').run(this.storeId);
      return { ...result, stockScope: 'affected-only' };
    }).immediate();
  }
  create(input) {
    return this.db.transaction(() => {
      const records = this.db.prepare("SELECT ordinal,payload FROM documents WHERE store_id=? AND collection='invoice-records' AND json_extract(payload,'$.creationRequestId')=? ORDER BY ordinal LIMIT 1").all(this.storeId, typeof input?.requestId === 'string' ? input.requestId.trim() : '');
      const duplicate = this.db.prepare("SELECT ordinal,payload FROM documents WHERE store_id=? AND collection='invoice-records' AND identity=?").get(this.storeId, typeof input?.number === 'string' ? input.number.trim() : '');
      if (duplicate && !records.some(row => row.ordinal === duplicate.ordinal)) records.push(duplicate);
      records.sort((a, b) => a.ordinal - b.ordinal);
      const stock = [];
      if (input?.status === 'completed' && Array.isArray(input.items) && input.items.length <= 500) {
        const ids = new Set(input.items.map(item => typeof item?.stockId === 'string' ? item.stockId.trim() : '').filter(Boolean));
        const query = this.db.prepare("SELECT payload FROM documents WHERE store_id=? AND collection='stock-list' AND identity=?");
        for (const id of ids) { const row = query.get(this.storeId, id); if (row) stock.push(JSON.parse(row.payload)); }
      }
      const counter = this.db.prepare("SELECT payload FROM store_properties WHERE store_id=? AND name='invoice-counter' AND is_collection=0").get(this.storeId);
      let scoped = { 'invoice-records': records.map(row => JSON.parse(row.payload)), 'stock-list': stock, 'old-gold-records': [], 'invoice-counter': counter ? JSON.parse(counter.payload) : 1 };
      let changed = false;
      // Preserve the exact validated financial function; only its persistence
      // view is scoped to indexed lookups and affected rows.
      const result = createInvoice({ read: () => structuredClone(scoped), write: next => { scoped = next; changed = true; } }, input, this.dependencies.now);
      if (!changed) return { ...result, stockScope: 'affected-only' };
      for (const collection of ['invoice-records','old-gold-records','stock-list']) this.ensureProperty(collection, true, null);
      for (const item of scoped['stock-list']) this.db.prepare("UPDATE documents SET payload=? WHERE store_id=? AND collection='stock-list' AND identity=?").run(JSON.stringify(item), this.storeId, String(item.id));
      const ordinal = this.db.prepare("SELECT coalesce(min(ordinal),0)-1 AS n FROM documents WHERE store_id=? AND collection='invoice-records'").get(this.storeId).n;
      if (!Number.isSafeInteger(ordinal)) throw new Error('Invoice position overflow.');
      this.db.prepare("INSERT INTO documents VALUES(?,'invoice-records',?,?,?)").run(this.storeId, ordinal, result.record.number, JSON.stringify(result.record));
      const receipts = scoped['old-gold-records'];
      if (receipts.length) {
        this.ensureProperty('old-gold-records', true, null);
        const start = this.db.prepare("SELECT coalesce(min(ordinal),0) AS n FROM documents WHERE store_id=? AND collection='old-gold-records'").get(this.storeId).n - receipts.length;
        if (!Number.isSafeInteger(start)) throw new Error('Metal ledger position overflow.');
        receipts.forEach((receipt, i) => this.db.prepare("INSERT INTO documents VALUES(?,'old-gold-records',?,NULL,?)").run(this.storeId, start + i, JSON.stringify(receipt)));
      }
      this.ensureProperty('invoice-counter', false, JSON.stringify(scoped['invoice-counter']));
      this.db.prepare("UPDATE store_properties SET payload=? WHERE store_id=? AND name='invoice-counter' AND is_collection=0").run(JSON.stringify(scoped['invoice-counter']), this.storeId);
      this.db.prepare('UPDATE store_revisions SET revision=revision+1 WHERE store_id=?').run(this.storeId);
      return { ...result, stockScope: 'affected-only' };
    }).immediate();
  }
  ensureProperty(name, collection, payload) {
    ensureProperty(this.db, this.storeId, name, collection, payload);
  }
}
module.exports = { InvoiceRepository };
