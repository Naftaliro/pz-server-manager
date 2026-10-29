import { ipcMain } from 'electron'
import { join } from 'path'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { mergeIni, mergeSandbox, isGameWritten, type SettingsTree } from '../../shared/gameConfig'
import { getProfile, listProfiles, getServerName, type ServerProfile } from './profileManager'
import { loadSettings } from './appSettings'

function getServerDataPath(dataPath: string): string {
  // Expand %USERPROFILE% and other env vars on Windows
  return dataPath.replace(/%([^%]+)%/g, (_, name) => process.env[name] || `%${name}%`)
}

function getServerDir(dataPath: string): string {
  return join(getServerDataPath(dataPath), 'Server')
}

function profileServerDir(p: Pick<ServerProfile, 'worldSavePath'>): string {
  return getServerDir(p.worldSavePath?.replace(/\\$/, '') || '%USERPROFILE%\\Zomboid')
}

const readIfThere = (file: string) => (existsSync(file) ? readFileSync(file, 'utf-8') : undefined)

// The game's difficulty presets, from the server install (they match its build exactly)
export const GAME_PRESETS = ['Apocalypse', 'Outbreak', 'Extinction', 'Rising'] as const

export function readGamePresets(installPath?: string): Record<string, string> {
  const dir = join(installPath || loadSettings().serverInstallPath || '', 'media', 'lua', 'shared', 'Sandbox')
  const out: Record<string, string> = {}
  for (const name of GAME_PRESETS) {
    const text = readIfThere(join(dir, `${name}.lua`))
    if (text) out[name] = text
  }
  return out
}

// What the settings editors are built from: this server's own files, or when it hasn't
// been started yet, another server's files on the same build (for the descriptions)
function configSources(profileId: string) {
  const profile = getProfile(profileId)
  if (!profile) throw new Error('That server is no longer in your list.')
  const dir = profileServerDir(profile)
  const name = getServerName(profile)
  const sandbox = readIfThere(join(dir, `${name}_SandboxVars.lua`))
  const ini = readIfThere(join(dir, `${name}.ini`))

  let sandboxTemplate: string | undefined
  let iniTemplate: string | undefined
  if (!sandbox || !isGameWritten(sandbox) || !ini) {
    for (const other of listProfiles()) {
      if (other.id === profile.id || (other.buildVersion || 'b42') !== (profile.buildVersion || 'b42')) continue
      const otherDir = profileServerDir(other)
      const s = readIfThere(join(otherDir, `${getServerName(other)}_SandboxVars.lua`))
      if (!sandboxTemplate && s && isGameWritten(s)) sandboxTemplate = s
      const i = readIfThere(join(otherDir, `${getServerName(other)}.ini`))
      if (!iniTemplate && i && /^#/m.test(i)) iniTemplate = i
    }
  }
  return {
    sandbox, ini, sandboxTemplate, iniTemplate,
    sandboxFromGame: !!sandbox && isGameWritten(sandbox),
    presets: readGamePresets(profile.serverInstallPath),
  }
}

export function setupFileHandlers() {
  ipcMain.handle('config:sources', async (_event, profileId: string) => {
    try {
      return { success: true, ...configSources(profileId) }
    } catch (error: unknown) {
      return { success: false, message: error instanceof Error ? error.message : String(error) }
    }
  })

  ipcMain.handle('config:presets', async (_event, installPath?: string) => readGamePresets(installPath))

  // Write .ini file: preserves comments and existing lines, only updates changed keys
  ipcMain.handle('config:writeIni', async (_event, serverName: string, dataPath: string, settings: Record<string, unknown>) => {
    try {
      const serverDir = getServerDir(dataPath)
      if (!existsSync(serverDir)) mkdirSync(serverDir, { recursive: true })
      const iniPath = join(serverDir, `${serverName}.ini`)
      writeFileSync(iniPath, mergeIni(readIfThere(iniPath) || '', settings), 'utf-8')
      return { success: true }
    } catch (error: unknown) {
      return { success: false, message: error instanceof Error ? error.message : String(error) }
    }
  })

  // Write SandboxVars.lua: same, settings go into their own section
  ipcMain.handle('config:writeSandbox', async (_event, serverName: string, dataPath: string, settings: SettingsTree) => {
    try {
      const serverDir = getServerDir(dataPath)
      if (!existsSync(serverDir)) mkdirSync(serverDir, { recursive: true })
      const luaPath = join(serverDir, `${serverName}_SandboxVars.lua`)
      const existing = readIfThere(luaPath) || ''
      writeFileSync(luaPath, mergeSandbox(existing, settings, !isGameWritten(existing)), 'utf-8')
      return { success: true }
    } catch (error: unknown) {
      return { success: false, message: error instanceof Error ? error.message : String(error) }
    }
  })
}
