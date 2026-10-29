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

test('menu changes reset scroll without unmounting form drafts', () => {
  const source = require('node:fs').readFileSync(require('node:path').join(__dirname, '../frontend/components/Navigation.tsx'), 'utf8');
  assert.match(source, /window\.scrollTo\(\{ top: 0, left: 0, behavior: 'auto' \}\)/);
  assert.match(source, /classList\.toggle\('active'/);
  assert.doesNotMatch(source, /\.reset\(|replaceChildren\(|innerHTML\s*=/);
});

test('logout is rendered into separate header actions while preserving its lock event', () => {
  const source = require('node:fs').readFileSync(require('node:path').join(__dirname, '../frontend/components/Navigation.tsx'), 'utf8');
  assert.match(source, /document\.getElementById\('workspace-account-actions'\)/);
  assert.match(source, /accountActions && createPortal\(<>/);
  assert.match(source, /window\.dispatchEvent\(new Event\(PIN_LOCK_EVENT\)\)/);
  assert.match(source, /aria-label="Log out and lock workspace"/);
  const entry = require('node:fs').readFileSync(require('node:path').join(__dirname, '../frontend/main.tsx'), 'utf8');
  assert.match(entry, /actions\.id = 'workspace-account-actions'/);
  assert.match(entry, /navigationTarget\.before\(actions\)/);
});
