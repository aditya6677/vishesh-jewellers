'use strict';

function applyReactNavigation(html) {
  const nav = /<nav class="tabs">[\s\S]*?<\/nav>/;
  if (!nav.test(html)) throw new Error('Navigation menu migration boundary changed.');
  html = html.replace(nav, '<nav class="tabs" id="react-navigation" aria-label="Main menu"></nav>');
  const start = html.indexOf('/* ================= NAV ================= */');
  const end = html.indexOf('/* ================= INVOICE ROWS ================= */', start);
  if (start < 0 || end < 0) throw new Error('Navigation handler migration boundary changed.');
  html = html.slice(0, start) + `// Invoice state remains mounted while React owns navigation.
let invoiceStockRefreshRequest = 0;
window.vjRefreshInvoiceStock = async () => {
  const request = ++invoiceStockRefreshRequest;
  const savedStock = await window.storage.get('stock-list');
  if (request !== invoiceStockRefreshRequest) return;
  const previous = stockList;
  stockList = savedStock ? JSON.parse(savedStock.value) : [];
  if (window.vjDatabaseMode) {
    const selected = new Set(rows.map(row => String(row.stockId)));
    for (const item of previous) if (selected.has(String(item.id)) && !stockList.some(stock => String(stock.id) === String(item.id))) stockList.push(item);
    window.dispatchEvent(new Event('vj:stocks-invalidated'));
  }
  renderRowsTable();
};
\n` + html.slice(end);
  return html.replace("document.querySelector('.tab-btn[data-page=\"stocks\"]').addEventListener('click', renderStockTable);", '');
}

module.exports = { applyReactNavigation };
