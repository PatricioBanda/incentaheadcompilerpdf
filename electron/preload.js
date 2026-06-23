const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('smartComprovante', {
  credentialStatus: () => ipcRenderer.invoke('credential:status'),
  saveGeminiKey: (key) => ipcRenderer.invoke('credential:save-gemini', key),
  deleteGeminiKey: () => ipcRenderer.invoke('credential:delete-gemini'),
})

