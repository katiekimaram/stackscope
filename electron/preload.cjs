const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('stackscope', Object.freeze({
  platform: process.platform,
  showMenu: () => ipcRenderer.invoke('stackscope:menu'),
  setAppearance: theme => ipcRenderer.invoke('stackscope:appearance', theme),
  deviceIdentity: () => ipcRenderer.invoke('stackscope:device'),
  request: input => ipcRenderer.invoke('stackscope:request', input),
  preferences: () => ipcRenderer.invoke('stackscope:preferences'),
  setTray: enabled => ipcRenderer.invoke('stackscope:tray', enabled),
  collect: options => ipcRenderer.invoke('stackscope:collect', options),
  cancelCollection: () => ipcRenderer.invoke('stackscope:cancel'),
  releaseCollection: () => ipcRenderer.invoke('stackscope:release'),
  onDesktopEvent: callback => {
    const listener = (_event, value) => callback(value);
    ipcRenderer.on('stackscope:event', listener);
    return () => ipcRenderer.removeListener('stackscope:event', listener);
  },
}));
