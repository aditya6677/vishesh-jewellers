'use strict';

const { createHash, randomUUID } = require('node:crypto');
const { StorageKey } = require('../domain/constants');
const { recordMatchesFilters, recordDateKey } = require('../record-filters');
const amount = value => Number(String(value || '').replace(/[^0-9.-]/g, '')) || 0;
const revision = record => createHash('sha256').update(JSON.stringify(record)).digest('hex');
const fail = (message, statusCode = 400) => { throw Object.assign(new Error(message), { statusCode }); };

function normalizeRecord(record) {
  const result = { ...record, paid: Number(record.paid) || 0, payments: Array.isArray(record.payments) ? record.payments : [] };
  const legacyZero = amount(record.total) > 0 && result.paid === 0 && Number(record.due) === 0 && result.payments.length === 0;
  if (record.status === 'voided') result.due = 0;
  else if (!Object.hasOwn(record, 'due') || legacyZero) result.due = Math.max(amount(record.total) - result.paid, 0);
  return result;
}

class RecordService {
  constructor(store, { now = () => new Date(), id = randomUUID } = {}) {
    this.store = store; this.now = now; this.id = id;
  }

  records(data) {
    const records = data[StorageKey.INVOICES] || [];
    if (!Array.isArray(records)) fail('Saved invoices are not in the expected format.', 500);
    return records;
  }

  list({ query = '', status = 'all', from = '', to = '' } = {}) {
    if (!['all', 'due', 'advance', 'pending', 'settled', 'voided'].includes(status)) fail('Invalid invoice status filter.');
    for (const date of [from, to]) if (date && recordDateKey({ invoiceDate: date }) !== date) fail('Enter a valid date in YYYY-MM-DD format.');
    if (from && to && from > to) fail('From date must be on or before To date.');
    const records = this.records(this.store.read());
    const items = records.map(normalizeRecord).filter(record => recordMatchesFilters(record, query.trim().toLowerCase(), status, from, to));
    return { items, total: records.length, versions: Object.fromEntries(records.map(record => [record.number, revision(record)])) };
  }

  get(number, version = '') {
    const record = this.records(this.store.read()).find(record => record.number === number);
    if (!record) fail('Invoice no longer exists. Refresh Records.', 404);
    const currentVersion = revision(record);
    if (version && version !== currentVersion) fail('Invoice changed. Refresh Records and reopen its details.', 409);
    return { record: normalizeRecord(record), version: currentVersion };
  }

  settle(number, input) {
    const data = this.store.read();
    const records = this.records(data);
    const index = records.findIndex(record => record.number === number);
    if (index < 0) fail('Invoice no longer exists. Refresh Records.', 404);
    if (!input?.version || input.version !== revision(records[index])) fail('Invoice changed. Reopen its details before settling.', 409);
    const record = normalizeRecord(records[index]);
    if (record.status === 'voided') fail('Voided invoices cannot be settled.');
    const due = Number(record.due);
    if (!Number.isFinite(due) || due <= 0) fail('This invoice has no outstanding due.');
    const method = input.fullyPaid === true ? 'amount' : input.method;
    if (!['amount', 'gold', 'silver'].includes(method)) fail('Choose a valid settlement type.');
    const numeric = value => typeof value === 'number' || typeof value === 'string' ? Number(value) : NaN;
    const weight = numeric(input.weight), rate = numeric(input.rate);
    if (method !== 'amount' && (!Number.isFinite(weight) || !Number.isFinite(rate) || weight <= 0 || rate <= 0)) fail('Weight and rate per gram must both be greater than zero.');
    const settled = input.fullyPaid === true ? due : method === 'amount' ? numeric(input.amount) : weight * rate;
    if (!Number.isFinite(settled) || settled <= 0 || settled > due) fail('Enter a valid settlement amount up to the outstanding due.');
    const paid = record.paid + settled;
    if (!Number.isFinite(paid)) fail('Resulting paid amount is too large.');
    const settledAt = this.now().toISOString();
    const payment = { method, amount: settled, weight: method === 'amount' ? null : weight, rate: method === 'amount' ? null : rate, settledAt };
    const next = { ...record, paid, due: Math.max(due - settled, 0), payments: [payment, ...record.payments] };
    records[index] = next;
    if (method !== 'amount') {
      const ledger = data[StorageKey.OLD_METAL] || [];
      if (!Array.isArray(ledger)) fail('Saved old-metal data is not in the expected format.', 500);
      data[StorageKey.OLD_METAL] = [{ sourceId: number + ':settlement:' + this.id(), metal: method, source: method === 'gold' ? 'Gold settlement' : 'Silver settlement', invoice: number, customer: record.customer, date: new Date(settledAt).toLocaleDateString('en-GB'), weight, rate, value: settled, receivedAt: settledAt }, ...ledger];
    }
    data[StorageKey.INVOICES] = records;
    // Commit the invoice and matching old-metal receipt in one encrypted write.
    this.store.write(data);
    return { record: next, version: revision(next), settled };
  }
}

module.exports = { RecordService, normalizeRecord };
