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
  stockList = savedStock ? JSON.parse(savedStock.value) : [];
  renderRowsTable();
};
\n` + html.slice(end);
  return html.replace("document.querySelector('.tab-btn[data-page=\"stocks\"]').addEventListener('click', renderStockTable);", '');
}

module.exports = { applyReactNavigation };
