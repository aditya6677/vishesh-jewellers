'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

function component(file) {
  const source = fs.readFileSync(file, 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} };
  const load = name => {
    if (!name.startsWith('.')) return require(name);
    const base = path.resolve(path.dirname(file), name);
    return component(fs.existsSync(base + '.tsx') ? base + '.tsx' : base + '.ts');
  };
  vm.runInNewContext(compiled, { module, exports: module.exports, require: load });
  return module.exports;
}

const { MarketRates } = component(path.join(__dirname, '../frontend/dashboard/MarketRates.tsx'));
const rates = { goldPerGram: 10000, silverPerGram: 100, quoteDate: '28/10/2026', session: 'PM', goldChangePercent: -1, silverChangePercent: 2, previousQuote: { quoteDate: '27/10/2026', session: 'PM' }, history: [
  { quoteDate: '27/10/2026', session: 'PM', goldPerGram: 10100, silverPerGram: 98 },
  { quoteDate: '28/10/2026', session: 'PM', goldPerGram: 10000, silverPerGram: 100 }
] };

test('side-by-side rates keep prices, change direction, chart and refresh controls', () => {
  const html = renderToStaticMarkup(React.createElement(MarketRates, { rates, refresh() {}, loading: false }));
  assert.match(html, /market-rates-layout/);
  assert.match(html, /aria-labelledby="benchmark-title"/);
  assert.match(html, /₹10,000\.00/);
  assert.match(html, /₹100\.00/);
  assert.match(html, /rate-change-down/);
  assert.match(html, /rate-change-up/);
  assert.match(html, /aria-label="Refresh live rates"/);
  assert.match(html, /2 published dates/);
  assert.match(html, /aria-label="Chart metal"/);
});

test('rates stay hidden offline and refresh remains disabled during loading', () => {
  assert.equal(renderToStaticMarkup(React.createElement(MarketRates, { rates: null, refresh() {}, loading: false })), '');
  const html = renderToStaticMarkup(React.createElement(MarketRates, { rates, refresh() {}, loading: true }));
  assert.match(html, /aria-label="Refresh live rates"[^>]*disabled/);
});

test('desktop uses a one-third/two-thirds grid with a stacked small-screen layout', () => {
  const css = fs.readFileSync(path.join(__dirname, '../source/styles/application.css'), 'utf8');
  assert.match(css, /\.market-rates-layout\s*\{[^}]*grid-template-columns:minmax\(0,1fr\) minmax\(0,2fr\)/);
  assert.match(css, /@media\(max-width:760px\)\s*\{\s*\.market-rates-layout\s*\{\s*grid-template-columns:minmax\(0,1fr\)/);
});
