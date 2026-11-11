import { app, BrowserWindow, ipcMain, dialog, shell, session } from 'electron'
import { join } from 'path'
import { existsSync } from 'fs'
import { pathToFileURL } from 'url'
import { setupSteamCmdHandlers, checkServerUpdate, isServerInstalled } from './ipc/steamcmd'
import { setupServerHandlers } from './ipc/serverManager'
import { setupBackupHandlers } from './ipc/backups'
import { setupProfileHandlers } from './ipc/profileManager'
import { setupFileHandlers } from './ipc/fileManager'
import { setupModHandlers } from './ipc/modManager'
import { setupLocalModHandlers } from './ipc/localMods'
import { setupModBackupHandlers } from './ipc/modBackups'
import { setupClientHandlers } from './ipc/client'
import { setupWorkshopHandlers } from './ipc/workshop'
import { setupWorldHandlers } from './ipc/worldManager'
import { setupUpdaterHandlers } from './ipc/updater'
import { setupAppSettingsHandlers, loadSettings, steamcmdExe } from './ipc/appSettings'
import { setupPlayitHandlers } from './ipc/playit'
import { setupNetworkHandlers, firewallStatus } from './ipc/network'
import { setupDiagnosticsHandlers } from './ipc/diagnostics'
import { setupDiscordHandlers } from './ipc/discord'
import { allowedFile, allowedFolder, localPath, rememberPickedFolder } from './ipc/allowedPaths'
import { configFolders, appFolders } from './ipc/appFolders'
import { lockDownSession } from './ipc/workshopSession'
import { STARTUP_ARG, secondLaunch, RUN_KEY, RUN_VALUE, parseRunKey, runKeyPlan, startupProblem, type RunValue } from './ipc/startup'
import { execFile } from 'child_process'
import os from 'os'

// vite-plugin-electron passes the dev server address when running `npm run dev`
const devServerUrl = process.env.VITE_DEV_SERVER_URL

let mainWindow: BrowserWindow | null = null


// One copy of the app at a time. A second one (another click on the shortcut, or the installed
// copy next to a portable one, they share one data folder) would start the same servers, run
// SteamCMD next to the first one's and post everything to Discord twice. Electron hands its
// command line to the first copy, which comes to the front, and the second one quits
const firstInstance = app.requestSingleInstanceLock()
if (!firstInstance) app.quit()
app.on('second-instance', (_event, argv) => {
  if (!mainWindow || secondLaunch(argv) === 'ignore') return
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
})

// the packaged app's one page, the only thing its window may load
const appPage = pathToFileURL(join(__dirname, '../dist/index.html')).href

// same file, ignoring #hash and ?query (Windows paths aren't case sensitive)
function samePage(a: string, b: string): boolean {
  try {
    const strip = (u: string) => { const x = new URL(u); return `${x.protocol}//${x.host}${decodeURIComponent(x.pathname)}`.toLowerCase() }
    return strip(a) === strip(b)
  } catch {
    return false
  }
}

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

  // started by Windows at login ("Start with Windows"): stay out of the way on the taskbar
  if (process.argv.includes(STARTUP_ARG)) mainWindow.minimize()

  // The window only ever shows the app. A file dropped on it or a stray link would
  // otherwise replace the app with that page, and the page would keep the app's preload.
  mainWindow.webContents.on('will-navigate', (e, url) => {
    if (devServerUrl && url.startsWith(devServerUrl)) return
    // its own page is fine: that's a reload (the Reload button on the crash screen)
    if (!devServerUrl && samePage(url, appPage)) return
    e.preventDefault()
    if (/^https?:\/\//.test(url)) shell.openExternal(url)
  })
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

// ── Start with Windows (see ipc/startup.ts) ──
function readRunKey(): Promise<RunValue[]> {
  return new Promise((resolve) => {
    execFile('reg.exe', ['query', RUN_KEY], { windowsHide: true, timeout: 10000 }, (err, stdout) => resolve(err ? [] : parseRunKey(String(stdout))))
  })
}

async function runKeyNow() {
  return runKeyPlan(await readRunKey(), app.getPath('exe'), existsSync)
}

function tempFolders(): string[] {
  return [os.tmpdir(), app.getPath('temp'), process.env.TEMP, process.env.TMP].filter((d): d is string => !!d)
}

async function setStartWithWindows(on: boolean): Promise<boolean> {
  const exe = app.getPath('exe')
  const plan = await runKeyNow()
  for (const name of plan.remove) app.setLoginItemSettings({ openAtLogin: false, name, path: exe, args: [STARTUP_ARG] })
  // the folder won't be there next login, the Startup card says why
  if (on && startupProblem(exe, tempFolders())) return false
  app.setLoginItemSettings({ openAtLogin: on, name: RUN_VALUE, path: exe, args: [STARTUP_ARG] })
  return (await runKeyNow()).on
}

// Files the user picked in an Open or Save dialog this session, which the window may then
// read or write wherever they are
const pickedFiles = new Set<string>()
function pick(p: string | undefined): string | null {
  if (!p) return null
  const full = localPath(p)
  if (full) pickedFiles.add(full.toLowerCase())
  return p
}

// Only steamcommunity.com is allowed inside the workshop webview, and it never gets node or a preload
const WORKSHOP_HOSTS = ['steamcommunity.com', 'store.steampowered.com']
const isWorkshopUrl = (url: string) => {
  try { return WORKSHOP_HOSTS.includes(new URL(url).hostname) } catch { return false }
}
const WORKSHOP_PARTITION = 'persist:workshop'

const lockDownWorkshopSession = () => lockDownSession(session.fromPartition(WORKSHOP_PARTITION))

app.on('web-contents-created', (_event, contents) => {
  contents.on('will-attach-webview', (e, webPreferences, params) => {
    delete webPreferences.preload
    webPreferences.nodeIntegration = false
    webPreferences.contextIsolation = true
    // always its own session (the one with the permission and download rules below), never the app's
    webPreferences.partition = WORKSHOP_PARTITION
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
  // the second copy only had to hand over its command line
  if (!firstInstance) return
  lockDownWorkshopSession()
  createWindow()

  // Register all IPC handlers
  setupDiagnosticsHandlers()
  setupDiscordHandlers()
  setupAppSettingsHandlers()
  setupPlayitHandlers()
  setupNetworkHandlers()
  setupSteamCmdHandlers()
  setupServerHandlers(mainWindow)
  setupBackupHandlers(mainWindow)
  setupProfileHandlers()
  setupFileHandlers()
  setupModHandlers()
  setupLocalModHandlers()
  setupModBackupHandlers()
  setupClientHandlers(mainWindow)
  setupWorkshopHandlers()
  setupWorldHandlers()
  setupUpdaterHandlers()

  // Get the slow answers the pre-start check needs (is the server out of date: SteamCMD, a
  // few seconds; the firewall rules: PowerShell, about one) while the host looks around,
  // so pressing Start doesn't wait on them. Hosts only, and only if SteamCMD is already
  // there (the check would download it otherwise)
  setTimeout(() => {
    const s = loadSettings()
    if (!s.setupComplete || s.role === 'player' || !isServerInstalled(s.serverInstallPath)) return
    void firewallStatus().catch(() => undefined)
    if (existsSync(steamcmdExe(s))) void checkServerUpdate(s.serverInstallPath).catch(() => undefined)
  }, 4000)

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

  // "Start with Windows". No argument: just read it
  ipcMain.handle('app:startWithWindows', async (_event, on?: boolean) => {
    if (typeof on === 'boolean') return setStartWithWindows(on)
    return (await runKeyNow()).on
  })
  // why this copy can't start with Windows (it runs from a temp folder), null when it can
  ipcMain.handle('app:startupProblem', () => startupProblem(app.getPath('exe'), tempFolders()))
  // a value an older version wrote gets the new name (and this exe, after the rename)
  if (app.isPackaged) {
    void runKeyNow().then(plan => { if (plan.migrate) return setStartWithWindows(true) }).catch(() => undefined)
  }

  // Open external links in browser
  ipcMain.on('shell:openExternal', (_event, url: string) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url)
  })

  ipcMain.handle('system:info', async () => {
    const os = await import('os')
    return { totalMemMb: Math.floor(os.totalmem() / 1024 / 1024), platform: process.platform }
  })

  // Open a folder in Explorer (env vars like %USERPROFILE% allowed). Only the app's own
  // folders, and never a file: a file would open with whatever program it belongs to
  ipcMain.handle('shell:openPath', async (_event, p: string) => {
    const folder = allowedFolder(p, appFolders())
    if (!folder) return "That isn't one of the app's folders."
    return shell.openPath(folder)
  })

  // Open folder dialog
  ipcMain.handle('dialog:openFolder', async () => {
    const result = await dialog.showOpenDialog(mainWindow!, {
      properties: ['openDirectory'],
    })
    // a folder picked here can then get the game server installed into it (steamcmd:installServer)
    if (!result.canceled) rememberPickedFolder(result.filePaths[0])
    return result.canceled ? null : result.filePaths[0]
  })

  // Open file dialog (for .ini import). The file picked can be read with fs:readFile after
  ipcMain.handle('dialog:openFile', async (_event, filters?: Electron.FileFilter[]) => {
    const result = await dialog.showOpenDialog(mainWindow!, {
      properties: ['openFile'],
      filters: filters || [{ name: 'All Files', extensions: ['*'] }],
    })
    return result.canceled ? null : pick(result.filePaths[0])
  })

  // Read a file from disk and return its text content. Only the servers' config files and
  // files the user picked in a dialog (see allowedFile)
  ipcMain.handle('fs:readFile', async (_event, filePath: string) => {
    try {
      const { readFileSync } = await import('fs')
      const resolved = allowedFile(filePath, configFolders(), pickedFiles)
      if (!resolved) return { success: false, message: "The app can't open that file." }
      const content = readFileSync(resolved, 'utf-8')
      return { success: true, content }
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error)
      return { success: false, message: msg }
    }
  })

  // Write text content to a file (creates parent directories if needed). Same files as fs:readFile
  ipcMain.handle('fs:writeFile', async (_event, filePath: string, content: string) => {
    try {
      const { writeFileSync, mkdirSync } = await import('fs')
      const { dirname } = await import('path')
      const resolved = allowedFile(filePath, configFolders(), pickedFiles)
      if (!resolved) return { success: false, message: "The app can't save to that file." }
      mkdirSync(dirname(resolved), { recursive: true })
      writeFileSync(resolved, String(content), 'utf-8')
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
    return result.canceled || !result.filePath ? null : pick(result.filePath)
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
