'use strict';

const { createHash } = require('node:crypto');
const { StorageKey, InvoiceStatus } = require('../domain/constants');
const { deleteInvoice } = require('../delete-invoice');

const revision = record => createHash('sha256').update(JSON.stringify(record)).digest('hex');
const fail = (message, statusCode = 400) => { throw Object.assign(new Error(message), { statusCode }); };

function voidInvoice(store, number, input, now = () => new Date()) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('Enter a reason before voiding this invoice.');
  const reason = typeof input.reason === 'string' ? input.reason.trim() : '';
  if (!reason || reason.length > 1000) fail('Enter a reason for voiding (up to 1000 characters).');
  const data = structuredClone(store.read());
  const records = data[StorageKey.INVOICES] || [];
  const ledger = data[StorageKey.OLD_METAL] || [];
  if (!Array.isArray(records) || !Array.isArray(ledger) || !Array.isArray(data[StorageKey.STOCK] || [])) fail('Saved invoice or inventory data is not in the expected format.', 500);
  const record = records.find(record => record.number === number);
  if (!record) fail('Invoice no longer exists. Refresh Records.', 404);
  if (!input.version || input.version !== revision(record)) fail('Invoice changed. Reopen its details before voiding.', 409);
  if (record.status === InvoiceStatus.VOIDED) fail('This invoice has already been voided.', 409);
  // Reuse the verified deletion reversal for stock/return history and for the
  // old-metal availability guard. Nothing is persisted by this pure operation.
  let next;
  try { next = deleteInvoice(data, number); }
  catch (error) { fail(error.message.replace(/deletion/g, 'voiding').replace(/deleted/g, 'voided').replace(/deleting/g, 'voiding').replace(/delete/g, 'void')); }
  const voidedAt = now().toISOString();
  const updated = { ...record, status: InvoiceStatus.VOIDED, voidedAt, voidReason: reason, due: 0 };
  // Retain the original document, payment history, and metal receipts for audit.
  // Opposite ledger entries neutralize every invoice-linked metal movement,
  // including historical returns, rather than erasing that history.
  const reversals = ledger.flatMap((entry, index) => {
    if (entry.invoice !== number) return [];
    const numeric = value => value == null || value === '' ? 0 : Number(value);
    const weight = numeric(entry.weight), value = numeric(entry.value), rate = numeric(entry.rate);
    if (![weight, value, rate].every(Number.isFinite)) fail('Invalid old-metal history. The invoice was not voided.');
    return [{ sourceId: 'void:' + number + ':' + index, reversalOf: entry.sourceId || null,
      metal: entry.metal || 'gold', source: 'Invoice void reversal', invoice: number, customer: record.customer,
      date: new Date(voidedAt).toLocaleDateString('en-GB'), weight: -weight, rate, value: -value, receivedAt: voidedAt }];
  });
  next[StorageKey.INVOICES] = records.map(entry => entry.number === number ? updated : entry);
  next[StorageKey.OLD_METAL] = [...reversals, ...ledger];
  // Invoice status, inventory and audit reversals commit together exactly once.
  store.write(next);
  return { record: updated, version: revision(updated) };
}

module.exports = { voidInvoice };
