const { app, BrowserWindow, dialog, safeStorage } = require('electron');
const { fork } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

let serverProcess;

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
  const result = await dialog.showOpenDialog({ title: 'Choose a folder for Vishesh Jewellers data', properties: ['openDirectory', 'createDirectory'] });
  if (result.canceled || !result.filePaths[0]) return;
  const targetDir = path.join(result.filePaths[0], 'Vishesh Jewellers Data');
  if (path.resolve(targetDir) === path.resolve(currentDataDir)) return;
  const existingStore = path.join(targetDir, 'store.json');
  if (fs.existsSync(existingStore)) {
    const choice = await dialog.showMessageBox({
      type: 'warning',
      buttons: ['Use Existing Data', 'Cancel'],
      defaultId: 1,
      message: 'A Vishesh Jewellers data file already exists in this folder.',
      detail: 'Using it will replace the app’s active data location. No files will be deleted.'
    });
    if (choice.response !== 0) return;
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
    title: 'Save encrypted Vishesh Jewellers backup',
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
    throw new Error('This is not a supported Vishesh Jewellers backup file.');
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
    title: 'Select an encrypted Vishesh Jewellers backup',
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
  const beforePath = path.join(backupsDir(), `Vishesh-Jewellers-Before-Restore-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  writeBackup(beforePath, dataDir);
  fs.mkdirSync(dataDir, { recursive: true });
  const storePath = path.join(dataDir, 'store.json');
  const tempStorePath = storePath + '.restore.tmp';
  fs.writeFileSync(tempStorePath, JSON.stringify(restored.encryptedStore, null, 2) + '\n', { mode: 0o600 });
  fs.writeFileSync(dataKeyFile() + '.restore.tmp', restored.keyEnvelope + '\n', { mode: 0o600 });
  fs.renameSync(dataKeyFile() + '.restore.tmp', dataKeyFile());
  fs.renameSync(tempStorePath, storePath);
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
  return new Promise((resolve, reject) => {
    const appRoot = runtimeRoot();
    const serverPath = path.join(appRoot, 'server.js');
    const dataDir = configuredDataDir();
    const encryptionKey = dataEncryptionKey();
    serverProcess = fork(serverPath, [], {
      env: {
        ...process.env,
        PORT: '0',
        HOST: '127.0.0.1',
        DATA_DIR: dataDir,
        BACKUP_DIR: backupsDir(),
        DATA_ENCRYPTION_KEY: encryptionKey,
        SOURCE_HTML: path.join(appRoot, 'source', 'index.html')
      },
      silent: true
    });

    const timeout = setTimeout(() => reject(new Error('The local app server did not start in time.')), 10_000);
    serverProcess.once('message', message => {
      if (message?.type !== 'server-ready') return;
      clearTimeout(timeout);
      resolve(message.url);
    });
    serverProcess.once('error', reject);
    serverProcess.once('exit', code => {
      if (code && code !== 0) reject(new Error('The local app server stopped unexpectedly.'));
    });
    serverProcess.on('message', message => {
      if (message?.type === 'choose-data-location') chooseDataLocation(dataDir).catch(error => dialog.showErrorBox('Could not change data location', error.message));
      if (message?.type === 'create-backup') createManualBackup(dataDir).catch(error => dialog.showErrorBox('Could not create backup', error.message));
      if (message?.type === 'restore-backup') restoreBackup(dataDir).catch(error => dialog.showErrorBox('Could not restore backup', error.message));
    });
  });
}

function createWindow(url) {
  const appRoot = runtimeRoot();
  const window = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1000,
    minHeight: 700,
    title: 'Vishesh Jewellers',
    icon: path.join(appRoot, 'assets', 'vishesh-jewellers-logo.png'),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  window.loadURL(url);
}

app.whenReady().then(async () => {
  try {
    const url = await startLocalServer();
    try { createWeeklyBackup(configuredDataDir()); } catch (error) { dialog.showErrorBox('Weekly backup could not be created', error.message); }
    createWindow(url);
  } catch (error) {
    dialog.showErrorBox('Vishesh Jewellers could not start', error.message);
    app.quit();
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  if (serverProcess && !serverProcess.killed) serverProcess.kill();
});

app.on('activate', async () => {
  if (BrowserWindow.getAllWindows().length) return;
  try { createWindow(await startLocalServer()); } catch { app.quit(); }
});
