'use strict';

function applyReactInvoiceSave(html) {
  html = html.replace('placeholder="Select from stock" readonly>', 'placeholder="${window.orderMode ? \'Item name\' : \'Select from stock\'}" ${window.orderMode ? \'\' : \'readonly\'}>');
  const start = "document.getElementById('btnCompleteSale').addEventListener('click', async ()=>{";
  const end = "document.getElementById('btnPrint')";
  const from = html.indexOf(start);
  const to = html.indexOf(end, from + start.length);
  if (from < 0 || to < 0) throw new Error('Invoice save migration boundary changed; review the compatibility adapter.');
  return html.slice(0, from) + '// React preview saves invoices through the atomic backend transaction.\n\n' + html.slice(to);
}

module.exports = { applyReactInvoiceSave };
