'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { historyReportUrl, parseHistoryText, parseHistoryPdf, readReport } = require('../lib/ibja-history');
const { MetalRatesService } = require('../lib/services/metal-rates-service');

const header = 'Gold 999 (AM Price) Gold 999 (PM Price) Silver 999 (AM Price) Silver 999 (PM Price)';
const numbers = '100000 101000 99000 100000 91000 92000 75000 76000 58000 59000 200000 201000';
const report = header + '\n28-Oct-26 ' + numbers + '\n27-Oct-26 SUN\n26-Oct-26 ' + numbers + '\n25-Oct-26 Market Holiday';
const link = '<a href="../UploadedFiles/30DaysPdf/report.pdf">Previous 30 Days</a>';
const row = '<tr><td data-label="PM">28/10/2026</td><td data-label="Gold 999">102000</td><td data-label="Silver 999">202000</td></tr>';

test('official report discovery excludes external URLs and unrelated downloads', () => {
  assert.equal(historyReportUrl(link), 'https://ibjarates.com/UploadedFiles/30DaysPdf/report.pdf');
  assert.equal(historyReportUrl(link.replace('../UploadedFiles', 'https://evil.example/UploadedFiles')), null);
  assert.equal(historyReportUrl(link.replace('30DaysPdf', 'Other')), null);
  assert.equal(historyReportUrl('<a href="https://example.com">Rates</a>'), null);
});

test('history validates columns, preserves sessions and converts the published units', () => {
  const pm = parseHistoryText(report, 'PM'), am = parseHistoryText(report, 'AM');
  assert.equal(pm.length, 2);
  assert.equal(pm[0].goldPerGram, 10100);
  assert.equal(pm[0].silverPerGram, 201);
  assert.equal(am[0].goldPerGram, 10000);
  assert.equal(am[0].silverPerGram, 200);
  assert.equal(pm[1].quoteDate, '26/10/2026');
  assert.throws(() => parseHistoryText(report.replace('Gold 999', 'Gold 916'), 'PM'), /columns/);
  assert.throws(() => parseHistoryText(header + '\n31-Feb-26 ' + numbers, 'PM'), /No valid/);
  assert.throws(() => parseHistoryText(header + '\n28-Oct-26 100000 200000', 'PM'), /No valid/);
});

test('PDF history parsing runs in an isolated worker without native PDF dependencies', async () => {
  const { jsPDF } = require('jspdf');
  const pdf = new jsPDF();
  pdf.setFontSize(8);
  pdf.text(header, 10, 15);
  pdf.text('28-Oct-26 ' + numbers, 10, 30);
  const quotes = await parseHistoryPdf(Buffer.from(pdf.output('arraybuffer')), 'PM');
  assert.equal(quotes.length, 1);
  assert.equal(quotes[0].goldPerGram, 10100);
  assert.equal(quotes[0].silverPerGram, 201);
});

test('history report download rejects non-PDF and oversized content', async () => {
  await assert.rejects(readReport(new Response('not a PDF')), /not a PDF/);
  await assert.rejects(readReport(new Response('%PDF-', { headers: { 'content-length': '2000001' } })), /too large/);
});

test('service merges more dates, retains homepage rates and caches the report', async () => {
  let time = 0, downloads = 0;
  const service = new MetalRatesService({ now: () => time,
    fetchRates: async url => url.endsWith('.pdf') ? (downloads++, new Response('%PDF-synthetic')) : new Response(row + link),
    parseHistory: async () => [...parseHistoryText(report, 'PM'), { quoteDate: '29/10/2026', session: 'PM', goldPerGram: 900, silverPerGram: 10 }]
  });
  const rates = await service.getRates();
  assert.equal(rates.history.length, 2);
  assert.deepEqual(rates.history.map(point => point.quoteDate), ['26/10/2026', '28/10/2026']);
  assert.equal(rates.history.at(-1).goldPerGram, 10200);
  assert.equal(rates.goldPerGram, 10200);
  time = 61_000;
  await service.getRates(); assert.equal(downloads, 1);
  await service.getRates(true); assert.equal(downloads, 2);
});

test('optional report failures never discard valid current rates', async () => {
  const service = new MetalRatesService({ fetchRates: async url => {
    if (url.endsWith('.pdf')) throw new Error('History unavailable');
    return new Response(row + link);
  } });
  const rates = await service.getRates();
  assert.equal(rates.goldPerGram, 10200);
  assert.equal(rates.history.length, 1);
});

test('concurrent rate refreshes share one fetch and failed jobs release the slot', async () => {
  let finish, calls = 0;
  const gate = new Promise(resolve => { finish = resolve; });
  const service = new MetalRatesService({ fetchRates: async () => { calls++; await gate; return new Response(row); } });
  const requests = Array.from({ length: 20 }, () => service.getRates(true));
  assert.equal(calls, 1);
  finish();
  const results = await Promise.all(requests);
  assert.ok(results.every(result => result.goldPerGram === 10200));
  await service.getRates(true); assert.equal(calls, 2);
  let attempts = 0;
  const failing = new MetalRatesService({ fetchRates: async () => { attempts++; throw new Error('offline'); } });
  await assert.rejects(failing.getRates(), /offline/);
  await assert.rejects(failing.getRates(), /offline/);
  assert.equal(attempts, 2);
});
