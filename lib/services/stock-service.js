'use strict';

const { createHash, randomUUID } = require('node:crypto');
const { StorageKey } = require('../domain/constants');

const PURITIES = Object.freeze(['24K', '22K', '18K', '14K', 'Silver', 'Fine Gold']);
const versionOf = item => createHash('sha256').update(JSON.stringify(item)).digest('hex');

function stockError(message, statusCode = 400) {
  return Object.assign(new Error(message), { statusCode });
}

function validateStock(input, batch = false) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw stockError('Enter valid stock details.');
  const item = typeof input.item === 'string' ? input.item.trim() : '';
  if (!batch && !item) throw stockError('Item name is required');
  if (!batch && !PURITIES.includes(input.purity)) throw stockError('Select a valid purity');
  const qty = Number(input.qty);
  if (!Number.isSafeInteger(qty) || qty < 1) throw stockError('Quantity is required and must be a whole number of at least 1');
  const gross = Number(input.gross);
  const net = Number(input.net);
  if (!Number.isFinite(gross) || gross <= 0) throw stockError('Total gross weight is required and must be greater than 0');
  if (!Number.isFinite(net) || net <= 0) throw stockError('Total net weight is required and must be greater than 0');
  if (net > gross) throw stockError('Total net weight cannot exceed total gross weight');
  return { item, purity: input.purity, qty, gross, net };
}

class StockService {
  constructor(store, { now = () => new Date(), id = randomUUID } = {}) {
    this.store = store;
    this.now = now;
    this.id = id;
  }

  collection(data) {
    const items = data[StorageKey.STOCK] || [];
    if (!Array.isArray(items)) throw stockError('Saved stock data is not in the expected format.', 500);
    return items;
  }

  result(items) {
    return { items, versions: Object.fromEntries(items.map(item => [item.id, versionOf(item)])) };
  }

  list() { return this.result(this.collection(this.store.read())); }

  create(input) {
    const details = validateStock(input);
    const data = this.store.read();
    const items = this.collection(data);
    items.push({ id: this.id(), ...details, rate: 0, added: this.now().toLocaleDateString('en-IN') });
    data[StorageKey.STOCK] = items;
    this.store.write(data);
    return this.result(items);
  }

  mutate(id, input, operation) {
    // Read, check the revision, and write synchronously so concurrent requests
    // cannot overwrite a stock deduction that occurred while the editor was open.
    const data = this.store.read();
    const items = this.collection(data);
    const index = items.findIndex(item => String(item.id) === String(id));
    if (index < 0) throw stockError('This stock item is no longer available. Refresh Stocks and try again.', 404);
    if (!input?.version || input.version !== versionOf(items[index])) {
      throw stockError('This stock item changed since you opened it. Refresh Stocks and reopen the item before saving.', 409);
    }
    if (operation === 'delete') items.splice(index, 1);
    else if (operation === 'batch') {
      const batch = validateStock(input, true);
      const item = items[index];
      const qty = (Number(item.qty) || 0) + batch.qty;
      const gross = (Number(item.gross) || 0) + batch.gross;
      const net = (Number(item.net) || 0) + batch.net;
      if (!Number.isSafeInteger(qty) || !Number.isFinite(gross) || !Number.isFinite(net)) throw stockError('Resulting quantity or weight is too large.');
      items[index] = { ...item, qty, gross, net };
    } else {
      items[index] = { ...items[index], ...validateStock(input) };
    }
    data[StorageKey.STOCK] = items;
    this.store.write(data);
    return this.result(items);
  }
}

module.exports = { StockService, PURITIES, validateStock };
