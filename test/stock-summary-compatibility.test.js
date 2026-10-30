'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('stock cards tolerate older backend totals without a Fine Gold bucket', () => {
  const source = fs.readFileSync(path.join(__dirname, '../frontend/stocks/Stocks.tsx'), 'utf8');
  assert.ok(source.includes("'gold']?.[field]"));
  assert.ok(source.includes("'gold']?.count"));
  const css = fs.readFileSync(path.join(__dirname, '../source/styles/application.css'), 'utf8');
  assert.doesNotMatch(css, /#page-stocks\s+\.stat-card:nth-child\(3\)\s*\{\s*display:\s*none/);
  const totals = { gold: { count: 1, gross: 10, net: 9 }, silver: { count: 0, gross: 0, net: 0 } };
  for (const key of ['gold', 'silver', 'fineGold']) {
    assert.doesNotThrow(() => { const count = totals?.[key]?.count ?? 0; const weight = totals?.[key]?.net ?? 0; assert.ok(Number.isFinite(count + weight)); });
  }
});
