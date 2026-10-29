'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const { calculateDashboard } = require('../lib/dashboard-summary');

function load(file) {
  const compiled = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(compiled, { module, exports: module.exports, require: name => name.startsWith('.') ? load(path.resolve(path.dirname(file), name) + '.tsx') : require(name) });
  return module.exports;
}
const { BusinessCharts } = load(path.join(__dirname, '../frontend/dashboard/BusinessCharts.tsx'));
const render = value => renderToStaticMarkup(React.createElement(BusinessCharts, { value }));

test('business charts display the existing summary without mutating financial data', () => {
  const value = calculateDashboard([
    { total: 1000, paid: 800, due: 200, status: 'completed', weightMode: 'line-total', soldItems: [{ net: 10, pcs: 4, rate: 100, purity: '22K' }] },
    { total: 500, paid: 500, due: 0, status: 'completed', weightMode: 'line-total', soldItems: [{ net: 10, pcs: 2, rate: 50, purity: 'Silver' }] }
  ], [{ amount: 100 }], [{ type: 'amount', amount: 300 }, { type: 'self-expense', amount: 50 }], []);
  const before = structuredClone(value);
  const html = render(value);
  assert.match(html, /Customer collections: ₹1,300\.00/);
  assert.match(html, /Party payments: ₹300\.00/);
  assert.match(html, /Old-metal purchases: ₹100\.00/);
  assert.match(html, /Expenses: ₹50\.00/);
  assert.match(html, /₹850\.00/);
  assert.match(html, /gold 66\.7%, silver 33\.3%/);
  assert.match(html, /Cash movement, not profit/);
  assert.deepEqual(value, before);
});

test('empty periods do not invent sales or produce invalid graph values', () => {
  const html = render(calculateDashboard([], [], [], []));
  assert.match(html, /No completed metal sales in this period/);
  assert.doesNotMatch(html, /NaN|Infinity|strokeDasharray="0 0"/);
});

test('negative after-payment balance is red and sales mix excludes voided and pending orders', () => {
  const value = calculateDashboard([
    { status: 'voided', total: 1000, paid: 1000, due: 0, soldItems: [{ net: 10, rate: 100, purity: 'Silver' }] },
    { status: 'pending', total: 1000, paid: 100, due: 900, soldItems: [{ net: 10, rate: 100, purity: 'Silver' }] }
  ], [{ amount: 250 }], [], []);
  assert.equal(value.silver.sales, 0);
  const html = render(value);
  assert.match(html, /class="due-amount">₹-150\.00/);
  assert.match(html, /No completed metal sales/);
});

test('charts use the date-filtered snapshot rather than external or unfiltered records', () => {
  const source = fs.readFileSync(path.join(__dirname, '../frontend/dashboard/Dashboard.tsx'), 'utf8');
  assert.match(source, /<BusinessCharts value=\{snapshot\.summary\} \/>/);
  assert.match(source, /dashboardApi\.snapshot\(range/);
  assert.doesNotMatch(fs.readFileSync(path.join(__dirname, '../frontend/dashboard/BusinessCharts.tsx'), 'utf8'), /fetch\(|https?:/);
});
