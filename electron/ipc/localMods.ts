import { ipcMain, app } from 'electron'
import { join, basename } from 'path'
import { existsSync, cpSync, mkdirSync, readFileSync } from 'fs'
import { cp } from 'fs/promises'
import { resolveDataPath } from './dataFolder'
import { listDirs, parseModInfo, scanModFolders } from './modManager'
import { enabledIds } from '../../shared/modCore'
import { sameFolder } from '../../shared/dataFolder'
import type { ServerProfile } from './profileManager'

// ---------------------------------------------------------------------------
// Small fix mods that ship with the app (repo folder local-mods/, packaged as an
// extra resource). They aren't on the workshop, so whoever hosts a server that uses
// them needs them in <Zomboid>\mods. Friends install them with local-mods/install.ps1.
// ---------------------------------------------------------------------------
function bundledDir(): string {
  return app.isPackaged ? join(process.resourcesPath, 'local-mods') : join(app.getAppPath(), 'local-mods')
}

// B42 layout: local-mods/<Folder>/42/mod.info
function listBundled(): Array<{ folder: string; id: string; name: string }> {
  const out: Array<{ folder: string; id: string; name: string }> = []
  for (const folder of listDirs(bundledDir())) {
    const infoPath = join(bundledDir(), folder, '42', 'mod.info')
    if (!existsSync(infoPath)) continue
    const info = parseModInfo(readFileSync(infoPath, 'utf-8'))
    if (info.id) out.push({ folder, id: info.id, name: info.name || info.id })
  }
  return out
}

export function installLocalMods(modIds: string[], worldSavePath?: string): { installed: string[]; missing: string[] } {
  const bundled = listBundled()
  const target = join(resolveDataPath(worldSavePath), 'mods')
  mkdirSync(target, { recursive: true })
  const installed: string[] = []
  const missing: string[] = []
  for (const id of modIds) {
    const mod = bundled.find(b => b.id === id)
    if (!mod) { missing.push(id); continue }
    // ours, so overwriting an older copy is the point
    cpSync(join(bundledDir(), mod.folder), join(target, mod.folder), {
      recursive: true,
      force: true,
      filter: src => basename(src) !== '.gitkeep',
    })
    // B42 mods have a common/ folder; packaging drops it when it's empty
    mkdirSync(join(target, mod.folder, 'common'), { recursive: true })
    installed.push(id)
  }
  return { installed, missing }
}

// A server with a data folder of its own reads local mods from <its folder>\mods, but they
// usually got put in the shared Zomboid\mods (by hand, by older versions, by a preset). Copy
// the ones it uses and doesn't have yet: the app's own fix mods, or the shared folder's copy.
// Returns the ids copied
export async function syncLocalMods(profile: Pick<ServerProfile, 'worldSavePath' | 'mods'>): Promise<string[]> {
  const dataPath = resolveDataPath(profile.worldSavePath)
  const shared = resolveDataPath()
  if (sameFolder(dataPath, shared)) return []
  const wanted = profile.mods.filter(m => !m.workshopId).flatMap(enabledIds)
  if (wanted.length === 0) return []
  const have = new Set((await scanModFolders(join(dataPath, 'mods'))).map(f => f.info.id))
  const missing = wanted.filter(id => !have.has(id))
  if (missing.length === 0) return []
  const copied = installLocalMods(missing, profile.worldSavePath).installed
  for (const { folder, info } of await scanModFolders(join(shared, 'mods'))) {
    if (!missing.includes(info.id) || copied.includes(info.id) || existsSync(join(dataPath, 'mods', folder))) continue
    await cp(join(shared, 'mods', folder), join(dataPath, 'mods', folder), { recursive: true })
    copied.push(info.id)
  }
  return copied
}

export function setupLocalModHandlers() {
  ipcMain.handle('localMods:install', async (_event, modIds: string[], worldSavePath?: string) => {
    try {
      return { success: true, ...installLocalMods(modIds, worldSavePath) }
    } catch (e) {
      return { success: false, installed: [], missing: modIds, message: e instanceof Error ? e.message : String(e) }
    }
  })
}
