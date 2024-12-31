const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
  startTorrent: (torrentLink) => ipcRenderer.send('start-torrent', torrentLink),
  onFocusMovie: (callback) => ipcRenderer.on('focus-movie', (_event, value) => callback(value)),
  onSelectMovie: (callback) => ipcRenderer.on('select-movie', (_event, value) => callback(value)),
  scrollToMovie: (callback) => ipcRenderer.on('scroll-to-movie', (_event, value) => callback(value))
})