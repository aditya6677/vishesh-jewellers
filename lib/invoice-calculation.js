'use strict';

function roundCurrency(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function calculateInvoiceLineAmount(item) {
  const netWeight = Number.parseFloat(item.net) || 0;
  const rate = Number.parseFloat(item.rate) || 0;
  const makingPercent = Number.parseFloat(item.making) || 0;
  // Net weight is the total weight entered for the invoice row. PCS is only
  // used by inventory deduction and must never multiply the item amount.
  return roundCurrency(netWeight * rate * (1 + makingPercent / 100));
}

function calculateInvoiceTotals(rows, exchangeAndDiscount, taxRatePerComponent) {
  const subtotal = roundCurrency(rows.reduce((sum, row) => sum + calculateInvoiceLineAmount(row), 0));
  const discount = Number.parseFloat(exchangeAndDiscount) || 0;
  const rate = Number.parseFloat(taxRatePerComponent) || 0;
  // GST applies to jewellery value first; old-metal credit and discount are
  // deducted afterward, matching the invoice and existing business rule.
  const cgst = roundCurrency(subtotal * (rate / 100));
  const sgst = roundCurrency(subtotal * (rate / 100));
  const rawGrand = Math.max(subtotal + cgst + sgst - discount, 0);
  const grand = Math.round(rawGrand);
  return {
    subtotal,
    disc: discount,
    cgst,
    sgst,
    gstPct: rate,
    grand,
    roundOff: roundCurrency(grand - rawGrand)
  };
}

module.exports = { roundCurrency, calculateInvoiceLineAmount, calculateInvoiceTotals };
