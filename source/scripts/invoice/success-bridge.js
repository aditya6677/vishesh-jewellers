// Notification only: persistence, stock changes and form reset are already done.
const showInvoiceSuccess = record => window.dispatchEvent(new CustomEvent('vj:invoice-saved', {
  detail: { number: record.number, status: record.status }
}));
