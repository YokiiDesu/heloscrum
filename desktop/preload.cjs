const {contextBridge, ipcRenderer} = require('electron');
// Narrow bridges only: startup status and a user-confirmed system folder dialog.
// No arbitrary filesystem, shell, generic IPC or credential access.
if (location.protocol === 'file:') contextBridge.exposeInMainWorld('startup', {
  onStatus(callback) {
    const listener = (_event, value) => callback(value);
    ipcRenderer.on('startup-status', listener);
    return () => ipcRenderer.removeListener('startup-status', listener);
  },
});
if (process.isMainFrame && location.protocol === 'http:' && location.hostname === '127.0.0.1') {
  contextBridge.exposeInMainWorld('heloscrumDesktop', {
    chooseProjectFolder: () => ipcRenderer.invoke('choose-project-folder'),
  });
}
