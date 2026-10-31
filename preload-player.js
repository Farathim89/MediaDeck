const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('player', {
  init: () => ipcRenderer.invoke('player:init'),
  cmd: (command) => ipcRenderer.invoke('player:cmd', command),
  progress: (file, data) => ipcRenderer.invoke('player:progress', file, data),
  close: () => ipcRenderer.send('player:close'),
  audio: (key, value) => ipcRenderer.invoke('player:audio', key, value),
  audioDevices: () => ipcRenderer.invoke('player:audio-devices'),
  onEvent: (fn) => ipcRenderer.on('mpv:event', (e, msg) => fn(msg)),
});

// for input.js: the buttons MediaDeck's own controller watcher read (when Chromium's controller list missed the
// controller, the player got nothing from it), and the controller log
contextBridge.exposeInMainWorld('api', {
  onPadNav: (fn) => ipcRenderer.on('pad-nav', (e, n) => fn(n)),
  padLog: (text) => ipcRenderer.invoke('pad-log', text),
});
