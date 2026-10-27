'use strict';

const { createHash } = require('node:crypto');
const { StorageKey, InvoiceStatus } = require('../domain/constants');
const { calculateInvoiceTotals } = require('../invoice-calculation');
const { recordDateKey } = require('../record-filters');

const fail = (message, statusCode = 400) => { throw Object.assign(new Error(message), { statusCode }); };
const text = value => typeof value === 'string' ? value.trim() : '';
const money = value => '₹' + value.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const numeric = (value, label, positive = false) => {
  const number = typeof value === 'number' || (typeof value === 'string' && value.trim()) ? Number(value) : NaN;
  if (!Number.isFinite(number) || (positive ? number <= 0 : number < 0)) fail(label + (positive ? ' must be greater than zero.' : ' must be zero or greater.'));
  return number;
};

function createInvoice(store, input, now = () => new Date(), calculateTotals = calculateInvoiceTotals, roundDeduction = true) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('Enter valid invoice details.');
  const requestId = text(input.requestId);
  if (!/^[a-zA-Z0-9-]{16,80}$/.test(requestId)) fail('A valid save request ID is required.');
  const fingerprint = createHash('sha256').update(JSON.stringify(input)).digest('hex');
  // Work on a detached snapshot. Failed validation or persistence cannot mutate
  // an in-memory store, and the complete transaction is committed once.
  const data = structuredClone(store.read());
  const collection = key => {
    const value = data[key] || [];
    if (!Array.isArray(value)) fail('Saved ' + key + ' data is not in the expected format.', 500);
    return value;
  };
  const records = collection(StorageKey.INVOICES);
  const stock = collection(StorageKey.STOCK);
  const oldMetal = collection(StorageKey.OLD_METAL);
  const previous = records.find(record => record.creationRequestId === requestId);
  if (previous) {
    if (previous.creationFingerprint !== fingerprint) fail('This save request was already used for different invoice details.', 409);
    return { record: previous, stock, nextCounter: data['invoice-counter'], replayed: true };
  }

  const number = text(input.number);
  const sequence = /^VJ(\d{6,})$/.exec(number);
  if (!sequence || !Number.isSafeInteger(Number(sequence[1])) || Number(sequence[1]) < 1 || Number(sequence[1]) >= Number.MAX_SAFE_INTEGER) fail('A valid automatic invoice number is required.');
  if (records.some(record => record.number === number)) fail('This invoice number is already saved. Start a new invoice before saving again.', 409);
  const status = input.status;
  if (![InvoiceStatus.COMPLETED, InvoiceStatus.PENDING].includes(status)) fail('Select a sale or pending order.');
  const customer = text(input.customer);
  if (!customer) fail('Customer name is required.');
  const invoiceDate = text(input.invoiceDate);
  if (!invoiceDate || recordDateKey({ invoiceDate }) !== invoiceDate) fail('A valid invoice date is required.');
  if (!Array.isArray(input.items) || !input.items.length || input.items.length > 500) fail('Add at least one invoice item (up to 500).');

  const requested = new Map();
  const items = input.items.map((item, index) => {
    if (!item || typeof item !== 'object') fail('Enter valid item details.');
    const name = text(item.name);
    if (!name) fail('Item name is required for every invoice item.');
    const gross = numeric(item.gross, 'Gross weight', true);
    const net = numeric(item.net, 'Net weight', true);
    const pcs = numeric(item.pcs, 'Quantity', true);
    if (!Number.isSafeInteger(pcs)) fail('Quantity must be a whole number.');
    if (net > gross) fail('Net weight cannot be greater than gross weight.');
    const rate = numeric(item.rate, 'Rate per gram', true);
    const making = numeric(item.making === '' || item.making == null ? 0 : item.making, 'Making percentage');
    const stockId = status === InvoiceStatus.COMPLETED ? text(item.stockId) : '';
    if (status === InvoiceStatus.COMPLETED) {
      const saved = stock.find(entry => String(entry.id) === stockId);
      if (!saved) fail('Select an available stock item for every invoice row.');
      if (name !== String(saved.item).trim() || text(item.purity) !== String(saved.purity).trim()) fail('Selected stock details changed. Select the stock item again.', 409);
      const demand = requested.get(stockId) || { pcs: 0, gross: 0, net: 0, name };
      demand.pcs += pcs; demand.gross += gross; demand.net += net;
      if (!Number.isSafeInteger(demand.pcs) || !Number.isFinite(demand.gross) || !Number.isFinite(demand.net)) fail('Requested quantity or weight is too large.');
      requested.set(stockId, demand);
    }
    return { lineId: text(item.lineId) || 'line-' + index, stockId, name, hsn: text(item.hsn), purity: text(item.purity), gross, net, pcs, rate, making };
  });

  if (!Array.isArray(input.exchanges) || input.exchanges.length > 500) fail('Enter valid exchange details.');
  const exchanges = input.exchanges.flatMap(entry => {
    if (!entry || !['gold', 'silver'].includes(entry.metal)) fail('Select Gold or Silver for each exchange.');
    const weight = numeric(entry.weight, 'Exchange weight');
    const rate = numeric(entry.rate, 'Exchange rate');
    if (!weight && !rate && !entry.required) return [];
    if (!weight || !rate) fail('Complete both weight and rate for each exchange item, or remove the empty row.');
    const value = weight * rate;
    if (!Number.isFinite(value)) fail('Exchange value is too large.');
    return [{ metal: entry.metal, weight, rate, value }];
  });
  const manualDiscount = numeric(input.manualDiscount, 'Discount');
  const paid = numeric(input.paid, 'Amount paid');
  const gstRate = numeric(input.gstRate, 'GST rate');
  if (![0, 3].includes(gstRate)) fail('Select a valid GST treatment.');
  // Preserve the original hidden exchange field's two-decimal conversion and
  // the existing invoice calculation order, including final rupee rounding.
  const rawDeduction = exchanges.reduce((sum, entry) => sum + entry.value, 0) + manualDiscount;
  const deduction = roundDeduction ? Number(rawDeduction.toFixed(2)) : rawDeduction;
  const totals = calculateTotals(items, deduction, gstRate / 2);
  if (![deduction, ...Object.values(totals)].every(Number.isFinite)) fail('Invoice amounts are too large.');
  if (numeric(input.expectedTotal, 'Preview total') !== totals.grand) fail('The invoice preview changed. Review its totals and save again.', 409);

  for (const [stockId, demand] of requested) {
    const saved = stock.find(entry => String(entry.id) === stockId);
    if (demand.pcs > (parseInt(saved.qty) || 0) || demand.gross > (parseFloat(saved.gross) || 0) + 0.0001 || demand.net > (parseFloat(saved.net) || 0) + 0.0001) fail('Not enough remaining quantity or weight for "' + demand.name + '".', 409);
    saved.qty = Math.max((parseInt(saved.qty) || 0) - demand.pcs, 0);
    saved.gross = Math.max((parseFloat(saved.gross) || 0) - demand.gross, 0);
    saved.net = Math.max((parseFloat(saved.net) || 0) - demand.net, 0);
  }
  const savedAt = now().toISOString();
  const date = new Date(invoiceDate + 'T00:00:00').toLocaleDateString('en-GB');
  const record = {
    number, date, invoiceDate, status, weightMode: 'line-total', customer,
    mobile: text(input.mobile), address: text(input.address), business: text(input.business) || 'Vishesh Jewellers',
    gstin: text(input.gstin), terms: typeof input.terms === 'string' ? input.terms : '',
    items: items.map(item => item.name).join(', '),
    subtotal: money(totals.subtotal), discount: money(deduction), tax: money(totals.cgst + totals.sgst), total: money(totals.grand),
    soldItems: status === InvoiceStatus.COMPLETED ? items : [],
    ...(status === InvoiceStatus.PENDING ? { orderItems: items } : {}),
    exchanges, manualDiscount, gstRate, initialPaid: paid, paid, due: Math.max(totals.grand - paid, 0),
    payments: paid > 0 ? [{ method: 'amount', amount: paid, initialPayment: true, settledAt: savedAt }] : [],
    invoiceMarkup: typeof input.invoiceMarkup === 'string' ? input.invoiceMarkup : '', savedAt,
    creationRequestId: requestId, creationFingerprint: fingerprint
  };
  exchanges.forEach((exchange, index) => oldMetal.unshift({
    sourceId: number + ':exchange:' + exchange.metal + ':' + index,
    metal: exchange.metal, source: 'Invoice exchange', invoice: number, customer, date,
    weight: exchange.weight, rate: exchange.rate, value: exchange.value, receivedAt: savedAt
  }));
  data[StorageKey.INVOICES] = [record, ...records];
  data[StorageKey.OLD_METAL] = oldMetal;
  data[StorageKey.STOCK] = stock;
  data['invoice-counter'] = Math.max(Number(data['invoice-counter']) || 1, Number(sequence[1]) + 1);
  store.write(data);
  return { record, stock, nextCounter: data['invoice-counter'], replayed: false };
}

module.exports = { createInvoice };
