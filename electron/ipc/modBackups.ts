import { ipcMain } from 'electron'
import { join } from 'path'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, renameSync } from 'fs'
import { cp, rm, readdir, stat } from 'fs/promises'
import { createHash } from 'crypto'
import { loadSettings, saveSettings } from './appSettings'
import { workshopContentDir, scanModFolders, listDirs } from './modManager'
import { resolveDataPath } from './serverManager'
import { folderSize, forgetFolderSize } from './folderSize'
import type { ModInfo } from '../../shared/modCore'

// Mod backups: a copy of every Workshop mod the server downloads, in one folder. If a mod
// gets pulled from the Workshop, or an update breaks something, the saved copy can be put
// in as a local mod (and server packs hand local mods to friends).

// versions kept per mod
const KEEP = 2

export function backupDir(): string {
  return loadSettings().modBackupDir || join(resolveDataPath(), 'Knox mod backups')
}

interface BackupMeta { workshopId: string; name?: string; savedAt: string; stamp: string }

// cheap "did it change": every file's path, size and time, without reading the files
async function stamp(dir: string): Promise<string> {
  const hash = createHash('sha256')
  const walk = async (d: string, rel: string) => {
    const entries = (await readdir(d, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))
    for (const e of entries) {
      const p = join(d, e.name)
      if (e.isDirectory()) await walk(p, `${rel}/${e.name}`)
      else { const s = await stat(p); hash.update(`${rel}/${e.name}:${s.size}:${Math.floor(s.mtimeMs)}\n`) }
    }
  }
  await walk(dir, '')
  return hash.digest('hex')
}

function versions(workshopId: string): Array<BackupMeta & { dir: string }> {
  const itemDir = join(backupDir(), workshopId)
  if (!existsSync(itemDir)) return []
  const out: Array<BackupMeta & { dir: string }> = []
  for (const name of readdirSync(itemDir)) {
    try {
      const meta = JSON.parse(readFileSync(join(itemDir, name, 'backup.json'), 'utf-8')) as BackupMeta
      out.push({ ...meta, dir: join(itemDir, name) })
    } catch { /* half-written copy, ignore */ }
  }
  return out.sort((a, b) => b.savedAt.localeCompare(a.savedAt))
}

// one at a time, a big mod can take a while to copy
let queue: Promise<unknown> = Promise.resolve()

export function backupItem(workshopId: string, name?: string): Promise<'saved' | 'same' | 'missing'> {
  const job = queue.then(async () => {
    const src = join(workshopContentDir(loadSettings().serverInstallPath), workshopId)
    if (!/^\d+$/.test(workshopId) || !existsSync(src)) return 'missing' as const
    const s = await stamp(src)
    const have = versions(workshopId)
    if (have[0]?.stamp === s) return 'same' as const
    const savedAt = new Date().toISOString()
    const target = join(backupDir(), workshopId, savedAt.replace(/[:.]/g, '-'))
    await cp(src, join(target, 'files'), { recursive: true })
    // written last, so a copy that didn't finish is never picked up
    writeFileSync(join(target, 'backup.json'), JSON.stringify({ workshopId, name: name || have[0]?.name, savedAt, stamp: s }, null, 2))
    for (const old of versions(workshopId).slice(KEEP)) await rm(old.dir, { recursive: true, force: true })
    forgetFolderSize(backupDir())
    return 'saved' as const
  })
  queue = job.catch(() => undefined)
  return job
}

// after SteamCMD downloads, when backups are on
export function backupAfterDownload(workshopIds: string[]) {
  if (!loadSettings().modBackups) return
  for (const id of workshopIds) void backupItem(id).catch(() => undefined)
}

export function listBackups(): Record<string, { name?: string; savedAt: string; versions: number }> {
  const dir = backupDir()
  const out: Record<string, { name?: string; savedAt: string; versions: number }> = {}
  if (!existsSync(dir)) return out
  for (const id of readdirSync(dir).filter(n => /^\d+$/.test(n))) {
    const v = versions(id)
    if (v.length) out[id] = { name: v[0].name, savedAt: v[0].savedAt, versions: v.length }
  }
  return out
}

/**
 * Put the newest saved copy of a Workshop item into <Zomboid>\mods as local mods. A folder
 * already there with the same name is moved aside, not deleted.
 */
export async function useBackup(workshopId: string, dataDir: string): Promise<{ folders: string[]; infos: ModInfo[]; savedAt: string }> {
  const latest = versions(workshopId)[0]
  if (!latest) throw new Error("There's no saved copy of that mod.")
  const src = join(latest.dir, 'files', 'mods')
  const folders = existsSync(src) ? listDirs(src) : []
  if (folders.length === 0) throw new Error("The saved copy doesn't have any mods in it.")
  const modsDir = join(dataDir, 'mods')
  mkdirSync(modsDir, { recursive: true })
  for (const folder of folders) {
    const target = join(modsDir, folder)
    if (existsSync(target)) {
      const aside = join(dataDir, 'pzm-mod-backups')
      mkdirSync(aside, { recursive: true })
      renameSync(target, join(aside, `${folder}-${new Date().toISOString().replace(/[:.]/g, '-')}`))
    }
    await cp(join(src, folder), target, { recursive: true })
  }
  const infos = (await scanModFolders(modsDir)).filter(f => folders.includes(f.folder)).map(f => f.info)
  return { folders, infos, savedAt: latest.savedAt }
}

export function setupModBackupHandlers() {
  const wrap = <A extends unknown[], R>(fn: (...args: A) => Promise<R> | R) => async (_e: unknown, ...args: A) => {
    try { return { success: true, ...(await fn(...args)) } } catch (e) {
      return { success: false, message: e instanceof Error ? e.message : String(e) }
    }
  }

  ipcMain.handle('modBackups:status', wrap(async (withSize?: boolean) => {
    const s = loadSettings()
    const dir = backupDir()
    return {
      enabled: !!s.modBackups,
      dir,
      items: listBackups(),
      sizeBytes: withSize && existsSync(dir) ? await folderSize(dir, 60000) : undefined,
    }
  }))

  ipcMain.handle('modBackups:configure', wrap((patch: { enabled?: boolean; dir?: string }) => {
    saveSettings({
      ...(patch.enabled !== undefined ? { modBackups: patch.enabled } : {}),
      ...(patch.dir !== undefined ? { modBackupDir: patch.dir || undefined } : {}),
    })
    return {}
  }))

  ipcMain.handle('modBackups:backupNow', wrap(async (items: Array<{ workshopId: string; name?: string }>) => {
    let saved = 0, same = 0, missing = 0
    for (const it of items) {
      const r = await backupItem(it.workshopId, it.name)
      if (r === 'saved') saved++; else if (r === 'same') same++; else missing++
    }
    return { saved, same, missing }
  }))

  ipcMain.handle('modBackups:use', wrap((workshopId: string, worldSavePath?: string) => useBackup(workshopId, resolveDataPath(worldSavePath))))
}
