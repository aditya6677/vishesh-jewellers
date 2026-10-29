'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomBytes } = require('node:crypto');
const { performance } = require('node:perf_hooks');
const { openDatabase } = require('../lib/database/database');
const { importSnapshot } = require('../lib/database/snapshot-migration');
const { DatabaseQueries } = require('../lib/database/queries');
const count = Number(process.argv[2] || 10000);
if (!Number.isSafeInteger(count) || count < 100 || count > 20000) throw new Error('Choose 100–20,000 synthetic operational invoices.');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vj-operational-bench-')), key = randomBytes(32);
let db;
try {
  db = openDatabase(path.join(directory, 'benchmark.db'), key, { create: true });
  const snapshot = { 'stock-list': [{ id: 'synthetic', item: 'Synthetic Ring', purity: '22K', qty: count * 4, gross: count, net: count }],
    'invoice-records': Array.from({ length: count }, (_, i) => ({ number: 'VJ' + String(i + 1).padStart(6, '0'), customer: 'Synthetic Customer ' + i, mobile: String(i).padStart(10, '0'), status: i % 10 ? 'completed' : 'pending', weightMode: 'line-total', invoiceDate: '2026-10-28', savedAt: '2026-10-28T08:00:00Z', total: 103, paid: 50, due: 53, payments: [{ method: 'amount', amount: 50, settledAt: '2026-10-28T08:00:00Z', initialPayment: true }], soldItems: i % 10 ? [{ lineId: 'line-1', stockId: 'synthetic', name: 'Synthetic Ring', purity: '22K', pcs: 4, gross: 1, net: 1, rate: 100, making: 0 }] : [], exchanges: [] })),
    'purchase-records': [], 'payment-records': [], 'old-gold-records': [], 'invoice-counter': count + 1 };
  const began = performance.now();
  importSnapshot(db, snapshot, { storeId: 'benchmark', sourceSha256: 'a'.repeat(64), acknowledgeLegacy: true });
  const importSeconds = (performance.now() - began) / 1000;
  const query = new DatabaseQueries(db, 'benchmark'), samples = [], reportTimes = [];
  for (let i = 0; i < 10; i++) {
    let start = performance.now(); const page = query.recordList({ page: Math.ceil(count / 10), pageSize: 10 }); samples.push(performance.now() - start);
    if (!page.items.length || page.items.length > 10) throw new Error('Invalid bounded page.');
    start = performance.now(); const report = query.dashboard({ from: '2026-10-28', to: '2026-10-28' }); reportTimes.push(performance.now() - start);
    if (report.summary.invoices !== count - Math.ceil(count / 10)) throw new Error('Report count mismatch.');
  }
  samples.sort((a,b) => a-b); reportTimes.sort((a,b) => a-b);
  console.log(JSON.stringify({ syntheticInvoices: count, normalizedLines: db.prepare('SELECT count(*) AS n FROM invoice_lines').get().n, importSeconds: Number(importSeconds.toFixed(3)), pageP95Ms: Number(samples[9].toFixed(3)), dateRangeReportP95Ms: Number(reportTimes[9].toFixed(3)), sampledRssMiB: Number((process.memoryUsage().rss / 1048576).toFixed(2)), runtime: process.version, platform: process.platform, architecture: process.arch, caveat: 'Operational schema synthetic benchmark on this host; not million-record or packaged-desktop acceptance.' }, null, 2));
} finally { if (db?.open) db.close(); key.fill(0); fs.rmSync(directory, { recursive: true, force: true }); }
