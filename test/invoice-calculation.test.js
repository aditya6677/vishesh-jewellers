'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { calculateInvoiceLineAmount, calculateInvoiceTotals } = require('../lib/invoice-calculation');

test('invoice item amount uses the row total weight and does not multiply by PCS', () => {
  const item = { net: '10', rate: '10000', making: '10', pcs: 4 };
  assert.equal(calculateInvoiceLineAmount(item), 110000);
  assert.equal(calculateInvoiceLineAmount({ net: 1, rate: 1.005, making: 0 }), 1.01);
});

test('GST is calculated on item subtotal before exchange credit and discount', () => {
  const totals = calculateInvoiceTotals([
    { net: '10', rate: '10000', making: '10', pcs: 4 }
  ], 1000, 1.5);

  assert.deepEqual(totals, {
    subtotal: 110000,
    disc: 1000,
    cgst: 1650,
    sgst: 1650,
    gstPct: 1.5,
    grand: 112300,
    roundOff: 0
  });
});

test('non-GST invoice rounds the final amount and does not allow a negative total', () => {
  const rounded = calculateInvoiceTotals([{ net: 1, rate: 10.25, making: 0 }], 0.15, 0);
  assert.equal(rounded.subtotal, 10.25);
  assert.equal(rounded.grand, 10);
  assert.ok(Math.abs(rounded.roundOff + 0.1) < 1e-10);

  const floor = calculateInvoiceTotals([{ net: 1, rate: 100, making: 0 }], 1000, 1.5);
  assert.equal(floor.grand, 0);
  assert.equal(floor.roundOff, 0);
});
