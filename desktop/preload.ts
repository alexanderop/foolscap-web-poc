import { contextBridge, ipcRenderer } from 'electron'
contextBridge.exposeInMainWorld('connectApp', {
  action: (name: string) => ipcRenderer.invoke('action', name),
  onState: (callback: (state: unknown) => void) => {
    ipcRenderer.on('state', (_event, state: unknown) => callback(state))
  },
})
