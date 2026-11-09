// Puente seguro entre la página y la aplicación de escritorio: solo expone consultar la versión y actualizar.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('fontanaDesktop', {
  info: () => ipcRenderer.invoke('desktop:info'),
  checkUpdate: () => ipcRenderer.invoke('desktop:check'),
  applyUpdate: () => ipcRenderer.invoke('desktop:update'),
  onProgress: (callback) => {
    const listener = (_event, data) => callback(data);
    ipcRenderer.on('desktop:progress', listener);
    return () => ipcRenderer.removeListener('desktop:progress', listener);
  },
});
