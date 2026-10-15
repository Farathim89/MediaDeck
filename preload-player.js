const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('player', {
  init: () => ipcRenderer.invoke('player:init'),
  cmd: (command) => ipcRenderer.invoke('player:cmd', command),
  progress: (file, data) => ipcRenderer.invoke('player:progress', file, data),
  close: () => ipcRenderer.send('player:close'),
  onEvent: (fn) => ipcRenderer.on('mpv:event', (e, msg) => fn(msg)),
});
