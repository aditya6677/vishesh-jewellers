// Presentation only: the backend has already committed the invoice.
export function invoiceSuccessMessage(record) {
  if (!record || typeof record.number !== 'string' || !record.number.trim() || !['completed', 'pending'].includes(record.status)) return null;
  const pending = record.status === 'pending';
  return {
    number: record.number,
    title: pending ? 'Pending order saved' : 'Invoice generated',
    note: pending ? 'The order was saved successfully. Stock will be selected and deducted only when you deliver it from Records.' : 'Stock has been updated and the invoice was saved successfully.',
    viewLabel: pending ? 'View Pending Invoice' : 'View Invoice'
  };
}
