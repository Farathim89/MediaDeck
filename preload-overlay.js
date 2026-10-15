const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('overlay', {
  info: () => ipcRenderer.invoke('overlay:info'),
  action: (a) => ipcRenderer.invoke('overlay:action', a),
  onOpen: (fn) => ipcRenderer.on('overlay:open', (e, info) => fn(info)),
});
