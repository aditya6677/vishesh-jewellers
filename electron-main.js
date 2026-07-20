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
    createWindow(await startLocalServer());
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
