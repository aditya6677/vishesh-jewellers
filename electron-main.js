const { app, BrowserWindow, dialog } = require('electron');
const { fork } = require('node:child_process');
const path = require('node:path');

let serverProcess;

function runtimeRoot() {
  return app.isPackaged ? path.join(process.resourcesPath, 'app.asar.unpacked') : __dirname;
}

function startLocalServer() {
  return new Promise((resolve, reject) => {
    const appRoot = runtimeRoot();
    const serverPath = path.join(appRoot, 'server.js');
    const dataDir = path.join(app.getPath('userData'), 'data');
    serverProcess = fork(serverPath, [], {
      env: {
        ...process.env,
        PORT: '0',
        HOST: '127.0.0.1',
        DATA_DIR: dataDir,
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
