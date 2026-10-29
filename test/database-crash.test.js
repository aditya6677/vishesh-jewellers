'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomBytes, randomUUID } = require('node:crypto');
const { fork } = require('node:child_process');
const { once } = require('node:events');
const { openDatabase } = require('../lib/database/database');
const { importSnapshot, readSnapshot } = require('../lib/database/snapshot-migration');
const { DatabaseQueries } = require('../lib/database/queries');
const { DashboardService } = require('../lib/services/dashboard-service');

// Run a real domain mutation in a separate process, not a mocked connection.
if (process.env.VJ_CRASH_TEST_CHILD === '1') {
  process.once('message', ({ file, key, commit }) => {
    const db = openDatabase(file, Buffer.from(key, 'hex'));
    const { InvoiceRepository } = require('../lib/database/invoice-repository');
    db.exec('BEGIN IMMEDIATE');
    new InvoiceRepository(db, 'crash').create({
      requestId: randomUUID(), number: 'VJ000001', status: 'completed',
      customer: 'Crash test', invoiceDate: '2026-10-29',
      items: [{ stockId: 'ring', name: 'Ring', purity: '22K', gross: 10, net: 9, pcs: 4, rate: 1000, making: 0 }],
      exchanges: [{ metal: 'gold', weight: 1, rate: 1000 }],
      manualDiscount: 0, gstRate: 0, paid: 1000, expectedTotal: 8000
    });
    if (commit) db.exec('COMMIT');
    process.send({ ready: true });
    // Parent kills us without close(), checkpoints or shutdown handlers.
  });
} else {
  for (const commit of [false, true]) {
    test(`encrypted database recovers an abrupt process stop ${commit ? 'after' : 'before'} invoice commit`, { timeout: 20000 }, async t => {
      const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vj-crash-'));
      const file = path.join(directory, 'store.db');
      const key = randomBytes(32);
      let db = openDatabase(file, key, { create: true });
      const original = {
        'stock-list': [{ id: 'ring', item: 'Ring', purity: '22K', qty: 10, gross: 100, net: 90 }],
        'invoice-records': [], 'old-gold-records': [],
        'purchase-records': [], 'payment-records': [], 'invoice-counter': 1
      };
      importSnapshot(db, original, { storeId: 'crash', sourceSha256: 'a'.repeat(64), acknowledgeLegacy: true });
      db.close();
      const child = fork(__filename, [], {
        env: { ...process.env, VJ_CRASH_TEST_CHILD: '1' },
        execArgv: [], stdio: ['ignore', 'ignore', 'pipe', 'ipc']
      });
      let stderr = '';
      child.stderr.on('data', chunk => { stderr += chunk; });
      t.after(async () => {
        if (child.exitCode === null && child.signalCode === null) {
          const stopped = once(child, 'exit'); child.kill('SIGKILL'); await stopped;
        }
        if (db.open) db.close();
        key.fill(0);
        fs.rmSync(directory, { recursive: true, force: true });
      });
      const ready = new Promise((resolve, reject) => {
        child.once('message', resolve);
        child.once('error', reject);
        child.once('exit', code => reject(new Error(`Child exited before ready (${code}): ${stderr}`)));
      });
      child.send({ file, key: key.toString('hex'), commit });
      assert.deepEqual(await ready, { ready: true });
      const stopped = once(child, 'exit');
      child.kill('SIGKILL');
      await stopped;
      db = openDatabase(file, key);
      assert.equal(db.pragma('integrity_check', { simple: true }), 'ok');
      assert.deepEqual(db.pragma('foreign_key_check'), []);
      const recovered = readSnapshot(db, 'crash');
      if (!commit) assert.deepEqual(recovered, original);
      else {
        assert.equal(recovered['invoice-records'].length, 1);
        assert.equal(recovered['invoice-records'][0].number, 'VJ000001');
        assert.equal(recovered['stock-list'][0].qty, 6);
        assert.equal(recovered['stock-list'][0].gross, 90);
        assert.equal(recovered['stock-list'][0].net, 81);
        assert.equal(recovered['invoice-counter'], 2);
        assert.equal(recovered['old-gold-records'].length, 1);
      }
      assert.deepEqual(new DatabaseQueries(db, 'crash').dashboard(),
        new DashboardService({ read: () => recovered }).snapshot());
    });
  }
}
