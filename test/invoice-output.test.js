'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const output = import('../lib/invoice-output.mjs');

test('print synchronizes the invoice before opening the existing print dialog', async () => {
  const calls = [];
  (await output).printInvoice(() => calls.push('flush'), () => calls.push('print'));
  assert.deepEqual(calls, ['flush', 'print']);
});

test('PDF export preserves the original A4 format, margins, scale, background and filename', async () => {
  const calls = [];
  const node = { invoice: true };
  class Pdf {
    constructor(...args) { calls.push(['constructor', ...args]); this.internal = { pageSize: { getWidth: () => 595 } }; }
    addImage(...args) { calls.push(['image', ...args]); }
    save(name) { calls.push(['save', name]); }
  }
  await (await output).downloadInvoicePdf(node, 'VJ000001', async (element, options) => {
    assert.equal(element, node);
    assert.deepEqual(options, { scale: 2, backgroundColor: '#FAF5E7' });
    return { width: 1000, height: 1200, toDataURL: type => { assert.equal(type, 'image/png'); return 'test-image'; } };
  }, Pdf);
  assert.deepEqual(calls, [['constructor', 'p', 'pt', 'a4'], ['image', 'test-image', 'PNG', 20, 20, 555, 1200 * (555 / 1000)], ['save', 'Invoice-VJ000001.pdf']]);
});

test('missing PDF libraries fail clearly before attempting a download', async () => {
  await assert.rejects((await output).downloadInvoicePdf({}, 'VJ000001', undefined, undefined), /PDF tools are unavailable/);
});
