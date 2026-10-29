const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('storeSetup', { chooseBackup: () => ipcRenderer.invoke('store-setup-choose'), submit: request => ipcRenderer.invoke('store-setup-submit', request) });
