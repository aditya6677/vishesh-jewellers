'use strict';

function replaceBetween(html, start, end, replacement, includeEnd = false) {
  const from = html.indexOf(start);
  const to = html.indexOf(end, from + start.length);
  if (from < 0 || to < 0) throw new Error('Invoice preview migration boundary changed; review the compatibility adapter.');
  return html.slice(0, from) + replacement + html.slice(to + (includeEnd ? end.length : 0));
}

function applyReactInvoicePreview(html) {
  html = replaceBetween(html, '      <div class="paper-outer">\n        <div id="invoicePaper">', '\n    </div>\n  </section>',
    '      <div class="paper-outer" id="react-invoice-preview"><p role="status">Loading invoice preview…</p></div>');
  html = replaceBetween(html, 'function renderPreview(){', 'function formatDateDisplay(iso){',
    "function renderPreview(){\n  renderMiniTotals();\n  if(typeof setSaleStatus === 'function') setSaleStatus();\n  window.dispatchEvent(new Event('vj:invoice-preview-sync'));\n  window.dispatchEvent(new Event('vj:invoice-totals-updated'));\n}\n\n");
  const pdfEnd = "    toast('Could not generate PDF — try Print instead');\n  }\n});";
  html = replaceBetween(html, "document.getElementById('btnPrint').addEventListener", pdfEnd, '', true);
  html = replaceBetween(html, '        <div class="panel">\n          <h3><span class="dot"></span>Terms &amp; Conditions</h3>', '\n\n        <div class="btn-row">',
    '<div id="react-invoice-terms"></div>\n<div id="legacy-invoice-terms" hidden>' +
    html.slice(html.indexOf('        <div class="panel">\n          <h3><span class="dot"></span>Terms &amp; Conditions</h3>'), html.indexOf('\n\n        <div class="btn-row">')) + '</div>');
  const taxStart = '            <div class="field"><label>Tax treatment</label>';
  const taxEnd = '              </select>\n            </div>';
  const from = html.indexOf(taxStart);
  const to = html.indexOf(taxEnd, from);
  if (from < 0 || to < 0) throw new Error('Invoice preview migration boundary changed; review the tax control.');
  html = html.slice(0, from) + '<div id="react-invoice-tax"></div><div id="legacy-invoice-tax" hidden>' + html.slice(from, to + taxEnd.length) + '</div>' + html.slice(to + taxEnd.length);
  const printButton = '<button class="btn btn-ghost" id="btnPrint">🖨 Print Invoice</button>';
  const pdfButton = '<button class="btn btn-ghost" id="btnPdf">⬇ Download PDF</button>';
  if (!html.includes(printButton) || !html.includes(pdfButton)) throw new Error('Invoice output controls changed; review the compatibility adapter.');
  return html.replace(printButton, '<span id="react-invoice-print-action"></span>').replace(pdfButton, '<span id="react-invoice-pdf-action"></span>')
    .replace('<a class="btn btn-ghost btn-sm invoice-preview-jump" href="#invoicePaper">View live preview ↓</a>', '<span id="react-invoice-preview-action"></span>')
    .replace('Your live invoice preview appears after the form and updates as you type.', 'Open the live preview whenever you need to review, download or print.');
}

module.exports = { applyReactInvoicePreview };
