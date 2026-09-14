const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('stackscope',Object.freeze({
  platform:process.platform,
  deviceIdentity:()=>ipcRenderer.invoke('stackscope:device'),
  request:input=>ipcRenderer.invoke('stackscope:request',input),
}));
