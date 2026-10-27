'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { calculateInvoiceLineAmount } = require('../lib/invoice-calculation');
const { applyReactInvoiceItems } = require('../lib/ui/react-invoice-items');

function fixture({ rates = async () => ({ goldPerGram: 12000, silverPerGram: 100 }) } = {}) {
  let sequence = 1;
  const newRow = () => ({ id: 'row-' + sequence++, stockId: '', name: '', hsn: '7113', purity: '22K', gross: '', net: '', pcs: 1, rate: '', making: '10' });
  const handlers = {}, messages = [];
  let previews = 0;
  const context = {
    rows: [newRow()], newRow,
    stockList: [{ id: 'ring', item: 'Gold Ring', purity: '22K', qty: 10, gross: 100, net: 90, rate: 0 }, { id: 'silver', item: 'Silver Ring', purity: 'Silver', qty: 5, gross: 100, net: 100, rate: 0 }],
    itemsMaster: [{ name: 'Gold Ring', hsn: '7113', purity: '22K', making: 12 }],
    window: { orderMode: false, addEventListener: (name, handler) => { handlers[name] = handler; } },
    renderRowsTable() {}, renderPreview: () => previews++, rowAmount: calculateInvoiceLineAmount,
    getInvoiceMarketRates: rates, toast: message => messages.push(message)
  };
  context.availableQtyFor = (stock, rowId) => Math.max(stock.qty - context.rows.filter(row => row.id !== rowId && row.stockId === stock.id).reduce((sum, row) => sum + (parseInt(row.pcs) || 0), 0), 0);
  // Use the existing rate/purity conversion rather than inventing a new one in the bridge.
  const source = fs.readFileSync(path.join(__dirname, '../source/index.html'), 'utf8');
  vm.createContext(context);
  vm.runInContext(source.slice(source.indexOf('function invoiceRateForStock('), source.indexOf('function stockOptionsHtml(')), context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../source/scripts/invoice/items-bridge.js'), 'utf8'), context);
  return { context, api: context.window.vjInvoiceItems, handlers, messages, previews: () => previews };
}

test('stock selection copies identity and purity, leaves total weights empty, and uses the existing benchmark conversion', async () => {
  const f = fixture();
  await f.api.selectStock('row-1', 'ring');
  const row = f.context.rows[0];
  assert.equal(row.name, 'Gold Ring');
  assert.equal(row.purity, '22K');
  assert.equal(row.hsn, '7113');
  assert.equal(row.gross, '');
  assert.equal(row.net, '');
  assert.equal(row.rate, '11000.00');
  assert.equal(row.making, 12);
  f.api.update(row.id, 'name', 'Cannot change ready-sale name');
  f.api.update(row.id, 'purity', '18K');
  assert.equal(row.name, 'Gold Ring');
  assert.equal(row.purity, '22K');
  await f.api.selectStock(row.id, 'silver');
  assert.equal(row.rate, '100.00');
  assert.equal(row.purity, 'Silver');
});

test('typing updates stable rows and amount uses total weight without multiplying by quantity', async () => {
  const f = fixture();
  await f.api.selectStock('row-1', 'ring');
  const original = f.context.rows[0];
  f.api.update(original.id, 'gross', '10');
  f.api.update(original.id, 'net', '9');
  f.api.update(original.id, 'pcs', '4');
  for (const value of ['1', '12', '123', '1234']) f.api.update(original.id, 'rate', value);
  assert.equal(f.context.rows[0], original);
  assert.equal(original.rate, '1234');
  assert.equal(original.net, '9');
  assert.equal(original.pcs, 4);
  assert.equal(f.api.read().items[0].amount, calculateInvoiceLineAmount(original));
  assert.equal(Math.round(f.api.read().items[0].amount), 12439);
  assert.ok(f.previews() > 0);
});

test('availability accounts for other rows and quantity is clamped before stock deduction', async () => {
  const f = fixture();
  await f.api.selectStock('row-1', 'ring');
  f.api.update('row-1', 'pcs', '4');
  f.api.add();
  assert.equal(f.api.read().items[1].available.ring, 6);
  await f.api.selectStock('row-2', 'ring');
  f.api.update('row-2', 'pcs', '7');
  assert.equal(f.context.rows[1].pcs, 6);
  assert.match(f.messages[0], /Only 6 piece/);
  assert.equal(f.context.stockList[0].qty, 10);
  assert.equal(f.context.stockList[0].gross, 100);
});

test('pending names remain editable and removing the last item restores an empty default row', () => {
  const f = fixture();
  f.context.window.orderMode = true;
  f.api.update('row-1', 'name', 'Custom Ring');
  f.api.update('row-1', 'purity', '18K');
  assert.equal(f.context.rows[0].name, 'Custom Ring');
  assert.equal(f.context.rows[0].purity, '18K');
  f.api.remove('row-1');
  assert.equal(f.context.rows.length, 1);
  assert.equal(f.context.rows[0].name, '');
  assert.equal(f.context.rows[0].stockId, '');
  assert.equal(f.context.rows[0].pcs, 1);
  assert.equal(f.context.rows[0].gross, '');
});

test('late benchmark responses never overwrite a manually entered rate or a removed row', async () => {
  let resolve;
  const rates = new Promise(done => { resolve = done; });
  const f = fixture({ rates: () => rates });
  const pending = f.api.selectStock('row-1', 'ring');
  f.api.update('row-1', 'rate', '7777');
  resolve({ goldPerGram: 12000, silverPerGram: 100 });
  await pending;
  assert.equal(f.context.rows[0].rate, '7777');

  let resolveRemoved;
  const removedRates = new Promise(done => { resolveRemoved = done; });
  const g = fixture({ rates: () => removedRates });
  const removed = g.api.selectStock('row-1', 'ring');
  g.api.remove('row-1');
  resolveRemoved({ goldPerGram: 12000, silverPerGram: 100 });
  await removed;
  assert.equal(g.context.rows[0].rate, '');
});

test('offline selection stays editable and save locks block draft mutations until released', async () => {
  const f = fixture({ rates: async () => { throw new Error('offline'); } });
  await f.api.selectStock('row-1', 'ring');
  assert.equal(f.context.rows[0].rate, '');
  f.api.update('row-1', 'rate', '1000');
  f.handlers['vj:invoice-save-start']();
  f.api.update('row-1', 'rate', '2000');
  f.api.add();
  f.api.remove('row-1');
  assert.equal(f.context.rows.length, 1);
  assert.equal(f.context.rows[0].rate, '1000');
  f.handlers['vj:invoice-save-end']();
  f.api.update('row-1', 'rate', '2000');
  assert.equal(f.context.rows[0].rate, '2000');
});

test('item adapter fails closed when legacy markup boundaries change', () => {
  assert.throws(() => applyReactInvoiceItems(''), /migration boundary changed/);
});
