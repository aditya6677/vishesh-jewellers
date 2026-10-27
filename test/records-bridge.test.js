'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('remaining Records bridge refreshes invoice stock without exposing legacy actions or writing data', async () => {
  const listeners = {}, calls = [];
  const window = { addEventListener: (name, listener) => { listeners[name] = listener; }, dispatchEvent: event => calls.push(event.type), storage: { get: async key => { assert.equal(key, 'stock-list'); return { value: '[{"id":"latest"}]' }; } } };
  const context = { window, stockList: [], Event: class { constructor(type) { this.type = type; } }, renderStockTable: () => calls.push('table'), renderStockStats: () => calls.push('stats'), renderRowsTable: () => calls.push('rows') };
  const source = fs.readFileSync(path.join(__dirname, '../source/scripts/records/react-bridge.js'), 'utf8');
  vm.runInNewContext(source + '\nwindow.refreshRecordsForTest = renderRecords;', context);
  await listeners['vj:record-stock-refresh']();
  assert.equal(context.stockList[0].id, 'latest'); assert.deepEqual(calls, ['table', 'stats', 'rows']);
  assert.equal(window.vjRecordAction, undefined);
  await window.refreshRecordsForTest();
  assert.equal(calls.at(-1), 'vj:records-refresh');
});
