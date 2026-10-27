'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { PageRenderer } = require('../lib/ui/page-renderer');
const { createConfig } = require('../lib/config');
const { applyReactNavigation } = require('../lib/ui/react-navigation');

test('navigation keeps menu order and refreshes exactly the selected feature', async () => {
  const { APP_MENUS, refreshMenu } = await import('../lib/navigation.mjs');
  assert.deepEqual(APP_MENUS.map(menu => menu.label), ['Dashboard', 'Invoice', 'Payment', 'Purchase', 'Stocks', 'Records', 'Settings']);
  assert.equal(APP_MENUS[0].page, 'dashboard');
  const calls = [], api = { dashboard: async () => calls.push('dashboard'), invoice: async () => calls.push('invoice'), event: name => calls.push(name) };
  for (const menu of APP_MENUS) await refreshMenu(menu.page, api);
  assert.deepEqual(calls, ['dashboard', 'invoice', 'vj:payments-refresh', 'vj:purchases-refresh', 'vj:stocks-refresh', 'vj:records-refresh', 'vj:settings-refresh']);
  await assert.rejects(refreshMenu('unknown', api), /Unknown/);
  assert.equal(calls.length, 7);
});

test('invoice navigation refresh preserves draft state and ignores late stale stock responses', async () => {
  const html = new PageRenderer(createConfig({})).render({ reactDashboard: true });
  const start = html.indexOf('let invoiceStockRefreshRequest = 0;'), end = html.indexOf('/* ================= INVOICE ROWS ================= */', start);
  const pending = [], rows = [{ name: 'Draft ring', gross: '10', net: '9', rate: '100' }]; let renders = 0;
  const context = { window: { storage: { get: key => { assert.equal(key, 'stock-list'); return new Promise(resolve => pending.push(resolve)); } } }, stockList: [], rows, renderRowsTable: () => renders++ };
  vm.runInNewContext(html.slice(start, end), context);
  const first = context.window.vjRefreshInvoiceStock(), second = context.window.vjRefreshInvoiceStock();
  pending[1]({ value: JSON.stringify([{ id: 'latest' }]) }); await second;
  pending[0]({ value: JSON.stringify([{ id: 'stale' }]) }); await first;
  assert.equal(context.stockList[0].id, 'latest'); assert.equal(renders, 1);
  assert.deepEqual(rows, [{ name: 'Draft ring', gross: '10', net: '9', rate: '100' }]);
});

test('menu refresh failures propagate without triggering other feature refreshes', async () => {
  const { refreshMenu } = await import('../lib/navigation.mjs');
  let events = 0;
  await assert.rejects(refreshMenu('home', { invoice: async () => { throw Error('Offline'); }, dashboard: async () => assert.fail('Wrong refresh'), event: () => events++ }), /Offline/);
  assert.equal(events, 0);
});

test('React navigation removes old button handlers and leaves original frontend intact', () => {
  const renderer = new PageRenderer(createConfig({}));
  const react = renderer.render({ reactDashboard: true }), legacy = renderer.render();
  assert.ok(react.includes('id="react-navigation"'));
  assert.ok(!react.includes('window.vjNavigationReady'));
  assert.ok(!react.includes("dashboardTab.addEventListener('click', openDashboard)"));
  assert.ok(!react.includes("document.querySelector('.tab-btn[data-page=\"stocks\"]').addEventListener"));
  assert.ok(legacy.includes("dashboardTab.addEventListener('click', openDashboard)"));
  assert.throws(() => applyReactNavigation('changed source'), /boundary/);
});
