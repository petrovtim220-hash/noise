const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('noiseDesktop', Object.freeze({
  loadLibrary: () => ipcRenderer.invoke('noise:library:load'),
  saveLibrary: (library) => ipcRenderer.invoke('noise:library:save', library),
}));
