const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('fuliAPI', {
  submitPrompt: (prompt) => ipcRenderer.send('fuli:submit-prompt', prompt),
  cancelTask: () => ipcRenderer.send('fuli:cancel-task'),
  hideWindow: () => ipcRenderer.send('fuli:hide-window'),
  closeApp: () => ipcRenderer.send('fuli:close-app'),
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
  },

  onFocusInput: (callback) => {
    const handler = () => callback();
    ipcRenderer.on('fuli:focus-input', handler);
    return () => ipcRenderer.removeListener('fuli:focus-input', handler);
  },

  onSetPromptAndRun: (callback) => {
    const handler = (_event, prompt) => callback(prompt);
    ipcRenderer.on('fuli:set-prompt-and-run', handler);
    return () => ipcRenderer.removeListener('fuli:set-prompt-and-run', handler);
  },

  onSetPromptOnly: (callback) => {
    const handler = (_event, prompt) => callback(prompt);
    ipcRenderer.on('fuli:set-prompt-only', handler);
    return () => ipcRenderer.removeListener('fuli:set-prompt-only', handler);
  },

  onSetStatus: (callback) => {
    const handler = (_event, status) => callback(status);
    ipcRenderer.on('fuli:set-status', handler);
    return () => ipcRenderer.removeListener('fuli:set-status', handler);
  },

  triggerMicListen: () => ipcRenderer.send('fuli:trigger-mic-listen')
});
