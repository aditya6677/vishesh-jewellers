'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const { calculateInvoiceLineAmount, calculateInvoiceTotals } = require('../lib/invoice-calculation');
const { applyReactInvoicePreview } = require('../lib/ui/react-invoice-preview');

function previewBridge() {
  const events = [];
  const values = {
    'biz-name': 'Test Shop', 'biz-gstin': 'TESTGST', 'biz-phone': '1112223333', 'biz-email': 'test@example.com', 'biz-address': 'Shop Address',
    'cust-name': 'Test Customer', 'cust-mobile': '9998887777', 'cust-address': 'Customer Address', 'inv-no': 'VJ000001', 'inv-date': '2026-10-20',
    'exchange-disc': '1650', 'gst-rate': '1.5', 'amount-paid': '1000', 'inv-terms': 'First line\nSecond line'
  };
  const nodes = Object.fromEntries(Object.entries(values).map(([id, value]) => [id, { value, dispatchEvent: event => events.push({ id, type: event.type }) }]));
  const rows = [{ id: 'one', stockId: 'ring', name: 'Gold Ring', hsn: '7113', purity: '22K', gross: '10', net: '9', pcs: '4', rate: '1000', making: '10' }, { id: 'empty', name: '', net: '', rate: '' }];
  const context = { window: {}, document: { getElementById: id => nodes[id] }, rows, rowAmount: calculateInvoiceLineAmount,
    computeTotals: () => calculateInvoiceTotals(rows, nodes['exchange-disc'].value, nodes['gst-rate'].value),
    Event: class { constructor(type) { this.type = type; } } };
  vm.createContext(context);
  const html = fs.readFileSync(path.join(__dirname, '../source/index.html'), 'utf8');
  vm.runInContext(html.slice(html.indexOf('function numToWords('), html.indexOf('/* ================= NAV ================= */')), context);
  vm.runInContext(html.slice(html.indexOf('function formatDateDisplay('), html.indexOf('/* ================= INVOICE ACTIONS ================= */')), context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../source/scripts/invoice/preview-bridge.js'), 'utf8'), context);
  return { bridge: context.window.vjInvoicePreviewSource, nodes, events };
}

function paperComponent() {
  const source = fs.readFileSync(path.join(__dirname, '../frontend/invoice/InvoicePaper.tsx'), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(compiled, { module, exports: module.exports, require });
  return module.exports.InvoicePaper;
}

test('preview snapshot uses existing totals/date/words and is read-only', () => {
  const f = previewBridge();
  const snapshot = f.bridge.read();
  assert.equal(snapshot.items.length, 1);
  assert.equal(snapshot.items[0].amount, 9900);
  assert.equal(snapshot.totals.grand, 8547);
  assert.equal(snapshot.date, '20/10/2026');
  assert.equal(snapshot.words, 'Rs. Eight Thousand Five Hundred Forty Seven Only');
  assert.equal(snapshot.paid, 1000);
  assert.equal(snapshot.terms, 'First line\nSecond line');
  assert.equal(f.events.length, 0);
});

test('tax and terms controls update the existing fields and use the corresponding preview events', () => {
  const f = previewBridge();
  f.bridge.tax('0');
  f.bridge.terms('Updated terms');
  assert.equal(f.bridge.read().totals.grand, 8250);
  assert.equal(f.bridge.read().totals.gstPct, 0);
  assert.equal(f.bridge.read().terms, 'Updated terms');
  assert.deepEqual(f.events, [{ id: 'gst-rate', type: 'change' }, { id: 'inv-terms', type: 'input' }]);
  f.bridge.tax('invalid');
  assert.equal(f.nodes['gst-rate'].value, '0');
});

test('React invoice paper retains item/financial values and branding without multiplying PCS', () => {
  const snapshot = previewBridge().bridge.read();
  const markup = renderToStaticMarkup(React.createElement(paperComponent(), { snapshot }));
  for (const expected of ['id="invoicePaper"', 'class="invoice-logo"', 'Beginning... of Special Relationship...', 'Test Customer', 'Customer Address · Mob: 9998887777', '20/10/2026', '9,900.00', '₹8,547.00', '₹7,547.00', 'CGST 1.5%', 'SGST 1.5%', 'Authorised Signatory']) assert.ok(markup.includes(expected), expected);
  assert.ok(!markup.includes('39,600.00'));
  assert.ok(markup.includes('id="p-totals"'));
  assert.ok(markup.includes('class="tl payment-summary-line"'));
});

test('non-GST paper omits tax rows and displays advance as plus amount', () => {
  const f = previewBridge();
  f.bridge.tax('0');
  f.nodes['amount-paid'].value = '9000';
  const markup = renderToStaticMarkup(React.createElement(paperComponent(), { snapshot: f.bridge.read() }));
  assert.ok(markup.includes('NON-GST INVOICE'));
  assert.ok(!markup.includes('CGST'));
  assert.ok(!markup.includes('SGST'));
  assert.ok(markup.includes('Excess / Plus Amount'));
  assert.ok(markup.includes('₹750.00'));
});
test('custom store branding appears on invoice paper and its watermark without changing totals', () => {
  const snapshot = previewBridge().bridge.read();
  snapshot.business.tagline = 'A new store tagline';
  snapshot.business.logo = 'data:image/png;base64,aGVsbG8=';
  const markup = renderToStaticMarkup(React.createElement(paperComponent(), { snapshot }));
  assert.ok(markup.includes('A new store tagline'));
  assert.ok(markup.includes('data:image/png;base64,aGVsbG8='));
  assert.ok(markup.includes('--invoice-logo-image'));
  assert.ok(markup.includes('₹8,547.00'));
});

test('paper escapes user text and preview adapter rejects changed legacy boundaries', () => {
  const f = previewBridge();
  f.nodes['cust-name'].value = '<script>bad()</script>';
  const markup = renderToStaticMarkup(React.createElement(paperComponent(), { snapshot: f.bridge.read() }));
  assert.ok(markup.includes('&lt;script&gt;bad()&lt;/script&gt;'));
  assert.ok(!markup.includes('<script>bad()'));
  assert.throws(() => applyReactInvoicePreview('<html></html>'), /migration boundary changed/);
});
