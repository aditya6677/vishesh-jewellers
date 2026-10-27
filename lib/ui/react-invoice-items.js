'use strict';

function replaceRange(html, start, end, replacement) {
  const from = html.indexOf(start);
  const to = html.indexOf(end, from + start.length);
  if (from < 0 || to < 0) throw new Error('Invoice items migration boundary changed; review the compatibility adapter.');
  return html.slice(0, from) + replacement + html.slice(to);
}

function applyReactInvoiceItems(html) {
  const tbody = '<tbody id="itemsTbody"></tbody>';
  const addButton = '<button class="btn btn-ghost btn-sm" id="addItemRow">+ Add Item Row</button>';
  const previewEnd = "  if(typeof setSaleStatus === 'function') setSaleStatus();\n}";
  if (![tbody, addButton, previewEnd].every(boundary => html.includes(boundary))) throw new Error('Invoice items migration boundary changed; review the compatibility adapter.');
  html = replaceRange(html, 'function stockOptionsHtml(', 'function rowAmount(r){',
    "function renderRowsTable(){ window.dispatchEvent(new Event('vj:invoice-items-sync')); }\n\n");
  html = replaceRange(html, "document.getElementById('addItemRow').addEventListener", "['exchange-disc','gst-rate'", '');
  return html
    .replace(tbody, '<tbody id="itemsTbody" data-react-invoice-items="true"></tbody>')
    .replace(addButton, '<span id="react-invoice-add-item"></span>')
    .replace(previewEnd, "  if(typeof setSaleStatus === 'function') setSaleStatus();\n  window.dispatchEvent(new Event('vj:invoice-totals-updated'));\n}");
}

module.exports = { applyReactInvoiceItems };
