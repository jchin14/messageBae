const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('sheet', {
  check: (code) => ipcRenderer.invoke('code-check', code),
  cancel: () => ipcRenderer.send('code-cancel'),
});
