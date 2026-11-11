// The app's own folders, for the checks in allowedPaths.ts

import { app } from 'electron'
import { join } from 'path'
import { loadSettings } from './appSettings'
import { listProfiles } from './profileManager'
import { resolveDataPath } from './serverManager'
import { backupDir } from './modBackups'
import { expandEnvVars, localPath } from './allowedPaths'

// Every server's data folder (Zomboid, or the one picked for it), the player's and the default one
export function dataFolders(): string[] {
  const s = loadSettings()
  return [...new Set([resolveDataPath(), resolveDataPath(s.clientDataDir), ...listProfiles().map(p => resolveDataPath(p.worldSavePath))])]
}

// <data>\Server, where the game keeps each server's .ini and SandboxVars.lua
export function configFolders(): string[] {
  return dataFolders().map(d => join(d, 'Server'))
}

// Folders the "Open folder" buttons show: the app's data, the servers' data and backups, the
// server installs, SteamCMD and the mod backups
export function appFolders(): string[] {
  const s = loadSettings()
  return [
    app.getPath('userData'), expandEnvVars('%APPDATA%\\pz-server-manager'),
    ...dataFolders(), backupDir(), s.serverInstallPath, s.steamcmdDir,
    ...listProfiles().map(p => p.serverInstallPath),
  ].filter((d): d is string => typeof d === 'string' && !!d)
}

// A data folder the window named (world wipe, config writers): one of the servers' own, as a
// full path, or null
export function knownDataFolder(dataPath: unknown): string | null {
  const p = localPath(dataPath)
  if (!p) return null
  return dataFolders().find(d => localPath(d)?.toLowerCase() === p.toLowerCase()) || null
}
