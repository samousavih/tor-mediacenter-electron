const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
  startTorrent: (torrentLink) => ipcRenderer.send('start-torrent', torrentLink)
})