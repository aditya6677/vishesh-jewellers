'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const exchangeMath = import('../lib/invoice-exchange.mjs');

function legacyExchangeValue(entry) {
  const weight = Math.max(Number(entry.weight) || 0, 0);
  const rate = Math.max(Number(entry.rate) || 0, 0);
  return weight * rate;
}

test('exchange line and combined credit preserve legacy weight-times-rate calculation', async () => {
  const { calculateExchangeEntryValue, calculateInvoiceExchange } = await exchangeMath;
  const rows = [
    { metal: 'gold', weight: '1.125', rate: '6423.75' },
    { metal: 'silver', weight: '20.5', rate: '102.25' },
    { metal: 'gold', weight: '0', rate: '2000' }
  ];
  assert.equal(calculateExchangeEntryValue(rows[0].weight, rows[0].rate), legacyExchangeValue(rows[0]));
  assert.equal(calculateInvoiceExchange(rows), rows.reduce((sum, row) => sum + legacyExchangeValue(row), 0));
});

test('exchange calculation clamps invalid and negative weight or rate to zero', async () => {
  const { calculateExchangeEntryValue, calculateInvoiceExchange } = await exchangeMath;
  assert.equal(calculateExchangeEntryValue('-1', '100'), 0);
  assert.equal(calculateExchangeEntryValue('2', '-100'), 0);
  assert.equal(calculateExchangeEntryValue('invalid', '100'), 0);
  assert.equal(calculateInvoiceExchange([]), 0);
});
