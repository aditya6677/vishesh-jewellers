'use strict';
const { calculateDashboard } = require('../dashboard-summary');
const { recordDateKey, recordNetTotal } = require('../record-filters');
const num = value => Number(String(value ?? 0).replace(/[^0-9.-]/g, '')) || 0;
const epoch = value => { const n = new Date(value).getTime(); return Number.isFinite(n) ? n : null; };
function normalized(entry) {
  const record = { ...entry, paid: Number(entry.paid) || 0, payments: Array.isArray(entry.payments) ? entry.payments : [] };
  const legacy = num(record.total) > 0 && record.paid === 0 && Number(record.due) === 0 && record.payments.length === 0;
  if (!Object.hasOwn(record, 'due') || legacy) record.due = Math.max(num(record.total) - record.paid, 0);
  return record;
}
function invoiceFacts(entry) {
  const record = normalized(entry);
  const summary = calculateDashboard([record], [], [], []);
  return { ...summary, status: record.status === 'voided' ? 'voided' : record.status === 'pending' ? 'pending' : 'completed',
    dateKey: recordDateKey(record), issued: epoch(record.invoiceDate ? record.invoiceDate + 'T00:00:00' : record.savedAt),
    search: (record.number + ' ' + record.customer + ' ' + record.mobile).toLowerCase(),
    advance: Math.max(record.paid - recordNetTotal(record), 0), mobile: String(record.mobile || '') };
}
function cashFlows(entry) {
  const record = normalized(entry);
  const rows = record.payments.filter(row => !['gold', 'silver'].includes(row.method)).map(row => ({ time: epoch(row.settledAt || record.savedAt), amount: num(row.amount) }));
  rows.push({ time: epoch(record.savedAt || (record.invoiceDate ? record.invoiceDate + 'T00:00:00' : record.savedAt)), amount: num(record.paid) - record.payments.reduce((sum, row) => sum + num(row.amount), 0) });
  return rows;
}
function lineFacts(entry) {
  const record = normalized(entry);
  return (record.status === 'pending' ? record.orderItems || [] : record.soldItems || []).map(item => {
    const summary = calculateDashboard([{ ...record, soldItems: [item] }], [], [], []);
    return { goldSold: summary.gold.sold, goldSales: summary.gold.sales, silverSold: summary.silver.sold, silverSales: summary.silver.sales,
      lineId: item.lineId ?? null, stockId: item.stockId ?? null, name: item.name ?? null, purity: item.purity ?? null,
      qty: Number(item.pcs) || 1, gross: num(item.gross), net: num(item.net), rate: num(item.rate), making: num(item.making), isOrder: record.status === 'pending' ? 1 : 0, original: item };
  });
}

function registerProjectionFunctions(db) {
  db.function('vj_search_text', { deterministic: true }, (collection, payload, identity) => { const row = JSON.parse(payload); return collection === 'invoice-records' ? (row.number + ' ' + row.customer + ' ' + row.mobile).toLowerCase() : (String(row.item || '') + ' ' + String(row.purity || '') + ' ' + String(identity || '')).toLowerCase(); });
  db.function('vj_invoice_facts', { deterministic: true }, value => JSON.stringify(invoiceFacts(JSON.parse(value))));
  db.function('vj_cash_flows', { deterministic: true }, value => JSON.stringify(cashFlows(JSON.parse(value))));
  db.function('vj_line_facts', { deterministic: true }, value => JSON.stringify(lineFacts(JSON.parse(value))));
  db.function('vj_invoice_payments', { deterministic: true }, value => JSON.stringify(normalized(JSON.parse(value)).payments));
  db.function('vj_invoice_exchanges', { deterministic: true }, value => { const row = JSON.parse(value); return JSON.stringify(Array.isArray(row.exchanges) ? row.exchanges : row.exchange && typeof row.exchange === 'object' ? [row.exchange] : []); });
  db.function('vj_num', { deterministic: true }, value => num(value));
  db.function('vj_plain_num', { deterministic: true }, value => Number(value) || 0);
  db.function('vj_epoch', { deterministic: true }, value => epoch(value));
  db.function('vj_lower', { deterministic: true }, value => String(value || '').toLowerCase());
  db.aggregate('vj_sum', { start: 0, step: (sum, value) => sum + (Number(value) || 0) });
}

function createReportingSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS invoice_facts (
      store_id TEXT NOT NULL, ordinal INTEGER NOT NULL, facts TEXT NOT NULL CHECK(json_valid(facts)),
      status TEXT GENERATED ALWAYS AS(json_extract(facts,'$.status')) STORED,
      date_key TEXT GENERATED ALWAYS AS(json_extract(facts,'$.dateKey')) STORED,
      issued_ms INTEGER GENERATED ALWAYS AS(json_extract(facts,'$.issued')) STORED,
      mobile TEXT GENERATED ALWAYS AS(json_extract(facts,'$.mobile')) STORED,
      due REAL GENERATED ALWAYS AS(json_extract(facts,'$.due')) STORED,
      advance REAL GENERATED ALWAYS AS(json_extract(facts,'$.advance')) STORED,
      PRIMARY KEY(store_id,ordinal), FOREIGN KEY(store_id) REFERENCES stores(store_id)
    );
    CREATE INDEX IF NOT EXISTS invoice_period ON invoice_facts(store_id,issued_ms,ordinal);
    CREATE INDEX IF NOT EXISTS invoice_date_status ON invoice_facts(store_id,status,date_key,ordinal);
    CREATE INDEX IF NOT EXISTS invoice_mobile ON invoice_facts(store_id,mobile,ordinal);
    CREATE INDEX IF NOT EXISTS invoice_due ON invoice_facts(store_id,due,ordinal);
    CREATE INDEX IF NOT EXISTS invoice_date ON invoice_facts(store_id,date_key,ordinal);
    CREATE INDEX IF NOT EXISTS invoice_advance ON invoice_facts(store_id,advance,ordinal);
    CREATE TABLE IF NOT EXISTS invoice_cashflows (
      store_id TEXT NOT NULL, invoice_ordinal INTEGER NOT NULL, position INTEGER NOT NULL,
      time_ms INTEGER, amount REAL NOT NULL,
      PRIMARY KEY(store_id,invoice_ordinal,position),
      FOREIGN KEY(store_id,invoice_ordinal) REFERENCES invoice_facts(store_id,ordinal) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS cashflow_period ON invoice_cashflows(store_id,time_ms,invoice_ordinal);
    CREATE TABLE IF NOT EXISTS invoice_lines (
      store_id TEXT NOT NULL, invoice_ordinal INTEGER NOT NULL, position INTEGER NOT NULL,
      gold_sold REAL NOT NULL, gold_sales REAL NOT NULL, silver_sold REAL NOT NULL, silver_sales REAL NOT NULL,
      line_id TEXT, stock_id TEXT, item_name TEXT, purity TEXT, qty REAL NOT NULL, gross REAL NOT NULL,
      net REAL NOT NULL, rate REAL NOT NULL, making REAL NOT NULL, is_order INTEGER NOT NULL CHECK(is_order IN (0,1)),
      original TEXT NOT NULL CHECK(json_valid(original)),
      PRIMARY KEY(store_id,invoice_ordinal,position),
      FOREIGN KEY(store_id,invoice_ordinal) REFERENCES invoice_facts(store_id,ordinal) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS invoice_line_stock ON invoice_lines(store_id,stock_id,invoice_ordinal);
    CREATE TABLE IF NOT EXISTS invoice_payments (
      store_id TEXT NOT NULL, invoice_ordinal INTEGER NOT NULL, position INTEGER NOT NULL,
      method TEXT, amount REAL NOT NULL, weight REAL, rate REAL, initial_payment INTEGER NOT NULL, settled_ms INTEGER,
      original TEXT NOT NULL CHECK(json_valid(original)), PRIMARY KEY(store_id,invoice_ordinal,position),
      FOREIGN KEY(store_id,invoice_ordinal) REFERENCES invoice_facts(store_id,ordinal) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS payment_history_period ON invoice_payments(store_id,settled_ms,invoice_ordinal);
    CREATE TABLE IF NOT EXISTS invoice_exchanges (
      store_id TEXT NOT NULL, invoice_ordinal INTEGER NOT NULL, position INTEGER NOT NULL,
      metal TEXT, weight REAL NOT NULL, rate REAL NOT NULL, value REAL NOT NULL,
      original TEXT NOT NULL CHECK(json_valid(original)), PRIMARY KEY(store_id,invoice_ordinal,position),
      FOREIGN KEY(store_id,invoice_ordinal) REFERENCES invoice_facts(store_id,ordinal) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS stock_facts (
      store_id TEXT NOT NULL, ordinal INTEGER NOT NULL, metal TEXT NOT NULL, item TEXT NOT NULL,
      qty REAL NOT NULL, gross REAL NOT NULL, net REAL NOT NULL, available REAL NOT NULL,
      PRIMARY KEY(store_id,ordinal), FOREIGN KEY(store_id) REFERENCES stores(store_id)
    );
    CREATE INDEX IF NOT EXISTS stock_metal ON stock_facts(store_id,metal,ordinal);
    CREATE TABLE IF NOT EXISTS transaction_facts (
      store_id TEXT NOT NULL, collection TEXT NOT NULL, ordinal INTEGER NOT NULL,
      type TEXT, metal TEXT, weight REAL NOT NULL, fine_weight REAL NOT NULL, amount REAL NOT NULL, time_ms INTEGER,
      PRIMARY KEY(store_id,collection,ordinal), FOREIGN KEY(store_id) REFERENCES stores(store_id)
    );
    CREATE INDEX IF NOT EXISTS transaction_period ON transaction_facts(store_id,collection,time_ms,ordinal);
    CREATE INDEX IF NOT EXISTS transaction_type_period ON transaction_facts(store_id,collection,type,time_ms,ordinal);
    CREATE TABLE IF NOT EXISTS metal_movements (
      store_id TEXT NOT NULL, ordinal INTEGER NOT NULL, metal TEXT NOT NULL, balance_metal TEXT NOT NULL,
      weight REAL NOT NULL, value REAL NOT NULL, source TEXT, invoice TEXT, time_ms INTEGER,
      guard_weight REAL NOT NULL, source_metal TEXT, source_id TEXT,
      PRIMARY KEY(store_id,ordinal), FOREIGN KEY(store_id) REFERENCES stores(store_id)
    );
    CREATE INDEX IF NOT EXISTS metal_period ON metal_movements(store_id,metal,time_ms,ordinal);
    CREATE INDEX IF NOT EXISTS metal_invoice ON metal_movements(store_id,invoice,ordinal);
    CREATE INDEX IF NOT EXISTS metal_guard ON metal_movements(store_id,source_metal,ordinal);
  `);
  for (const event of ['INSERT', 'UPDATE']) {
    const suffix = event.toLowerCase();
    db.exec(`CREATE TRIGGER IF NOT EXISTS project_document_${suffix} AFTER ${event} ON documents BEGIN
      DELETE FROM invoice_facts WHERE store_id=NEW.store_id AND ordinal=NEW.ordinal AND NEW.collection='invoice-records';
      INSERT INTO invoice_facts(store_id,ordinal,facts) SELECT NEW.store_id,NEW.ordinal,vj_invoice_facts(NEW.payload) WHERE NEW.collection='invoice-records';
      INSERT INTO invoice_cashflows SELECT NEW.store_id,NEW.ordinal,CAST(j.key AS INTEGER),json_extract(j.value,'$.time'),json_extract(j.value,'$.amount') FROM json_each(CASE WHEN NEW.collection='invoice-records' THEN vj_cash_flows(NEW.payload) ELSE '[]' END) j;
      INSERT INTO invoice_lines SELECT NEW.store_id,NEW.ordinal,CAST(j.key AS INTEGER),json_extract(j.value,'$.goldSold'),json_extract(j.value,'$.goldSales'),json_extract(j.value,'$.silverSold'),json_extract(j.value,'$.silverSales'),json_extract(j.value,'$.lineId'),json_extract(j.value,'$.stockId'),json_extract(j.value,'$.name'),json_extract(j.value,'$.purity'),json_extract(j.value,'$.qty'),json_extract(j.value,'$.gross'),json_extract(j.value,'$.net'),json_extract(j.value,'$.rate'),json_extract(j.value,'$.making'),json_extract(j.value,'$.isOrder'),json_extract(j.value,'$.original') FROM json_each(CASE WHEN NEW.collection='invoice-records' THEN vj_line_facts(NEW.payload) ELSE '[]' END) j;
      INSERT INTO invoice_payments SELECT NEW.store_id,NEW.ordinal,CAST(j.key AS INTEGER),json_extract(j.value,'$.method'),vj_num(json_extract(j.value,'$.amount')),json_extract(j.value,'$.weight'),json_extract(j.value,'$.rate'),CASE WHEN json_extract(j.value,'$.initialPayment') THEN 1 ELSE 0 END,vj_epoch(json_extract(j.value,'$.settledAt')),j.value FROM json_each(CASE WHEN NEW.collection='invoice-records' THEN vj_invoice_payments(NEW.payload) ELSE '[]' END) j;
      INSERT INTO invoice_exchanges SELECT NEW.store_id,NEW.ordinal,CAST(j.key AS INTEGER),json_extract(j.value,'$.metal'),vj_num(json_extract(j.value,'$.weight')),vj_num(json_extract(j.value,'$.rate')),vj_num(json_extract(j.value,'$.value')),j.value FROM json_each(CASE WHEN NEW.collection='invoice-records' THEN vj_invoice_exchanges(NEW.payload) ELSE '[]' END) j;
      DELETE FROM stock_facts WHERE store_id=NEW.store_id AND ordinal=NEW.ordinal AND NEW.collection='stock-list';
      INSERT INTO stock_facts SELECT NEW.store_id,NEW.ordinal,CASE WHEN vj_lower(json_extract(NEW.payload,'$.purity'))='silver' THEN 'silver' ELSE 'gold' END,coalesce(json_extract(NEW.payload,'$.item'),''),vj_plain_num(json_extract(NEW.payload,'$.qty')),vj_plain_num(json_extract(NEW.payload,'$.gross')),vj_plain_num(json_extract(NEW.payload,'$.net')),CASE WHEN vj_plain_num(json_extract(NEW.payload,'$.net'))<>0 THEN vj_plain_num(json_extract(NEW.payload,'$.net')) ELSE vj_plain_num(json_extract(NEW.payload,'$.gross')) END WHERE NEW.collection='stock-list';
      DELETE FROM transaction_facts WHERE store_id=NEW.store_id AND collection=NEW.collection AND ordinal=NEW.ordinal;
      INSERT INTO transaction_facts SELECT NEW.store_id,NEW.collection,NEW.ordinal,json_extract(NEW.payload,'$.type'),json_extract(NEW.payload,'$.metal'),vj_num(json_extract(NEW.payload,'$.weight')),vj_num(json_extract(NEW.payload,'$.weight'))*(vj_num(json_extract(NEW.payload,'$.purity'))/100),vj_num(json_extract(NEW.payload,'$.amount')),CASE WHEN json_type(NEW.payload,'$.savedAt') IS NULL THEN NULL ELSE vj_epoch(json_extract(NEW.payload,'$.savedAt')) END WHERE NEW.collection IN ('purchase-records','payment-records');
      DELETE FROM metal_movements WHERE store_id=NEW.store_id AND ordinal=NEW.ordinal AND NEW.collection='old-gold-records';
      INSERT INTO metal_movements SELECT NEW.store_id,NEW.ordinal,CASE WHEN json_extract(NEW.payload,'$.metal')='silver' THEN 'silver' ELSE 'gold' END,vj_lower(coalesce(nullif(json_extract(NEW.payload,'$.metal'),''),'gold')),vj_num(json_extract(NEW.payload,'$.weight')),vj_num(json_extract(NEW.payload,'$.value')),json_extract(NEW.payload,'$.source'),json_extract(NEW.payload,'$.invoice'),CASE WHEN json_type(NEW.payload,'$.receivedAt') IS NULL THEN NULL ELSE vj_epoch(json_extract(NEW.payload,'$.receivedAt')) END,vj_plain_num(json_extract(NEW.payload,'$.weight')),json_extract(NEW.payload,'$.metal'),json_extract(NEW.payload,'$.sourceId') WHERE NEW.collection='old-gold-records';
    END;`);
  }
  db.exec(`CREATE TRIGGER IF NOT EXISTS project_document_delete AFTER DELETE ON documents BEGIN
    DELETE FROM invoice_facts WHERE store_id=OLD.store_id AND ordinal=OLD.ordinal AND OLD.collection='invoice-records';
    DELETE FROM stock_facts WHERE store_id=OLD.store_id AND ordinal=OLD.ordinal AND OLD.collection='stock-list';
    DELETE FROM transaction_facts WHERE store_id=OLD.store_id AND collection=OLD.collection AND ordinal=OLD.ordinal;
    DELETE FROM metal_movements WHERE store_id=OLD.store_id AND ordinal=OLD.ordinal AND OLD.collection='old-gold-records';
  END;`);
}
module.exports = { registerProjectionFunctions, createReportingSchema, normalized };
