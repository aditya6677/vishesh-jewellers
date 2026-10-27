'use strict';

const { createHash, randomUUID } = require('node:crypto');
const { StorageKey, InvoiceStatus } = require('../domain/constants');
const { calculateInvoiceLineAmount } = require('../invoice-calculation');
const { createInvoice } = require('./invoice-creation');

const fail = (message, statusCode = 400) => { throw Object.assign(new Error(message), { statusCode }); };
const revision = record => createHash('sha256').update(JSON.stringify(record)).digest('hex');

function initialPaidFor(record) {
  if (Number.isFinite(Number(record.initialPaid))) return Number(record.initialPaid);
  const payments = Array.isArray(record.payments) ? record.payments : [];
  const initial = payments.find(payment => payment.initialPayment) || payments.find(payment => payment.settledAt && record.savedAt && Math.abs(new Date(payment.settledAt) - new Date(record.savedAt)) < 60000);
  return initial ? Number(initial.amount) || 0 : Math.max((Number(record.paid) || 0) - payments.reduce((sum, payment) => sum + (Number(payment.amount) || 0), 0), 0);
}

// Preserve the verified editor's arithmetic order, including its single GST
// calculation. Do not multiply line-total weights or prices by piece count.
function editTotals(rows, deduction, componentRate) {
  const subtotal = rows.reduce((sum, item) => sum + calculateInvoiceLineAmount(item), 0);
  const tax = subtotal * (componentRate * 2) / 100;
  const raw = Math.max(subtotal + tax - deduction, 0);
  return { subtotal, disc: deduction, cgst: tax / 2, sgst: tax / 2, gstPct: componentRate, grand: Math.round(raw), roundOff: Math.round(raw) - raw };
}

function editInvoice(store, number, input, now = () => new Date()) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('Enter valid invoice details.');
  const data = structuredClone(store.read());
  const records = data[StorageKey.INVOICES];
  if (!Array.isArray(records)) fail('Saved invoices are not in the expected format.', 500);
  const index = records.findIndex(record => record.number === number);
  if (index < 0) fail('Invoice no longer exists. Refresh Records.', 404);
  const previous = records[index];
  if (!input.version || input.version !== revision(previous)) fail('Invoice changed. Reopen its editor before saving.', 409);
  if (previous.status === InvoiceStatus.VOIDED) fail('Voided invoices cannot be edited.');
  if (!Array.isArray(data[StorageKey.STOCK] || []) || !Array.isArray(data[StorageKey.OLD_METAL] || [])) fail('Saved inventory is not in the expected format.', 500);
  const stock = data[StorageKey.STOCK] || [];
  // Restore the original sale into a detached working snapshot before checking
  // the revised aggregate demand. A pending order has no deducted stock.
  for (const item of previous.soldItems || []) {
    let entry = stock.find(entry => entry.id === item.stockId);
    if (!entry) {
      entry = { id: item.stockId, item: item.name || 'Restored item', purity: item.purity || '', qty: 0, gross: 0, net: 0, added: 'Restored from ' + number };
      stock.push(entry);
    }
    const pcs = Number(item.pcs) || 1;
    const multiplier = previous.weightMode === 'line-total' ? 1 : pcs;
    entry.qty = (Number(entry.qty) || 0) + pcs;
    entry.gross = (Number(entry.gross) || 0) + (Number(item.gross) || 0) * multiplier;
    entry.net = (Number(entry.net) || 0) + (Number(item.net) || 0) * multiplier;
  }
  const prepared = {
    ...data, [StorageKey.STOCK]: stock,
    [StorageKey.INVOICES]: records.filter((_, position) => position !== index),
    [StorageKey.OLD_METAL]: (data[StorageKey.OLD_METAL] || []).filter(entry => !String(entry.sourceId || '').startsWith(number + ':exchange:'))
  };
  let next;
  // Reuse creation validation and inventory reconciliation without persisting its
  // temporary result or advancing the live invoice counter.
  const result = createInvoice({ read: () => prepared, write: value => { next = value; } }, {
    ...input, number, requestId: randomUUID(), status: InvoiceStatus.COMPLETED,
    business: previous.business, gstin: previous.gstin
  }, now, editTotals, false);
  const updated = { ...previous, ...result.record };
  updated.savedAt = previous.savedAt;
  updated.creationRequestId = previous.creationRequestId;
  updated.creationFingerprint = previous.creationFingerprint;
  updated.editedAt = now().toISOString();
  if (previous.status === InvoiceStatus.PENDING) updated.deliveredAt = updated.editedAt;
  const initial = initialPaidFor(previous);
  updated.paid = updated.initialPaid + Math.max((Number(previous.paid) || 0) - initial, 0);
  if (!Number.isFinite(updated.paid)) fail('Resulting paid amount is too large.');
  updated.due = Math.max(input.expectedTotal - updated.paid, 0);
  updated.payments = structuredClone(previous.payments || []);
  const initialPayment = updated.payments.find(payment => payment.initialPayment) || updated.payments.find(payment => payment.settledAt && previous.savedAt && Math.abs(new Date(payment.settledAt) - new Date(previous.savedAt)) < 60000);
  if (initialPayment) { initialPayment.amount = updated.initialPaid; initialPayment.initialPayment = true; }
  else if (updated.initialPaid > 0) updated.payments.push({ method: 'amount', amount: updated.initialPaid, initialPayment: true, settledAt: previous.savedAt || updated.editedAt });
  // Retain the editor's display formatting and the original invoice ordering.
  updated.date = new Date(updated.invoiceDate + 'T00:00:00').toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  const finalRecords = [...records]; finalRecords[index] = updated;
  next[StorageKey.INVOICES] = finalRecords;
  next['invoice-counter'] = data['invoice-counter'];
  // Creation supplies validated exchange rows; preserve the original receipt
  // timestamp rather than making edits look like new metal receipts.
  for (const entry of next[StorageKey.OLD_METAL]) if (String(entry.sourceId || '').startsWith(number + ':exchange:')) { entry.receivedAt = previous.savedAt; entry.date = updated.date; }
  store.write(next);
  return { record: updated, stock: next[StorageKey.STOCK], version: revision(updated) };
}

module.exports = { editInvoice, initialPaidFor, editTotals };
