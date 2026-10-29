'use strict';
const { RecordService, normalizeRecord } = require('../services/record-service');
const { TransactionService } = require('../services/transaction-service');
const { matchPhrase } = require('./search-schema');
const hash = value => require('node:crypto').createHash('sha256').update(JSON.stringify(value)).digest('hex');
function paging(input = {}) {
  const page = Number(input.page || 1), pageSize = Number(input.pageSize || 10);
  if (!Number.isSafeInteger(page) || page < 1 || ![10, 25, 50, 100].includes(pageSize) || !Number.isSafeInteger((page - 1) * pageSize)) throw Object.assign(new Error('Invalid page or page size.'), { statusCode: 400 });
  return { page, pageSize };
}
function rangeBounds(range = {}) {
  for (const value of [range.from, range.to]) if (value) {
    const date = new Date(value + 'T00:00:00Z');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw Object.assign(new Error('Enter a valid date range.'), { statusCode: 400 });
  }
  if (range.from && range.to && range.from > range.to) throw Object.assign(new Error('From date must not follow To date.'), { statusCode: 400 });
  return { start: range.from ? new Date(range.from + 'T00:00:00').getTime() : -8640000000000000, end: range.to ? new Date(range.to + 'T23:59:59.999').getTime() : 8640000000000000, ranged: Boolean(range.from || range.to) };
}
class DatabaseQueries {
  constructor(db, storeId) { this.db = db; this.storeId = storeId; this.reportCache = new Map(); }
  scalar(sql, args = []) { return this.db.prepare(sql).get(this.storeId, ...args)?.value || 0; }
  sum(table, field, where = '', args = [], order = 'ordinal') {
    return this.scalar(`SELECT vj_sum(value) AS value FROM (SELECT ${field} AS value FROM ${table} WHERE store_id=? ${where} ORDER BY ${order})`, args);
  }
  stockTotals() {
    return Object.fromEntries(['gold', 'silver'].map(metal => [metal, { count: this.scalar('SELECT count(*) AS value FROM stock_facts WHERE store_id=? AND metal=?', [metal]), gross: this.sum('stock_facts', 'gross', 'AND metal=?', [metal]), net: this.sum('stock_facts', 'net', 'AND metal=?', [metal]), available: this.sum('stock_facts', 'available', 'AND metal=?', [metal]) }]));
  }
  stockList(input = {}) {
    return this.db.transaction(() => {
      const options = paging(input), query = String(input.query || '').toLowerCase();
      if (query.length > 256) throw Object.assign(new Error('Search text is too long (maximum 256 characters).'), { statusCode: 400 });
      const indexed = query.length >= 3;
      const where = "d.store_id=? AND d.collection='stock-list' AND " + (indexed ? "d.rowid IN(SELECT rowid FROM document_search WHERE document_search MATCH ? AND store_id=? AND collection='stock-list')" : "instr(vj_lower(coalesce(json_extract(d.payload,'$.item'),'')||' '||coalesce(json_extract(d.payload,'$.purity'),'')||' '||coalesce(d.identity,'')),?)>0");
      const searchArgs = indexed ? [this.storeId, matchPhrase(query), this.storeId] : [this.storeId, query];
      const total = this.scalar("SELECT count(*) AS value FROM documents WHERE store_id=? AND collection='stock-list'");
      const filteredTotal = this.db.prepare(`SELECT count(*) AS n FROM documents d WHERE ${where}`).get(...searchArgs).n;
      options.page = Math.min(options.page, Math.max(1, Math.ceil(filteredTotal / options.pageSize)));
      const items = this.db.prepare(`SELECT d.payload FROM documents d WHERE ${where} ORDER BY ordinal LIMIT ? OFFSET ?`).all(...searchArgs, options.pageSize, (options.page - 1) * options.pageSize).map(row => JSON.parse(row.payload));
      return { items, versions: Object.fromEntries(items.map(item => [item.id, hash(item)])), total, pagination: { ...options, total: filteredTotal }, totals: this.stockTotals(), refreshRequired: false };
    })();
  }
  recordWhere(filters = {}) {
    rangeBounds(filters);
    const status = filters.status || 'all';
    if (!['all', 'due', 'advance', 'settled', 'pending', 'voided'].includes(status)) throw Object.assign(new Error('Invalid invoice status.'), { statusCode: 400 });
    const sql = ['f.store_id=?'], args = [this.storeId];
    const query = String(filters.query || '').trim().toLowerCase();
    if (query.length > 256) throw Object.assign(new Error('Search text is too long (maximum 256 characters).'), { statusCode: 400 });
    if (query.length >= 3) { sql.push("f.ordinal IN(SELECT d.ordinal FROM documents d JOIN document_search s ON s.rowid=d.rowid WHERE document_search MATCH ? AND d.store_id=? AND d.collection='invoice-records')"); args.push(matchPhrase(query), this.storeId); }
    else if (query) { sql.push("instr(json_extract(f.facts,'$.search'),?)>0"); args.push(query); }
    if (filters.from || filters.to) sql.push("f.date_key<>''");
    if (filters.from) { sql.push('f.date_key>=?'); args.push(filters.from); }
    if (filters.to) { sql.push('f.date_key<=?'); args.push(filters.to); }
    if (['pending', 'voided'].includes(status)) { sql.push('f.status=?'); args.push(status); }
    if (['due', 'advance', 'settled'].includes(status)) {
      sql.push("f.status='completed'");
      sql.push(status === 'due' ? 'f.due>0.005' : status === 'advance' ? 'f.advance>0.005' : 'f.due<=0.005 AND f.advance<=0.005');
    }
    return { sql: sql.join(' AND '), args };
  }
  recordList(filters = {}) {
    return this.db.transaction(() => {
      const { sql, args } = this.recordWhere(filters), options = paging(filters);
      const total = this.scalar('SELECT count(*) AS value FROM invoice_facts WHERE store_id=?');
      const count = this.db.prepare(`SELECT count(*) AS n FROM invoice_facts f WHERE ${sql}`).get(...args).n;
      options.page = Math.min(options.page, Math.max(1, Math.ceil(count / options.pageSize)));
      const originals = this.db.prepare(`SELECT d.payload FROM invoice_facts f JOIN documents d ON d.store_id=f.store_id AND d.collection='invoice-records' AND d.ordinal=f.ordinal WHERE ${sql} ORDER BY f.ordinal LIMIT ? OFFSET ?`).all(...args, options.pageSize, (options.page - 1) * options.pageSize).map(row => JSON.parse(row.payload));
      const records = new RecordService({ read: () => ({ 'invoice-records': originals }) }).list({ query: '', status: 'all' });
      const revision = this.db.prepare('SELECT revision FROM store_revisions WHERE store_id=?').get(this.storeId)?.revision || 0;
      return { ...records, total, pagination: { ...options, total: count }, revision };
    })();
  }
  *recordExport(filters = {}) {
    const { sql, args } = this.recordWhere(filters);
    for (const row of this.db.prepare(`SELECT d.payload FROM invoice_facts f JOIN documents d ON d.store_id=f.store_id AND d.collection='invoice-records' AND d.ordinal=f.ordinal WHERE ${sql} ORDER BY f.ordinal`).iterate(...args)) {
      yield normalizeRecord(JSON.parse(row.payload));
    }
  }
  balances() { return Object.fromEntries(['gold', 'silver'].map(metal => [metal, this.sum('metal_movements', 'guard_weight', 'AND balance_metal=?', [metal])])); }
  transactionList(kind, input = {}) {
    return this.db.transaction(() => {
      const collection = kind === 'purchases' ? 'purchase-records' : kind === 'payments' ? 'payment-records' : null;
      if (!collection) throw new Error('Unknown transaction kind.');
      const options = paging(input);
      const total = this.scalar('SELECT count(*) AS value FROM transaction_facts WHERE store_id=? AND collection=?', [collection]);
      options.page = Math.min(options.page, Math.max(1, Math.ceil(total / options.pageSize)));
      const rows = this.db.prepare('SELECT payload FROM documents WHERE store_id=? AND collection=? ORDER BY ordinal LIMIT ? OFFSET ?').all(this.storeId, collection, options.pageSize, (options.page - 1) * options.pageSize).map(row => JSON.parse(row.payload));
      const versions = Object.fromEntries(rows.map(item => {
        const sourceId = (kind === 'purchases' ? 'purchase:' : 'payment:') + item.id;
        const linked = this.db.prepare("SELECT payload FROM documents WHERE store_id=? AND collection='old-gold-records' AND json_extract(payload,'$.sourceId')=? ORDER BY ordinal").all(this.storeId, sourceId).map(row => JSON.parse(row.payload));
        return [item.id, new TransactionService(null).revision(kind, item, linked)];
      }));
      const summary = { amount: this.sum('transaction_facts', 'amount', 'AND collection=? AND (type IS NULL OR type<>?)', [collection, 'metal']), gold: this.sum('transaction_facts', 'weight', "AND collection=? AND metal=? AND (collection='purchase-records' OR type='metal')", [collection, 'gold']), silver: this.sum('transaction_facts', 'weight', "AND collection=? AND metal=? AND (collection='purchase-records' OR type='metal')", [collection, 'silver']) };
      return { items: rows, versions, balances: require('./metal-balances').balances(this.db, this.storeId), summary, pagination: { ...options, total } };
    })();
  }
  cash(start, end) {
    return this.scalar(`SELECT vj_sum(value) AS value FROM (SELECT c.invoice_ordinal,vj_sum(c.amount) AS value FROM (SELECT * FROM invoice_cashflows WHERE store_id=? AND time_ms>=? AND time_ms<=? ORDER BY invoice_ordinal,position) c JOIN invoice_facts f ON f.store_id=c.store_id AND f.ordinal=c.invoice_ordinal WHERE f.status<>'voided' GROUP BY c.invoice_ordinal ORDER BY c.invoice_ordinal)`, [start, end]);
  }
  dashboard(range = {}) {
    const canCache = !this.db.inTransaction;
    return this.db.transaction(() => {
      const { start, end, ranged } = rangeBounds(range);
      const revision = this.db.prepare('SELECT revision FROM store_revisions WHERE store_id=?').get(this.storeId)?.revision || 0;
      const cacheKey = JSON.stringify([revision, range.from || '', range.to || '']);
      if (canCache && this.reportCache.has(cacheKey)) return structuredClone(this.reportCache.get(cacheKey));
      const period = ranged ? ' AND issued_ms>=? AND issued_ms<=?' : '', args = ranged ? [start, end] : [];
      const selected = "AND status<>'voided'" + period;
      const factSum = key => this.sum('invoice_facts', `json_extract(facts,'$.${key}')`, selected, args);
      const summary = { invoices: this.scalar("SELECT count(*) AS value FROM invoice_facts WHERE store_id=? AND status='completed'" + period, args), pending: this.scalar("SELECT count(*) AS value FROM invoice_facts WHERE store_id=? AND status='pending'" + period, args), sales: factSum('sales'), due: factSum('due'), collected: ranged ? this.cash(start, end) : factSum('collected') };
      const costs = (collection, type, before = false) => this.sum('transaction_facts', 'amount', 'AND collection=?' + (type ? ' AND type=?' : '') + (before ? ' AND time_ms<?' : ranged ? ' AND time_ms>=? AND time_ms<=?' : ''), [collection, ...(type ? [type] : []), ...(before ? [start] : ranged ? [start, end] : [])]);
      summary.purchases = costs('purchase-records'); summary.party = costs('payment-records', 'amount'); summary.expenses = costs('payment-records', 'self-expense');
      const lineSum = field => this.scalar(`SELECT vj_sum(value) AS value FROM (SELECT l.${field} AS value FROM invoice_lines l JOIN invoice_facts f ON f.store_id=l.store_id AND f.ordinal=l.invoice_ordinal WHERE l.store_id=? AND f.status='completed' ${ranged ? 'AND f.issued_ms>=? AND f.issued_ms<=?' : ''} ORDER BY l.invoice_ordinal,l.position)`, args);
      for (const metal of ['gold', 'silver']) {
        const ledgerPeriod = ranged ? ' AND time_ms>=? AND time_ms<=?' : '';
        const receipts = `AND metal=? AND weight>0 AND source IN ('Invoice exchange','Gold settlement','Silver settlement','Old metal purchase') ${ledgerPeriod} AND NOT EXISTS(SELECT 1 FROM documents d JOIN invoice_facts f ON f.store_id=d.store_id AND f.ordinal=d.ordinal WHERE d.store_id=metal_movements.store_id AND d.collection='invoice-records' AND d.identity=metal_movements.invoice AND f.status='voided' ${ranged ? 'AND f.issued_ms>=? AND f.issued_ms<=?' : ''})`;
        const receiptArgs = [metal, ...args, ...args];
        summary[metal] = { sold: lineSum(metal + '_sold'), sales: lineSum(metal + '_sales'), received: this.sum('metal_movements', 'weight', receipts, receiptArgs), receivedValue: this.sum('metal_movements', 'value', receipts, receiptArgs), balance: this.sum('metal_movements', 'weight', ranged ? "AND coalesce(nullif(source_metal,''),'gold')=? AND time_ms<=?" : 'AND metal=?', [metal, ...(ranged ? [end] : [])]), paid: this.sum('transaction_facts', 'weight', "AND collection='payment-records' AND type='metal' AND metal=?" + (ranged ? ' AND time_ms>=? AND time_ms<=?' : ''), [metal, ...args]), finePaid: this.sum('transaction_facts', 'fine_weight', "AND collection='payment-records' AND type='metal' AND metal=?" + (ranged ? ' AND time_ms>=? AND time_ms<=?' : ''), [metal, ...args]) };
      }
      summary.beforeParty = summary.collected - summary.purchases - summary.expenses;
      summary.afterPayment = summary.beforeParty - summary.party;
      summary.openingCash = ranged ? this.cash(-8640000000000000, start - 1) - costs('purchase-records', null, true) - this.sum('transaction_facts', 'amount', "AND collection='payment-records' AND type IN ('amount','self-expense') AND time_ms<?", [start]) : 0;
      summary.closingCash = summary.openingCash + summary.afterPayment;
      const totals = this.stockTotals();
      const result = { summary, fresh: { gold: totals.gold.available, silver: totals.silver.available }, old: this.balances(), lowStockLimits: { gold: 10, silver: 100 } };
      if (canCache) { if (this.reportCache.size >= 16) this.reportCache.clear(); this.reportCache.set(cacheKey, result); }
      return structuredClone(result);
    })();
  }
}
module.exports = { DatabaseQueries, paging, rangeBounds };
