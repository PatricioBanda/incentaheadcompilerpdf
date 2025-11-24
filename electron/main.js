const { app, BrowserWindow } = require('electron')
const path = require('path')
const { spawn } = require('child_process')

let serverProcess

const startServer = () => {
  const serverPath = path.join(__dirname, '..', '.next', 'standalone', 'server.js')
  serverProcess = spawn('node', [serverPath], {
    cwd: path.join(__dirname, '..'),
    stdio: 'inherit'
  })
}

const createWindow = async () => {
  const win = new BrowserWindow({
    width: 1300,
    height: 900,
    webPreferences: {
      sandbox: false
    }
  })

  // Wait a moment for the server to boot; in production builds the server is quick
  const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms))
  await wait(1200)
  await win.loadURL('http://localhost:3000')
}

app.whenReady().then(() => {
  startServer()
  createWindow()
})

app.on('window-all-closed', () => {
  if (serverProcess) {
    serverProcess.kill()
  }
  app.quit()
})
