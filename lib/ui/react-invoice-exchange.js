'use strict';

function applyReactInvoiceExchange(html) {
  return html
    .replace('id="react-invoice-exchange" hidden', 'id="react-invoice-exchange"')
    .replace(
      '<div class="field"><label>Exchange / Old Gold Deduction (₹)</label><input type="number" id="exchange-disc" value="0" step="0.01"></div>',
      '<div class="field" hidden><label>Exchange / Old Gold Deduction (₹)</label><input type="number" id="exchange-disc" value="0" step="0.01"></div>'
    );
}

module.exports = { applyReactInvoiceExchange };
