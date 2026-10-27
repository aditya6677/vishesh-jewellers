// Retained synchronization only: React owns all Records actions.
const renderRecords = async () => window.dispatchEvent(new Event('vj:records-refresh'));
window.addEventListener('vj:record-stock-refresh', async () => {
  const saved = await window.storage.get('stock-list');
  stockList = saved ? JSON.parse(saved.value) : [];
  renderStockTable(); renderStockStats(); renderRowsTable();
});

