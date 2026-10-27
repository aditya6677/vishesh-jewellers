'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseIbjaRates } = require('../lib/ibja-rates');

const row = (date, session, gold, silver) => `<tr><td data-label="${session}">${date}</td><td data-label="Gold 999">${gold}</td><td data-label="Silver 999">${silver}</td></tr>`;
test('IBJA history is chronological, deduplicated and uses one session with correct gram conversions', () => {
  const html = row('26/10/2026', 'PM', 141710, 194479) + row('23/10/2026', 'AM', 141448, 195027) + row('23/10/2026', 'PM', 141630, 194415) + row('26/10/2026', 'PM', 141710, 194479) + row('22/10/2026', 'PM', 0, 0);
  const rates = parseIbjaRates(html);
  assert.equal(rates.goldPerGram, 14171); assert.equal(rates.silverPerGram, 194.479);
  assert.deepEqual(rates.history.map(point => point.quoteDate), ['23/10/2026', '26/10/2026']);
  assert.ok(rates.history.every(point => point.session === 'PM'));
  assert.equal(rates.history[0].silverPerGram, 194.415);
  assert.equal(rates.previousQuote.quoteDate, '23/10/2026');
  assert.equal(rates.goldChangePercent, (14171 - 14163) / 14163 * 100);
});
test('IBJA single quote history does not invent previous data or missing days', () => {
  const result = parseIbjaRates(row('26/10/2026', 'AM', 100000, 100000));
  assert.equal(result.history.length, 1); assert.equal(result.previousQuote, null);
  assert.equal(result.goldChangePercent, null);
  assert.throws(() => parseIbjaRates(row('26/10/2026', 'PM', 'invalid', 100000)), /No valid/);
});
