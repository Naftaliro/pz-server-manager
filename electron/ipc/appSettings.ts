import { ipcMain, app } from 'electron'
import { join } from 'path'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'

// App-wide settings (one server install shared by every profile)
export interface AppSettings {
  setupComplete: boolean
  steamcmdDir: string
  serverInstallPath: string
  buildVersion: 'b41' | 'b42'
  advancedMode: boolean
  // server came from the user's Steam library, so Steam keeps it updated (not steamcmd)
  steamManaged: boolean
  // "Works with playit.gg" turned on
  playitEnabled: boolean
}

const DEFAULTS: AppSettings = {
  setupComplete: false,
  steamcmdDir: 'C:\\PZServerManager\\steamcmd',
  serverInstallPath: 'C:\\PZServer',
  buildVersion: 'b42',
  advancedMode: false,
  steamManaged: false,
  playitEnabled: false,
}

function settingsPath(): string {
  return join(app.getPath('userData'), 'settings.json')
}

export function loadSettings(): AppSettings {
  try {
    if (existsSync(settingsPath())) {
      return { ...DEFAULTS, ...JSON.parse(readFileSync(settingsPath(), 'utf-8')) }
    }
  } catch { /* fall through to defaults */ }
  return { ...DEFAULTS }
}

export function saveSettings(patch: Partial<AppSettings>): AppSettings {
  const next = { ...loadSettings(), ...patch }
  const dir = app.getPath('userData')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  writeFileSync(settingsPath(), JSON.stringify(next, null, 2), 'utf-8')
  return next
}

export function steamcmdExe(settings = loadSettings()): string {
  return join(settings.steamcmdDir, 'steamcmd.exe')
}

export function setupAppSettingsHandlers() {
  ipcMain.handle('settings:get', async () => loadSettings())
  ipcMain.handle('settings:set', async (_event, patch: Partial<AppSettings>) => saveSettings(patch))
}
