import { ipcMain } from 'electron'
import { join, dirname } from 'path'
import { existsSync, readdirSync, statSync } from 'fs'
import { cp, mkdir, rm } from 'fs/promises'
import { getProfile, listProfiles, patchProfile, getServerName } from './profileManager'
import { folderSize } from './folderSize'
import { copyBackupsFolder, backupsCopyProblem } from './backupStore'
import { whileBusy, oneAtATime } from './busy'
import { expandDataPath, ownDataFolder, sameFolder, sharingWith, serverFiles } from '../../shared/dataFolder'

// Each server's data folder (see shared/dataFolder.ts for why new servers get their own)

export function resolveDataPath(worldSavePath?: string): string {
  return expandDataPath(worldSavePath, process.env)
}

// Is this server's folder the one other servers in the app use too?
export function dataFolderInfo(profileId: string) {
  const profile = getProfile(profileId)
  if (!profile) return null
  return {
    path: resolveDataPath(profile.worldSavePath),
    // made by the game on the first start
    exists: existsSync(resolveDataPath(profile.worldSavePath)),
    shared: sameFolder(resolveDataPath(profile.worldSavePath), resolveDataPath()),
    sharedWith: sharingWith(profile, listProfiles(), process.env).map(p => p.name),
  }
}

async function sizeOf(p: string): Promise<number> {
  return statSync(p).isDirectory() ? folderSize(p) : statSync(p).size
}

// "Give this server its own folder": copy its files out of the shared one, check the copy has
// everything, and only then point the server at it. The originals stay where they are
export async function useOwnDataFolder(profileId: string, isRunning: (id: string) => Promise<boolean>): Promise<{ success: boolean; message: string; worldSavePath?: string }> {
  const profile = getProfile(profileId)
  if (!profile) return { success: false, message: 'That server is no longer in your list.' }
  if (await isRunning(profileId)) return { success: false, message: 'Stop the server first.' }
  const serverName = getServerName(profile)
  const from = resolveDataPath(profile.worldSavePath)
  const target = ownDataFolder(serverName)
  const to = resolveDataPath(target)
  if (sameFolder(from, to)) return { success: true, message: 'This server already has its own folder.', worldSavePath: target }
  if (existsSync(to) && readdirSync(to).length > 0) {
    return { success: false, message: `There's already something in ${to}. Move or delete that folder first.` }
  }

  const items = serverFiles(serverName).filter(rel => existsSync(join(from, rel)))
  const backups = `pzm-backups\\${serverName}`
  try {
    for (const rel of items) {
      await mkdir(dirname(join(to, rel)), { recursive: true })
      // backups share their unchanged files as hard links, a plain copy would make each one full size
      if (rel === backups) await copyBackupsFolder(join(from, rel), join(to, rel))
      else await cp(join(from, rel), join(to, rel), { recursive: true, errorOnExist: true, force: false, preserveTimestamps: true })
    }
    for (const rel of items) {
      if (rel === backups) {
        const problem = await backupsCopyProblem(join(from, rel), join(to, rel))
        if (problem) throw new Error(`the copy of ${rel} isn't complete: ${problem}`)
        continue
      }
      const [a, b] = await Promise.all([sizeOf(join(from, rel)), sizeOf(join(to, rel))])
      if (a !== b) throw new Error(`the copy of ${rel} isn't the same size as the original (${b} of ${a} bytes)`)
    }
  } catch (e) {
    await rm(to, { recursive: true, force: true }).catch(() => undefined)
    return { success: false, message: `Nothing was changed, the copy didn't work: ${e instanceof Error ? e.message : String(e)}` }
  }
  await mkdir(to, { recursive: true })
  patchProfile(profileId, { worldSavePath: target })
  return {
    success: true,
    worldSavePath: target,
    message: `Done. This server keeps its world, settings, players and log in ${to} now. The old copy is still in ${from}, you can delete it once you're happy.`,
  }
}

export function setupDataFolderHandlers(isRunning: (id: string) => Promise<boolean>) {
  ipcMain.handle('server:dataFolder', async (_event, profileId: string) => dataFolderInfo(profileId))
  ipcMain.handle('server:useOwnDataFolder', async (_event, profileId: string) => {
    try {
      // no start while the files move, and no backup or restore of them meanwhile
      return await whileBusy({ profileId }, 'data-folder', 'Moving the files...', () => oneAtATime(profileId, () => useOwnDataFolder(profileId, isRunning)))
    } catch (e) {
      return { success: false, message: e instanceof Error ? e.message : String(e) }
    }
  })
}
