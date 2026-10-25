'use strict';

function replaceSection(source, start, end, replacement) {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  if (from < 0 || to < 0) throw new Error('Stocks migration boundary changed; review the compatibility adapter.');
  return source.slice(0, from) + replacement + source.slice(to);
}

function applyReactStocks(html) {
  html = replaceSection(html,
    '  <!-- ================= STOCKS PAGE ================= -->',
    '  <!-- ================= ITEMS PAGE ================= -->',
    '<section class="page react-page" id="page-stocks"><div id="react-stocks"><p role="status">Loading stock…</p></div></section>\n');
  return replaceSection(html,
    '/* ================= STOCKS PAGE ================= */',
    '/* ================= ITEMS PAGE ================= */',
    `// Compatibility bridge: React owns stock UI; legacy invoices retain their state.
function renderStockTable(){ window.dispatchEvent(new Event('vj:stocks-refresh')); }
function renderStockStats(){}
window.addEventListener('vj:stocks-updated', event => {
  stockList = event.detail;
  renderRowsTable();
});
document.querySelector('.tab-btn[data-page="stocks"]').addEventListener('click', renderStockTable);
\n`);
}

function removeLegacyStockSetup(script) {
  return replaceSection(script, '  const stockItemInput =', '  const customerNameInput =', '');
}

module.exports = { applyReactStocks, removeLegacyStockSetup };
