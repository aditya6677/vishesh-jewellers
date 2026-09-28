// Build the complete reversal before committing any part of it to storage.
function deleteInvoice(store, number) {
  const next = JSON.parse(JSON.stringify(store));
  const records = next['invoice-records'] || [];
  const record = records.find(entry => entry.number === number);
  if (!record) throw new Error('Invoice no longer exists. Refresh Records.');
  const stocks = next['stock-list'] || [];
  if (record.status !== 'voided' && record.status !== 'pending') {
    if (!record.soldItems?.length) throw new Error('This invoice lacks the stock details required for a safe deletion.');
    for (const item of record.soldItems) {
      const stock = stocks.find(entry => String(entry.id) === String(item.stockId));
      if (!stock) throw new Error('Original stock item missing: ' + item.name + '. Restore it before deleting this invoice.');
      const returned = (record.returns || []).flatMap(entry => entry.items || []).filter(entry => entry.lineId === item.lineId);
      for (const field of ['gross', 'net']) {
        const weight = Number(item[field]) || 0;
        const restored = returned.reduce((sum, entry) => sum + (Number(entry[field]) || 0), 0);
        if (!Number.isFinite(weight) || weight < 0 || restored > weight + 0.0001) throw new Error('Inconsistent stock history. Invoice was not deleted.');
        stock[field] = (Number(stock[field]) || 0) + Math.max(weight - restored, 0);
      }
    }
  }
  const ledger = next['old-gold-records'] || [];
  const revised = ledger.filter(entry => entry.invoice !== number);
  for (const metal of ['gold', 'silver']) {
    const balance = entries => entries.filter(entry => (entry.metal || 'gold') === metal).reduce((sum, entry) => sum + (Number(entry.weight) || 0), 0);
    if (balance(revised) < Math.min(0, balance(ledger)) - 0.0001) {
      throw new Error('Cannot delete: the old ' + metal + ' received on this invoice has already been used. Adjust the linked outgoing metal payments first.');
    }
  }
  next['invoice-records'] = records.filter(entry => entry.number !== number);
  next['stock-list'] = stocks;
  next['old-gold-records'] = revised;
  return next;
}
module.exports = { deleteInvoice };
