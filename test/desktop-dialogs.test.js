'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const { createJsonStore } = require('../lib/json-store');
const { replaceDesktopData } = require('../lib/desktop-data-files');

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vj-native-dialogs-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const storePath = path.join(directory, 'store.json'), keyPath = path.join(directory, 'data-key.bin');
  const key = crypto.randomBytes(32).toString('base64');
  createJsonStore(storePath, { encryptionKey: key }).write({ current: true });
  fs.writeFileSync(keyPath, 'old-envelope\n');
  return { directory, storePath, keyPath, key };
}

test('desktop replacement rolls back both encrypted store and key when final replacement fails', t => {
  const f = fixture(t), beforeStore = fs.readFileSync(f.storePath), beforeKey = fs.readFileSync(f.keyPath);
  const replacementFs = { ...fs, renameSync: (from, to) => { if (from === f.storePath + '.restore.tmp') throw Error('Simulated store rename failure'); fs.renameSync(from, to); } };
  assert.throws(() => replaceDesktopData({ ...f, encryptedStore: { test: 'incoming' }, keyEnvelope: 'new-envelope' }, replacementFs), /Simulated/);
  assert.deepEqual(fs.readFileSync(f.storePath), beforeStore); assert.deepEqual(fs.readFileSync(f.keyPath), beforeKey);
  assert.deepEqual(createJsonStore(f.storePath, { encryptionKey: f.key }).read(), { current: true });
  assert.ok(!fs.readdirSync(f.directory).some(name => /restore\.tmp|rollback\.tmp/.test(name)));
});

test('successful desktop replacement retains the matching new envelope and encrypted data', t => {
  const f = fixture(t), key = crypto.randomBytes(32).toString('base64'), incoming = path.join(f.directory, 'incoming.json');
  createJsonStore(incoming, { encryptionKey: key }).write({ restored: true });
  replaceDesktopData({ ...f, encryptedStore: JSON.parse(fs.readFileSync(incoming, 'utf8')), keyEnvelope: 'matching-envelope' });
  assert.equal(fs.readFileSync(f.keyPath, 'utf8'), 'matching-envelope\n');
  assert.deepEqual(createJsonStore(f.storePath, { encryptionKey: key }).read(), { restored: true });
});

function desktop(t, dialogs) {
  const f = fixture(t), calls = [];
  const app = { getPath: name => path.join(f.directory, name), whenReady: () => ({ then() {} }), on() {}, relaunch: () => calls.push('relaunch'), exit: () => calls.push('exit') };
  const safeStorage = { isEncryptionAvailable: () => true, decryptString: () => f.key };
  const root = path.join(__dirname, '..'), module = { exports: {} };
  fs.mkdirSync(app.getPath('userData'), { recursive: true });
  fs.writeFileSync(path.join(app.getPath('userData'), 'data-key.bin'), 'protected-envelope');
  const context = { module, require: name => name === 'electron' ? { app, dialog: dialogs, safeStorage } : name.startsWith('.') ? require(path.join(root, name)) : require(name), __dirname: root, Buffer, process, console };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'electron-main.js'), 'utf8') + '\nmodule.exports = {chooseDataLocation, createManualBackup, restoreBackup};', context);
  return { ...f, app, calls, actions: module.exports };
}

test('cancelling native folder/save/open dialogs leaves files and app state unchanged', async t => {
  const f = desktop(t, { showOpenDialog: async () => ({ canceled: true, filePaths: [] }), showSaveDialog: async () => ({ canceled: true }) });
  const before = fs.readFileSync(f.storePath);
  await f.actions.chooseDataLocation(f.directory); await f.actions.createManualBackup(f.directory); await f.actions.restoreBackup(f.directory);
  assert.deepEqual(fs.readFileSync(f.storePath), before); assert.deepEqual(f.calls, []);
  assert.equal(fs.existsSync(path.join(f.app.getPath('userData'), 'data-location.json')), false);
});

test('native location change rejects a store encrypted with a different key before switching', async t => {
  let target;
  const f = desktop(t, { showOpenDialog: async () => ({ canceled: false, filePaths: [target] }), showMessageBox: async () => ({ response: 0 }) });
  target = path.join(f.directory, 'selected');
  const existing = path.join(target, 'Vishesh Jewellers Data', 'store.json');
  createJsonStore(existing, { encryptionKey: crypto.randomBytes(32).toString('base64') }).write({ foreign: true });
  const before = fs.readFileSync(existing);
  await assert.rejects(f.actions.chooseDataLocation(f.directory), /could not be read or decrypted/);
  assert.deepEqual(fs.readFileSync(existing), before); assert.deepEqual(f.calls, []);
  assert.equal(fs.existsSync(path.join(f.app.getPath('userData'), 'data-location.json')), false);
});

test('native manual backup and confirmed restore preserve recovery data and request app restart', async t => {
  let selected;
  const f = desktop(t, { showSaveDialog: async () => ({ canceled: false, filePath: selected }), showOpenDialog: async () => ({ canceled: false, filePaths: [selected] }), showMessageBox: async () => ({ response: 0 }) });
  selected = path.join(f.directory, 'manual-backup.json');
  await f.actions.createManualBackup(f.directory);
  const payload = JSON.parse(fs.readFileSync(selected, 'utf8'));
  assert.equal(payload.format, 'vishesh-jewellers-backup-v1');
  assert.equal(payload.encryptedStore.algorithm, 'aes-256-gcm');
  assert.ok(!fs.readFileSync(selected, 'utf8').includes('"current"'));
  createJsonStore(f.storePath, { encryptionKey: f.key }).write({ changed: 'retain in safety backup' });
  const before = JSON.parse(fs.readFileSync(f.storePath, 'utf8'));
  await f.actions.restoreBackup(f.directory);
  assert.deepEqual(createJsonStore(f.storePath, { encryptionKey: f.key }).read(), { current: true });
  assert.deepEqual(f.calls, ['relaunch', 'exit']);
  const backupDir = path.join(f.app.getPath('documents'), 'Vishesh Jewellers Backups');
  const names = fs.readdirSync(backupDir); assert.equal(names.length, 1);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(backupDir, names[0]), 'utf8')).encryptedStore, before);
});

test('rejecting native restore confirmation and a staging failure never replace current files', async t => {
  let selected;
  const f = desktop(t, { showSaveDialog: async () => ({ canceled: false, filePath: selected }), showOpenDialog: async () => ({ canceled: false, filePaths: [selected] }), showMessageBox: async () => ({ response: 1 }) });
  selected = path.join(f.directory, 'cancelled-restore.json');
  await f.actions.createManualBackup(f.directory);
  const beforeStore = fs.readFileSync(f.storePath), keyFile = path.join(f.app.getPath('userData'), 'data-key.bin'), beforeKey = fs.readFileSync(keyFile);
  await f.actions.restoreBackup(f.directory);
  assert.deepEqual(fs.readFileSync(f.storePath), beforeStore); assert.deepEqual(fs.readFileSync(keyFile), beforeKey); assert.deepEqual(f.calls, []);
  const stagingFs = { ...fs, writeFileSync: (file, ...args) => { if (file === f.storePath + '.restore.tmp') throw Error('Simulated staging failure'); fs.writeFileSync(file, ...args); } };
  assert.throws(() => replaceDesktopData({ storePath: f.storePath, keyPath: keyFile, encryptedStore: { incoming: true }, keyEnvelope: 'new' }, stagingFs), /Simulated staging/);
  assert.deepEqual(fs.readFileSync(f.storePath), beforeStore); assert.deepEqual(fs.readFileSync(keyFile), beforeKey);
});
