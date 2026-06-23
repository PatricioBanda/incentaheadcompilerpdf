const { app, BrowserWindow, ipcMain, safeStorage } = require('electron')
const path = require('path')
const fs = require('fs')
const { spawn } = require('child_process')

let serverProcess
let mainWindow

const keyPath = () => path.join(app.getPath('userData'), 'gemini-key.enc')

const readEncryptedKey = () => {
  if (!safeStorage.isEncryptionAvailable() || !fs.existsSync(keyPath())) return ''
  try {
    return safeStorage.decryptString(fs.readFileSync(keyPath()))
  } catch {
    return ''
  }
}

const startServer = () => {
  const serverPath = path.join(__dirname, '..', '.next', 'standalone', 'server.js')
  const geminiKey = readEncryptedKey()
  serverProcess = spawn(process.execPath, [serverPath], {
    cwd: path.join(__dirname, '..'),
    stdio: 'inherit',
    windowsHide: true,
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      SMARTCOMPROVANTE_DATA_DIR: path.join(app.getPath('userData'), 'smartcomprovante-data'),
      ...(geminiKey ? { GEMINI_API_KEY: geminiKey } : {}),
    },
  })
}

const restartServer = () => {
  if (serverProcess) serverProcess.kill()
  setTimeout(startServer, 500)
}

const createWindow = async () => {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 940,
    minWidth: 1120,
    minHeight: 720,
    backgroundColor: '#f5f7f8',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith('http://localhost:3000')) event.preventDefault()
  })

  await new Promise((resolve) => setTimeout(resolve, 1400))
  await mainWindow.loadURL('http://localhost:3000')
}

ipcMain.handle('credential:status', () => ({
  configured: Boolean(readEncryptedKey()),
  encryptionAvailable: safeStorage.isEncryptionAvailable(),
}))

ipcMain.handle('credential:save-gemini', (_event, rawKey) => {
  if (!safeStorage.isEncryptionAvailable()) return { ok: false, configured: false, error: 'Armazenamento seguro indisponível.' }
  const key = typeof rawKey === 'string' ? rawKey.trim() : ''
  if (key.length < 20 || key.length > 256) return { ok: false, configured: false, error: 'Formato de chave inválido.' }
  try {
    const encrypted = safeStorage.encryptString(key)
    const temporary = `${keyPath()}.tmp`
    fs.writeFileSync(temporary, encrypted, { mode: 0o600 })
    fs.renameSync(temporary, keyPath())
    restartServer()
    return { ok: true, configured: true }
  } catch {
    return { ok: false, configured: false, error: 'Não foi possível encriptar a chave.' }
  }
})

ipcMain.handle('credential:delete-gemini', () => {
  try { if (fs.existsSync(keyPath())) fs.unlinkSync(keyPath()) } catch {}
  restartServer()
  return { ok: true, configured: false }
})

const instanceLock = app.requestSingleInstanceLock()
if (!instanceLock) app.quit()
else {
  app.on('second-instance', () => {
    if (mainWindow) { if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.focus() }
  })
  app.whenReady().then(() => { startServer(); return createWindow() })
}

app.on('window-all-closed', () => {
  if (serverProcess) serverProcess.kill()
  app.quit()
})
