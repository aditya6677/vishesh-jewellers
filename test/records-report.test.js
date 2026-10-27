'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { PageRenderer } = require('../lib/ui/page-renderer');
const { createConfig } = require('../lib/config');
const filters = { query: '', status: 'all', from: '', to: '' };

test('records report preserves balances, exchange/settlement/return details and input data', async () => {
  const { recordsReport } = await import('../lib/records-report.mjs');
  const records = [{ number: 'VJ1', customer: 'Customer', mobile: '9999999999', total: '₹1,000.00', returnTotal: 100, paid: 400, due: 500, exchanges: [{ metal: 'gold', weight: 1, rate: 100, value: 100 }], payments: [{ method: 'silver', weight: 2, rate: 50, amount: 100 }], returns: [{ noteNumber: 'R1', reason: 'Historical', cashRefund: 50 }] },
    { number: 'VJ2', total: 100, paid: 150, due: 0 }, { number: 'VJ3', status: 'pending', total: 100, due: 100 }, { number: 'VJ4', status: 'voided', total: 100, paid: 50, due: 0 }];
  const before = structuredClone(records);
  const report = recordsReport(records, { ...filters, query: '9999999999', from: '2026-10-01', to: '2026-10-26' }, new Date('2026-10-26T10:00:00Z'));
  assert.equal(report.rows.length, 4);
  assert.deepEqual(report.rows[0].slice(5), ['INR 900.00', 'INR 400.00', 'Due INR 500.00', 'Due']);
  assert.match(report.rows[0][4], /Exchange: gold 1.000g x INR 100.00 = INR 100.00/);
  assert.match(report.rows[0][4], /Payment: silver 2g x INR 50.00 = INR 100.00/);
  assert.match(report.rows[0][4], /Return: R1 Historical INR 50.00/);
  assert.equal(report.rows[1][7], 'Advance +INR 50.00');
  assert.equal(report.rows[2][8], 'Pending delivery'); assert.equal(report.rows[3][8], 'Voided');
  assert.equal(report.filename, 'Invoices-9999999999.pdf');
  assert.match(report.description, /Invoice dates: 2026-10-01 to 2026-10-26/);
  assert.deepEqual(records, before);
  assert.throws(() => recordsReport([], filters), /No invoices match/);
  assert.throws(() => recordsReport(records, { ...filters, from: '2026-10-26', to: '2026-10-01' }), /From date/);
});

test('PDF output repeats headers, restores readable body fonts and continues oversized rows within pages', async () => {
  const { downloadRecordsReport } = await import('../lib/records-report.mjs');
  let instance;
  class Pdf {
    constructor(options) { instance = this; this.options = options; this.page = 1; this.texts = []; this.rects = []; this.internal = { pageSize: { getWidth: () => 842, getHeight: () => 595 } }; }
    setFillColor(...color) { this.fill = color; } setDrawColor() {} setLineWidth() {}
    setTextColor(...color) { this.color = color; this.fill = color; } setFont(name, style) { this.style = style; } setFontSize(size) { this.size = size; }
    rect(x, y, width, height, style) { this.rects.push({ page: this.page, y, height, style, fill: this.fill }); }
    text(value, x, y) { this.texts.push({ page: this.page, value, y, style: this.style, color: this.color, size: this.size }); }
    splitTextToSize(value) { return value.split('\n').flatMap(line => line.match(/.{1,20}/g) || ['']); }
    addPage() { this.page++; } save(name) { this.filename = name; }
  }
  const rows = Array.from({ length: 12 }, (_, index) => ({ number: 'VJ' + index, total: 100, paid: 20, due: 80, items: index === 0 ? 'Long item '.repeat(400) : 'Ring' }));
  assert.equal(downloadRecordsReport(rows, filters, Pdf), 12);
  assert.ok(instance.page > 2);
  assert.ok(instance.rects.every(rect => rect.y + rect.height <= 595 - 24 + .001));
  assert.ok(instance.rects.filter(rect => rect.style === 'F').every(rect => rect.fill.join(',') === '48,39,25'));
  assert.equal(instance.texts.filter(text => text.value === 'Invoice').length, instance.page);
  const body = instance.texts.filter(text => Array.isArray(text.value));
  assert.ok(body.some(text => text.value.join(' ').includes('(cont.)')));
  assert.ok(body.some(text => text.page === 1));
  assert.ok(body.every(text => text.style === 'normal' && text.size === 6.5 && text.color.join(',') === '45,40,32'));
  assert.equal(instance.filename, 'Invoice-Records.pdf');
  assert.throws(() => downloadRecordsReport(rows, filters), /unavailable/);
});

test('React report no longer exposes or injects the legacy export bridge', () => {
  const renderer = new PageRenderer(createConfig({}));
  const react = renderer.render({ reactDashboard: true }), legacy = renderer.render();
  assert.ok(!react.includes('const exportRecordPdf = async filters'));
  assert.ok(!react.includes('window.vjRecordExport ='));
  assert.ok(legacy.includes('const exportRecordPdf = async filters'));
});
