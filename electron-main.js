const { app, BrowserWindow, dialog, safeStorage, ipcMain, screen, shell } = require('electron');
const { fork } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
// Keep the existing encrypted profile/Keychain identity across the product rename.
// Installer, executable and window branding are independent of this internal name.
if (app.isPackaged && require('./package.json').name === 'vishesh-jewellers-json-app') {
  app.setName('Vishesh Jewellers');
  app.setPath('userData', path.join(app.getPath('appData'), 'Vishesh Jewellers'));
}
const { createJsonStore } = require('./lib/json-store');
const { replaceDesktopData } = require('./lib/desktop-data-files');

let serverProcess;
let serverUrl;
let settingUp = false;
let launchingWorkspace = false;
let desktopCloseForQuit;
const desktopUserData = app.getPath('userData');
const sqliteDesktop = require('./lib/database/desktop-startup').desktopBackend({ backend: process.env.DATA_BACKEND, isPackaged: app.isPackaged, userData: desktopUserData }) === 'sqlite';
if (sqliteDesktop) {
  process.env.DATA_BACKEND = 'sqlite';
  if (app.isPackaged || fs.existsSync(path.join(desktopUserData, 'database-installation.json'))) process.env.VJ_ENABLE_SQLITE_DESKTOP = '1';
}

function runtimeRoot() {
  return app.isPackaged ? path.join(process.resourcesPath, 'app.asar.unpacked') : __dirname;
}

function dataLocationConfigFile() {
  return path.join(app.getPath('userData'), 'data-location.json');
}

function dataKeyFile() {
  return path.join(app.getPath('userData'), 'data-key.bin');
}

function backupsDir() {
  return path.join(app.getPath('documents'), 'Vishesh Jewellers Backups');
}

function configuredDataDir() {
  try {
    const config = JSON.parse(fs.readFileSync(dataLocationConfigFile(), 'utf8'));
    if (typeof config.dataDir === 'string' && path.isAbsolute(config.dataDir)) return config.dataDir;
  } catch (_) { /* Use the default location. */ }
  return path.join(app.getPath('userData'), 'data');
}

async function chooseDataLocation(currentDataDir) {
  const result = await dialog.showOpenDialog({ title: 'Choose a folder for KaratDesk data', properties: ['openDirectory', 'createDirectory'] });
  if (result.canceled || !result.filePaths[0]) return;
  const targetDir = path.join(result.filePaths[0], 'Vishesh Jewellers Data');
  if (path.resolve(targetDir) === path.resolve(currentDataDir)) return;
  const existingStore = path.join(targetDir, 'store.json');
  if (fs.existsSync(existingStore)) {
    const choice = await dialog.showMessageBox({
      type: 'warning',
      buttons: ['Use Existing Data', 'Cancel'],
      defaultId: 1,
      message: 'A KaratDesk data file already exists in this folder.',
      detail: 'Using it will replace the app’s active data location. No files will be deleted.'
    });
    if (choice.response !== 0) return;
    // Validate before switching configuration; another installation's encrypted
    // store may require a different protected key. Do not activate unreadable data.
    createJsonStore(existingStore, { encryptionKey: dataEncryptionKey() }).read();
  } else if (fs.existsSync(currentDataDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
    fs.cpSync(currentDataDir, targetDir, { recursive: true, force: false, errorOnExist: false });
  }
  fs.mkdirSync(path.dirname(dataLocationConfigFile()), { recursive: true });
  fs.writeFileSync(dataLocationConfigFile(), JSON.stringify({ dataDir: targetDir }, null, 2) + '\n', { mode: 0o600 });
  app.relaunch();
  app.exit(0);
}

function backupPayload(dataDir) {
  const storePath = path.join(dataDir, 'store.json');
  const keyPath = dataKeyFile();
  if (!fs.existsSync(storePath) || !fs.existsSync(keyPath)) throw new Error('The encrypted data or its secure key file could not be found.');
  return {
    format: 'vishesh-jewellers-backup-v1',
    createdAt: new Date().toISOString(),
    encryption: 'AES-256-GCM; key protected by this computer account',
    keyEnvelope: fs.readFileSync(keyPath, 'utf8').trim(),
    encryptedStore: JSON.parse(fs.readFileSync(storePath, 'utf8'))
  };
}

function writeBackup(filePath, dataDir) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = filePath + '.tmp';
  fs.writeFileSync(tempPath, JSON.stringify(backupPayload(dataDir), null, 2) + '\n', { mode: 0o600 });
  fs.renameSync(tempPath, filePath);
  return filePath;
}

function isoWeekStamp(date = new Date()) {
  const day = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  day.setUTCDate(day.getUTCDate() + 4 - (day.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(day.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((day - yearStart) / 86400000) + 1) / 7);
  return `${day.getUTCFullYear()}-${String(week).padStart(2, '0')}`;
}

function createWeeklyBackup(dataDir) {
  const dir = backupsDir();
  const stamp = isoWeekStamp();
  const filename = `Vishesh-Jewellers-Weekly-${stamp}.json`;
  const target = path.join(dir, filename);
  if (!fs.existsSync(target)) writeBackup(target, dataDir);
  // Keep at most 12 app-generated weekly snapshots; manual and pre-restore backups are never pruned.
  const weekly = fs.readdirSync(dir).filter(name => /^Vishesh-Jewellers-Weekly-\d{4}-\d{2}\.json$/.test(name)).sort();
  weekly.slice(0, Math.max(0, weekly.length - 12)).forEach(name => fs.unlinkSync(path.join(dir, name)));
}

async function createManualBackup(dataDir) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const result = await dialog.showSaveDialog({
    title: 'Save encrypted KaratDesk backup',
    defaultPath: path.join(backupsDir(), `Vishesh-Jewellers-Backup-${stamp}.json`),
    buttonLabel: 'Save Encrypted Backup',
    filters: [{ name: 'Encrypted JSON backup', extensions: ['json'] }]
  });
  if (!result.canceled && result.filePath) {
    writeBackup(result.filePath, dataDir);
    dialog.showMessageBox({ type: 'info', buttons: ['OK'], message: 'Encrypted backup created', detail: `Saved to:\n${result.filePath}` });
  }
}

function decryptBackupStore(backup) {
  if (!backup || backup.format !== 'vishesh-jewellers-backup-v1' || !backup.keyEnvelope || !backup.encryptedStore) {
    throw new Error('This is not a supported KaratDesk backup file.');
  }
  if (!safeStorage.isEncryptionAvailable()) throw new Error('Secure storage is unavailable on this computer.');
  const key = Buffer.from(safeStorage.decryptString(Buffer.from(backup.keyEnvelope, 'base64')), 'base64');
  const stored = backup.encryptedStore;
  if (key.length !== 32 || stored.format !== 'vishesh-jewellers-encrypted-v1' || stored.algorithm !== 'aes-256-gcm') {
    throw new Error('The backup key or encrypted data format is invalid.');
  }
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(stored.iv, 'base64'), { authTagLength: 16 });
  decipher.setAuthTag(Buffer.from(stored.tag, 'base64'));
  const data = Buffer.concat([decipher.update(Buffer.from(stored.ciphertext, 'base64')), decipher.final()]).toString('utf8');
  JSON.parse(data); // Validate the authenticated payload before replacing any active files.
  return { keyEnvelope: backup.keyEnvelope, encryptedStore: stored };
}

async function restoreBackup(dataDir) {
  const result = await dialog.showOpenDialog({
    title: 'Select an encrypted KaratDesk backup',
    properties: ['openFile'],
    filters: [{ name: 'Encrypted JSON backup', extensions: ['json'] }]
  });
  if (result.canceled || !result.filePaths[0]) return;
  const backup = JSON.parse(fs.readFileSync(result.filePaths[0], 'utf8'));
  const restored = decryptBackupStore(backup);
  const confirmation = await dialog.showMessageBox({
    type: 'warning',
    buttons: ['Restore Backup', 'Cancel'],
    defaultId: 1,
    cancelId: 1,
    message: 'Replace current app data with this backup?',
    detail: `Backup date: ${backup.createdAt || 'unknown'}\nA safety copy of the current data will be created first. This backup is protected for this computer account.`
  });
  if (confirmation.response !== 0) return;
  const beforePath = path.join(backupsDir(), `Vishesh-Jewellers-Before-Restore-${new Date().toISOString().replace(/[:.]/g, '-')}-${crypto.randomUUID()}.json`);
  writeBackup(beforePath, dataDir);
  fs.mkdirSync(dataDir, { recursive: true });
  const storePath = path.join(dataDir, 'store.json');
  replaceDesktopData({ storePath, keyPath: dataKeyFile(), encryptedStore: restored.encryptedStore, keyEnvelope: restored.keyEnvelope });
  const choice = await dialog.showMessageBox({ type: 'info', buttons: ['Restart Now'], message: 'Backup restored', detail: 'The app will restart to load the restored data.' });
  if (choice.response === 0) { app.relaunch(); app.exit(0); }
}

function dataEncryptionKey() {
  if (!safeStorage.isEncryptionAvailable()) throw new Error('Your operating system secure storage is unavailable. Data encryption cannot be started.');
  const keyFile = path.join(app.getPath('userData'), 'data-key.bin');
  if (fs.existsSync(keyFile)) return safeStorage.decryptString(Buffer.from(fs.readFileSync(keyFile, 'utf8'), 'base64'));
  const key = crypto.randomBytes(32).toString('base64');
  fs.mkdirSync(path.dirname(keyFile), { recursive: true });
  fs.writeFileSync(keyFile, safeStorage.encryptString(key).toString('base64'), { mode: 0o600 });
  return key;
}

function startLocalServer() {
  if (serverProcess && !serverProcess.killed && serverUrl) return Promise.resolve(serverUrl);
  return new Promise((resolve, reject) => {
    const appRoot = runtimeRoot();
    const serverPath = path.join(appRoot, 'server.js');
    const dataDir = configuredDataDir();
    if (sqliteDesktop && process.env.VJ_ENABLE_SQLITE_DESKTOP !== '1') return reject(new Error('SQLite desktop mode is opt-in. Set VJ_ENABLE_SQLITE_DESKTOP=1 only for a prepared database copy.'));
    let protectedKey;
    try {
      if (sqliteDesktop) protectedKey = require('./lib/database/desktop-key').desktopDatabaseKey({ safeStorage, userData: app.getPath('userData'), databaseFile: process.env.DATABASE_FILE || '', bootstrapKeyFile: process.env.DATABASE_KEY_FILE });
    } catch (error) { return reject(error); }
    const encryptionKey = sqliteDesktop ? undefined : dataEncryptionKey();
    const environment = { ...process.env };
    // Database keys cross the private parent/child pipe, never the inherited
    // process environment or renderer. JSON's established path is unchanged.
    if (sqliteDesktop) { delete environment.DATABASE_KEY; delete environment.DATABASE_KEY_FILE; delete environment.DATA_ENCRYPTION_KEY; }
    serverProcess = fork(serverPath, [], {
      env: {
        ...environment,
        PORT: '0',
        HOST: '127.0.0.1',
        DATA_DIR: dataDir,
        BACKUP_DIR: backupsDir(),
        ...(sqliteDesktop ? { VJ_DATABASE_KEY_IPC: '1', BACKUP_DIR: process.env.BACKUP_DIR || path.join(path.dirname(process.env.DATABASE_FILE), 'backups') } : { DATA_ENCRYPTION_KEY: encryptionKey }),
        SOURCE_HTML: path.join(appRoot, 'source', 'index.html')
      },
      silent: true,
      serialization: 'advanced'
    });
    if (protectedKey) serverProcess.send({ type: 'protected-database-key', key: protectedKey.key }, error => { protectedKey.key.fill(0); if (error) reject(error); });

    const timeout = setTimeout(() => { serverProcess.kill(); reject(new Error('The local app server did not start in time.')); }, 30_000);
    serverProcess.once('message', message => {
      if (message?.type !== 'server-ready') return;
      clearTimeout(timeout);
      serverUrl = message.url;
      resolve(message.url);
    });
    serverProcess.once('error', error => { clearTimeout(timeout); protectedKey?.key.fill(0); reject(error); });
    serverProcess.once('exit', code => {
      const wasReady = Boolean(serverUrl);
      clearTimeout(timeout); serverUrl = null; protectedKey?.key.fill(0);
      if (!wasReady || (code && code !== 0)) reject(new Error('The local app server stopped unexpectedly.'));
    });
    serverProcess.on('message', message => {
      if (sqliteDesktop) return; // JSON-only desktop actions must not touch the database store.
      if (message?.type === 'choose-data-location') chooseDataLocation(dataDir).catch(error => dialog.showErrorBox('Could not change data location', error.message));
      if (message?.type === 'create-backup') createManualBackup(dataDir).catch(error => dialog.showErrorBox('Could not create backup', error.message));
      if (message?.type === 'restore-backup') restoreBackup(dataDir).catch(error => dialog.showErrorBox('Could not restore backup', error.message));
    });
  });
}

function createWindow(url) {
  const appRoot = runtimeRoot();
  const { loadWindowState, saveWindowState } = require('./lib/desktop-window-state');
  const stateFile = path.join(app.getPath('userData'), 'workspace-window.json');
  const state = loadWindowState(stateFile, screen.getAllDisplays());
  const window = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1000,
    minHeight: 700,
    ...(state?.bounds || {}),
    title: 'KaratDesk',
    icon: path.join(appRoot, 'assets', 'desktop', 'karatdesk.png'),
    webPreferences: {
      preload: path.join(__dirname, 'scripts/workspace-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  let rendererReady = false;
  let closeConfirmed = false;
  let closeRequested = false;
  let quitRequested = false;
  let saveTimer;
  const authorized = event => event.sender === window.webContents && event.senderFrame === window.webContents.mainFrame;
  const ready = event => { if (authorized(event)) rendererReady = true; };
  const confirm = event => {
    if (authorized(event) && rendererReady && closeRequested) {
      closeConfirmed = true;
      const quitting = quitRequested;
      window.destroy();
      if (quitting) app.quit();
    }
  };
  desktopCloseForQuit = () => {
    if (!rendererReady || window.webContents.isDestroyed() || window.webContents.isCrashed()) return false;
    closeRequested = true; quitRequested = true;
    saveWindowState(stateFile, window);
    window.webContents.send('workspace:request-close');
    return true;
  };
  ipcMain.on('workspace:ready', ready);
  ipcMain.on('workspace:confirm-close', confirm);
  const persist = () => { clearTimeout(saveTimer); saveTimer = setTimeout(() => saveWindowState(stateFile, window), 300); };
  window.on('resize', persist); window.on('move', persist);
  window.on('close', event => {
    saveWindowState(stateFile, window);
    if (rendererReady && !closeConfirmed && !window.webContents.isDestroyed() && !window.webContents.isCrashed()) { event.preventDefault(); closeRequested = true; quitRequested = false; window.webContents.send('workspace:request-close'); }
  });
  window.webContents.on('did-start-navigation', (_event, _url, inPlace, mainFrame) => { if (mainFrame && !inPlace) { rendererReady = false; closeRequested = false; } });
  window.on('closed', () => { desktopCloseForQuit = undefined; clearTimeout(saveTimer); ipcMain.removeListener('workspace:ready', ready); ipcMain.removeListener('workspace:confirm-close', confirm); });
  if (state?.maximized) window.maximize();
  window.loadURL(url);
}

async function configureFirstRun({ recovery = false, mode, parent } = {}) {
  if (!recovery && (!sqliteDesktop || process.env.VJ_ENABLE_SQLITE_DESKTOP !== '1' || process.env.DATABASE_FILE)) return;
  const { readInstallation, provisionStore } = require('./lib/database/first-run');
  const userData = app.getPath('userData');
  if (recovery) fs.mkdirSync(userData, { recursive: true, mode: 0o700 });
  const setupDirectory = recovery ? fs.mkdtempSync(path.join(userData, 'recovery-')) : userData;
  let installation = recovery ? null : readInstallation(userData);
  if (!installation) installation = await new Promise((resolve, reject) => {
    settingUp = true;
    const setup = new BrowserWindow({ width: 920, height: 760, minWidth: 540, minHeight: 620, ...(parent ? { parent, modal: true } : {}), title: 'Store setup', webPreferences: { preload: path.join(__dirname, 'scripts/setup-preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true } });
    let busy = false, completed = false;
    const authorized = event => event.sender === setup.webContents && event.senderFrame === setup.webContents.mainFrame;
    ipcMain.handle('store-setup-choose', async event => {
      if (!authorized(event) || busy) return null;
      const chosen = await dialog.showOpenDialog(setup, { title: 'Choose encrypted backup folder', properties: ['openDirectory'] });
      return chosen.canceled ? null : chosen.filePaths[0];
    });
    ipcMain.handle('store-setup-submit', async (event, request) => {
      if (!authorized(event) || busy) return { ok: false, error: 'Setup is already running.' };
      busy = true;
      try {
        if (recovery && request?.mode !== mode) throw new Error('Use the recovery mode selected on the previous screen.');
        const config = await provisionStore({ userData: setupDirectory, safeStorage, mode: request?.mode, backupDirectory: request?.backupDirectory, passphrase: request?.passphrase, confirmPassphrase: request?.confirmPassphrase, recoveryAcknowledged: request?.recoveryAcknowledged, storeName: request?.storeName, tagline: request?.tagline });
        if (recovery) require('./lib/database/startup-recovery').activateRecovery({ userData, recoveryDirectory: setupDirectory, safeStorage });
        completed = true; resolve(config); setup.close(); return { ok: true };
      } catch (error) { return { ok: false, error: error.message }; }
      finally { busy = false; }
    });
    setup.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    setup.webContents.on('will-navigate', event => event.preventDefault());
    setup.on('close', event => { if (busy && !completed) event.preventDefault(); });
    setup.on('closed', () => { ipcMain.removeHandler('store-setup-choose'); ipcMain.removeHandler('store-setup-submit'); if (!completed) reject(new Error('Store setup was cancelled.')); });
    setup.loadFile(path.join(__dirname, 'scripts/setup.html'), recovery ? { query: { mode, recovery: '1' } } : undefined);
  });
  process.env.DATABASE_FILE = installation.databaseFile;
  process.env.STORE_ID = installation.storeId;
  if (installation.accountsEnabled) process.env.ACCOUNTS_ENABLED = '1';
  if (installation.licensingEnabled) process.env.LICENSING_ENABLED = '1';
}

async function launchWorkspace() {
  if (launchingWorkspace) return;
  launchingWorkspace = true;
  try {
    for (;;) {
      try {
        await configureFirstRun();
        const url = await startLocalServer();
        if (!sqliteDesktop) try { createWeeklyBackup(configuredDataDir()); } catch (error) { dialog.showErrorBox('Weekly backup could not be created', error.message); }
        createWindow(url);
        settingUp = false;
        return;
      } catch (error) {
        serverProcess?.kill(); serverUrl = null;
        settingUp = true;
        const action = await require('./lib/desktop-recovery-window').showStartupRecovery({ app, BrowserWindow, ipcMain, shell, scriptRoot: __dirname, setup: configureFirstRun, error });
        if (action !== 'retry') { settingUp = false; app.quit(); return; }
      }
    }
  } finally { launchingWorkspace = false; }
}

app.whenReady().then(async () => {
  app.setAboutPanelOptions({
    applicationName: app.getName(),
    applicationVersion: app.getVersion(),
    copyright: `Copyright © ${new Date().getFullYear()} Tech Aditya`,
    credits: 'Software solutions & products by Tech Aditya'
  });
  await launchWorkspace();
});

app.on('window-all-closed', () => {
  if (settingUp) return;
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', event => {
  // Keep the backend alive if the user cancels quitting to finish an invoice.
  if (desktopCloseForQuit?.()) { event.preventDefault(); return; }
  if (serverProcess && !serverProcess.killed) serverProcess.kill();
});

app.on('activate', async () => {
  if (BrowserWindow.getAllWindows().length) return;
  await launchWorkspace();
});
