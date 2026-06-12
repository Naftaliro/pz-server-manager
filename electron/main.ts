import { app, BrowserWindow, ipcMain, dialog, shell } from 'electron'
import { join } from 'path'
import { setupSteamCmdHandlers } from './ipc/steamcmd'
import { setupServerHandlers } from './ipc/serverManager'
import { setupProfileHandlers } from './ipc/profileManager'
import { setupFileHandlers } from './ipc/fileManager'
import { setupModHandlers } from './ipc/modManager'
import { setupWorldHandlers } from './ipc/worldManager'
import { setupUpdaterHandlers } from './ipc/updater'

const isDev = process.env.NODE_ENV === 'development'

let mainWindow: BrowserWindow | null = null

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1024,
    minHeight: 600,
    frame: false,
    titleBarStyle: 'hidden',
    backgroundColor: '#0f1117',
    webPreferences: {
      preload: join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
    icon: join(__dirname, '../public/icon.ico'),
  })

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173')
    mainWindow.webContents.openDevTools()
  } else {
    mainWindow.loadFile(join(__dirname, '../dist/index.html'))
  }

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

app.whenReady().then(() => {
  createWindow()

  // Register all IPC handlers
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
    shell.openExternal(url)
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

  // Read a file from disk and return its text content
  ipcMain.handle('fs:readFile', async (_event, filePath: string) => {
    try {
      const { readFileSync } = await import('fs')
      const content = readFileSync(filePath, 'utf-8')
      return { success: true, content }
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error)
      return { success: false, message: msg }
    }
  })

  // Write text content to a file
  ipcMain.handle('fs:writeFile', async (_event, filePath: string, content: string) => {
    try {
      const { writeFileSync } = await import('fs')
      writeFileSync(filePath, content, 'utf-8')
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
