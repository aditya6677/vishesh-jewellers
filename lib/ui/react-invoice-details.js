'use strict';

function applyReactInvoiceDetails(html) {
  const start = '        <div class="panel" style="margin-bottom:18px;">\n          <details class="collapse">';
  const end = '        <div class="panel" style="margin-bottom:18px;">\n          <h3><span class="dot"></span>Items</h3>';
  const from = html.indexOf(start);
  const to = html.indexOf(end, from + start.length);
  const resetBoundary = "  setSaleStatus();\n}\n\ndocument.getElementById('btnNewInvoice')";
  if (from < 0 || to < 0 || !html.includes(resetBoundary)) throw new Error('Invoice details migration boundary changed; review the compatibility adapter.');
  // Existing scripts still read these field IDs while their UI is migrated.
  // Keep the backing controls available, but expose only the React editor.
  return (html.slice(0, from) +
    '<div id="react-invoice-details"><p role="status">Loading invoice details…</p></div>\n' +
    '<div id="legacy-invoice-details" hidden>\n' + html.slice(from, to) + '</div>\n' + html.slice(to))
    .replace(resetBoundary, "  setSaleStatus();\n  window.dispatchEvent(new Event('vj:invoice-details-sync'));\n  window.dispatchEvent(new Event('vj:invoice-reset'));\n}\n\ndocument.getElementById('btnNewInvoice')");
}

module.exports = { applyReactInvoiceDetails };
