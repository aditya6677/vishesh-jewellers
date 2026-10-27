'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { calculateInvoiceLineAmount, calculateInvoiceTotals } = require('../lib/invoice-calculation');

// Keep the pre-migration arithmetic here as a compatibility oracle. These
// expressions intentionally preserve JavaScript's original floating-point
// operation order; changing them can change edge-case invoice totals.
function legacyLineAmount(item) {
  return (parseFloat(item.net) || 0) * (parseFloat(item.rate) || 0)
    * (1 + (parseFloat(item.making) || 0) / 100);
}

function legacyInvoiceTotals(rows, discount, taxRate) {
  const subtotal = rows.reduce((sum, row) => sum + legacyLineAmount(row), 0);
  const disc = parseFloat(discount) || 0;
  const gstPct = parseFloat(taxRate) || 0;
  const cgst = subtotal * (gstPct / 100);
  const sgst = subtotal * (gstPct / 100);
  const rawGrand = Math.max(subtotal + cgst + sgst - disc, 0);
  const grand = Math.round(rawGrand);
  return { subtotal, disc, cgst, sgst, gstPct, grand, roundOff: grand - rawGrand };
}

test('invoice item amount uses the row total weight and does not multiply by PCS', () => {
  const item = { net: '10', rate: '10000', making: '10', pcs: 4 };
  assert.equal(calculateInvoiceLineAmount(item), legacyLineAmount(item));
  assert.equal(Math.round(calculateInvoiceLineAmount(item)), 110000);
  assert.equal(calculateInvoiceLineAmount({ net: 1, rate: 1.005, making: 0 }), 1.005);
});

test('invoice arithmetic remains exactly compatible with pre-migration calculation order', () => {
  const rows = [
    { net: '10', rate: '10000', making: '10', pcs: 4 },
    { net: '3.125', rate: '1234.56', making: '7.25', pcs: 2 },
    { net: '0.333', rate: '6789.01', making: '0', pcs: 5 }
  ];
  assert.equal(calculateInvoiceLineAmount(rows[1]), legacyLineAmount(rows[1]));
  assert.deepEqual(calculateInvoiceTotals(rows, '1234.56', '1.5'), legacyInvoiceTotals(rows, '1234.56', '1.5'));

  const totals = calculateInvoiceTotals([{ net: '10', rate: '10000', making: '10', pcs: 4 }], 1000, 1.5);
  assert.deepEqual(totals, legacyInvoiceTotals([{ net: '10', rate: '10000', making: '10', pcs: 4 }], 1000, 1.5));
  assert.equal(totals.grand, 112300);
});

test('non-GST invoice rounds the final amount and does not allow a negative total', () => {
  const rounded = calculateInvoiceTotals([{ net: 1, rate: 10.25, making: 0 }], 0.15, 0);
  assert.equal(rounded.subtotal, 10.25);
  assert.equal(rounded.grand, 10);
  assert.equal(rounded.roundOff, legacyInvoiceTotals([{ net: 1, rate: 10.25, making: 0 }], 0.15, 0).roundOff);

  const floor = calculateInvoiceTotals([{ net: 1, rate: 100, making: 0 }], 1000, 1.5);
  assert.equal(floor.grand, 0);
  assert.equal(floor.roundOff, 0);
});
