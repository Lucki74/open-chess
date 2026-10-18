import { app, BrowserWindow, ipcMain, Menu, session, type IpcMainInvokeEvent } from 'electron'
import path from 'node:path'
import { createStorage } from './storage'
import { buildCsp } from './csp'
import type { InProgressGame } from '../src/store/types'

const DEV_URL = process.env.VITE_DEV_SERVER_URL
const isDev = DEV_URL !== undefined && DEV_URL !== ''
const DEV_ORIGIN = isDev ? new URL(DEV_URL).origin : ''
const PACKAGED_PREFIX = 'file://'

let win: BrowserWindow | null = null
let flushed = false

// Keep saved games from before the rename to open_chess.
if (!app.commandLine.hasSwitch('user-data-dir')) app.setPath('userData', path.join(app.getPath('appData'), 'Chess'))
// Lazy: getPath('userData') is valid before ready.
const storage = createStorage(app.getPath('userData'))

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (!win) return
    if (win.isMinimized()) win.restore()
    win.focus()
  })
  bootstrap()
}

function bootstrap(): void {
  app.setAppUserModelId('com.lrame.chess')

  app.whenReady().then(() => {
    Menu.setApplicationMenu(null)
    installSecurity()
    registerIpc()
    createWindow()
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })

  app.on('before-quit', (event) => {
    if (flushed) return
    event.preventDefault()
    storage
      .drain()
      .catch(() => undefined)
      .finally(() => {
        flushed = true
        app.quit()
      })
  })
}

function installSecurity(): void {
  // Deny every permission prompt (camera, mic, notifications, geolocation).
  session.defaultSession.setPermissionRequestHandler((_wc, _perm, callback) => callback(false))

  // Response-header CSP. Packaged file:// pages also carry the same policy as a meta tag.
  const urls = isDev ? [`${DEV_ORIGIN}/*`, 'file:///*'] : ['file:///*']
  session.defaultSession.webRequest.onHeadersReceived({ urls }, (details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [buildCsp(isDev)],
      },
    })
  })
}

function isTrustedSender(event: IpcMainInvokeEvent): boolean {
  const url = event.senderFrame?.url ?? ''
  return isDev ? url.startsWith(DEV_ORIGIN + '/') || url === DEV_ORIGIN : url.startsWith(PACKAGED_PREFIX)
}

function registerIpc(): void {
  const guard =
    <A extends unknown[], R>(fn: (...args: A) => R) =>
    (event: IpcMainInvokeEvent, ...args: A): R => {
      if (!isTrustedSender(event)) throw new Error('untrusted sender')
      return fn(...args)
    }

  ipcMain.handle('app:ping', guard(() => 'pong'))
  ipcMain.handle('store:load', guard(() => storage.load()))
  ipcMain.handle('store:save', guard((data: unknown) => storage.save(data)))
  ipcMain.handle(
    'store:saveInProgress',
    guard((game: InProgressGame | null) => storage.saveInProgress(game)),
  )
  ipcMain.handle('window:flush', guard(() => storage.drain()))
}

function createWindow(): void {
  win = new BrowserWindow({
    width: 1100,
    height: 720,
    minWidth: 760,
    minHeight: 560,
    backgroundColor: '#1F2B24',
    show: false,
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#1F2B24', symbolColor: '#CDEBC3', height: 36 },
    webPreferences: {
      preload: path.join(app.getAppPath(), 'dist-electron', 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  const current = win
  current.once('ready-to-show', () => current.show())
  current.on('closed', () => {
    win = null
  })
  // Chromium does not always mark a minimised window hidden, so the renderer is told directly.
  const sendHidden = (hidden: boolean): void => {
    if (!current.isDestroyed()) current.webContents.send('window:hidden', hidden)
  }
  current.on('minimize', () => sendHidden(true))
  current.on('restore', () => sendHidden(false))

  current.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  current.webContents.on('will-navigate', (event) => event.preventDefault())

  if (isDev) {
    void current.loadURL(DEV_URL as string)
  } else {
    void current.loadFile(path.join(app.getAppPath(), 'dist', 'index.html'))
  }
}
