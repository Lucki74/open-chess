import { contextBridge, ipcRenderer } from 'electron'
import type { ChessApi } from '../src/store/api'

const api: ChessApi = {
  loadStore: () => ipcRenderer.invoke('store:load'),
  saveStore: (data) => ipcRenderer.invoke('store:save', data),
  saveInProgress: (game) => ipcRenderer.invoke('store:saveInProgress', game),
  ping: () => ipcRenderer.invoke('app:ping'),
  onWindowHidden: (cb) => {
    ipcRenderer.on('window:hidden', (_event, hidden: boolean) => cb(hidden))
  },
}

contextBridge.exposeInMainWorld('chessApi', api)
