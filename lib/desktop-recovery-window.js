'use strict';
const path = require('node:path');
const { startupExplanation } = require('./database/startup-recovery');

function showStartupRecovery({ app, BrowserWindow, ipcMain, shell, scriptRoot, setup, error }) {
  return new Promise(resolve => {
    const window = new BrowserWindow({ width: 760, height: 730, minWidth: 560, minHeight: 620, title: 'Safe recovery · Tech Aditya', webPreferences: { preload: path.join(scriptRoot, 'scripts/recovery-preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true } });
    let busy = false, recovered = false, outcome = 'quit';
    const authorized = event => event.sender === window.webContents && event.senderFrame === window.webContents.mainFrame;
    ipcMain.handle('store-recovery-info', event => {
      if (!authorized(event)) throw new Error('Recovery window required.');
      return { ...startupExplanation(error), directory: app.getPath('userData') };
    });
    ipcMain.handle('store-recovery-action', async (event, request) => {
      if (!authorized(event) || busy) return { ok: false, error: 'Recovery is unavailable or already running.' };
      const action = request?.action;
      if (!['retry', 'folder', 'restore', 'fresh', 'restart', 'quit'].includes(action)) return { ok: false, error: 'Unknown recovery action.' };
      if (recovered && ['retry', 'restore', 'fresh'].includes(action)) return { ok: false, error: 'Restart to open the newly configured store.' };
      if (action === 'fresh' && request.confirmation !== 'CREATE NEW STORE') return { ok: false, error: 'Type CREATE NEW STORE to confirm a separate empty store.' };
      busy = true;
      try {
        if (action === 'folder') {
          const failure = await shell.openPath(app.getPath('userData'));
          return failure ? { ok: false, error: 'Could not open the data folder.' } : { ok: true, message: 'Keep this folder intact. Do not share encryption keys or delete files.' };
        }
        if (action === 'restore' || action === 'fresh') {
          await setup({ recovery: true, mode: action === 'restore' ? 'restore' : 'new', parent: window });
          recovered = true;
          return { ok: true, recovered: true, message: 'Setup completed in a separate folder. Previous files and settings were preserved. Restart to open the configured store.' };
        }
        if (action === 'restart') {
          if (!recovered) return { ok: false, error: 'Complete recovery or new setup first.' };
          process.env.DATA_BACKEND = 'sqlite';
          delete process.env.DATABASE_KEY; delete process.env.DATABASE_KEY_FILE; delete process.env.DATA_ENCRYPTION_KEY;
          app.relaunch(); app.exit(0); return { ok: true };
        }
        outcome = action === 'retry' ? 'retry' : 'quit';
        busy = false; window.close(); return { ok: true };
      } catch { return { ok: false, error: 'Setup was cancelled or could not complete. No existing database or encryption key was replaced. You can retry setup or contact Tech Aditya.' }; }
      finally { busy = false; }
    });
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', event => event.preventDefault());
    window.on('close', event => { if (busy) event.preventDefault(); });
    window.on('closed', () => { ipcMain.removeHandler('store-recovery-info'); ipcMain.removeHandler('store-recovery-action'); resolve(outcome); });
    window.loadFile(path.join(scriptRoot, 'scripts/recovery.html'));
  });
}
module.exports = { showStartupRecovery };
