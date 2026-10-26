// React owns Records; existing invoice editor, print, and void flows remain isolated.
const renderRecords = async () => window.dispatchEvent(new Event('vj:records-refresh'));
window.vjRecordAction = async (action, number, version) => {
  const records = await getRecords();
  const index = records.findIndex(record => record.number === number);
  if (index < 0) throw new Error('Invoice no longer exists. Refresh Records.');
  if (version !== recordVersions[number]) throw new Error('Invoice changed. Refresh Records and reopen its details.');
  const record = records[index];
  if (action === 'view') return reprintInvoice(record);
  if (record.status === 'voided') throw new Error('Voided invoices cannot be edited or voided again.');
  if (action === 'edit') return openEditInvoiceModal(record, index);
  if (action === 'void') return openVoidModal(record, index);
  throw new Error('Unknown invoice action.');
};
window.addEventListener('vj:record-stock-refresh', async () => {
  const saved = await window.storage.get('stock-list');
  stockList = saved ? JSON.parse(saved.value) : [];
  renderStockTable(); renderStockStats(); renderRowsTable();
});
window.vjRecordExport = exportRecordPdf;

