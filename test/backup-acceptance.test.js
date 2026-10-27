'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomBytes } = require('node:crypto');
const { createJsonStore } = require('../lib/json-store');
const { BackupService } = require('../lib/services/backup-service');
const { calculateDashboard } = require('../lib/dashboard-summary');

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vj-backup-acceptance-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const dataFile = path.join(dir, 'store.json'), backupDir = path.join(dir, 'backups'), encryptionKey = randomBytes(32).toString('base64');
  const store = createJsonStore(dataFile, { encryptionKey });
  const backup = new BackupService({ dataFile, backupDir, encryptionKey }, { now: () => new Date('2026-10-27T10:00:00Z') });
  return { dir, dataFile, backupDir, encryptionKey, store, backup };
}
function populated() {
  return { 'stock-list': [{ id: 'ring', item: 'Gold Ring', qty: 6, gross: 90, net: 81 }], 'invoice-records': [{ number: 'VJ000008', status: 'completed', total: 1000, paid: 400, due: 600, payments: [{ method: 'amount', amount: 400 }], weightMode: 'line-total', soldItems: [{ name: 'Ring', purity: '22K', net: 9, gross: 10, pcs: 4, rate: 100, making: 0 }] }], 'purchase-records': [{ amount: 100 }], 'payment-records': [{ type: 'amount', amount: 50 }, { type: 'self-expense', amount: 20 }], 'old-gold-records': [{ sourceId: 'purchase:x', metal: 'gold', source: 'Old metal purchase', weight: 2, value: 100 }], 'invoice-counter': 9, 'business-info': { name: 'Backup Acceptance Test' }, custom: { preserved: [1, 2, 3] } };
}

test('populated encrypted backup restores every collection and dashboard, retaining the replaced data for recovery', t => {
  const f = fixture(t), original = populated(); f.store.write(original);
  const payload = f.backup.createPayload();
  assert.ok(!JSON.stringify(payload).includes('Backup Acceptance Test'));
  f.store.write({ replaced: true, 'invoice-counter': 99 });
  const previous = JSON.parse(fs.readFileSync(f.dataFile, 'utf8'));
  f.backup.restore(payload);
  assert.deepEqual(f.store.read(), original);
  assert.deepEqual(createJsonStore(f.dataFile, { encryptionKey: f.encryptionKey }).read(), original);
  const restored = f.store.read();
  const summary = data => calculateDashboard(data['invoice-records'], data['purchase-records'], data['payment-records'], data['old-gold-records']);
  assert.deepEqual(summary(restored), summary(original)); assert.equal(summary(restored).afterPayment, 230);
  const names = fs.readdirSync(f.backupDir); assert.equal(names.length, 1);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(f.backupDir, names[0]), 'utf8')).encryptedStore, previous);
  const retained = fs.readdirSync(f.dir).find(name => name.startsWith('store.json.before-restore-'));
  assert.deepEqual(createJsonStore(path.join(f.dir, retained), { encryptionKey: f.encryptionKey }).read(), { replaced: true, 'invoice-counter': 99 });
});

test('unsupported, tampered, and wrong-key backups never change the current encrypted bytes', t => {
  const f = fixture(t); f.store.write(populated()); const payload = f.backup.createPayload();
  const before = fs.readFileSync(f.dataFile, 'utf8');
  const corrupt = structuredClone(payload); corrupt.encryptedStore.ciphertext = Buffer.from('tampered').toString('base64');
  const other = fixture(t); other.store.write({ foreign: true });
  for (const value of [null, {}, { ...payload, format: 'unsupported' }, corrupt, other.backup.createPayload()]) {
    assert.throws(() => f.backup.restore(value));
    assert.equal(fs.readFileSync(f.dataFile, 'utf8'), before); assert.deepEqual(f.store.read(), populated());
    assert.equal(fs.existsSync(f.dataFile + '.restore-tmp'), false);
  }
  assert.equal(fs.existsSync(f.backupDir), false);
});

test('two restores at the same timestamp retain separate recovery copies rather than overwriting them', t => {
  const f = fixture(t); f.store.write({ baseline: true }); const payload = f.backup.createPayload();
  f.store.write({ before: 'first' }); f.backup.restore(payload);
  f.store.write({ before: 'second' }); f.backup.restore(payload);
  assert.deepEqual(f.store.read(), { baseline: true });
  const retained = fs.readdirSync(f.dir).filter(name => name.startsWith('store.json.before-restore-'));
  assert.equal(retained.length, 2);
  assert.deepEqual(retained.map(name => createJsonStore(path.join(f.dir, name), { encryptionKey: f.encryptionKey }).read().before).sort(), ['first', 'second']);
  assert.equal(fs.readdirSync(f.backupDir).length, 2);
});

test('failed final replacement rolls back to the previous encrypted store and cleans the restore temporary file', t => {
  const f = fixture(t); f.store.write({ backup: true }); const payload = f.backup.createPayload();
  f.store.write({ current: 'must survive' }); const before = fs.readFileSync(f.dataFile, 'utf8');
  const rename = fs.renameSync;
  fs.renameSync = (from, to) => { if (from === f.dataFile + '.restore-tmp' && to === f.dataFile) throw new Error('Simulated replacement failure'); return rename(from, to); };
  try { assert.throws(() => f.backup.restore(payload), /Simulated replacement failure/); }
  finally { fs.renameSync = rename; }
  assert.equal(fs.readFileSync(f.dataFile, 'utf8'), before); assert.deepEqual(f.store.read(), { current: 'must survive' });
  assert.equal(fs.existsSync(f.dataFile + '.restore-tmp'), false);
});
