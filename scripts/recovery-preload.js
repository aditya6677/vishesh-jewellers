'use strict';
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('storeRecovery', Object.freeze({
  info: () => ipcRenderer.invoke('store-recovery-info'),
  action: (action, confirmation = '') => ipcRenderer.invoke('store-recovery-action', { action, confirmation })
}));
