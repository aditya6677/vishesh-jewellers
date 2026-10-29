'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomBytes } = require('node:crypto');
const { fork } = require('node:child_process');
const { once } = require('node:events');
const { openDatabase } = require('../lib/database/database');
const { importSnapshot } = require('../lib/database/snapshot-migration');
const { DatabaseRuntime } = require('../lib/database/runtime');
const { createConfig } = require('../lib/config');

test('desktop database server receives key by private IPC and rejects a second app process', { timeout: 20000 }, async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vj-database-ipc-'));
  const key = randomBytes(32), file = path.join(directory, 'store.db');
  const db = openDatabase(file, key, { create: true });
  importSnapshot(db, {}, { storeId: 'main', sourceSha256: 'a'.repeat(64), acknowledgeLegacy: true }); db.close();
  const env = { ...process.env, VJ_DATABASE_KEY_IPC: '1', DATA_BACKEND: 'sqlite', DATABASE_FILE: file, DATA_DIR: path.join(directory, 'unused-json'), BACKUP_DIR: path.join(directory, 'backups'), PORT: '0', HOST: '127.0.0.1' };
  delete env.DATABASE_KEY; delete env.DATABASE_KEY_FILE; delete env.DATA_ENCRYPTION_KEY;
  const child = fork(path.join(__dirname, '../server.js'), [], { env, serialization: 'advanced', stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) { const stopped = once(child, 'exit'); child.kill(); await stopped; }
    key.fill(0); fs.rmSync(directory, { recursive: true, force: true });
  });
  let diagnostics = '';
  child.stderr.on('data', chunk => { diagnostics += chunk; });
  const ready = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Desktop bootstrap timed out: ' + diagnostics)), 10000);
    child.once('message', message => { clearTimeout(timeout); resolve(message); });
    child.once('error', error => { clearTimeout(timeout); reject(error); });
    child.once('exit', () => { clearTimeout(timeout); reject(new Error('Desktop bootstrap failed: ' + diagnostics)); });
  });
  child.send({ type: 'protected-database-key', key });
  const message = await ready;
  assert.equal(message.type, 'server-ready');
  const response = await fetch(message.url + '/api/stocks');
  assert.equal(response.status, 200); assert.equal((await response.json()).items.length, 0);
  assert.equal(fs.existsSync(path.join(directory, 'unused-json', 'store.json')), false);
  assert.equal(diagnostics.includes(key.toString('base64')), false);
  assert.throws(() => new DatabaseRuntime(createConfig({ DATA_BACKEND: 'sqlite', DATABASE_FILE: file, DATABASE_KEY: key.toString('base64') })), /already open/);
});
