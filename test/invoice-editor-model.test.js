'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { initialPaidFor, editTotals } = require('../lib/services/invoice-editing');
const { PageRenderer } = require('../lib/ui/page-renderer');
const { createConfig } = require('../lib/config');

function model() {
  const source = fs.readFileSync(path.join(__dirname, '../frontend/invoice/editor-model.ts'), 'utf8');
  const javascript = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const context = { exports: {}, window: { vjInvoiceEditMath: { initialPaidFor, totals: editTotals } } };
  vm.runInNewContext(javascript, context);
  return context.exports;
}
const plain = value => JSON.parse(JSON.stringify(value));
const record = () => ({ number: 'VJ000001', status: 'completed', invoiceDate: '2026-10-26', weightMode: 'line-total', customer: 'Customer', paid: 300, initialPaid: 100, soldItems: [{ lineId: 'line1', stockId: 'ring', name: 'Gold Ring', purity: '22K', gross: 10, net: 9, pcs: 4, rate: 100, making: 0 }], exchanges: [{ metal: 'gold', weight: 1, rate: 100, value: 100 }], manualDiscount: 0, gstRate: 3 });

test('React edit draft preserves line-total weights and initial payments without mutating records', () => {
  const { editDraft, editSummary } = model();
  const saved = record(), before = structuredClone(saved);
  const draft = editDraft(saved);
  assert.equal(draft.items[0].gross, 10); assert.equal(draft.items[0].net, 9); assert.equal(draft.items[0].pcs, 4);
  assert.equal(draft.paid, '100.00'); assert.equal(draft.manualDiscount, '0.00');
  const summary = editSummary(saved, draft);
  assert.equal(summary.grand, 827); assert.equal(summary.paid, 300); assert.equal(summary.due, 527);
  draft.paid = '1000';
  assert.equal(editSummary(saved, draft).advance, 373);
  assert.equal(editSummary(saved, draft).due, 0);
  assert.deepEqual(saved, before);
});

test('React edit draft maps historical per-piece and pending order data and legacy discounts', () => {
  const { editDraft } = model();
  const saved = record(); delete saved.weightMode;
  assert.equal(editDraft(saved).items[0].gross, 40);
  assert.equal(editDraft(saved).items[0].net, 36);
  const pending = { ...saved, status: 'pending', soldItems: [], orderItems: saved.soldItems, manualDiscount: undefined, discount: '₹125.00', gstRate: undefined, tax: '₹0.00' };
  const draft = editDraft(pending);
  assert.equal(draft.items.length, 1); assert.equal(draft.gstRate, '0'); assert.equal(draft.manualDiscount, '25.00');
  assert.equal(draft.exchanges[0].metal, 'gold');
});

test('React stock picker availability includes the invoice allocation without changing current stock', () => {
  const { editStocks } = model();
  const saved = record(), stocks = [{ id: 'ring', item: 'Gold Ring', purity: '22K', qty: 6, gross: 90, net: 81 }];
  const before = structuredClone(stocks);
  assert.deepEqual(plain(editStocks(saved, stocks)), [{ ...stocks[0], qty: 10, gross: 100, net: 90 }]);
  assert.deepEqual(stocks, before);
  assert.equal(editStocks(saved, [])[0].qty, 4);
  assert.deepEqual(plain(editStocks({ ...saved, status: 'pending', soldItems: [] }, stocks)), stocks);
});

test('React page replaces legacy editor DOM and injects the exact backend calculation functions', () => {
  const renderer = new PageRenderer(createConfig({}));
  const react = renderer.render({ reactDashboard: true }), legacy = renderer.render();
  assert.ok(react.includes('id="react-invoice-editor"'));
  assert.ok(!react.includes("editInvoiceModal.id = 'editInvoiceModal'"));
  assert.ok(!react.includes("getElementById('saveInvoiceEdit').addEventListener"));
  assert.ok(legacy.includes("getElementById('saveInvoiceEdit').addEventListener"));
  const editor = fs.readFileSync(path.join(__dirname, '../frontend/invoice/InvoiceEditor.tsx'), 'utf8');
  assert.match(editor, /type="date"[^\n]*onInput=/);
  assert.ok(editor.includes('if (lock.current) return'));
  assert.ok(editor.includes('version: session.version'));
  for (const script of react.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)) new vm.Script(script[1]);
  const injected = /window\.vjInvoiceEditMath = ([\s\S]*?);\n\/\/ End shared editor math\./.exec(react)[1];
  const context = { window: { vjInvoiceMath: { lineAmount: require('../lib/invoice-calculation').calculateInvoiceLineAmount } }, numToWords: () => '' };
  const math = vm.runInNewContext('(' + injected + ')', context);
  assert.equal(math.initialPaidFor(record()), 100);
  for (const gst of [0, 1.5]) for (const deduction of [0, 12.3456, 5000]) assert.deepEqual(plain(math.totals(record().soldItems, deduction, gst)), editTotals(record().soldItems, deduction, gst));
});
