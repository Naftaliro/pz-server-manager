import { app, BrowserWindow, ipcMain, dialog, shell } from 'electron'
import { join } from 'path'
import { setupSteamCmdHandlers } from './ipc/steamcmd'
import { setupServerHandlers } from './ipc/serverManager'
import { setupProfileHandlers } from './ipc/profileManager'
import { setupFileHandlers } from './ipc/fileManager'
import { setupModHandlers } from './ipc/modManager'
import { setupWorldHandlers } from './ipc/worldManager'
import { setupUpdaterHandlers } from './ipc/updater'
import { setupAppSettingsHandlers } from './ipc/appSettings'
import { setupPlayitHandlers } from './ipc/playit'
import { setupNetworkHandlers } from './ipc/network'
import { setupDiagnosticsHandlers } from './ipc/diagnostics'
import { setupDiscordHandlers } from './ipc/discord'

// vite-plugin-electron passes the dev server address when running `npm run dev`
const devServerUrl = process.env.VITE_DEV_SERVER_URL

let mainWindow: BrowserWindow | null = null

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1024,
    minHeight: 600,
    frame: false,
    titleBarStyle: 'hidden',
    backgroundColor: '#1e1e2e', // Catppuccin Mocha Base
    webPreferences: {
      preload: join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      // the mod browser shows the real Steam Workshop in a <webview>
      webviewTag: true,
    },
    icon: join(__dirname, '../build/icon.png'),
  })

  if (devServerUrl) {
    mainWindow.loadURL(devServerUrl)
    mainWindow.webContents.openDevTools({ mode: 'detach' })
  } else {
    mainWindow.loadFile(join(__dirname, '../dist/index.html'))
  }

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

// Only steamcommunity.com is allowed inside the workshop webview, and it never gets node or a preload
const WORKSHOP_HOSTS = ['steamcommunity.com', 'store.steampowered.com']
const isWorkshopUrl = (url: string) => {
  try { return WORKSHOP_HOSTS.includes(new URL(url).hostname) } catch { return false }
}

app.on('web-contents-created', (_event, contents) => {
  contents.on('will-attach-webview', (e, webPreferences, params) => {
    delete webPreferences.preload
    webPreferences.nodeIntegration = false
    webPreferences.contextIsolation = true
    if (!isWorkshopUrl(params.src)) e.preventDefault()
  })

  if (contents.getType() === 'webview') {
    // links to anything that isn't steam open in the real browser instead
    contents.setWindowOpenHandler(({ url }) => {
      if (isWorkshopUrl(url)) contents.loadURL(url)
      else if (/^https?:\/\//.test(url)) shell.openExternal(url)
      return { action: 'deny' }
    })
    contents.on('will-navigate', (e, url) => {
      // steam wraps outside links in /linkfilter/?u=..., unwrap those and send them to the browser
      if (url.includes('/linkfilter/')) {
        e.preventDefault()
        const target = new URL(url).searchParams.get('u') || new URL(url).searchParams.get('url')
        if (target && /^https?:\/\//.test(target)) shell.openExternal(target)
        return
      }
      if (isWorkshopUrl(url)) return
      e.preventDefault()
      if (/^https?:\/\//.test(url)) shell.openExternal(url)
    })
  }
})

app.whenReady().then(() => {
  createWindow()

  // Register all IPC handlers
  setupDiagnosticsHandlers()
  setupDiscordHandlers()
  setupAppSettingsHandlers()
  setupPlayitHandlers()
  setupNetworkHandlers()
  setupSteamCmdHandlers()
  setupServerHandlers(mainWindow)
  setupProfileHandlers()
  setupFileHandlers()
  setupModHandlers()
  setupWorldHandlers()
  setupUpdaterHandlers()

  // Window control IPC
  ipcMain.on('window:minimize', () => mainWindow?.minimize())
  ipcMain.on('window:maximize', () => {
    if (mainWindow?.isMaximized()) {
      mainWindow.unmaximize()
    } else {
      mainWindow?.maximize()
    }
  })
  ipcMain.on('window:close', () => mainWindow?.close())

  // Open external links in browser
  ipcMain.on('shell:openExternal', (_event, url: string) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url)
  })

  ipcMain.handle('system:info', async () => {
    const os = await import('os')
    return { totalMemMb: Math.floor(os.totalmem() / 1024 / 1024), platform: process.platform }
  })

  // Open a folder in Explorer (env vars like %USERPROFILE% allowed)
  ipcMain.handle('shell:openPath', async (_event, p: string) => {
    return shell.openPath(p.replace(/%([^%]+)%/g, (_, name) => process.env[name] || `%${name}%`))
  })

  // Open folder dialog
  ipcMain.handle('dialog:openFolder', async () => {
    const result = await dialog.showOpenDialog(mainWindow!, {
      properties: ['openDirectory'],
    })
    return result.canceled ? null : result.filePaths[0]
  })

  // Open file dialog (for .ini import)
  ipcMain.handle('dialog:openFile', async (_event, filters?: Electron.FileFilter[]) => {
    const result = await dialog.showOpenDialog(mainWindow!, {
      properties: ['openFile'],
      filters: filters || [{ name: 'All Files', extensions: ['*'] }],
    })
    return result.canceled ? null : result.filePaths[0]
  })

  // Expand Windows environment variables in a path (%USERPROFILE%, %APPDATA%, etc.)
  function expandEnvVars(p: string): string {
    return p.replace(/%([^%]+)%/g, (_, name) => process.env[name] || `%${name}%`)
  }

  // Read a file from disk and return its text content
  ipcMain.handle('fs:readFile', async (_event, filePath: string) => {
    try {
      const { readFileSync } = await import('fs')
      const resolved = expandEnvVars(filePath)
      const content = readFileSync(resolved, 'utf-8')
      return { success: true, content }
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error)
      return { success: false, message: msg }
    }
  })

  // Write text content to a file (creates parent directories if needed)
  ipcMain.handle('fs:writeFile', async (_event, filePath: string, content: string) => {
    try {
      const { writeFileSync, mkdirSync } = await import('fs')
      const { dirname } = await import('path')
      const resolved = expandEnvVars(filePath)
      mkdirSync(dirname(resolved), { recursive: true })
      writeFileSync(resolved, content, 'utf-8')
      return { success: true }
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error)
      return { success: false, message: msg }
    }
  })

  // Search a directory (and one level of subdirectories) for StartServer64.bat
  // This helps users who point at a Steam library folder instead of the server root
  ipcMain.handle('fs:findServerBat', async (_event, dir: string) => {
    try {
      const { readdirSync, existsSync, statSync } = await import('fs')
      const { join } = await import('path')
      const targets = ['StartServer64.bat', 'ProjectZomboidServer.bat', 'start-server.sh']

      // Check the dir itself first
      for (const t of targets) {
        if (existsSync(join(dir, t))) return { success: true, path: dir }
      }

      // Search one level deep
      try {
        const entries = readdirSync(dir)
        for (const entry of entries) {
          const sub = join(dir, entry)
          try {
            if (statSync(sub).isDirectory()) {
              for (const t of targets) {
                if (existsSync(join(sub, t))) return { success: true, path: sub }
              }
            }
          } catch { /* skip */ }
        }
      } catch { /* skip */ }

      return { success: false, message: 'StartServer64.bat not found in selected directory or immediate subdirectories.' }
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error)
      return { success: false, message: msg }
    }
  })

  // Save file dialog
  ipcMain.handle('dialog:saveFile', async (_event, defaultName: string, filters?: Electron.FileFilter[]) => {
    const result = await dialog.showSaveDialog(mainWindow!, {
      defaultPath: defaultName,
      filters: filters || [{ name: 'All Files', extensions: ['*'] }],
    })
    return result.canceled ? null : result.filePath
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
