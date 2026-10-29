'use strict';
const { contextBridge, ipcRenderer } = require('electron');

// No arbitrary IPC, filesystem access or credentials are exposed to the renderer.
contextBridge.exposeInMainWorld('vjDesktop', Object.freeze({
  onCloseRequest(callback) {
    if (typeof callback !== 'function') throw new TypeError('A close callback is required.');
    const handler = () => callback();
    ipcRenderer.on('workspace:request-close', handler);
    ipcRenderer.send('workspace:ready');
    return () => ipcRenderer.removeListener('workspace:request-close', handler);
  },
  confirmClose() { ipcRenderer.send('workspace:confirm-close'); }
}));
