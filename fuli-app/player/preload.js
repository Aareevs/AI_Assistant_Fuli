const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('fuliPlayerBridge', {
  getToken: () => ipcRenderer.invoke('player:token'),
  emit: (event, data) => ipcRenderer.send('player:event', event, data),
  onCommand: (cb) => ipcRenderer.on('player:cmd', (_e, cmd, arg) => cb(cmd, arg))
});
