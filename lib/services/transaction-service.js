'use strict';

const { createHash, randomUUID } = require('node:crypto');
const { StorageKey } = require('../domain/constants');

const TransactionKind = Object.freeze({ PURCHASE: 'purchases', PAYMENT: 'payments' });
const PaymentType = Object.freeze({ AMOUNT: 'amount', EXPENSE: 'self-expense', METAL: 'metal' });
const keys = Object.freeze({ purchases: StorageKey.PURCHASES, payments: StorageKey.PAYMENTS });
const prefixes = Object.freeze({ purchases: 'purchase:', payments: 'payment:' });
const fail = (message, statusCode = 400) => { throw Object.assign(new Error(message), { statusCode }); };
const positive = (value, label) => {
  const number = typeof value === 'number' || typeof value === 'string' ? Number(value) : NaN;
  if (!Number.isFinite(number) || number <= 0) fail(`${label} is required and must be greater than 0.`);
  return number;
};

function details(kind, input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('Enter valid transaction details.');
  const reason = typeof input.reason === 'string' ? input.reason.trim() : '';
  if (kind === TransactionKind.PAYMENT && !Object.values(PaymentType).includes(input.type)) fail('Select a valid payment type.');
  if (kind === TransactionKind.PAYMENT && input.type !== PaymentType.METAL) {
    return { type: input.type, reason, amount: positive(input.amount, 'Amount') };
  }
  if (!['gold', 'silver'].includes(input.metal)) fail('Select Gold or Silver.');
  const weight = positive(input.weight, 'Weight');
  if (kind === TransactionKind.PURCHASE) {
    const rate = positive(input.rate, 'Rate per gram');
    const amount = weight * rate;
    if (!Number.isFinite(amount)) fail('Calculated purchase amount is too large.');
    return { metal: input.metal, weight, rate, amount };
  }
  const purity = positive(input.purity, 'Purity');
  if (purity > 100) fail('Purity cannot exceed 100%.');
  return { type: PaymentType.METAL, metal: input.metal, weight, purity, fineWeight: weight * (purity / 100), reason };
}

class TransactionService {
  constructor(store, { now = () => new Date(), id = randomUUID } = {}) {
    this.store = store; this.now = now; this.id = id;
  }

  collection(data, key) {
    const entries = data[key] || [];
    if (!Array.isArray(entries)) fail('Saved transaction data is not in the expected format.', 500);
    return entries;
  }

  revision(kind, entry, ledger) {
    return createHash('sha256').update(JSON.stringify([entry, ledger.filter(row => row.sourceId === prefixes[kind] + entry.id)])).digest('hex');
  }

  snapshot(kind, data) {
    if (!keys[kind]) fail('Unknown transaction kind.', 404);
    const items = this.collection(data, keys[kind]);
    const ledger = this.collection(data, StorageKey.OLD_METAL);
    return { items, versions: Object.fromEntries(items.map(item => [item.id, this.revision(kind, item, ledger)])), balances: this.balances(ledger) };
  }

  balances(ledger) {
    return Object.fromEntries(['gold', 'silver'].map(metal => [metal, ledger.filter(row => row.metal === metal).reduce((sum, row) => sum + (Number(row.weight) || 0), 0)]));
  }

  list(kind) { return this.snapshot(kind, this.store.read()); }

  save(kind, input, id, deleting = false) {
    if (!keys[kind]) fail('Unknown transaction kind.', 404);
    // All validation and linked-ledger changes occur against one fresh snapshot.
    // A single encrypted atomic write commits both collections together.
    const data = this.store.read();
    const items = [...this.collection(data, keys[kind])];
    const ledger = this.collection(data, StorageKey.OLD_METAL);
    const index = id === undefined ? -1 : items.findIndex(item => String(item.id) === String(id));
    if (id !== undefined && index < 0) fail('This entry no longer exists. Refresh the list.', 404);
    const existing = items[index];
    if (existing && input?.version !== this.revision(kind, existing, ledger)) fail('This entry changed. Refresh and reopen it before saving.', 409);
    const entryId = existing?.id ?? this.id();
    const sourceId = prefixes[kind] + entryId;
    const revised = ledger.filter(row => row.sourceId !== sourceId);
    if (deleting) items.splice(index, 1);
    else {
      const values = details(kind, input);
      const entry = { ...existing, ...values, id: entryId, savedAt: existing?.savedAt || this.now().toISOString() };
      // Remove fields belonging to the previous payment type.
      if (kind === TransactionKind.PAYMENT) {
        for (const field of ['amount', 'metal', 'weight', 'purity', 'fineWeight', 'rate']) {
          if (!(field in values)) delete entry[field];
        }
      }
      if (kind === TransactionKind.PURCHASE || entry.type === PaymentType.METAL) {
        if (kind === TransactionKind.PAYMENT && entry.weight > this.balances(revised)[entry.metal] + 0.0001) fail(`Not enough old ${entry.metal} available for this payment.`);
        revised.unshift({ sourceId, metal: entry.metal, source: kind === TransactionKind.PURCHASE ? 'Old metal purchase' : 'Metal payment', invoice: '—', customer: '—', date: new Date(entry.savedAt).toLocaleDateString('en-GB'), weight: kind === TransactionKind.PURCHASE ? entry.weight : -entry.weight, rate: entry.rate || 0, value: kind === TransactionKind.PURCHASE ? entry.amount : 0, receivedAt: entry.savedAt });
      }
      if (existing) items[index] = entry; else items.unshift(entry);
    }
    const before = this.balances(ledger), after = this.balances(revised);
    for (const metal of ['gold', 'silver']) {
      if (!Number.isFinite(after[metal])) fail('Resulting metal balance is too large.');
      if (after[metal] < Math.min(before[metal], 0) - 0.0001) fail(`This change would leave insufficient old ${metal}. Adjust the linked metal payments first.`);
    }
    data[keys[kind]] = items;
    data[StorageKey.OLD_METAL] = revised;
    this.store.write(data);
    return this.snapshot(kind, data);
  }
}

module.exports = { TransactionService, TransactionKind, PaymentType };
