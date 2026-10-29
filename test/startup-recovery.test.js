'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { createHash, randomUUID } = require('node:crypto');
const { EventEmitter } = require('node:events');
const { activateRecovery, startupExplanation } = require('../lib/database/startup-recovery');
const { provisionStore, readInstallation } = require('../lib/database/first-run');
const { desktopDatabaseKey } = require('../lib/database/desktop-key');
const { openDatabase } = require('../lib/database/database');
const { readSnapshot } = require('../lib/database/snapshot-migration');
const { createPortableBackup } = require('../lib/database/portable-backup');
const { StockRepository } = require('../lib/database/stock-repository');
const { InvoiceRepository } = require('../lib/database/invoice-repository');
const { DatabaseQueries } = require('../lib/database/queries');
const { showStartupRecovery } = require('../lib/desktop-recovery-window');

// Contract double; actual Windows DPAPI/macOS Keychain still need native acceptance.
const safeStorage = { isEncryptionAvailable: () => true, encryptString: text => Buffer.from(text).map(value => value ^ 93), decryptString: bytes => Buffer.from(bytes).map(value => value ^ 93).toString() };
const digest = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const phrase = 'Disposable recovery acceptance phrase!';
function temporary(t) { const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vj-startup-recovery-')); t.after(() => fs.rmSync(root, { recursive: true, force: true })); return root; }
const newOptions = (userData, backupDirectory) => ({ userData, safeStorage, platform: 'darwin', mode: 'new', backupDirectory, passphrase: phrase, confirmPassphrase: phrase, recoveryAcknowledged: true });

test('startup key errors explain safe recovery without revealing the raw error', () => {
  const info = startupExplanation(new Error('Error decrypting ciphertext in safeStorage.decryptString: private diagnostic'));
  assert.match(info.title, /unlock/); assert.match(info.guidance, /Never delete AppData/);
  assert.doesNotMatch(JSON.stringify(info), /private diagnostic/);
  assert.match(startupExplanation(new Error('unrelated')).guidance, /separate new store/);
});

test('startup recovery restores financial data with a new OS-wrapped key and preserves the old database and broken key', async t => {
  const root = temporary(t), userData = path.join(root, 'app-data');
  const config = await provisionStore(newOptions(userData, root));
  const unlocked = desktopDatabaseKey({ userData, safeStorage, platform: 'darwin', databaseFile: config.databaseFile });
  const db = openDatabase(config.databaseFile, unlocked.key);
  let snapshot, report;
  const backupDirectory = path.join(root, 'portable-populated');
  try {
    const stocks = new StockRepository(db, 'main', { id: () => 'ring' });
    stocks.create({ item: 'Recovery ring', purity: '22K', qty: 10, gross: 100, net: 90 });
    new InvoiceRepository(db, 'main').create({ requestId: randomUUID(), number: 'VJ000001', status: 'completed', customer: 'Recovery customer', invoiceDate: '2026-10-30', items: [{ stockId: 'ring', name: 'Recovery ring', purity: '22K', gross: 10, net: 9, pcs: 4, rate: 1000, making: 0 }], exchanges: [], manualDiscount: 0, gstRate: 3, paid: 1000, expectedTotal: 9270 });
    snapshot = readSnapshot(db, 'main'); report = new DatabaseQueries(db, 'main').dashboard({});
    await createPortableBackup(db, unlocked.key, phrase, backupDirectory);
  } finally { db.close(); unlocked.key.fill(0); }
  fs.writeFileSync(unlocked.protectedFile, 'damaged OS-wrapped key');
  const oldKey = fs.readFileSync(unlocked.protectedFile);
  const oldSettings = fs.readFileSync(path.join(userData, 'database-installation.json'));
  const oldDatabaseDigest = digest(config.databaseFile);
  const failed = fs.mkdtempSync(path.join(userData, 'recovery-'));
  await assert.rejects(provisionStore({ userData: failed, safeStorage, platform: 'darwin', mode: 'restore', backupDirectory, passphrase: 'Wrong recovery phrase!' }));
  assert.deepEqual(fs.readFileSync(path.join(userData, 'database-installation.json')), oldSettings);
  const recoveryDirectory = fs.mkdtempSync(path.join(userData, 'recovery-'));
  const restored = await provisionStore({ userData: recoveryDirectory, safeStorage, platform: 'darwin', mode: 'restore', backupDirectory, passphrase: phrase });
  // The active pointer stays unchanged until separate verification and activation succeed.
  assert.deepEqual(fs.readFileSync(path.join(userData, 'database-installation.json')), oldSettings);
  const result = activateRecovery({ userData, recoveryDirectory, safeStorage, platform: 'darwin' });
  assert.deepEqual(readInstallation(userData), restored);
  assert.deepEqual(fs.readFileSync(path.join(result.archive, 'database-installation.json')), oldSettings);
  assert.equal(digest(config.databaseFile), oldDatabaseDigest);
  assert.deepEqual(fs.readFileSync(unlocked.protectedFile), oldKey);
  const recoveredKey = desktopDatabaseKey({ userData, safeStorage, platform: 'darwin', databaseFile: restored.databaseFile });
  const recoveredDb = openDatabase(restored.databaseFile, recoveredKey.key);
  try { assert.deepEqual(readSnapshot(recoveredDb, 'main'), snapshot); assert.deepEqual(new DatabaseQueries(recoveredDb, 'main').dashboard({}), report); }
  finally { recoveredDb.close(); recoveredKey.key.fill(0); }
});

test('separate new setup preserves corrupt settings and legacy JSON rather than resetting them', async t => {
  const root = temporary(t), userData = path.join(root, 'app-data'); fs.mkdirSync(userData);
  const previous = Buffer.from('corrupt previous installation settings');
  fs.writeFileSync(path.join(userData, 'database-installation.json'), previous);
  fs.writeFileSync(path.join(userData, 'data-location.json'), '{"dataDir":"preserve-original"}');
  fs.mkdirSync(path.join(userData, 'data')); fs.writeFileSync(path.join(userData, 'data/store.json'), 'original encrypted data');
  fs.writeFileSync(path.join(userData, 'data-key.bin'), 'original unreadable key');
  const recoveryDirectory = fs.mkdtempSync(path.join(userData, 'recovery-'));
  const config = await provisionStore(newOptions(recoveryDirectory, root));
  const result = activateRecovery({ userData, recoveryDirectory, safeStorage, platform: 'darwin' });
  assert.deepEqual(readInstallation(userData), config);
  assert.deepEqual(fs.readFileSync(path.join(result.archive, 'database-installation.json')), previous);
  assert.equal(fs.readFileSync(path.join(userData, 'data/store.json'), 'utf8'), 'original encrypted data');
  assert.equal(fs.readFileSync(path.join(userData, 'data-key.bin'), 'utf8'), 'original unreadable key');
  assert.equal(fs.readFileSync(path.join(result.archive, 'data-location.json'), 'utf8'), '{"dataDir":"preserve-original"}');
});

test('invalid recovery destinations or damaged staged databases cannot change active installation settings', async t => {
  const root = temporary(t), userData = path.join(root, 'app-data'); fs.mkdirSync(userData);
  const target = path.join(userData, 'database-installation.json'); fs.writeFileSync(target, 'old settings');
  const external = path.join(root, 'outside'); fs.mkdirSync(external);
  assert.throws(() => activateRecovery({ userData, recoveryDirectory: external, safeStorage, platform: 'darwin' }), /Invalid recovery directory/);
  const recoveryDirectory = fs.mkdtempSync(path.join(userData, 'recovery-'));
  const config = await provisionStore(newOptions(recoveryDirectory, root));
  fs.writeFileSync(config.databaseFile, 'corrupt staged database');
  assert.throws(() => activateRecovery({ userData, recoveryDirectory, safeStorage, platform: 'darwin' }));
  assert.equal(fs.readFileSync(target, 'utf8'), 'old settings');
});

test('a failed activation rename leaves the old configuration available and preserved', async t => {
  const root = temporary(t), userData = path.join(root, 'app-data'); fs.mkdirSync(userData);
  const target = path.join(userData, 'database-installation.json'); fs.writeFileSync(target, 'unchanged original settings');
  const recoveryDirectory = fs.mkdtempSync(path.join(userData, 'recovery-'));
  await provisionStore(newOptions(recoveryDirectory, root));
  const rename = fs.renameSync;
  try {
    fs.renameSync = (source, destination) => {
      if (destination === target) throw new Error('Simulated activation failure');
      return rename(source, destination);
    };
    assert.throws(() => activateRecovery({ userData, recoveryDirectory, safeStorage, platform: 'darwin' }), /Simulated activation failure/);
  } finally { fs.renameSync = rename; }
  assert.equal(fs.readFileSync(target, 'utf8'), 'unchanged original settings');
  assert.equal(fs.readFileSync(path.join(recoveryDirectory, 'previous-settings/database-installation.json'), 'utf8'), 'unchanged original settings');
});

test('recovery window authorizes only its own frame, requires fresh-store confirmation and cleans up IPC', async () => {
  const handlers = new Map(), calls = []; let window;
  class Window extends EventEmitter {
    constructor(options) { super(); this.options = options; this.webContents = new EventEmitter(); this.webContents.mainFrame = {}; this.webContents.setWindowOpenHandler = callback => { this.open = callback; }; window = this; }
    loadFile(file) { this.file = file; }
    close() { let blocked = false; this.emit('close', { preventDefault() { blocked = true; } }); if (!blocked) this.emit('closed'); }
  }
  const result = showStartupRecovery({ app: { getPath: () => '/synthetic/app-data' }, BrowserWindow: Window,
    ipcMain: { handle: (name, callback) => handlers.set(name, callback), removeHandler: name => handlers.delete(name) },
    shell: { openPath: async value => { calls.push(value); return ''; } }, scriptRoot: '/synthetic/app', error: Error('decryptString'), setup: async options => calls.push(options.mode) });
  const event = { sender: window.webContents, senderFrame: window.webContents.mainFrame };
  const action = request => handlers.get('store-recovery-action')(event, request);
  assert.throws(() => handlers.get('store-recovery-info')({ sender: {} }), /window required/);
  assert.equal((await handlers.get('store-recovery-action')({ sender: {} }, { action: 'fresh', confirmation: 'CREATE NEW STORE' })).ok, false);
  assert.equal((await action({ action: 'fresh' })).ok, false); assert.equal(calls.length, 0);
  await action({ action: 'folder' }); assert.equal(calls[0], '/synthetic/app-data');
  assert.equal((await action({ action: 'fresh', confirmation: 'CREATE NEW STORE' })).recovered, true);
  assert.equal(calls[1], 'new'); assert.equal((await action({ action: 'retry' })).ok, false);
  assert.equal(window.options.webPreferences.sandbox, true); assert.equal(window.options.webPreferences.nodeIntegration, false);
  assert.deepEqual(window.open(), { action: 'deny' });
  await action({ action: 'quit' }); assert.equal(await result, 'quit'); assert.equal(handlers.size, 0);
});

test('recovery UI is packaged with a constrained preload and no file deletion controls', () => {
  const root = path.join(__dirname, '..'), files = require('../package.json').build.files;
  for (const file of ['scripts/recovery.html', 'scripts/recovery-preload.js', 'scripts/recovery-ui.js']) assert.ok(files.includes(file));
  const ui = fs.readFileSync(path.join(root, 'scripts/recovery-ui.js'), 'utf8');
  assert.match(ui, /CREATE NEW STORE/); assert.match(ui, /recovered = true/);
  const preload = fs.readFileSync(path.join(root, 'scripts/recovery-preload.js'), 'utf8');
  assert.doesNotMatch(preload, /readFile|writeFile|unlink|remove|require\('fs'\)/);
});
