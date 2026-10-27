'use strict';

// Run against an unpacked packaged runtime, never against installed user data:
// node scripts/check-packaged-runtime.js /absolute/path/to/app.asar.unpacked
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { randomBytes, randomUUID } = require('node:crypto');
const { createRequire } = require('node:module');
const { fork } = require('node:child_process');
const { once } = require('node:events');

async function check(root) {
  if (!root || !path.isAbsolute(root) || !fs.existsSync(path.join(root, 'server.js'))) throw new Error('Pass the absolute packaged app.asar.unpacked directory.');
  const resolve = createRequire(path.join(root, 'server.js'));
  assert.ok(resolve.resolve('fastify').startsWith(path.join(root, 'node_modules') + path.sep), 'Fastify must resolve from packaged production modules.');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vj-packaged-smoke-'));
  const child = fork(path.join(root, 'server.js'), [], {
    cwd: root, silent: true,
    env: { ...process.env, NODE_PATH: '', PORT: '0', HOST: '127.0.0.1', BACKEND_MODE: 'fastify', DATA_DIR: path.join(directory, 'data'), BACKUP_DIR: path.join(directory, 'backups'), DATA_ENCRYPTION_KEY: randomBytes(32).toString('base64'), SOURCE_HTML: path.join(root, 'source/index.html') }
  });
  let stderr = ''; child.stderr.on('data', chunk => { stderr += chunk.toString(); });
  try {
    const base = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Packaged server startup timed out. ' + stderr)), 15000);
      child.on('message', message => { if (message?.type === 'server-ready') { clearTimeout(timer); resolve(message.url); } });
      child.once('error', error => { clearTimeout(timer); reject(error); });
      child.once('exit', code => { clearTimeout(timer); reject(new Error('Packaged server exited (' + code + '). ' + stderr)); });
    });
    const request = (url, options) => fetch(base + url, { ...options, signal: AbortSignal.timeout(15000) });
    const json = async (url, method = 'GET', body) => {
      const response = await request(url, { method, ...(body ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {}) });
      const value = await response.json(); assert.equal(response.status, 200, value.error || url); return value;
    };
    const page = await request('/'); assert.equal(page.status, 200); const html = await page.text();
    assert.ok(html.includes('id="react-navigation"'));
    const legacy = await request('/?frontend=legacy'); assert.equal(legacy.status, 200);
    const legacyHtml = await legacy.text();
    assert.ok(!legacyHtml.includes('id="react-navigation"'));
    assert.ok(legacyHtml.includes("getElementById('printRegeneratedInvoice').addEventListener"));
    assert.ok(!legacyHtml.includes('const openReturnModal ='));
    const module = /type="module" src="([^\"]+)"/.exec(html)[1];
    for (const url of [module, '/vendor/html2canvas.min.js', '/vendor/jspdf.umd.min.js', '/vendor/fonts.css', '/vendor/fonts/jost-latin-400-normal.woff2', '/assets/vishesh-jewellers-logo.png']) {
      const response = await request(url); assert.equal(response.status, 200, url); assert.ok((await response.arrayBuffer()).byteLength > 0);
    }
    const stock = await json('/api/stocks', 'POST', { item: 'Packaged Test Ring', purity: '22K', qty: 10, gross: 100, net: 90 });
    const line = { stockId: stock.items[0].id, name: 'Packaged Test Ring', purity: '22K', gross: 10, net: 9, pcs: 4, rate: 100, making: 0 };
    const sale = { requestId: randomUUID(), number: 'VJ000001', status: 'completed', customer: 'Packaged Smoke Test', invoiceDate: '2026-10-27', items: [line], exchanges: [{ metal: 'gold', weight: .1, rate: 1000 }], manualDiscount: 20, paid: 300, gstRate: 3, expectedTotal: 807 };
    const saved = await json('/api/invoices', 'POST', sale);
    assert.equal(saved.record.due, 507); assert.equal(saved.stock[0].qty, 6); assert.equal(saved.stock[0].gross, 90); assert.equal(saved.stock[0].net, 81);
    const records = await json('/api/records'); assert.equal(records.items.length, 1); assert.equal(records.items[0].paid, 300);
    const detail = await json('/api/records/VJ000001');
    const settled = await json('/api/records/VJ000001/settlements', 'POST', { version: detail.version, method: 'amount', amount: 100 });
    assert.equal(settled.record.paid, 400); assert.equal(settled.record.due, 407);
    const edited = await json('/api/invoices/VJ000001', 'PUT', { ...sale, version: settled.version, items: [{ ...line, pcs: 2, gross: 5, net: 4.5 }], expectedTotal: 344 });
    assert.equal(edited.record.paid, 400); assert.equal(edited.record.due, 0);
    // Outstanding due is clamped to zero; advance is paid minus invoice total.
    const editedTotal = Number(String(edited.record.total).replace(/[₹,]/g, ''));
    assert.equal(editedTotal, 344);
    assert.equal(edited.record.paid - editedTotal, 56);
    const editedStock = await json('/api/stocks');
    assert.equal(editedStock.items[0].qty, 8); assert.equal(editedStock.items[0].gross, 95); assert.equal(editedStock.items[0].net, 85.5);
    const voided = await json('/api/invoices/VJ000001/void', 'POST', { version: edited.version, reason: 'Packaged acceptance test' });
    assert.equal(voided.record.due, 0); assert.equal(voided.record.paid, 400);
    const restoredStock = await json('/api/stocks');
    assert.equal(restoredStock.items[0].qty, 10); assert.equal(restoredStock.items[0].gross, 100); assert.equal(restoredStock.items[0].net, 90);
    await json('/api/invoices/VJ000001', 'DELETE');
    assert.equal((await json('/api/records')).items.length, 0);
    const disk = fs.readFileSync(path.join(directory, 'data/store.json'), 'utf8');
    assert.equal(JSON.parse(disk).algorithm, 'aes-256-gcm'); assert.ok(!disk.includes('Packaged Smoke Test'));
    console.log('PASS: packaged module resolution, React/assets/fonts, sale/exchange/settlement/edit/void/delete, quantity and total weights, due/advance and encrypted persistence.');
  } finally {
    const exited = child.exitCode !== null || child.signalCode !== null;
    if (!exited) { const exit = once(child, 'exit'); child.kill(); await exit; }
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

check(process.argv[2]).catch(error => { console.error(error.message); process.exitCode = 1; });
