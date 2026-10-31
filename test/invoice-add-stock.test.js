'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

function load(file, imports = {}, globals = {}) {
  const source = fs.readFileSync(path.join(__dirname, '../frontend/', file), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(compiled, { module, exports: module.exports, require: name => imports[name] || require(name), ...globals });
  return module.exports;
}
const selector = { Select: props => React.createElement('button', { type: 'button' }, props.value) };
function find(node, predicate) {
  if (!node || typeof node !== 'object') return;
  if (predicate(node)) return node;
  for (const child of [].concat(node.props?.children || [])) { const result = find(child, predicate); if (result) return result; }
}

test('shared stock form prefills searched name and retains required total weight/quantity inputs', () => {
  const { StockForm } = load('stocks/StockForm.tsx', { '../components/Select': selector });
  const markup = renderToStaticMarkup(React.createElement(StockForm, { editor: { mode: 'add' }, initialPurity: '22K', initialName: 'New Ring', idPrefix: 'invoice-stock', busy: false, save() {}, cancel() {} }));
  assert.ok(markup.includes('value="New Ring"'));
  for (const field of ['name', 'qty', 'gross', 'net']) assert.ok(markup.includes('id="invoice-stock-' + field + '"'));
  assert.ok(markup.includes('Total gross weight for quantity'));
  assert.ok(markup.includes('Total net weight for quantity'));
});

test('stock popup form submission cannot bubble into an invoice editor form', () => {
  let saved, prevented = false, stopped = false;
  const { StockForm } = load('stocks/StockForm.tsx', {
    react: { ...React, useState: value => [value, () => {}] }, '../components/Select': selector
  }, { FormData: class { get(key) { return { item: ' New Ring ', qty: '4', gross: '10', net: '9' }[key]; } } });
  const tree = StockForm({ editor: { mode: 'add' }, initialPurity: '22K', busy: false, save: value => { saved = value; }, cancel() {} });
  find(tree, node => node.type === 'form').props.onSubmit({ preventDefault() { prevented = true; }, stopPropagation() { stopped = true; }, currentTarget: {} });
  assert.equal(prevented && stopped, true);
  assert.equal(saved.item, 'New Ring');
  assert.equal(saved.qty, 4); assert.equal(saved.gross, 10); assert.equal(saved.net, 9);
});

function popup(create) {
  const events = [], selected = [], errors = [];
  class ApiError extends Error {}
  let state = 0;
  const { AddInvoiceStock } = load('invoice/AddInvoiceStock.tsx', {
    react: { ...React, useEffect() {}, useId: () => 'test-stock', useRef: value => ({ current: value }), useState: value => { const index = state++; return [value, next => { if (index === 2) errors.push(next); }]; } },
    'react-dom': { createPortal: element => element }, '../api': { ApiError, stockApi: { create } },
    '../stocks/StockForm': { StockForm: 'stock-form' }
  }, { document: { body: {} }, window: { dispatchEvent: event => events.push(event) }, Event: class { constructor(type) { this.type = type; } }, CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init.detail; } } });
  const tree = AddInvoiceStock({ name: 'Ring', onClose() {}, onCreated: stock => selected.push(stock) });
  return { save: find(tree, node => node.type === 'stock-form').props.save, events, selected, errors, ApiError };
}

test('inline creation selects exact returned stock ID for SQLite and JSON, never matching names', async () => {
  const old = { id: 'old', item: 'Ring' }, created = { id: 'new', item: 'Ring', qty: 4, gross: 10, net: 9 };
  for (const response of [{ items: [old], affected: [created] }, { items: [old, created] }]) {
    const f = popup(async () => response);
    await f.save({ item: 'Ring' });
    assert.equal(f.selected[0].id, 'new');
    assert.equal(f.events[0].type, 'vj:stock-cache-merge');
    assert.equal(f.events[0].detail[0].id, 'new');
    assert.equal(f.events[1].type, 'vj:stocks-refresh');
    assert.equal(f.selected[0].net, 9);
  }
});

test('popup prevents duplicate submissions and never selects stock after failed validation', async () => {
  let release, calls = 0;
  const f = popup(() => { calls++; return new Promise(resolve => { release = resolve; }); });
  const pending = f.save({});
  await f.save({});
  assert.equal(calls, 1);
  release({ items: [{ id: 'created' }] }); await pending;
  assert.equal(f.selected.length, 1);
  const g = popup(async () => { throw new g.ApiError('Net weight cannot exceed gross weight.'); });
  await g.save({});
  assert.equal(g.selected.length, 0);
  assert.equal(g.events.length, 0);
  assert.ok(g.errors.includes('Net weight cannot exceed gross weight.'));
});

test('no-match creation is offered only with create permission and a successful completed search', () => {
  function picker({ permissions = ['stocks.create'], busy = false, error = '', query = 'Missing ring' } = {}) {
    const states = [query, { left: 0, top: 0, width: 300 }, 0, [], error, busy, null];
    let index = 0;
    const { InvoiceStockPicker } = load('invoice/InvoiceStockPicker.tsx', {
      react: { ...React, useEffect() {}, useId: () => 'stock-menu', useRef: value => ({ current: value }), useState: () => [states[index++], () => {}] },
      'react-dom': { createPortal: element => element }, './AddInvoiceStock': { AddInvoiceStock: 'stock-modal' }
    }, { document: { body: {} }, window: { vjDatabaseMode: true, vjAccountSession: { permissions } } });
    return InvoiceStockPicker({ stocks: [], available: {}, selectedId: '', rowNumber: 1, onSelect() {}, disabled: false, required: true });
  }
  const offered = tree => Boolean(find(tree, node => node.type === 'button' && String(node.props.className).includes('stock-picker-create')));
  assert.equal(offered(picker()), true);
  assert.equal(offered(picker({ permissions: [] })), false);
  assert.equal(offered(picker({ busy: true })), false);
  assert.equal(offered(picker({ error: 'Search failed' })), false);
  assert.equal(offered(picker({ query: '' })), false);
});
