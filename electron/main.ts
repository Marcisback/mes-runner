import { app, BrowserWindow } from 'electron'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import {
  disposeManagedChromeWindows,
  registerManagedChromeWindow,
} from './managedChromeIpc'
import { registerHistoryIpc } from './history/historyIpc'
import { LocalHistoryStore } from './history/historyStore'
import { registerClipboardIpc } from './clipboardIpc.ts'
import {
  createRendererSecurityPolicy,
  isAllowedRendererUrl,
} from './ipcSecurity.ts'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// The built directory structure
//
// ├─┬─┬ dist
// │ │ └── index.html
// │ │
// │ ├─┬ dist-electron
// │ │ ├── main.js
// │ │ └── preload.mjs
// │
process.env.APP_ROOT = path.join(__dirname, '..')

// 🚧 Use ['ENV_NAME'] avoid vite:define plugin - Vite@2.x
export const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL']
export const RENDERER_DIST = path.join(process.env.APP_ROOT, 'dist')
const RENDERER_SECURITY_POLICY = createRendererSecurityPolicy(
  process.env.APP_ROOT,
  VITE_DEV_SERVER_URL,
)

let win: BrowserWindow | null
let historyStore: LocalHistoryStore | null = null
let shutdownStarted = false

function createWindow() {
  const mainWindow = new BrowserWindow({
    title: 'MES Runner',
    backgroundColor: '#0f1115',
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    webPreferences: {
      preload: path.join(__dirname, 'preload.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      devTools: !app.isPackaged,
      webviewTag: false,
      navigateOnDragDrop: false,
    },
  })

  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  mainWindow.webContents.on('will-attach-webview', (event) => event.preventDefault())
  mainWindow.webContents.session.setPermissionRequestHandler(
    (_webContents, _permission, callback) => callback(false),
  )
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!isAllowedRendererUrl(url, RENDERER_SECURITY_POLICY)) event.preventDefault()
  })
  mainWindow.webContents.on('will-redirect', (event, url) => {
    if (!isAllowedRendererUrl(url, RENDERER_SECURITY_POLICY)) event.preventDefault()
  })

  win = mainWindow
  if (historyStore === null) throw new Error('History store was not initialized.')
  registerManagedChromeWindow(mainWindow, historyStore, RENDERER_SECURITY_POLICY)

  mainWindow.once('closed', () => {
    if (win === mainWindow) {
      win = null
    }
  })

  if (VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(VITE_DEV_SERVER_URL)
  } else {
    mainWindow.loadFile(path.join(RENDERER_DIST, 'index.html'))
  }
}

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('activate', () => {
  // On OS X it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow()
  }
})

app.on('before-quit', (event) => {
  if (shutdownStarted) return
  event.preventDefault()
  shutdownStarted = true
  void Promise.allSettled([
    disposeManagedChromeWindows(),
    historyStore?.close() ?? Promise.resolve(),
  ]).finally(() => app.quit())
})

void app.whenReady().then(async () => {
  historyStore = new LocalHistoryStore(
    path.join(app.getPath('userData'), 'mes-runner.sqlite'),
  )
  await historyStore.initialize()
  registerHistoryIpc(historyStore, RENDERER_SECURITY_POLICY)
  registerClipboardIpc(RENDERER_SECURITY_POLICY)
  createWindow()
})
