const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('fuliAPI', {
  submitPrompt: (prompt) => ipcRenderer.send('fuli:submit-prompt', prompt),
  cancelTask: () => ipcRenderer.send('fuli:cancel-task'),
  hideWindow: () => ipcRenderer.send('fuli:hide-window'),
  resizeWindow: (width, height) => ipcRenderer.send('fuli:resize-window', { width, height }),
  
  onProgress: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('fuli:progress', handler);
    return () => ipcRenderer.removeListener('fuli:progress', handler);
  },
  
  onComplete: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('fuli:complete', handler);
    return () => ipcRenderer.removeListener('fuli:complete', handler);
  },

  onError: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('fuli:error', handler);
    return () => ipcRenderer.removeListener('fuli:error', handler);
  }
});
